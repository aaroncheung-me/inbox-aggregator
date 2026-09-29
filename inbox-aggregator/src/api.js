import { supabase } from './supabase';

// The server's address: VITE_API_URL once deployed, otherwise port 3001 on
// whichever computer served this page (so a phone on the same Wi-Fi works too).
const API_BASE = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

// fetch() for our API with the signed-in user's token attached. getSession()
// refreshes the token first if it has expired. A 401 means the login is no
// longer valid, so sign out, which sends the app back to the login screen.
async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { ...options.headers };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) await supabase.auth.signOut();
  return res;
}

function jsonBody(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// folder: 'inbox' or 'sent'
export async function getMessages({ limit = 25, offset = 0, folder = 'inbox' } = {}) {
  const res = await apiFetch(`/messages?limit=${limit}&offset=${offset}&folder=${folder}`);
  if (!res.ok) throw new Error('Failed to load messages');
  return res.json();
}

export async function getMessage(messageId) {
  const res = await apiFetch(`/messages/${messageId}`);
  if (!res.ok) throw new Error('Failed to load message');
  return res.json();
}

export async function getAccounts() {
  const res = await apiFetch('/accounts');
  if (!res.ok) throw new Error('Failed to load accounts');
  return res.json();
}

export async function updateAccount(accountId, changes) {
  const res = await apiFetch(`/accounts/${accountId}`, { method: 'PATCH', ...jsonBody(changes) });
  if (!res.ok) throw new Error('Failed to update account');
  return res.json();
}

export async function syncAll() {
  const res = await apiFetch('/sync', { method: 'POST' });
  if (!res.ok) throw new Error('Sync failed');
  return res.json();
}

// Sign-in-based connects (Gmail): the server returns the provider's sign-in
// URL, and the browser goes there. It comes back with ?connected= or ?connect_error=
export async function startSignInConnect(provider) {
  const res = await apiFetch(`/connect/${provider}`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not start connecting the account');
  const { url } = await res.json();
  window.location.assign(url);
}

// Throws with the server's explanation (e.g. "The server rejected that email/password") when it has one.
export async function connectImap({ email, password, host, port }) {
  const res = await apiFetch('/connect/imap', { method: 'POST', ...jsonBody({ email, password, host, port }) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'Connecting failed, check the server terminal');
  }
  return res.json();
}

// ---------- notes ----------

// Throws with the server's explanation when it gave one (a 400 with { error }).
async function failWith(res, fallback) {
  const body = await res.json().catch(() => null);
  throw new Error(body?.error || fallback);
}

export async function getNotes() {
  const res = await apiFetch('/notes');
  if (!res.ok) throw new Error('Failed to load notes');
  return res.json();
}

// addons: [{ kind, remindAt?, messageId?, noteId? }], attached as it's created. Returns { id }.
export async function createNote(body, addons = []) {
  const res = await apiFetch('/notes', { method: 'POST', ...jsonBody({ body, addons }) });
  if (!res.ok) await failWith(res, 'Failed to save the note');
  return res.json();
}

// The AI rewrites the text and adds a reminder, pin and links as it sees fit,
// on top of any addons picked by hand. Returns { id, message, usage }.
export async function aiSaveNote(text, addons = []) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await apiFetch('/notes/ai-save', { method: 'POST', ...jsonBody({ text, addons, timeZone }) });
  if (!res.ok) await failWith(res, 'AI save failed, try again or use Save');
  return res.json();
}

// The AI's suggestions for tidying the notes; nothing is changed.
// Returns { changes: [{ action, noteId, otherNoteId, title, otherTitle, reason }], order, usage }.
export async function suggestOrganizing() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await apiFetch('/notes/organize', { method: 'POST', ...jsonBody({ timeZone }) });
  if (!res.ok) await failWith(res, 'Organize failed, try again');
  return res.json();
}

// changes: { body?, position? }
export async function updateNote(noteId, changes) {
  const res = await apiFetch(`/notes/${noteId}`, { method: 'PATCH', ...jsonBody(changes) });
  if (!res.ok) await failWith(res, 'Failed to update the note');
}

