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

// Calls the API. A failure throws the server's explanation when it gave one
// (a 400 with { error }, e.g. "The server rejected that email/password"), else `fallback`.
async function request(path, fallback, options) {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || fallback);
  }
  return res;
}

async function getJson(path, fallback, options) {
  return (await request(path, fallback, options)).json();
}

// options for a request with a JSON body
function withJson(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- email ----------

// folder: 'inbox' or 'sent'. The first page also has the pinned emails.
export function getMessages({ limit = 25, offset = 0, folder = 'inbox' } = {}) {
  return getJson(`/messages?limit=${limit}&offset=${offset}&folder=${folder}`, 'Failed to load messages');
}

// Basic search, no AI: words plus from:/after:/before:/has:attachment operators.
export function searchMessagesBasic(query, { limit = 25, offset = 0 } = {}) {
  return getJson(`/messages/search?${new URLSearchParams({ q: query, limit, offset })}`, 'Search failed');
}

export function getMessage(messageId) {
  return getJson(`/messages/${messageId}`, 'Failed to load message');
}

// The email's formatted version: { html, text, inlinePartIds }. html is null
// for a plain-text email, whose whole text is in text.
export function getMessageHtml(messageId) {
  return getJson(`/messages/${messageId}/html`, "Couldn't load this email's formatting");
}

// Every email of its conversation, itself included, newest first:
// [{ id, account_id, sender, to_recipients, subject, snippet, received_at, labels, from_me }].
export function getConversation(messageId) {
  return getJson(`/messages/${messageId}/conversation`, "Couldn't load the conversation");
}

// Pins live only in the app. Returns { pinned_at }.
export function pinMessage(messageId, pinned) {
  return getJson(`/messages/${messageId}`, pinned ? "Couldn't pin that email" : "Couldn't unpin that email", withJson('PATCH', { pinned }));
}

// { replyTo }: where replies should go when the sender set a Reply-To, else null.
export async function getReplyInfo(messageId) {
  return getJson(`/messages/${messageId}/reply-info`, 'Lookup failed').catch(() => ({ replyTo: null }));
}

// Saves an attachment ({ id, filename }) to the device.
export async function downloadAttachment(attachment) {
  const res = await request(`/attachments/${attachment.id}`, 'Downloading the attachment failed');
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.filename || 'attachment';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

// ---------- accounts ----------

export function getAccounts() {
  return getJson('/accounts', 'Failed to load accounts');
}

// changes: { show_in_inbox?, color?, signature? }
export function updateAccount(accountId, changes) {
  return getJson(`/accounts/${accountId}`, 'Failed to update account', withJson('PATCH', changes));
}

export function syncAll() {
  return getJson('/sync', 'Sync failed', { method: 'POST' });
}

// Sign-in-based connects (Gmail): the server returns the provider's sign-in
// URL, and the browser goes there. It comes back with ?connected= or ?connect_error=
export async function startSignInConnect(provider) {
  const { url } = await getJson(`/connect/${provider}`, 'Could not start connecting the account', { method: 'POST' });
  window.location.assign(url);
}

export function connectImap({ email, password, host, port }) {
  return getJson('/connect/imap', 'Connecting failed, check the server terminal', withJson('POST', { email, password, host, port }));
}

// ---------- temp addresses ----------

// { available, reason, domain, addresses: [{ id, address, label, color,
// show_in_inbox, created_at, expires_at, received }] }
export function getTempAddresses() {
  return getJson('/temp-addresses', 'Failed to load temp addresses');
}

// lifetime: '1h' | '1d' | '1w' | '1m'. Returns the new address.
export function createTempAddress(lifetime, label) {
  return getJson('/temp-addresses', "Couldn't make a temp address, try again", withJson('POST', { lifetime, label }));
}

// changes: { lifetime? (keeps it that long from now), color?, show_in_inbox? }
export function updateTempAddress(id, changes) {
  return getJson(`/temp-addresses/${id}`, "Couldn't change that address", withJson('PATCH', changes));
}

// Deletes it now, with the emails it received.
export async function deleteTempAddress(id) {
  await request(`/temp-addresses/${id}`, "Couldn't delete that address", { method: 'DELETE' });
}

// ---------- notes ----------

export function getNotes() {
  return getJson('/notes', 'Failed to load notes');
}

// addons: [{ kind, remindAt?, messageId?, noteId? }], attached as it's created. Returns { id }.
export function createNote(body, addons = []) {
  return getJson('/notes', 'Failed to save the note', withJson('POST', { body, addons }));
}

// The AI rewrites the text and adds a reminder, pin and links as it sees fit,
// on top of any addons picked by hand. Returns { id, message, usage }.
export function aiSaveNote(text, addons = []) {
  return getJson('/notes/ai-save', 'AI save failed, try again or use Save', withJson('POST', { text, addons, timeZone: timeZone() }));
}

// The AI's suggestions for tidying the notes; nothing is changed.
// Returns { changes: [{ action, noteId, otherNoteId, title, otherTitle, reason }], order, usage }.
export function suggestOrganizing() {
  return getJson('/notes/organize', 'Organize failed, try again', withJson('POST', { timeZone: timeZone() }));
}

// changes: { body?, position? }
export async function updateNote(noteId, changes) {
  await request(`/notes/${noteId}`, 'Failed to update the note', withJson('PATCH', changes));
}

export async function deleteNote(noteId) {
  await request(`/notes/${noteId}`, 'Failed to delete the note', { method: 'DELETE' });
}

// addon: { kind: 'reminder' | 'email_link' | 'note_link' | 'pin', remindAt?, messageId?, noteId? }
export function addNoteAddon(noteId, addon) {
  return getJson(`/notes/${noteId}/addons`, 'Failed to add that to the note', withJson('POST', addon));
}

// changes: { remindAt?, done? } (reminders only)
export async function updateNoteAddon(addonId, changes) {
  await request(`/note-addons/${addonId}`, 'Failed to update the reminder', withJson('PATCH', changes));
}

export async function removeNoteAddon(addonId) {
  await request(`/note-addons/${addonId}`, 'Failed to remove that from the note', { method: 'DELETE' });
}

// ---------- assistant, voice and AI status ----------

// history: earlier exchanges in this chat, [{ question, answer }], so follow-up questions work.
// openMessageId: the email open in the app, so "note this email" knows which one.
// draft: the email being written, when asking from the writing screen
//   ({ mode, from, to, cc, subject, body, replyToMessageId }).
// onProgress(event) is called while the answer is worked out: { type: 'step', text },
// { type: 'text', delta } or { type: 'text_reset' } (see the server's /ask route).
// Returns { answer, sources, steps, createdNotes, draft, usage }.
export async function askAssistant(question, history, { openMessageId = null, draft = null, onProgress = () => {} } = {}) {
  const res = await request('/ask', 'The assistant failed, try again',
    withJson('POST', { question, history, openMessageId, timeZone: timeZone(), draft }));

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

// A recording (Blob from MediaRecorder) -> the words spoken in it.
export async function transcribeRecording(recording) {
  const { text } = await getJson('/transcribe', 'Transcription failed, try again', {
    method: 'POST',
    headers: { 'Content-Type': recording.type || 'audio/webm' },
    body: recording,
  });
  return text;
}

// Recent out-of-credits problems with Anthropic or OpenAI (including ones hit
// by background syncs): { problems: [{ provider, message, since }] }
export function getStatus() {
  return getJson('/status', 'Failed to load status');
}

// ---------- sending ----------

// Uploads one file to attach to an email that's about to be sent. Returns
// { uploadId } for sendEmail. Always sent as octet-stream, with the real type
// beside it, so the server treats every file the same way.
export function uploadAttachment(file) {
  return getJson('/send/uploads', `Uploading "${file.name}" failed, try again`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
}

// email: { accountId, to, cc, bcc, subject, body, replyToMessageId, attachments,
// forwardedAttachmentIds, sendAt? } (see POST /send). The server waits 15
// seconds before sending, so it can be undone, or until sendAt.
// Returns { id, sendAt, scheduled }.
export function sendEmail(email) {
  return getJson('/send', 'Sending failed, try again', withJson('POST', email));
}

// { status: 'waiting' | 'sending' | 'sent' | 'failed', error }
export function getSendStatus(outboxId) {
  return getJson(`/send/${outboxId}`, 'Could not check on that email');
}

// Undo, or Cancel on a scheduled email. Throws once it has started sending.
// keepFiles: its uploaded attachments stay, for a draft that still points at them.
export async function cancelSend(outboxId, { keepFiles = false } = {}) {
  await request(`/send/${outboxId}${keepFiles ? '?edit=1' : ''}`, 'Could not undo, check your Sent folder', { method: 'DELETE' });
}

// Scheduled emails not sent yet (and failed ones): [{ id, accountId, sendAt,
// failed, to, cc, bcc, subject, body, replyToMessageId, attachments, forwarded }].
export function getScheduled() {
  return getJson('/scheduled', 'Failed to load scheduled emails');
}

export async function sendScheduledNow(outboxId) {
  await request(`/send/${outboxId}/now`, "Couldn't send it now, try again", { method: 'POST' });
}

// Edit on a scheduled email: takes it back (its files stay uploaded) and
// returns it, to reopen on the writing screen.
export function takeBackScheduled(outboxId) {
  return getJson(`/send/${outboxId}?edit=1`, "Couldn't take it back, it may have been sent", { method: 'DELETE' });
}
