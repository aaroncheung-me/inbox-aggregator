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

export async function getMessages({ limit = 25, offset = 0 } = {}) {
  const res = await apiFetch(`/messages?limit=${limit}&offset=${offset}`);
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

// Basic search, no AI: words plus from:/after:/before:/has:attachment operators.
export async function searchMessagesBasic(query, { limit = 25, offset = 0 } = {}) {
  const params = new URLSearchParams({ q: query, limit, offset });
  const res = await apiFetch(`/messages/search?${params}`);
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

// history: earlier exchanges in this chat, [{ question, answer }], so follow-up questions work.
// Returns { answer, sources, steps, usage }.
export async function askAssistant(question, history) {
  const res = await apiFetch('/ask', { method: 'POST', ...jsonBody({ question, history }) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'The assistant failed, check the server terminal');
  }
  return res.json();
}
