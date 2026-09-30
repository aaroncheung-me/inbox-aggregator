import { useEffect, useRef, useState } from 'react';
import { askAssistant, deleteNote, getReplyInfo, sendEmail, getSendStatus, cancelSend, uploadAttachment } from '../../api';
import { applyProgress, markNoteUndone } from '../assistant/useChat';
import {
  newDraft,
  draftFromMessage,
  fullBody,
  draftHasContent,
  withAccount,
  withSignature,
  attachmentsFromFiles,
  attachmentsSize,
  MAX_ATTACHMENTS_BYTES,
} from './compose';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Writing and sending email: the draft (see compose.js) or null, the assistant
// beside it with its own chat, and the email just sent while it can be undone.
// Whether the draft is on screen belongs to navigation (showDraft/hideDraft),
// since the assistant beside it can open emails and notes in its place.
export function useCompose({ accounts, openMessage, onNotice, showDraft, hideDraft, showListScreen, reloadMessages, refreshNotes, refreshStatus }) {
  const [draft, setDraft] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatPending, setChatPending] = useState(null);
  const [chatError, setChatError] = useState(null);
  // bumped whenever a draft opens or closes, so a late answer about an old one is dropped
  const session = useRef(0);
  const [sending, setSending] = useState(false);
  // the email just sent, until it's confirmed: { id, sendAt, draft, chat, status, error, undoError }
  const [outgoing, setOutgoing] = useState(null);
  const followedSend = useRef(null); // the outbox id whose progress is being checked

  const ownAddresses = accounts.map(a => a.email_address.toLowerCase());
  const signatureOf = accountId => accounts.find(a => a.id === accountId)?.signature || '';

  // Opens a draft on the writing screen (withChat: its assistant conversation, when
  // bringing back one that was undone). Asks first if it would replace one with
  // text in it, unless the caller already has (force).
  function open(next, withChat = [], force = false) {
    if (!force && draft && draftHasContent(draft) && !window.confirm('Discard the email you are writing?')) return false;
    session.current++;
    setDraft(next);
    setChat(withChat);
    setChatError(null);
    setChatLoading(false);
    setChatPending(null);
    showDraft();
    return true;
  }

  function close() {
    session.current++;
    setDraft(null);
    hideDraft();
    setChat([]);
    setChatError(null);
    setChatLoading(false);
    setChatPending(null);
  }

  function newEmail() {
    const account = accounts.find(a => a.show_in_inbox) || accounts[0];
    if (!account) {
      onNotice({ type: 'error', text: 'Connect an email account first' });
      return;
    }
    open(newDraft(account.id, signatureOf(account.id)));
  }

  // kind: 'reply' | 'replyAll' | 'forward', on the email that's open. The draft
  // opens straight away; if the sender asked for replies to go elsewhere
  // (Reply-To), the To line is updated when that arrives, unless it was edited.
  function reply(kind) {
    const message = openMessage;
    if (!message) return;
    const initial = draftFromMessage(kind, message, ownAddresses, null, signatureOf(message.account_id));
    if (!open(initial) || kind === 'forward') return;

    getReplyInfo(message.id).then(({ replyTo }) => {
      if (!replyTo) return;
      const better = draftFromMessage(kind, message, ownAddresses, replyTo);
      setDraft(prev => (prev?.originalMessageId === message.id && prev.to === initial.to && prev.cc === initial.cc
        ? { ...prev, to: better.to, cc: better.cc, showCcBcc: prev.showCcBcc || Boolean(better.cc) }
        : prev));
    });
  }

  // A different From address brings its own signature (see withAccount).
  function update(changes) {
    setDraft(prev => {
      if (!prev) return prev;
      const { accountId, ...rest } = changes;
      const moved = accountId !== undefined && accountId !== prev.accountId
        ? withAccount(prev, accountId, signatureOf(accountId))
        : prev;
      return { ...moved, ...rest, error: null };
    });
  }

  // files: a FileList or array, from the Attach button or dropped on the page.
  // Read straight away: a FileList empties when its file picker is reset.
  function addFiles(files) {
    const added = attachmentsFromFiles(files || []);
    if (!added.length) return;
    setDraft(prev => (prev ? { ...prev, attachments: [...prev.attachments, ...added], error: null } : prev));
  }

  function removeAttachment(key) {
    setDraft(prev => (prev ? { ...prev, attachments: prev.attachments.filter(a => a.key !== key), error: null } : prev));
  }

  // On a phone this always lands on the list, whichever of the draft's two
  // screens (the email or its assistant) it was discarded from.
  function discard() {
    if (draftHasContent(draft) && !window.confirm('Discard this email?')) return;
    close();
    showListScreen();
  }

  async function send() {
    if (!draft || sending) return;
    const sent = draft;
    if (attachmentsSize(sent) > MAX_ATTACHMENTS_BYTES) {
      setDraft(prev => (prev ? { ...prev, error: 'Attachments can add up to 25 MB. Remove some to send.' } : prev));
      return;
    }
    setSending(true);
    try {
      // files picked here are uploaded first, one at a time; a forward's own
      // attachments are fetched by the server from the mailbox
      const uploads = [];
      for (const a of sent.attachments.filter(a => a.file)) {
        const { uploadId } = await uploadAttachment(a.file);
        uploads.push({ uploadId, filename: a.name, mimeType: a.type || 'application/octet-stream', size: a.size });
      }
      const { id, sendAt } = await sendEmail({
        attachments: uploads,
        forwardedAttachmentIds: sent.attachments.filter(a => a.attachmentId).map(a => a.attachmentId),
        accountId: sent.accountId,
        to: sent.to,
        cc: sent.showCcBcc ? sent.cc : '',
        bcc: sent.showCcBcc ? sent.bcc : '',
        subject: sent.subject,
        body: fullBody(sent),
        // a forward starts a new conversation, so only replies are threaded
        replyToMessageId: sent.mode === 'reply' ? sent.originalMessageId : null,
      });
      setOutgoing({ id, sendAt, draft: sent, chat, status: 'waiting', error: null, undoError: null });
      close();
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
    const updateOutgoing = changes => setOutgoing(prev => (prev?.id === id ? { ...prev, ...changes } : prev));

    await delay(Math.max(0, new Date(sendAt).getTime() - Date.now()) + 1500);
    for (let attempt = 0; attempt < 10; attempt++) {
      if (followedSend.current !== id) return; // undone
      try {
        const { status, error } = await getSendStatus(id);
        if (followedSend.current !== id) return;
        if (status === 'failed') return updateOutgoing({ status, error });
        if (status === 'sent') {
          updateOutgoing({ status });
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
    updateOutgoing({ status: 'unknown' });
  }

  async function undoSend() {
    const { id, draft: unsent, chat: unsentChat } = outgoing;
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
    open(unsent, unsentChat, true);
  }

  // "Open email" on a send that failed: back to the writing screen, with the reason
  function reopenFailedSend() {
    const { draft: unsent, chat: unsentChat, error } = outgoing;
    if (open({ ...unsent, error }, unsentChat)) setOutgoing(null);
  }

  function dismissOutgoing() {
    followedSend.current = null;
    setOutgoing(null);
  }

  // The assistant beside the writing screen. It gets the draft as it stands,
  // and returns a suggested draft only when asked for one.
  async function ask(question) {
    if (!draft) return;
    const askedIn = session.current;
    setChatLoading(true);
    setChatError(null);
    setChatPending({ question, steps: [], text: '' });
    try {
      const earlier = chat.map(({ question: q, answer }) => ({ question: q, answer }));
      const result = await askAssistant(question, earlier, {
        draft: {
          mode: draft.mode,
          from: accounts.find(a => a.id === draft.accountId)?.email_address || '',
          to: draft.to,
          cc: draft.showCcBcc ? draft.cc : '',
          subject: draft.subject,
          body: draft.body,
          replyToMessageId: draft.originalMessageId,
        },
        onProgress: event => {
          if (askedIn === session.current) setChatPending(prev => applyProgress(prev, event));
        },
      });
      if (askedIn !== session.current) return;
      setChat(prev => [...prev, { question, ...result }]);
      if (result.createdNotes?.length) await refreshNotes();
    } catch (err) {
      if (askedIn === session.current) setChatError(err.message);
    } finally {
      if (askedIn === session.current) {
        setChatLoading(false);
        setChatPending(null);
      }
      refreshStatus();
    }
  }

  // Puts the assistant's draft into the email, with the signature kept under
  // it. What the user had before is kept (from before the first AI draft), so
  // Undo always returns to their own text.
  function applyAiDraft(exchangeIndex) {
    const suggestion = chat[exchangeIndex]?.draft;
    if (!suggestion || !draft) return;
    setDraft(prev => ({
      ...prev,
      body: withSignature(suggestion.body, prev),
      subject: suggestion.subject || prev.subject,
      aiPrevious: prev.aiPrevious || { body: prev.body, subject: prev.subject },
      error: null,
    }));
    setChat(prev => prev.map((exchange, i) => ({ ...exchange, draftUsed: i === exchangeIndex })));
    showDraft();
  }

  function undoAiDraft() {
    setDraft(prev => (prev?.aiPrevious ? { ...prev, ...prev.aiPrevious, aiPrevious: null } : prev));
    setChat(prev => prev.map(exchange => ({ ...exchange, draftUsed: false })));
  }

  async function undoChatNote(exchangeIndex, noteId) {
    await deleteNote(noteId);
    setChat(prev => markNoteUndone(prev, exchangeIndex, noteId));
    await refreshNotes();
  }

  // closing the tab or app with an unsent draft asks first
  const atRisk = Boolean(draft && draftHasContent(draft));
  useEffect(() => {
    if (!atRisk) return;
    const warn = e => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [atRisk]);

  return {
    draft,
    chat,
    chatLoading,
    chatPending,
    chatError,
    sending,
    outgoing,
    newEmail,
    reply,
    update,
    addFiles,
    removeAttachment,
    discard,
    send,
    undoSend,
    reopenFailedSend,
    dismissOutgoing,
    ask,
    applyAiDraft,
    undoAiDraft,
    undoChatNote,
  };
}
