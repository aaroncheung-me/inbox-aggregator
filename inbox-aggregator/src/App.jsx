import { useEffect, useRef, useState } from 'react';
import {
  getMessages,
  getMessage,
  getAccounts,
  updateAccount,
  syncAll,
  searchMessagesBasic,
  askAssistant,
  getNotes,
  createNote,
  aiSaveNote,
  suggestOrganizing,
  getStatus,
  updateNote,
  deleteNote,
  addNoteAddon,
  updateNoteAddon,
  removeNoteAddon,
  getReplyInfo,
  sendEmail,
  getSendStatus,
  cancelSend,
} from './api';
import { PHONE_LAYOUT } from './layout';
import { dueReminderCount } from './notes';
import { newDraft, draftFromMessage, fullBody, draftHasContent, DRAFT_TITLES } from './compose';
import { useNow } from './hooks/useNow';
import Sidebar from './components/Sidebar';
import MainPane from './components/MainPane';
import CreditsBanner from './components/CreditsBanner';
import DraftAssistant from './components/DraftAssistant';
import SendingBar from './components/SendingBar';
import './styles/app.scss';

const PAGE_SIZE = 25;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// The least recently synced account decides the "synced Xm ago" label, so it
// never looks fresher than it is. Any never-synced account means "never synced".
function oldestSyncTime(accounts) {
  if (!accounts.length) return null;
  const times = accounts.map(a => a.last_synced_at);
  if (times.some(t => !t)) return null;
  return times.reduce((oldest, t) => (t < oldest ? t : oldest));
}

// After connecting an account, the server redirects back with ?connected=<email>
// or ?connect_error=<reason>. Read it once at startup and tidy the URL.
function readConnectResult() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const error = params.get('connect_error');
  if (!connected && !error) return null;

  window.history.replaceState(null, '', window.location.pathname);
  return connected
    ? { type: 'success', text: `Connected ${connected}` }
    : { type: 'error', text: `Couldn't connect account: ${error}` };
}

const connectResult = readConnectResult();

// The installed app's icon shortcuts (see manifest.webmanifest) open
// /?action=new-note or /?action=ask. Read once at startup and tidy the URL.
function readLaunchAction() {
  const action = new URLSearchParams(window.location.search).get('action');
  if (action !== 'new-note' && action !== 'ask') return null;
  window.history.replaceState(null, '', window.location.pathname);
  return action;
}

const launchAction = readLaunchAction();
// StrictMode runs effects twice in development; this keeps the startup sync to one run
let startupSyncStarted = false;
// Opening the app syncs if the least recently synced account is older than this.
// (On a free host the server sleeps, so nothing syncs in the background.)
const SYNC_ON_OPEN_AFTER_MS = 5 * 60 * 1000;

// Syncs every account, then fetches what the sidebar needs to reflect it.
// `page` is null when nothing new arrived, so the list (and any "load more"
// progress) is left alone.
// folder: the list on screen, 'inbox' or 'sent'
async function syncAndReload(folder) {
  const result = await syncAll();
  for (const r of result.results) {
    if (r.error) console.error(`Sync failed for ${r.emailAddress}: ${r.error}`);
  }
  const [accounts, page] = await Promise.all([
    getAccounts(),
    result.saved > 0 ? getMessages({ limit: PAGE_SIZE, offset: 0, folder }) : null,
  ]);
  return { accounts, page };
}

