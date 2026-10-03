import { useState } from 'react';
import { dueReminderCount, noteTitle } from './features/notes/notes';
import { DRAFT_TITLES } from './features/compose/compose';
import { useNow } from './hooks/useNow';
import { useRemembered } from './hooks/useRemembered';
import { useNavigation } from './shell/useNavigation';
import { useProviderStatus } from './shell/useProviderStatus';
import { useSync, oldestSyncTime } from './shell/useSync';
import { useMessageList } from './features/email/useMessageList';
import { useOpenEmail } from './features/email/useOpenEmail';
import { useSearch } from './features/email/useSearch';
import { useAccounts } from './features/accounts/useAccounts';
import { useTempAddresses } from './features/accounts/useTempAddresses';
import { useNotes } from './features/notes/useNotes';
import { useChat } from './features/assistant/useChat';
import { useCompose } from './features/compose/useCompose';
import { useScheduled } from './features/compose/useScheduled';
import Sidebar from './shell/Sidebar';
import MainPane from './shell/MainPane';
import CreditsBanner from './shell/CreditsBanner';
import DraftAssistant from './features/compose/DraftAssistant';
import AskBar from './features/assistant/AskBar';
import { askPlaceholders } from './features/assistant/askPlaceholders';
import { PHONE_LAYOUT } from './layout';
import SidebarTabs from './shell/SidebarTabs';
import SendingBar from './features/compose/SendingBar';
import './styles/app.scss';

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
// on a phone, "New note" opens the full-screen new note; on desktop, the Notes box
const startOnNewNote = launchAction === 'new-note' && window.matchMedia(PHONE_LAYOUT).matches;

