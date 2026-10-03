import { useEffect, useRef, useState } from 'react';
import { getReplyInfo, sendEmail, getSendStatus, cancelSend, uploadAttachment, takeBackScheduled } from '../../api';
import { useChat } from '../assistant/useChat';
import {
  newDraft,
  draftFromMessage,
  draftFromScheduled,
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
// onScheduled: reloads the Scheduled list after scheduling or taking one back.
// onNoteDeleted: as for useChat, for notes its assistant made and then undid.
export function useCompose({ accounts, openMessage, onNotice, showDraft, hideDraft, showListScreen, reloadMessages, refreshNotes, refreshStatus, onNoteDeleted, onScheduled }) {
  const [draft, setDraft] = useState(null);
  // the draft's own assistant; it starts over with each draft, dropping any late answer about the old one
  const chat = useChat({ refreshNotes, refreshStatus, onNoteDeleted });
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
    setDraft(next);
    chat.reset(withChat);
    showDraft();
    return true;
  }

  function close() {
    setDraft(null);
    hideDraft();
    chat.reset();
  }

  // One email is written at a time: with one already started, this goes back to it.
  function newEmail() {
    if (draft) {
      showDraft();
      return;
    }
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
  // Returns whether the draft opened.
  function reply(kind) {
    const message = openMessage;
    if (!message) return false;
    const initial = draftFromMessage(kind, message, ownAddresses, null, signatureOf(message.account_id));
    if (!open(initial)) return false;
    if (kind === 'forward') return true;

    getReplyInfo(message.id).then(({ replyTo }) => {
      if (!replyTo) return;
      const better = draftFromMessage(kind, message, ownAddresses, replyTo);
      setDraft(prev => (prev?.originalMessageId === message.id && prev.to === initial.to && prev.cc === initial.cc
        ? { ...prev, to: better.to, cc: better.cc, showCcBcc: prev.showCcBcc || Boolean(better.cc) }
        : prev));
    });
    return true;
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

  // sendAt: a Date, for Send later; otherwise it goes after the 15-second undo.
  async function send(sendAt = null) {
    if (!draft || sending) return;
    const sent = draft;
    if (attachmentsSize(sent) > MAX_ATTACHMENTS_BYTES) {
      setDraft(prev => (prev ? { ...prev, error: 'Attachments can add up to 25 MB. Remove some to send.' } : prev));
      return;
    }
    setSending(true);
    try {
      // files picked here are uploaded first, one at a time (ones already
      // uploaded, from an edited scheduled email, are reused); a forward's own
      // attachments are fetched by the server from the mailbox
      const uploads = [];
      for (const a of sent.attachments.filter(a => a.file || a.uploadId)) {
        const uploadId = a.uploadId || (await uploadAttachment(a.file)).uploadId;
        uploads.push({ uploadId, filename: a.name, mimeType: a.type || 'application/octet-stream', size: a.size });
      }
      const queued = await sendEmail({
        ...(sendAt && { sendAt: sendAt.toISOString() }),
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
      const { id } = queued;
      if (queued.scheduled) {
        // nothing to follow: the bar says when it goes, with Undo, for a while
        setOutgoing({ id, sendAt: queued.sendAt, draft: sent, chat: chat.history, status: 'scheduled', error: null, undoError: null });
        close();
        onScheduled();
        setTimeout(() => setOutgoing(prev => (prev?.id === id && prev.status === 'scheduled' ? null : prev)), 10000);
        return;
      }
      setOutgoing({ id, sendAt: queued.sendAt, draft: sent, chat: chat.history, status: 'waiting', error: null, undoError: null });
      close();
      followSend(id, queued.sendAt);
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
      // files it only has as uploads (an edited scheduled email) must stay for the draft
      await cancelSend(id, { keepFiles: unsent.attachments.some(a => a.uploadId) });
      if (outgoing.status === 'scheduled') onScheduled();
    } catch (err) {
      setOutgoing(prev => (prev?.id === id ? { ...prev, undoError: err.message } : prev));
      return;
    }
    followedSend.current = null;
    setOutgoing(null);
    open(unsent, unsentChat, true);
  }

  // Edit on a scheduled email: takes it back and opens it on the writing
  // screen. Returns false if the user kept the email they were writing.
  async function editScheduled(item) {
    if (draft && draftHasContent(draft) && !window.confirm('Discard the email you are writing?')) return false;
    const email = await takeBackScheduled(item.id);
    open(draftFromScheduled(email), [], true);
    onScheduled();
    return true;
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
  function ask(question) {
    if (!draft) return;
    chat.ask(question, {
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
  }

  // Puts the assistant's draft into the email, with the signature kept under
  // it. What the user had before is kept (from before the first AI draft), so
  // Undo always returns to their own text.
  function applyAiDraft(exchangeIndex) {
    const suggestion = chat.history[exchangeIndex]?.draft;
    if (!suggestion || !draft) return;
    setDraft(prev => ({
      ...prev,
      body: withSignature(suggestion.body, prev),
      subject: suggestion.subject || prev.subject,
      aiPrevious: prev.aiPrevious || { body: prev.body, subject: prev.subject },
      error: null,
    }));
    chat.setHistory(prev => prev.map((exchange, i) => ({ ...exchange, draftUsed: i === exchangeIndex })));
    showDraft();
  }

  function undoAiDraft() {
    setDraft(prev => (prev?.aiPrevious ? { ...prev, ...prev.aiPrevious, aiPrevious: null } : prev));
    chat.setHistory(prev => prev.map(exchange => ({ ...exchange, draftUsed: false })));
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
    editScheduled,
  };
}