function App({ userEmail, onSignOut }) {
  // message list + pagination
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // bumped whenever the list is reloaded, so slower, older responses can be ignored
  const listVersion = useRef(0);
  // which mail the list holds: 'inbox' (received) or 'sent', chosen above the
  // list. The ref is for async code that must use the current one.
  const [folder, setFolder] = useState('inbox');
  const listFolder = useRef('inbox');

  // accounts / sync status
  const [accounts, setAccounts] = useState([]);
  // a just-connected account is synced immediately on load
  const [syncing, setSyncing] = useState(connectResult?.type === 'success');
  const [notice, setNotice] = useState(connectResult);
  const colorSaveTimers = useRef(new Map()); // accountId -> pending save timer

  // selected email
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  // phone layout only: 'list' (sidebar) or 'main' (email or chat)
  const [phoneScreen, setPhoneScreen] = useState('list');
  // the last email fetched: { id, message, error }. Loading and errors are read
  // off it below, so a stale response can't show under a newer selection.
  const [loadedMessage, setLoadedMessage] = useState(null);
  const current = loadedMessage?.id === selectedMessageId ? loadedMessage : null;
  const selectedMessage = current?.message ?? null;
  const messageError = current?.error ?? null;
  const messageLoading = selectedMessageId != null && !current;

  // basic search: null = showing the inbox, otherwise
  // { query, results, hasMore, loading, loadingMore, error }
  const [search, setSearch] = useState(null);

  // AI chat
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);

  // notes: the sidebar shows either the inbox or the notes
  // the "New note" shortcut opens straight onto Notes
  const [tab, setTab] = useState(launchAction === 'new-note' ? 'notes' : 'inbox');
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const selectedNote = notes.find(note => note.id === selectedNoteId) || null;
  // a heads-up from the last AI save, shown on the note it made: { noteId, message }
  const [aiHeadsUp, setAiHeadsUp] = useState(null);

  // writing an email: the draft (see compose.js) or null, whether it's on screen
  // (the assistant beside it can open emails and notes), and that assistant's own chat
  const [draft, setDraft] = useState(null);
  const [draftVisible, setDraftVisible] = useState(false);
  const [draftChat, setDraftChat] = useState([]);
  const [draftChatLoading, setDraftChatLoading] = useState(false);
  const [draftChatError, setDraftChatError] = useState(null);
  // bumped whenever a draft opens or closes, so a late answer about an old one is dropped
  const draftSession = useRef(0);
  const [sending, setSending] = useState(false);
  // the email just sent, until it's confirmed: { id, sendAt, draft, chat, status, error, undoError }
  const [outgoing, setOutgoing] = useState(null);
  const followedSend = useRef(null); // the outbox id whose progress is being checked

  // out-of-credits problems with the AI providers, for the red banner
  const [providerProblems, setProviderProblems] = useState([]);
  const [hiddenProblems, setHiddenProblems] = useState({}); // provider -> the `since` that was hidden

  function refreshStatus() {
    getStatus().then(status => setProviderProblems(status.problems)).catch(() => {});
  }

  // checked on open and every few minutes, since background syncs can hit it too
  useEffect(() => {
    let active = true;
    const load = () => getStatus().then(status => { if (active) setProviderProblems(status.problems); }).catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  // re-checked every minute, so a reminder turns due while the app is open
  const now = useNow();

  // initial load
  useEffect(() => {
    getNotes().then(setNotes).catch(() => {});

    getMessages({ limit: PAGE_SIZE, offset: 0 })
      .then(data => {
        setMessages(data.messages);
        setTotal(data.total);
      })
      .catch(() => {});

    const accountsLoaded = getAccounts();
    accountsLoaded.then(setAccounts).catch(() => {});

    if (startupSyncStarted) return;
    startupSyncStarted = true;

    // Sync right after connecting an account, or when opening the app with stale
    // mail. The saved messages above show immediately; new ones appear when this finishes.
    const syncNeeded = connectResult?.type === 'success'
      ? Promise.resolve(true)
      : accountsLoaded.then(accounts => {
          const oldest = oldestSyncTime(accounts);
          return accounts.length > 0 && (!oldest || Date.now() - new Date(oldest).getTime() > SYNC_ON_OPEN_AFTER_MS);
        });

    syncNeeded
      .then(needed => {
        if (!needed) return;
        setSyncing(true);
        return syncAndReload(listFolder.current).then(({ accounts, page }) => {
          setAccounts(accounts);
          if (page) {
            setMessages(page.messages);
            setTotal(page.total);
          }
        });
      })
      .catch(err => console.error(err))
      .finally(() => setSyncing(false));
  }, []);

  // fetch full detail whenever a message is selected; a response for an email
  // that's no longer selected (clicked away before it arrived) is dropped
  useEffect(() => {
    if (selectedMessageId == null) return;
    let stale = false;
    getMessage(selectedMessageId)
      .then(message => { if (!stale) setLoadedMessage({ id: selectedMessageId, message, error: null }); })
      .catch(err => { if (!stale) setLoadedMessage({ id: selectedMessageId, message: null, error: err.message }); });
    return () => { stale = true; };
  }, [selectedMessageId]);

  // Replaces the list with the first page. Returns false if a newer reload
  // started while this one was in flight (its result is then dropped).
  function showFirstPage(page, version) {
    if (version !== listVersion.current) return false;
    setMessages(page.messages);
    setTotal(page.total);
    return true;
  }

  async function reloadMessages() {
    const version = ++listVersion.current;
    showFirstPage(await getMessages({ limit: PAGE_SIZE, offset: 0, folder: listFolder.current }), version);
  }

  // Received and Sent share the one list: switching between them reloads it.
  function changeFolder(next) {
    if (next === listFolder.current) return;
    listFolder.current = next;
    setFolder(next);
    setMessages([]);
    setTotal(0);
    reloadMessages().catch(err => console.error(err));
  }

  async function loadMore() {
    const version = listVersion.current;
    setLoadingMore(true);
    try {
      const data = await getMessages({ limit: PAGE_SIZE, offset: messages.length, folder: listFolder.current });
      // the list was reloaded mid-request (e.g. an account toggled), so this page no longer fits
      if (version === listVersion.current) setMessages(prev => [...prev, ...data.messages]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const version = ++listVersion.current;
      const { accounts, page } = await syncAndReload(listFolder.current);
      setAccounts(accounts);
      // refresh from the top so newly synced messages appear
      if (page) showFirstPage(page, version);
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
      refreshStatus(); // indexing new mail may have hit a credits problem
    }
  }

  // Updates the checkbox immediately, then saves; puts it back if saving fails.
  async function handleToggleAccount(accountId, showInInbox) {
    const setShown = shown =>
      setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, show_in_inbox: shown } : a)));

    setShown(showInInbox);
    try {
      await updateAccount(accountId, { show_in_inbox: showInInbox });
      await reloadMessages();
    } catch (err) {
      console.error(err);
      setShown(!showInInbox);
      setNotice({ type: 'error', text: "Couldn't update that account, try again" });
    }
  }

  // Recolors immediately; saves once the color stops changing, since the
  // custom picker fires on every step of a drag. On failure, reloads the
  // accounts so the dot shows what's actually saved.
  function handleChangeAccountColor(accountId, color) {
    setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, color } : a)));

    clearTimeout(colorSaveTimers.current.get(accountId));
    colorSaveTimers.current.set(accountId, setTimeout(async () => {
      colorSaveTimers.current.delete(accountId);
      try {
        await updateAccount(accountId, { color });
      } catch (err) {
        console.error(err);
        setNotice({ type: 'error', text: "Couldn't save that color, try again" });
        getAccounts().then(setAccounts).catch(() => {});
      }
    }, 400));
  }

  // Form-based connects (IMAP) finish without leaving the page, so sync right away.
  // Sign-in connects (Gmail) come back through a redirect instead, see readConnectResult.
  function handleAccountConnected(emailAddress) {
    setNotice({ type: 'success', text: `Connected ${emailAddress}` });
    getAccounts().then(setAccounts).catch(() => {}); // show it in the panel before its first sync finishes
    handleSync();
  }

  // Results only apply if the search box still holds the same query when they arrive.
  function updateSearchIfCurrent(query, changes) {
    setSearch(prev => (prev?.query === query ? { ...prev, ...changes } : prev));
  }

  async function handleSearch(query) {
    setSearch({ query, results: [], hasMore: false, loading: true, loadingMore: false, error: null });
    try {
      const data = await searchMessagesBasic(query);
      updateSearchIfCurrent(query, { results: data.messages, hasMore: data.hasMore, loading: false });
    } catch (err) {
      updateSearchIfCurrent(query, { loading: false, error: err.message });
    }
  }

  async function loadMoreSearch() {
    const { query, results } = search;
    updateSearchIfCurrent(query, { loadingMore: true });
    try {
      const data = await searchMessagesBasic(query, { offset: results.length });
      setSearch(prev => (prev?.query === query
        ? { ...prev, results: [...prev.results, ...data.messages], hasMore: data.hasMore, loadingMore: false }
        : prev));
    } catch (err) {
      console.error(err);
      updateSearchIfCurrent(query, { loadingMore: false });
    }
  }

  // ---------- phone screens ----------
  // Opening the main screen adds a browser history entry, so the phone's back
  // gesture (or back button) returns to the list instead of leaving the app.

  useEffect(() => {
    function handlePopState() {
      setPhoneScreen(window.history.state?.screen === 'main' ? 'main' : 'list');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function showMainScreen() {
    if (phoneScreen === 'main' || !window.matchMedia(PHONE_LAYOUT).matches) return;
    window.history.pushState({ screen: 'main' }, '');
    setPhoneScreen('main');
  }

  function showListScreen() {
    // going back through history keeps it in step; popstate then switches the screen
    if (window.history.state?.screen === 'main') window.history.back();
    else setPhoneScreen('list');
  }

  // The main pane shows one thing at a time: an email, a note, or the chat.

  // (While an email is being written, these open things from its assistant,
  // and the draft waits behind a "Back to your email" link.)

  function openMessage(id) {
    setDraftVisible(false);
    setSelectedNoteId(null);
    setSelectedMessageId(id);
    showMainScreen();
  }

  function openNote(id) {
    setDraftVisible(false);
    setSelectedMessageId(null);
    setSelectedNoteId(id);
    setTab('notes');
    showMainScreen();
  }

  function openChat() {
    setDraftVisible(false);
    setSelectedNoteId(null);
    setSelectedMessageId(null);
    showMainScreen();
  }

  function showDraft() {
    setDraftVisible(true);
    showMainScreen();
  }

  // ---------- writing and sending email ----------

  const ownAddresses = accounts.map(a => a.email_address.toLowerCase());

  // Opens a draft on the writing screen (chat: its assistant conversation, when
  // bringing back one that was undone). Asks first if it would replace one with
  // text in it, unless the caller already has (force).
  function openDraft(next, chat = [], force = false) {
    if (!force && draft && draftHasContent(draft) && !window.confirm('Discard the email you are writing?')) return false;
    draftSession.current++;
    setDraft(next);
    setDraftChat(chat);
    setDraftChatError(null);
    setDraftChatLoading(false);
    showDraft();
    return true;
  }

  function closeDraft() {
    draftSession.current++;
    setDraft(null);
    setDraftVisible(false);
    setDraftChat([]);
    setDraftChatError(null);
    setDraftChatLoading(false);
  }

  function handleNewEmail() {
    const account = accounts.find(a => a.show_in_inbox) || accounts[0];
    if (!account) {
      setNotice({ type: 'error', text: 'Connect an email account first' });
      return;
    }
    openDraft(newDraft(account.id));
  }

  // kind: 'reply' | 'replyAll' | 'forward', on the email that's open. The draft
  // opens straight away; if the sender asked for replies to go elsewhere
  // (Reply-To), the To line is updated when that arrives, unless it was edited.
  function handleReply(kind) {
    const message = selectedMessage;
    if (!message) return;
    const initial = draftFromMessage(kind, message, ownAddresses);
    if (!openDraft(initial) || kind === 'forward') return;

    getReplyInfo(message.id).then(({ replyTo }) => {
      if (!replyTo) return;
      const better = draftFromMessage(kind, message, ownAddresses, replyTo);
      setDraft(prev => (prev?.originalMessageId === message.id && prev.to === initial.to && prev.cc === initial.cc
        ? { ...prev, to: better.to, cc: better.cc, showCcBcc: prev.showCcBcc || Boolean(better.cc) }
        : prev));
    });
  }

  function updateDraft(changes) {
    setDraft(prev => (prev ? { ...prev, ...changes, error: null } : prev));
  }

  // On a phone this always lands on the list, whichever of the draft's two
  // screens (the email or its assistant) it was discarded from.
  function handleDiscardDraft() {
    if (draftHasContent(draft) && !window.confirm('Discard this email?')) return;
    closeDraft();
    showListScreen();
  }

  async function handleSendDraft() {
    if (!draft || sending) return;
    const sent = draft;
    setSending(true);
    try {
      const { id, sendAt } = await sendEmail({
        accountId: sent.accountId,
        to: sent.to,
        cc: sent.showCcBcc ? sent.cc : '',
        bcc: sent.showCcBcc ? sent.bcc : '',
        subject: sent.subject,
        body: fullBody(sent),
        // a forward starts a new conversation, so only replies are threaded
        replyToMessageId: sent.mode === 'reply' ? sent.originalMessageId : null,
      });
      setOutgoing({ id, sendAt, draft: sent, chat: draftChat, status: 'waiting', error: null, undoError: null });
      closeDraft();
      followSend(id, sendAt);
    } catch (err) {
      setDraft(prev => (prev ? { ...prev, error: err.message } : prev));
    } finally {
      setSending(false);
    }
  }

  // Once the undo time is up, checks until the server says it went (or didn't).
  async function followSend(id, sendAt) {
    followedSend.current = id;
    const update = changes => setOutgoing(prev => (prev?.id === id ? { ...prev, ...changes } : prev));

    await delay(Math.max(0, new Date(sendAt).getTime() - Date.now()) + 1500);
    for (let attempt = 0; attempt < 10; attempt++) {
      if (followedSend.current !== id) return; // undone
      try {
        const { status, error } = await getSendStatus(id);
        if (followedSend.current !== id) return;
        if (status === 'failed') return update({ status, error });
        if (status === 'sent') {
          update({ status });
          setTimeout(() => setOutgoing(prev => (prev?.id === id ? null : prev)), 4000);
          // the server syncs the account after sending, bringing in the sent copy
          setTimeout(() => reloadMessages().catch(() => {}), 4000);
          return;
        }
      } catch {
        // checked again below
      }
      await delay(2000);
    }
    update({ status: 'unknown' });
  }

  async function handleUndoSend() {
    const { id, draft: unsent, chat } = outgoing;
    // asked before cancelling, so the undone email can't be lost
    if (draft && draftHasContent(draft) && !window.confirm('Undo brings that email back in place of the one you are writing. Continue?')) return;
    try {
      await cancelSend(id);
    } catch (err) {
      setOutgoing(prev => (prev?.id === id ? { ...prev, undoError: err.message } : prev));
      return;
    }
    followedSend.current = null;
    setOutgoing(null);
    openDraft(unsent, chat, true);
  }

  // "Open email" on a send that failed: back to the writing screen, with the reason
  function handleReopenFailedSend() {
    const { draft: unsent, chat, error } = outgoing;
    if (openDraft({ ...unsent, error }, chat)) setOutgoing(null);
  }

  // The assistant beside the writing screen. It gets the draft as it stands,
  // and returns a suggested draft only when asked for one.
  async function handleAskAboutDraft(question) {
    if (!draft) return;
    const session = draftSession.current;
    setDraftChatLoading(true);
    setDraftChatError(null);
    try {
      const history = draftChat.map(({ question: q, answer }) => ({ question: q, answer }));
      const result = await askAssistant(question, history, {
        draft: {
          mode: draft.mode,
          from: accounts.find(a => a.id === draft.accountId)?.email_address || '',
          to: draft.to,
          cc: draft.showCcBcc ? draft.cc : '',
          subject: draft.subject,
          body: draft.body,
          replyToMessageId: draft.originalMessageId,
        },
      });
      if (session !== draftSession.current) return;
      setDraftChat(prev => [...prev, { question, ...result }]);
      if (result.createdNotes?.length) await refreshNotes();
    } catch (err) {
      if (session === draftSession.current) setDraftChatError(err.message);
    } finally {
      if (session === draftSession.current) setDraftChatLoading(false);
      refreshStatus();
    }
  }

  // Puts the assistant's draft into the email. What the user had before is
  // kept (from before the first AI draft), so Undo always returns to their own text.
  function handleUseAiDraft(exchangeIndex) {
    const suggestion = draftChat[exchangeIndex]?.draft;
    if (!suggestion || !draft) return;
    setDraft(prev => ({
      ...prev,
      body: suggestion.body,
      subject: suggestion.subject || prev.subject,
      aiPrevious: prev.aiPrevious || { body: prev.body, subject: prev.subject },
      error: null,
    }));
    setDraftChat(prev => prev.map((exchange, i) => ({ ...exchange, draftUsed: i === exchangeIndex })));
    showDraft();
  }

  function handleUndoAiDraft() {
    setDraft(prev => (prev?.aiPrevious ? { ...prev, ...prev.aiPrevious, aiPrevious: null } : prev));
    setDraftChat(prev => prev.map(exchange => ({ ...exchange, draftUsed: false })));
  }

  async function handleUndoDraftChatNote(exchangeIndex, noteId) {
    await deleteNote(noteId);
    setDraftChat(prev => prev.map((exchange, i) => (i !== exchangeIndex ? exchange : {
      ...exchange,
      createdNotes: exchange.createdNotes.map(note => (note.id === noteId ? { ...note, undone: true } : note)),
    })));
    await refreshNotes();
  }

  // closing the tab or app with an unsent draft asks first
  const draftAtRisk = Boolean(draft && draftHasContent(draft));
  useEffect(() => {
    if (!draftAtRisk) return;
    const warn = e => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftAtRisk]);

  // ---------- notes ----------
  // Every change goes to the server, then the list is reloaded from it, so the
  // app always shows what's saved (notes are few, so reloading is cheap).

  async function refreshNotes() {
    setNotes(await getNotes());
  }

  // Saving from the Notes box or from "+ Note" on an email (where addons already
  // include the link to that email). Either way the new note opens, so it's
  // clear it was made and any mistakes are visible straight away. (Going back to
  // the email later reloads it, so its new sticky note shows there too.)
  async function handleCreateNote(body, addons) {
    const { id } = await createNote(body, addons);
    await refreshNotes();
    openNote(id);
  }

  // AI save: the AI rewrites the text and adds more add-ons. Anything it wants
  // the user to know (e.g. an email it couldn't find) shows on the opened note.
  async function handleAiSaveNote(body, addons) {
    try {
      const { id, message } = await aiSaveNote(body, addons);
      await refreshNotes();
      setAiHeadsUp(message ? { noteId: id, message } : null);
      openNote(id);
    } finally {
      refreshStatus();
    }
  }

  async function handleSaveNoteBody(noteId, body) {
    await updateNote(noteId, { body });
    setNotes(prev => prev.map(note => (note.id === noteId ? { ...note, body } : note)));
  }

  // Dragging: moves the note on screen straight away, then saves the new position.
  async function handleMoveNote(noteId, position) {
    setNotes(prev => prev
      .map(note => (note.id === noteId ? { ...note, position } : note))
      .sort((a, b) => a.position - b.position));
    try {
      await updateNote(noteId, { position });
    } catch (err) {
      console.error(err);
      setNotice({ type: 'error', text: "Couldn't save the new order, try again" });
      refreshNotes().catch(() => {});
    }
  }

  // Applies the Organize suggestions the user kept, through the same routes as
  // doing each by hand. order: { noteIds } in their new order, or null.
  async function handleApplyOrganizing(changes, order) {
    const byId = new Map(notes.map(note => [note.id, note]));
    try {
      for (const change of changes) {
        const note = byId.get(change.noteId);
        if (!note) continue;
        if (change.action === 'pin') await addNoteAddon(note.id, { kind: 'pin' });
        if (change.action === 'unpin' && note.pin) await removeNoteAddon(note.pin.id);
        if (change.action === 'mark_done' && note.reminder) await updateNoteAddon(note.reminder.id, { done: true });
        if (change.action === 'link') await addNoteAddon(note.id, { kind: 'note_link', noteId: change.otherNoteId });
      }
      if (order) {
        // positions 0, 1, 2... in the new order, saving only the ones that change
        for (const [index, noteId] of order.noteIds.entries()) {
          if (byId.get(noteId)?.position !== index) await updateNote(noteId, { position: index });
        }
      }
    } finally {
      await refreshNotes();
    }
  }

  async function handleDeleteNote(noteId) {
    await deleteNote(noteId);
    setSelectedNoteId(null);
    showListScreen();
    await refreshNotes();
  }

  async function handleAddNoteAddon(noteId, addon) {
    await addNoteAddon(noteId, addon);
    await refreshNotes();
  }

  async function handleUpdateNoteAddon(addonId, changes) {
    await updateNoteAddon(addonId, changes);
    await refreshNotes();
  }

  async function handleRemoveNoteAddon(addonId) {
    await removeNoteAddon(addonId);
    await refreshNotes();
  }

  const noteActions = {
    onSaveBody: handleSaveNoteBody,
    onDelete: handleDeleteNote,
    onAddAddon: handleAddNoteAddon,
    onUpdateAddon: handleUpdateNoteAddon,
    onRemoveAddon: handleRemoveNoteAddon,
    onOpenNote: openNote,
    onCreate: handleCreateNote,
    onAiCreate: handleAiSaveNote,
  };

  async function handleAsk(question) {
    // the email on screen when asking is "this email" for the assistant
    const openMessageId = selectedMessageId;
    openChat(); // the answer shows in the chat
    setChatLoading(true);
    setChatError(null);
    try {
      // earlier exchanges go along so follow-up questions make sense
      const history = chatHistory.map(({ question: q, answer }) => ({ question: q, answer }));
      const result = await askAssistant(question, history, { openMessageId });
      setChatHistory(prev => [...prev, { question, ...result }]);
      if (result.createdNotes?.length) await refreshNotes();
    } catch (err) {
      setChatError(err.message);
    } finally {
      setChatLoading(false);
      refreshStatus();
    }
  }

  // Undo on a note the assistant created: deletes it and marks its card as undone.
  async function handleUndoCreatedNote(exchangeIndex, noteId) {
    await deleteNote(noteId);
    if (selectedNoteId === noteId) setSelectedNoteId(null);
    setChatHistory(prev => prev.map((exchange, i) => (i !== exchangeIndex ? exchange : {
      ...exchange,
      createdNotes: exchange.createdNotes.map(note => (note.id === noteId ? { ...note, undone: true } : note)),
    })));
    await refreshNotes();
  }

  const selectedAccount = accounts.find(a => a.id === selectedMessage?.account_id);

  return (
    <div className={`app phone-shows-${phoneScreen}`}>
      <Sidebar
        creditsBanner={(
          <CreditsBanner
            problems={providerProblems}
            hiddenSince={hiddenProblems}
            onHide={problem => setHiddenProblems(prev => ({ ...prev, [problem.provider]: problem.since }))}
          />
        )}
        // while writing an email, the ask box asks that email's assistant
        onAsk={draft ? handleAskAboutDraft : handleAsk}
        focusAskBox={launchAction === 'ask'}
        focusNoteBox={launchAction === 'new-note'}
        chatCount={chatHistory.length}
        onOpenChat={openChat}
        asking={draft ? draftChatLoading : chatLoading}
        lastSyncedAt={oldestSyncTime(accounts)}
        onSync={handleSync}
        syncing={syncing}
        messages={messages}
        selectedId={selectedMessageId}
        onSelect={openMessage}
        hasMore={messages.length < total}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        total={total}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        accounts={accounts}
        onToggleAccount={handleToggleAccount}
        onChangeAccountColor={handleChangeAccountColor}
        onAccountConnected={handleAccountConnected}
        userEmail={userEmail}
        onSignOut={onSignOut}
        search={search}
        // search results are emails, so they show on the Inbox tab
        onSearch={query => { setTab('inbox'); handleSearch(query); }}
        onClearSearch={() => setSearch(null)}
        onLoadMoreSearch={loadMoreSearch}
        tab={tab}
        onTabChange={setTab}
        folder={folder}
        onFolderChange={changeFolder}
        dueCount={dueReminderCount(notes, now)}
        notes={notes}
        now={now}
        selectedNoteId={selectedNoteId}
        onSelectNote={openNote}
        onCreateNote={handleCreateNote}
        onAiCreateNote={handleAiSaveNote}
        onMoveNote={handleMoveNote}
        onSuggestOrganizing={async () => {
          try {
            return await suggestOrganizing();
          } finally {
            refreshStatus();
          }
        }}
        onApplyOrganizing={handleApplyOrganizing}
        onNewEmail={handleNewEmail}
        drafting={draft && {
          title: DRAFT_TITLES[draft.mode],
          onBackToDraft: showDraft,
          onDiscard: handleDiscardDraft,
          chat: (
            <DraftAssistant
              history={draftChat}
              loading={draftChatLoading}
              error={draftChatError}
              onUseDraft={handleUseAiDraft}
              onOpenMessage={openMessage}
              onOpenNote={openNote}
              onUndoCreatedNote={handleUndoDraftChatNote}
            />
          ),
        }}
      />
      <MainPane
        selectedMessageId={selectedMessageId}
        selectedMessage={selectedMessage}
        selectedAccount={selectedAccount}
        messageLoading={messageLoading}
        messageError={messageError}
        chatHistory={chatHistory}
        chatLoading={chatLoading}
        chatError={chatError}
        selectedNote={selectedNote}
        notes={notes}
        now={now}
        noteActions={noteActions}
        aiHeadsUp={aiHeadsUp}
        onDismissAiHeadsUp={() => setAiHeadsUp(null)}
        onOpenMessage={openMessage}
        onUndoCreatedNote={handleUndoCreatedNote}
        onCloseMessage={() => setSelectedMessageId(null)}
        onBackToList={showListScreen}
        // while writing, the list screen is the email's assistant
        backLabel={draft ? 'Assistant' : tab === 'notes' ? 'Notes' : 'Inbox'}
        onReply={handleReply}
        compose={draft && {
          draft,
          visible: draftVisible,
          accounts,
          sending,
          onChange: updateDraft,
          onSend: handleSendDraft,
          onDiscard: handleDiscardDraft,
          onUndoAiDraft: handleUndoAiDraft,
          onShowAssistant: showListScreen,
          onShow: showDraft,
        }}
      />
      {outgoing && (
        <SendingBar
          outgoing={outgoing}
          onUndo={handleUndoSend}
          onOpenDraft={handleReopenFailedSend}
          onDismiss={() => { followedSend.current = null; setOutgoing(null); }}
        />
      )}
    </div>
  );
}

export default App;