export async function deleteNote(noteId) {
  const res = await apiFetch(`/notes/${noteId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete the note');
}

// addon: { kind: 'reminder' | 'email_link' | 'note_link' | 'pin', remindAt?, messageId?, noteId? }
export async function addNoteAddon(noteId, addon) {
  const res = await apiFetch(`/notes/${noteId}/addons`, { method: 'POST', ...jsonBody(addon) });
  if (!res.ok) await failWith(res, 'Failed to add that to the note');
  return res.json();
}

// changes: { remindAt?, done? } (reminders only)
export async function updateNoteAddon(addonId, changes) {
  const res = await apiFetch(`/note-addons/${addonId}`, { method: 'PATCH', ...jsonBody(changes) });
  if (!res.ok) await failWith(res, 'Failed to update the reminder');
}

export async function removeNoteAddon(addonId) {
  const res = await apiFetch(`/note-addons/${addonId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove that from the note');
}

// Recent out-of-credits problems with Anthropic or OpenAI (including ones hit
// by background syncs): { problems: [{ provider, message, since }] }
export async function getStatus() {
  const res = await apiFetch('/status');
  if (!res.ok) throw new Error('Failed to load status');
  return res.json();
}

// ---------- voice ----------

// A recording (Blob from MediaRecorder) -> the words spoken in it.
export async function transcribeRecording(recording) {
  const res = await apiFetch('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': recording.type || 'audio/webm' },
    body: recording,
  });
  if (!res.ok) await failWith(res, 'Transcription failed, try again');
  return (await res.json()).text;
}

// Basic search, no AI: words plus from:/after:/before:/has:attachment operators.
export async function searchMessagesBasic(query, { limit = 25, offset = 0 } = {}) {
  const params = new URLSearchParams({ q: query, limit, offset });
  const res = await apiFetch(`/messages/search?${params}`);
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

// history: earlier exchanges in this chat, [{ question, answer }], so follow-up questions work.
// openMessageId: the email open in the app, so "note this email" knows which one.
// draft: the email being written, when asking from the writing screen
//   ({ mode, from, to, cc, subject, body, replyToMessageId }).
// onProgress(event) is called while the answer is worked out: { type: 'step', text },
// { type: 'text', delta } or { type: 'text_reset' } (see the server's /ask route).
// Returns { answer, sources, steps, createdNotes, draft, usage }.
export async function askAssistant(question, history, { openMessageId = null, draft = null, onProgress = () => {} } = {}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await apiFetch('/ask', { method: 'POST', ...jsonBody({ question, history, openMessageId, timeZone, draft }) });
  if (!res.ok) await failWith(res, 'The assistant failed, try again');

  // one JSON event per line; a chunk can end partway through a line
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === 'done') return event.result;
      if (event.type === 'error') throw new Error(event.error);
      onProgress(event);
    }
    if (done) throw new Error('The answer was cut off, try again');
  }
}

// ---------- sending ----------

// Pins live only in the app. Returns { pinned_at }.
export async function pinMessage(messageId, pinned) {
  const res = await apiFetch(`/messages/${messageId}`, { method: 'PATCH', ...jsonBody({ pinned }) });
  if (!res.ok) throw new Error(pinned ? "Couldn't pin that email" : "Couldn't unpin that email");
  return res.json();
}

// { replyTo }: where replies should go when the sender set a Reply-To, else null.
export async function getReplyInfo(messageId) {
  const res = await apiFetch(`/messages/${messageId}/reply-info`);
  if (!res.ok) return { replyTo: null };
  return res.json();
}

// email: { accountId, to, cc, bcc, subject, body, replyToMessageId }. The server
// waits 15 seconds before sending, so it can be undone. Returns { id, sendAt }.
export async function sendEmail(email) {
  const res = await apiFetch('/send', { method: 'POST', ...jsonBody(email) });
  if (!res.ok) await failWith(res, 'Sending failed, try again');
  return res.json();
}

// { status: 'waiting' | 'sending' | 'sent' | 'failed', error }
export async function getSendStatus(outboxId) {
  const res = await apiFetch(`/send/${outboxId}`);
  if (!res.ok) throw new Error('Could not check on that email');
  return res.json();
}

// Undo. Throws "Too late to undo..." once it has started sending.
export async function cancelSend(outboxId) {
  const res = await apiFetch(`/send/${outboxId}`, { method: 'DELETE' });
  if (!res.ok) await failWith(res, 'Could not undo, check your Sent folder');
}