// The app: each feature keeps its own state in a hook (features/*/use*.js,
// shell/use*.js), and this wires them together and to the two panes.
function App({ userEmail, onSignOut }) {
  const [notice, setNotice] = useState(connectResult);
  // re-checked every minute, so a reminder turns due while the app is open
  const now = useNow();

  const status = useProviderStatus();
  // the "New note" shortcut opens straight onto Notes
  const nav = useNavigation(launchAction === 'new-note' ? 'notes' : 'inbox', { startOnNewNote });
  // the ask bar: AI or Search (shared by the sidebar's bar and the phone's
  // copy), and a count that empties its box when a search is closed
  const [askMode, setAskMode] = useState('ai');
  const [askResets, setAskResets] = useState(0);
  const [noteQuery, setNoteQuery] = useState(null); // a search on the Notes tab
  const [newNoteText, setNewNoteText] = useState(''); // the phone's new note, kept while it's closed with back
  // desktop, remembered on this device: which side things go beside the email
  // being written, and whether the sidebar is folded away
  const [besideSide, setBesideSide] = useRemembered('besideSide', 'right', ['left', 'right']);
  const [sidebar, setSidebar] = useRemembered('sidebar', 'open', ['open', 'closed']);
  const list = useMessageList();
  const accounts = useAccounts({ onNotice: setNotice, reloadMessages: list.reload });
  const temp = useTempAddresses({ onNotice: setNotice, reloadMessages: list.reload });
  const notes = useNotes({ onNotice: setNotice, refreshStatus: status.refresh });
  const sync = useSync({
    // a just-connected account is synced immediately on load
    syncNow: connectResult?.type === 'success',
    list,
    setAccounts: accounts.setAccounts,
    setTemp: temp.setTemp,
    setNotes: notes.setNotes,
    refreshStatus: status.refresh,
  });
  const openEmail = useOpenEmail(nav.selectedMessageId, { reloadMessages: list.reload, onNotice: setNotice });
  // the email beside the one being written, if that's what's beside it
  const besideEmail = useOpenEmail(nav.beside?.kind === 'email' ? nav.beside.id : null, { reloadMessages: list.reload, onNotice: setNotice });
  const search = useSearch();
  const chat = useChat({
    refreshNotes: notes.refresh,
    refreshStatus: status.refresh,
    onNoteDeleted: noteId => nav.closeNote(noteId),
  });
  const scheduled = useScheduled({ reloadMessages: list.reload });
  const compose = useCompose({
    accounts: accounts.accounts,
    openMessage: openEmail.message,
    onNotice: setNotice,
    showDraft: nav.showDraft,
    hideDraft: nav.hideDraft,
    showListScreen: nav.showListScreen,
    reloadMessages: list.reload,
    refreshNotes: notes.refresh,
    refreshStatus: status.refresh,
    onScheduled: scheduled.refresh,
  });
  const { draft } = compose;
  // the email being written is showing (its tab, or on a phone its two screens):
  // the sidebar is then its assistant
  const drafting = draft && nav.draftVisible;

  // Form-based connects (IMAP) finish without leaving the page, so sync right away.
  // Sign-in connects (Gmail) come back through a redirect instead, see readConnectResult.
  function handleAccountConnected(emailAddress) {
    setNotice({ type: 'success', text: `Connected ${emailAddress}` });
    accounts.refresh(); // show it in the panel before its first sync finishes
    sync.sync();
  }

  // Saving from the Notes box or from "+ Note" on an email (where addons already
  // include the link to that email). Either way the new note opens, so it's
  // clear it was made and any mistakes are visible straight away. (Going back to
  // the email later reloads it, so its new sticky note shows there too.)
  // (A note saved from the phone's new-note page takes that page's place.)
  function showSavedNote(noteId) {
    if (nav.newNoteVisible) nav.closeNewNote();
    nav.openNote(noteId, { kept: true });
  }

  async function handleCreateNote(body, addons) {
    showSavedNote(await notes.create(body, addons));
  }

  async function handleAiSaveNote(body, addons) {
    showSavedNote(await notes.aiSave(body, addons));
  }

  async function handleDeleteNote(noteId) {
    await notes.remove(noteId, () => {
      nav.closeNote(noteId);
      nav.showListScreen();
    });
  }

  // Opens an email, named after its subject on its tab. hint: what the caller
  // knows of it ({ subject, account_id }), else it's looked up in the lists.
  // opts: { newTab, at, focus } (see useNavigation).
  function openEmailTab(id, hint, opts) {
    const known = hint
      || [...list.messages, ...list.pinned, ...(search.search?.results || [])].find(m => m.id === id)
      || (openEmail.message?.id === id ? openEmail.message : null);
    nav.openMessage(id, {
      label: known ? known.subject || '(no subject)' : 'Email',
      color: accounts.accounts.find(a => a.id === known?.account_id)?.color,
    }, opts);
  }

  // an email or note dropped on the tab bar: a new tab there
  function openDropped(item, at) {
    if (item.kind === 'email') nav.openMessage(item.id, { label: item.label, color: item.color }, { newTab: true, at });
    else if (item.kind === 'note') nav.openNote(item.id, { newTab: true, at });
  }

  // A reply or forward opens with the email it answers beside it (desktop).
  function handleReply(kind) {
    const emailTab = nav.active?.kind === 'email' ? nav.active.key : null;
    if (compose.reply(kind) && emailTab && !window.matchMedia(PHONE_LAYOUT).matches) nav.showBeside(emailTab);
  }

  // An email or note dropped on one half of the writing screen: beside the
  // draft, on that side. drop: { item } from a list, or { tabKey } from the tab bar.
  function dropBeside({ item, tabKey }, side) {
    if (item?.kind === 'email' || item?.kind === 'note') {
      setBesideSide(side);
      nav.openBeside(item.kind, item.id, item.kind === 'email' ? { label: item.label, color: item.color } : {});
      return;
    }
    const t = nav.tabs.find(other => other.key === tabKey);
    if (t && (t.kind === 'email' || t.kind === 'note')) {
      setBesideSide(side);
      nav.showBeside(tabKey);
    }
  }

  // what each tab is called (emails keep the name they opened with)
  function tabLabel(t) {
    if (t.kind === 'email') return t.label;
    if (t.kind === 'note') return noteTitle(notes.notes.find(n => n.id === t.id)?.body || '') || 'Note';
    if (t.kind === 'draft') return draft ? [DRAFT_TITLES[draft.mode], draft.subject].filter(Boolean).join(': ') : 'Email';
    if (t.kind === 'scheduled') return scheduled.scheduled.find(s => s.id === t.id)?.subject || 'Scheduled email';
    return { chat: 'Assistant', settings: 'Settings', newnote: 'New note', empty: 'New tab' }[t.kind];
  }

  // × on a tab: the email being written and the new note are discarded (the
  // email asks first, if it has anything in it)
  function closeTab(key) {
    const t = nav.tabs.find(other => other.key === key);
    if (t?.kind === 'draft') compose.discard();
    else if (t?.kind === 'newnote') discardNewNote();
    else nav.closeTab(key);
  }

  function discardNewNote() {
    setNewNoteText('');
    nav.closeNewNote();
    nav.showListScreen();
  }

  const noteActions = {
    onSaveBody: notes.saveBody,
    onDelete: handleDeleteNote,
    onAddAddon: notes.addAddon,
    onUpdateAddon: notes.updateAddon,
    onRemoveAddon: notes.removeAddon,
    onOpenNote: id => nav.openNote(id),
    onCreate: handleCreateNote,
    onAiCreate: handleAiSaveNote,
  };

  // the answer shows in the chat; the email on screen is "this email" for the assistant
  function handleAsk(question) {
    const openMessageId = nav.selectedMessageId;
    nav.openChat();
    chat.ask(question, openMessageId);
  }

  // Search looks through whatever the tab lists: emails on Inbox (and while
  // writing), notes on Notes.
  function handleSearch(query) {
    if (nav.tab === 'notes' && !drafting) setNoteQuery(query);
    else search.run(query);
  }

  function clearSearch() {
    search.clear();
    setAskResets(n => n + 1);
  }

  function clearNoteQuery() {
    setNoteQuery(null);
    setAskResets(n => n + 1);
  }

  // a search belongs to its tab, so switching tabs closes it (and the box
  // empties, see askResetKey). On a phone the current tab leads back to its
  // list, results included.
  function handleTabChange(next) {
    if (next === nav.tab) return;
    nav.setTab(next);
    search.clear();
    setNoteQuery(null);
  }

  const askBarProps = {
    mode: askMode,
    onModeChange: setAskMode,
    resetKey: `${nav.tab}:${askResets}`,
    placeholders: askPlaceholders({ drafting, tab: nav.tab }),
  };

  // Received | Sent share one list; Sent also shows the scheduled emails, freshly loaded
  function handleFolderChange(next) {
    list.changeFolder(next);
    if (next === 'sent') scheduled.refresh();
  }

  const scheduledItem = scheduled.scheduled.find(s => s.id === nav.selectedScheduledId) || null;
  const selectedNote = notes.notes.find(note => note.id === nav.selectedNoteId) || null;
  const selectedAccount = accounts.accounts.find(a => a.id === openEmail.message?.account_id);
  const dueCount = dueReminderCount(notes.notes, now);

  return (
    <div className={`app phone-shows-${nav.phoneScreen}${sidebar === 'closed' ? ' sidebar-closed' : ''}`}>
      {/* desktop: the folded sidebar, a strip that brings it back */}
      {sidebar === 'closed' && (
        <div className="sidebar-rail desktop-only">
          <button className="sidebar-toggle" onClick={() => setSidebar('open')} aria-label="Show the sidebar" title="Show the sidebar">»</button>
        </div>
      )}
      <Sidebar
        onCollapse={() => setSidebar('closed')}
        creditsBanner={(
          <CreditsBanner
            problems={status.problems}
            hiddenSince={status.hidden}
            onHide={status.hide}
          />
        )}
        // while writing an email, the ask box asks that email's assistant
        onAsk={drafting ? compose.ask : handleAsk}
        askMode={askMode}
        onAskModeChange={setAskMode}
        askResetKey={askBarProps.resetKey}
        focusAskBox={launchAction === 'ask'}
        focusNoteBox={launchAction === 'new-note'}
        chatCount={chat.history.length}
        onOpenChat={nav.openChat}
        asking={drafting ? compose.chatLoading : chat.loading}
        lastSyncedAt={oldestSyncTime(accounts.accounts)}
        onSync={sync.sync}
        syncing={sync.syncing}
        messages={list.messages}
        tempColors={temp.colors}
        pinned={list.pinned}
        selectedId={nav.selectedMessageId}
        onSelect={(id, opts) => openEmailTab(id, null, opts)}
        hasMore={list.messages.length < list.total}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        total={list.total}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        accounts={accounts.accounts}
        onToggleAccount={accounts.toggle}
        onChangeAccountColor={accounts.changeColor}
        onAccountConnected={handleAccountConnected}
        userEmail={userEmail}
        onSignOut={onSignOut}
        onOpenSettings={nav.openSettings}
        settingsOpen={nav.settingsVisible}
        search={search.search}
        onSearch={handleSearch}
        onClearSearch={clearSearch}
        onLoadMoreSearch={search.loadMore}
        tab={nav.tab}
        onTabChange={handleTabChange}
        folder={list.folder}
        onFolderChange={handleFolderChange}
        scheduled={scheduled.scheduled}
        selectedScheduledId={nav.selectedScheduledId}
        onOpenScheduled={nav.openScheduled}
        dueCount={dueCount}
        notes={notes.notes}
        now={now}
        selectedNoteId={nav.selectedNoteId}
        onSelectNote={(id, opts) => nav.openNote(id, opts)}
        onCreateNote={handleCreateNote}
        onAiCreateNote={handleAiSaveNote}
        onMoveNote={notes.move}
        onSuggestOrganizing={notes.suggest}
        onApplyOrganizing={notes.applyOrganizing}
        noteQuery={noteQuery}
        onClearNoteQuery={clearNoteQuery}
        onStartNote={nav.openNewNote}
        onNewEmail={compose.newEmail}
        // phone: an email being written while something else shows, to go back to
        waitingDraft={draft && !nav.draftVisible ? { title: tabLabel({ kind: 'draft' }), onShow: nav.showDraft } : null}
        tempAddresses={{
          temp: temp.temp,
          now,
          onCreate: temp.create,
          onExtend: temp.extend,
          onToggle: temp.toggle,
          onChangeColor: temp.changeColor,
          onDelete: temp.remove,
        }}
        drafting={drafting && {
          title: DRAFT_TITLES[draft.mode],
          onBackToDraft: nav.showDraft,
          onDiscard: compose.discard,
          chat: (
            <DraftAssistant
              history={compose.chat}
              loading={compose.chatLoading}
              pending={compose.chatPending}
              error={compose.chatError}
              onUseDraft={compose.applyAiDraft}
              onOpenMessage={(id, hint) => openEmailTab(id, hint)}
              onOpenNote={id => nav.openNote(id)}
              onUndoCreatedNote={compose.undoChatNote}
            />
          ),
        }}
      />
      <MainPane
        selectedMessageId={nav.selectedMessageId}
        selectedMessage={openEmail.message}
        selectedAccount={selectedAccount}
        tempColors={temp.colors}
        messageLoading={openEmail.loading}
        messageError={openEmail.error}
        chatHistory={chat.history}
        chatLoading={chat.loading}
        chatPending={chat.pending}
        chatError={chat.error}
        chatVisible={nav.chatVisible}
        onNewChat={chat.newChat}
        tabs={{
          tabs: nav.tabs.map(t => ({ ...t, label: tabLabel(t) })),
          activeKey: nav.active?.key ?? null,
          onShow: nav.showTab,
          onClose: closeTab,
          // phone: × on the page goes back to the list
          onCloseActive: () => {
            if (nav.active) nav.closeTab(nav.active.key);
            nav.showListScreen();
          },
          besideKey: nav.besideKey,
          onNewTab: nav.newTab,
          onDropItem: openDropped,
          // reading pages offer "Show beside" while an email is being written
          onShowBeside: draft ? nav.showBeside : null,
          onDropBeside: dropBeside,
          onCloseBeside: nav.closeBeside,
          onSwapBeside: () => setBesideSide(besideSide === 'left' ? 'right' : 'left'),
        }}
        besideSide={besideSide}
        newNote={nav.newNoteVisible && {
          text: newNoteText,
          onTextChange: setNewNoteText,
          onBack: nav.showListScreen,
          onDiscard: discardNewNote,
        }}
        selectedNote={selectedNote}
        notes={notes.notes}
        now={now}
        noteActions={noteActions}
        aiHeadsUp={notes.aiHeadsUp}
        onDismissAiHeadsUp={notes.dismissAiHeadsUp}
        onOpenMessage={(id, hint) => openEmailTab(id, hint)}
        onUndoCreatedNote={chat.undoCreatedNote}
        beside={nav.beside?.kind === 'email' ? {
          kind: 'email',
          messageId: nav.beside.id,
          message: besideEmail.message,
          account: accounts.accounts.find(a => a.id === besideEmail.message?.account_id),
          loading: besideEmail.loading,
          error: besideEmail.error,
          onTogglePin: besideEmail.togglePin,
        } : nav.beside?.kind === 'note' && notes.notes.some(n => n.id === nav.beside.id) ? {
          kind: 'note',
          note: notes.notes.find(n => n.id === nav.beside.id),
        } : null}
        onBackToList={nav.showListScreen}
        // while writing, the list screen is the email's assistant
        backLabel={drafting ? 'Assistant' : nav.tab === 'notes' ? 'Notes' : 'Inbox'}
        onReply={handleReply}
        // Phone: emails, notes and answers keep the list screen's top (the ask
        // box and Inbox | Notes), so moving between screens doesn't change the
        // layout; the tabs lead back to the lists. Not on the writing screen,
        // which has its own bar.
        phoneHeader={!nav.draftVisible && (
          <div className="phone-header phone-only">
            <AskBar
              {...askBarProps}
              onAsk={handleAsk}
              onSearch={query => { handleSearch(query); nav.showListScreen(); }}
              asking={chat.loading}
              topAction={{ label: 'New email', onClick: compose.newEmail }}
            />
            <SidebarTabs
              tab={nav.tab}
              onChange={next => { handleTabChange(next); nav.showListScreen(); }}
              dueCount={dueCount}
            />
          </div>
        )}
        onTogglePin={openEmail.togglePin}
        settingsVisible={nav.settingsVisible}
        scheduled={scheduledItem && {
          item: scheduledItem,
          account: accounts.accounts.find(a => a.id === scheduledItem.accountId),
          onEdit: async () => { if (await compose.editScheduled(scheduledItem)) nav.closeScheduled(scheduledItem.id); },
          onSendNow: async () => {
            await scheduled.sendNow(scheduledItem.id);
            nav.closeScheduled(scheduledItem.id);
            setNotice({ type: 'success', text: 'Sending it now' });
          },
          onCancel: async () => {
            await scheduled.cancel(scheduledItem.id);
            nav.closeScheduled(scheduledItem.id);
          },
        }}
        accounts={accounts.accounts}
        onChangeSignature={accounts.changeSignature}
        compose={draft && {
          draft,
          visible: nav.draftVisible,
          accounts: accounts.accounts,
          sending: compose.sending,
          onChange: compose.update,
          onAddFiles: compose.addFiles,
          onRemoveAttachment: compose.removeAttachment,
          // wrapped: a click event must not be taken for Send later's time
          onSend: () => compose.send(),
          onSchedule: date => compose.send(date),
          onDiscard: compose.discard,
          onUndoAiDraft: compose.undoAiDraft,
          onShowAssistant: nav.showListScreen,
          onShow: nav.showDraft,
        }}
      />
      {compose.outgoing && (
        <SendingBar
          outgoing={compose.outgoing}
          onUndo={compose.undoSend}
          onOpenDraft={compose.reopenFailedSend}
          onDismiss={compose.dismissOutgoing}
        />
      )}
    </div>
  );
}

export default App;
