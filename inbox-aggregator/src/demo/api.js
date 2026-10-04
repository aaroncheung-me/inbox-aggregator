// The demo's stand-in for src/api.js (swapped in by vite.config.js): the same
// functions, answering from made-up data kept in memory (see data.js) the way
// the server would. Nothing leaves the browser, and a reload starts over.
// The shapes returned match the real routes; see the comments in src/api.js.

import { createDemoData, TEMP_DOMAIN } from './data';
import { answerQuestion, parseReminder, describeReminder } from './assistant';
import { makePdf } from './pdf';

const now = () => Date.now();
const state = createDemoData();

// A short pause, so loading states show the way they do against the real server.
const wait = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
// Copies, so the app can never change the demo's data by accident.
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };

const nextId = list => Math.max(0, ...list.map(item => item.id)) + 1;
const emailAddress = text => (/<([^>]+)>/.exec(text || '')?.[1] || text || '').trim().toLowerCase();
const ownAddresses = () => state.accounts.map(a => a.email_address.toLowerCase());
const visibleAccountIds = () => state.accounts.filter(a => a.show_in_inbox).map(a => a.id);
const findMessage = id => state.messages.find(m => m.id === Number(id));
// a copy of obj without the given keys
const omit = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));

// ---------- email ----------

// What the list shows of an email, with the paperclip and Temp marks.
function listItem(m) {
  const temp = tempAddressFor(m);
  return {
    id: m.id, account_id: m.account_id, sender: m.sender, to_recipients: m.to_recipients, subject: m.subject,
    snippet: m.snippet, received_at: m.received_at, is_read: m.is_read, has_attachments: m.has_attachments,
    pinned_at: m.pinned_at,
    has_files: m.attachments.some(a => !a.mime_type.startsWith('image/') || a.size_bytes >= 100 * 1024),
    ...(temp && { temp_address: { address: temp.address, label: temp.label, color: temp.color, expires_at: temp.expires_at } }),
  };
}

const newestFirst = (a, b) => b.received_at.localeCompare(a.received_at);
const recipientsOf = m => `${m.to_recipients || ''} ${m.cc_recipients || ''}`.toLowerCase();

function isInbox(m) {
  return (m.labels.includes('INBOX') || !m.labels.includes('SENT')) && !m.labels.some(l => l === 'SPAM' || l === 'TRASH');
}

export async function getMessages({ limit = 25, offset = 0, folder = 'inbox' } = {}) {
  await wait();
  const visible = visibleAccountIds();
  const hiddenTemp = state.tempAddresses.filter(t => !t.show_in_inbox).map(t => t.address);
  const sent = folder === 'sent';
  const mine = state.messages.filter(m => visible.includes(m.account_id));
  const list = mine
    .filter(m => (sent
      ? m.labels.includes('SENT')
      : isInbox(m) && !m.pinned_at && !hiddenTemp.some(address => recipientsOf(m).includes(address))))
    .sort(newestFirst);
  const pinned = sent || offset > 0
    ? []
    : mine.filter(m => m.pinned_at).sort((a, b) => b.pinned_at.localeCompare(a.pinned_at));
  return {
    messages: list.slice(offset, offset + limit).map(listItem),
    pinned: pinned.map(listItem),
    total: list.length,
    limit,
    offset,
  };
}

// Words plus from:/after:/before:/has:attachment, like the server's parseSearchQuery.
function parseSearchQuery(input) {
  const filters = {};
  const text = (input || '').replace(/\b(from|after|before|has):(?:"([^"]*)"|(\S+))/gi, (match, key, quoted, bare) => {
    const value = (quoted ?? bare).trim();
    switch (key.toLowerCase()) {
      case 'from': filters.sender = value.toLowerCase(); return '';
      case 'after':
      case 'before':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return match;
        filters[key.toLowerCase()] = value;
        return '';
      case 'has':
        if (!/^attachments?$/i.test(value)) return match;
        filters.hasAttachments = true;
        return '';
      default: return match;
    }
  });
  return { text: text.replace(/\s+/g, ' ').trim(), filters };
}

// Emails matching every word, best first. Shared with the assistant.
export function searchEmails(query) {
  const { text, filters } = parseSearchQuery(query);
  const words = text.toLowerCase().split(' ').filter(Boolean);
  if (!words.length && !Object.keys(filters).length) return [];
  const visible = visibleAccountIds();
  return state.messages
    .filter(m => visible.includes(m.account_id) && !m.labels.includes('SPAM') && !m.labels.includes('TRASH'))
    .filter(m => !filters.sender || m.sender.toLowerCase().includes(filters.sender))
    .filter(m => !filters.after || m.received_at.slice(0, 10) >= filters.after)
    .filter(m => !filters.before || m.received_at.slice(0, 10) < filters.before)
    .filter(m => !filters.hasAttachments || m.has_attachments)
    .map(m => {
      const subject = m.subject.toLowerCase();
      const all = `${subject} ${m.sender} ${m.to_recipients || ''} ${m.body}`.toLowerCase();
      if (!words.every(w => all.includes(w))) return null;
      return { m, score: words.filter(w => subject.includes(w)).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || newestFirst(a.m, b.m))
    .map(({ m }) => m);
}

export async function searchMessagesBasic(query, { limit = 25, offset = 0 } = {}) {
  await wait();
  const found = searchEmails(query);
  return { messages: found.slice(offset, offset + limit).map(listItem), hasMore: found.length > offset + limit, limit, offset };
}

// Notes stuck to one email: [{ id, body, position, reminder }]
function notesForMessage(messageId) {
  return state.addons
    .filter(a => a.kind === 'email_link' && a.linked_message_id === messageId)
    .map(a => state.notes.find(n => n.id === a.note_id))
    .filter(Boolean)
    .map(n => {
      const reminder = state.addons.find(a => a.note_id === n.id && a.kind === 'reminder');
      return { id: n.id, body: n.body, position: n.position, reminder: reminder ? { remind_at: reminder.remind_at, done_at: reminder.done_at } : null };
    })
    .sort((a, b) => a.position - b.position);
}

export async function getMessage(messageId) {
  await wait();
  const m = findMessage(messageId) || fail('Failed to load message');
  return copy({
    ...listItem(m),
    ...omit(m, 'html', 'reply_to'),
    attachments: m.attachments.map(a => omit(a, 'pdf', 'file')),
    notes: notesForMessage(m.id),
  });
}

export async function getMessageHtml(messageId) {
  await wait(200);
  const m = findMessage(messageId) || fail("Couldn't load this email's formatting");
  return { html: m.html, text: m.html ? null : m.body, inlinePartIds: [] };
}

export async function getConversation(messageId) {
  await wait();
  const m = findMessage(messageId) || fail("Couldn't load the conversation");
  if (!m.thread_id) return [];
  const own = ownAddresses();
  return state.messages
    .filter(other => other.account_id === m.account_id && other.thread_id === m.thread_id)
    .sort(newestFirst)
    .map(other => ({
      id: other.id, account_id: other.account_id, sender: other.sender, to_recipients: other.to_recipients,
      subject: other.subject, snippet: other.snippet, received_at: other.received_at, labels: [...other.labels],
      from_me: other.labels.includes('SENT') || own.includes(emailAddress(other.sender)),
    }));
}

export async function pinMessage(messageId, pinned) {
  await wait();
  const m = findMessage(messageId) || fail(pinned ? "Couldn't pin that email" : "Couldn't unpin that email");
  m.pinned_at = pinned ? new Date().toISOString() : null;
  return { pinned_at: m.pinned_at };
}

export async function getReplyInfo(messageId) {
  await wait(80);
  return { replyTo: findMessage(messageId)?.reply_to || null };
}

function findAttachment(id) {
  for (const m of state.messages) {
    const found = m.attachments.find(a => a.id === Number(id));
    if (found) return found;
  }
  return null;
}

// Made-up attachments download as a small PDF saying what they are; files
// attached to an email sent in the demo download as themselves.
export async function downloadAttachment(attachment) {
  await wait();
  const found = findAttachment(attachment.id) || fail('Downloading the attachment failed');
  const blob = found.file || (found.pdf
    ? makePdf(found.pdf)
    : new Blob([`${found.filename}: a made-up attachment from the Inbox Aggregator demo.`], { type: 'text/plain' }));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.filename || found.filename || 'attachment';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

// ---------- accounts ----------

const ACCOUNT_COLORS = ['#93CDE6', '#F5BE8F', '#9FD8B0', '#CDA8EC', '#E9D17A', '#F2A7A7', '#A9B3EE', '#EFA7CC'];

export async function getAccounts() {
  await wait(100);
  return copy(state.accounts);
}

export async function updateAccount(accountId, changes) {
  await wait();
  const account = state.accounts.find(a => a.id === Number(accountId)) || fail('Failed to update account');
  if (typeof changes.show_in_inbox === 'boolean') account.show_in_inbox = changes.show_in_inbox;
  if (typeof changes.color === 'string' && /^#[0-9a-f]{6}$/i.test(changes.color)) account.color = changes.color;
  if (typeof changes.signature === 'string') account.signature = changes.signature.slice(0, 2000);
  return copy(account);
}

// Each sync "receives" the next of a couple of new emails, so syncing visibly
// does something; after those, nothing new arrives.
export async function syncAll() {
  await wait(1400);
  const syncedAt = new Date().toISOString();
  const next = state.incoming.shift();
  if (next) state.messages.push(next(syncedAt));
  for (const account of state.accounts) account.last_synced_at = syncedAt;
  return { saved: next ? 1 : 0, embedded: next ? 1 : 0, results: [] };
}

export async function startSignInConnect() {
  await wait();
  fail('Adding accounts is turned off in the demo. In the real app this signs in with Google.');
}

export async function connectImap() {
  await wait();
  fail('Adding accounts is turned off in the demo, so nothing typed here goes anywhere.');
}

// ---------- temp addresses ----------

const TEMP_LIFETIMES = { '1h': 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, '1w': 7 * 24 * 60 * 60 * 1000, '1m': 30 * 24 * 60 * 60 * 1000 };
const MAX_TEMP_ADDRESSES = 10;

function activeTempAddresses() {
  const nowIso = new Date().toISOString();
  state.tempAddresses = state.tempAddresses.filter(t => t.expires_at > nowIso);
  return state.tempAddresses;
}

function tempAddressFor(m) {
  const recipients = recipientsOf(m);
  return activeTempAddresses().find(t => t.account_id === m.account_id && recipients.includes(t.address)) || null;
}

const receivedBy = t => state.messages.filter(m => m.account_id === t.account_id && recipientsOf(m).includes(t.address));
const shapeTemp = ({ account_id, ...t }) => ({ ...t, received: receivedBy({ account_id, ...t }).length });

export async function getTempAddresses() {
  await wait(100);
  return { available: true, reason: null, domain: TEMP_DOMAIN, addresses: copy(activeTempAddresses().map(shapeTemp)) };
}

function lifetimeMs(lifetime) {
  return TEMP_LIFETIMES[lifetime] || fail('Choose how long the address should last');
}

export async function createTempAddress(lifetime, label) {
  await wait(300);
  const expiresAt = new Date(now() + lifetimeMs(lifetime)).toISOString();
  if (activeTempAddresses().length >= MAX_TEMP_ADDRESSES) fail(`You can have at most ${MAX_TEMP_ADDRESSES} temp addresses; delete some first`);

  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const chars = letters + '0123456789';
  const local = Array.from({ length: 8 }, (_, i) => (i === 0 ? letters : chars)[Math.floor(Math.random() * (i === 0 ? 26 : 36))]).join('');
  const used = [...state.accounts, ...state.tempAddresses].map(item => item.color);
  const color = [...ACCOUNT_COLORS].sort((a, b) => used.filter(c => c === a).length - used.filter(c => c === b).length)[0];

  const address = {
    id: nextId(state.tempAddresses), account_id: 3, address: `${local}@${TEMP_DOMAIN}`,
    label: typeof label === 'string' ? label.trim().slice(0, 40) : '', color, show_in_inbox: true,
    created_at: new Date().toISOString(), expires_at: expiresAt,
  };
  state.tempAddresses.push(address);
  return copy(shapeTemp(address));
}

export async function updateTempAddress(id, changes) {
  await wait();
  const t = state.tempAddresses.find(a => a.id === Number(id)) || fail("Couldn't change that address");
  if (changes.lifetime === undefined && changes.color === undefined && changes.show_in_inbox === undefined) fail('Nothing to change');
  if (changes.lifetime !== undefined) t.expires_at = new Date(now() + lifetimeMs(changes.lifetime)).toISOString();
  if (typeof changes.color === 'string') t.color = changes.color;
  if (typeof changes.show_in_inbox === 'boolean') t.show_in_inbox = changes.show_in_inbox;
  return { expires_at: t.expires_at, color: t.color, show_in_inbox: t.show_in_inbox };
}

// Deletes it now, with the emails it received.
export async function deleteTempAddress(id) {
  await wait();
  const t = state.tempAddresses.find(a => a.id === Number(id)) || fail("Couldn't delete that address");
  const received = new Set(receivedBy(t).map(m => m.id));
  state.messages = state.messages.filter(m => !received.has(m.id));
  state.tempAddresses = state.tempAddresses.filter(a => a !== t);
}

// ---------- notes ----------

const firstLine = body => (body || '').split('\n').find(line => line.trim())?.trim().slice(0, 120) || '(empty note)';

// The notes shaped as the server's listNotes shapes them.
function listNotes() {
  const shaped = new Map([...state.notes]
    .sort((a, b) => a.position - b.position)
    .map(n => [n.id, { ...n, pin: null, reminder: null, emailLinks: [], noteLinks: [] }]));
  for (const a of [...state.addons].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const note = shaped.get(a.note_id);
    if (!note) continue;
    if (a.kind === 'pin') note.pin = { id: a.id, added_by: a.added_by };
    if (a.kind === 'reminder') note.reminder = { id: a.id, remind_at: a.remind_at, done_at: a.done_at, added_by: a.added_by };
    const m = a.kind === 'email_link' && findMessage(a.linked_message_id);
    if (m) {
      note.emailLinks.push({ addonId: a.id, added_by: a.added_by, message: { id: m.id, subject: m.subject, sender: m.sender, received_at: m.received_at, account_id: m.account_id } });
    }
    if (a.kind === 'note_link' && shaped.has(a.linked_note_id)) {
      const other = shaped.get(a.linked_note_id);
      note.noteLinks.push({ addonId: a.id, added_by: a.added_by, noteId: other.id, preview: firstLine(other.body) });
      other.noteLinks.push({ addonId: a.id, added_by: a.added_by, noteId: note.id, preview: firstLine(note.body) });
    }
  }
  return [...shaped.values()];
}

export async function getNotes() {
  await wait();
  return copy(listNotes());
}

function cleanBody(body) {
  if (typeof body !== 'string') fail('Note text is missing');
  return body.slice(0, 10000);
}

function parseTime(value) {
  const time = new Date(value);
  if (!value || Number.isNaN(time.getTime())) fail('That reminder time is not a valid date');
  return time.toISOString();
}

// New notes go to the top of the list. Returns the id.
function insertNote(body) {
  const stamp = new Date().toISOString();
  const position = state.notes.length ? Math.min(...state.notes.map(n => n.position)) - 1 : 0;
  const note = { id: nextId(state.notes), body: cleanBody(body), position, created_at: stamp, updated_at: stamp };
  state.notes.push(note);
  return note.id;
}

// Same rules as the server: one reminder and one pin per note, links not doubled.
function addAddon(noteId, addon, addedBy = 'user') {
  const note = state.notes.find(n => n.id === Number(noteId));
  if (!note) return null;
  if (!['reminder', 'email_link', 'note_link', 'pin'].includes(addon.kind)) fail('Unknown kind of add-on');
  const row = {
    id: nextId(state.addons), note_id: note.id, kind: addon.kind, added_by: addedBy, remind_at: null, done_at: null,
    linked_message_id: null, linked_note_id: null, created_at: new Date().toISOString(),
  };
  const same = state.addons.filter(a => a.note_id === note.id && a.kind === addon.kind);

  if (addon.kind === 'reminder') {
    row.remind_at = parseTime(addon.remindAt);
    if (same[0]) {
      Object.assign(same[0], { remind_at: row.remind_at, done_at: null, added_by: addedBy });
      return same[0].id;
    }
  } else if (addon.kind === 'email_link') {
    const m = findMessage(addon.messageId) || fail('That email was not found');
    row.linked_message_id = m.id;
    const existing = same.find(a => a.linked_message_id === m.id);
    if (existing) return existing.id;
  } else if (addon.kind === 'note_link') {
    const other = state.notes.find(n => n.id === Number(addon.noteId)) || fail('That note was not found');
    if (other.id === note.id) fail("A note can't link to itself");
    const existing = state.addons.find(a => a.kind === 'note_link' && (
      (a.note_id === note.id && a.linked_note_id === other.id) || (a.note_id === other.id && a.linked_note_id === note.id)));
    if (existing) return existing.id;
    row.linked_note_id = other.id;
  } else if (same[0]) {
    return same[0].id;
  }
  state.addons.push(row);
  return row.id;
}

// A note with its add-ons, all or nothing (like POST /notes). Shared with the assistant.
export function saveNote(body, addons = [], addedBy = 'user') {
  const id = insertNote(body);
  try {
    for (const addon of addons) addAddon(id, addon, addon.addedBy || addedBy);
  } catch (err) {
    removeNote(id);
    throw err;
  }
  return id;
}

function removeNote(noteId) {
  state.notes = state.notes.filter(n => n.id !== noteId);
  state.addons = state.addons.filter(a => a.note_id !== noteId && a.linked_note_id !== noteId);
}

export async function createNote(body, addons = []) {
  await wait();
  return { id: saveNote(body, addons) };
}

// AI save, without the AI: tidies the text and turns "remind me ... Friday at
// 3pm" into a reminder, marked as added by the AI like the real one.
export async function aiSaveNote(text, addons = []) {
  await wait(1200);
  const trimmed = (text || '').trim() || fail('Write something first');
  const reminder = parseReminder(trimmed, new Date());
  let body = trimmed;
  if (reminder) {
    for (const words of reminder.matches) body = body.replace(words, ' ');
    body = body.replace(/\bremind me (to |about )?/i, '').replace(/[ \t]+/g, ' ').replace(/ ([,.!?])/g, '$1').trim();
  }
  body = body.charAt(0).toUpperCase() + body.slice(1);
  const ai = reminder && !addons.some(a => a.kind === 'reminder')
    ? [{ kind: 'reminder', remindAt: reminder.date.toISOString(), addedBy: 'ai' }]
    : [];
  const id = saveNote(body, [...addons, ...ai]);
  return { id, message: ai.length ? `Added a reminder for ${describeReminder(reminder.date)}.` : null, usage: null };
}

// Organize, without the AI: pins notes with a reminder in the next two days,
// suggests finishing reminders that have passed, links notes about the same
// thing, and puts the soonest reminders first.
export async function suggestOrganizing() {
  await wait(1200);
  const notes = listNotes();
  const soon = now() + 2 * 24 * 60 * 60 * 1000;
  const changes = [];
  const change = (action, note, reason, other = null) => changes.push({
    action, noteId: note.id, otherNoteId: other?.id ?? null, title: firstLine(note.body), otherTitle: other ? firstLine(other.body) : null, reason,
  });

  for (const note of notes) {
    const r = note.reminder;
    if (!r || r.done_at) continue;
    const at = new Date(r.remind_at).getTime();
    if (at < now()) change('mark_done', note, 'Its reminder time has passed.');
    else if (at < soon && !note.pin) change('pin', note, `Its reminder is ${describeReminder(new Date(at))}, so keep it in sight.`);
  }

  // names, e.g. "Brightwave": capitalized words that aren't ordinary words or dates
  const ordinary = /^(This|That|These|Your|Three|Follow|Order|Call|Things|Rain|Remind|Note|Notes|With|From|Software|Engineer|Frontend|Junior|Data|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|June|July|August|September|October|November|December)$/;
  const names = note => new Set((note.body.match(/\b[A-Z][a-zA-Z]{3,}\b/g) || []).filter(word => !ordinary.test(word)));
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const [a, b] = [notes[i], notes[j]];
      if (a.noteLinks.some(l => l.noteId === b.id)) continue;
      const shared = [...names(a)].filter(name => names(b).has(name));
      if (shared.length) change('link', a, `Both are about ${shared[0]}.`, b);
    }
  }

  const active = notes.filter(n => !n.reminder?.done_at);
  const when = n => (n.reminder ? new Date(n.reminder.remind_at).getTime() : Infinity);
  const sorted = [...active].sort((a, b) => when(a) - when(b));
  const unchanged = sorted.every((n, i) => n.id === active[i].id);
  const order = unchanged ? null : {
    noteIds: sorted.map(n => n.id),
    titles: sorted.map(n => firstLine(n.body)),
    reason: 'Soonest reminders first',
  };
  return { changes, order, usage: null };
}

export async function updateNote(noteId, changes) {
  await wait(80);
  const note = state.notes.find(n => n.id === Number(noteId)) || fail('Failed to update the note');
  if (changes.body !== undefined) note.body = cleanBody(changes.body);
  if (changes.position !== undefined) {
    if (typeof changes.position !== 'number' || !Number.isFinite(changes.position)) fail('Invalid position');
    note.position = changes.position;
  }
  note.updated_at = new Date().toISOString();
}

export async function deleteNote(noteId) {
  await wait(80);
  if (!state.notes.some(n => n.id === Number(noteId))) fail('Failed to delete the note');
  removeNote(Number(noteId));
}

export async function addNoteAddon(noteId, addon) {
  await wait(80);
  const id = addAddon(noteId, addon);
  if (id == null) fail('Failed to add that to the note');
  return { id };
}

export async function updateNoteAddon(addonId, changes) {
  await wait(80);
  const addon = state.addons.find(a => a.id === Number(addonId)) || fail('Failed to update the reminder');
  if (addon.kind !== 'reminder') fail('Only reminders can be changed');
  if (changes.remindAt !== undefined) addon.remind_at = parseTime(changes.remindAt);
  if (changes.done !== undefined) addon.done_at = changes.done ? new Date().toISOString() : null;
}

export async function removeNoteAddon(addonId) {
  await wait(80);
  if (!state.addons.some(a => a.id === Number(addonId))) fail('Failed to remove that from the note');
  state.addons = state.addons.filter(a => a.id !== Number(addonId));
}

// ---------- assistant, voice and AI status ----------

// Canned answers (see assistant.js), streamed like the real /ask: each step,
// then the answer a few words at a time.
export async function askAssistant(question, history, { openMessageId = null, draft = null, onProgress = () => {} } = {}) {
  await wait(400);
  const result = answerQuestion({
    question, history, openMessageId, draft, data: state, findMessage, searchEmails, saveNote, listNotes,
  });
  for (const step of result.steps) {
    await wait(450);
    onProgress({ type: 'step', text: step });
  }
  await wait(300);
  for (const piece of result.answer.match(/\S+\s*/g) || []) {
    onProgress({ type: 'text', delta: piece });
    await wait(18);
  }
  return { ...result, usage: null };
}

export async function transcribeRecording() {
  await wait();
  fail('Voice input is off in the demo.');
}

export async function getStatus() {
  return { problems: [] };
}

// ---------- sending ----------
// Sent email lands in Sent (and in the inbox too, when it's to one of the
// demo's own addresses). Nothing is really sent anywhere.

const UNDO_SECONDS = 15;
const uploads = new Map(); // uploadId -> File
const timers = new Map();

export async function uploadAttachment(file) {
  await wait(250);
  const uploadId = `upload-${uploads.size + 1}-${Date.now()}`;
  uploads.set(uploadId, file);
  return { uploadId };
}

const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// "Ann <a@x.com>, b@y.com" -> [{ name, address }]
function parseRecipients(text, field) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text.split(/[,;]/).map(part => part.trim()).filter(Boolean).map(part => {
    const match = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(part);
    const name = match ? match[1].trim() : '';
    const address = (match ? match[2] : part).trim();
    if (!EMAIL_ADDRESS.test(address)) fail(`"${address}" in ${field} isn't a valid email address`);
    return { name, address };
  });
}

const addressList = list => list.map(({ name, address }) => (name ? `"${name}" <${address}>` : address)).join(', ');

function shapeScheduled(row) {
  const { email } = row;
  return copy({
    id: row.id,
    accountId: row.account_id,
    sendAt: row.send_at,
    failed: row.status === 'failed' ? (row.error || 'Sending failed') : null,
    to: addressList(email.to),
    cc: addressList(email.cc),
    bcc: addressList(email.bcc),
    subject: email.subject,
    body: email.body,
    replyToMessageId: email.replyToMessageId,
    attachments: email.attachments,
    forwarded: email.forwarded.map(attachmentId => {
      const a = findAttachment(attachmentId);
      return { attachmentId, filename: a?.filename || 'attachment', size: a?.size_bytes || 0 };
    }),
  });
}

function arm(row) {
  clearTimeout(timers.get(row.id));
  const delay = new Date(row.send_at).getTime() - now();
  if (delay > 2 ** 31 - 1) return; // weeks away: the demo won't still be open
  timers.set(row.id, setTimeout(() => deliver(row), Math.max(0, delay)));
}

// "Sends" an email: it appears in Sent, and in the inbox of any of the demo's
// own addresses it was sent to.
function deliver(row) {
  if (!state.outbox.includes(row) || row.status !== 'waiting') return;
  row.status = 'sent';
  timers.delete(row.id);
  const { email } = row;
  const account = state.accounts.find(a => a.id === row.account_id);
  const original = email.replyToMessageId ? findMessage(email.replyToMessageId) : null;
  const sentAt = new Date().toISOString();
  const attachments = [
    ...email.attachments.map(a => ({ filename: a.filename, mime_type: a.mimeType || 'application/octet-stream', size_bytes: a.size || 0, file: uploads.get(a.uploadId) || null })),
    ...email.forwarded.map(id => findAttachment(id)).filter(Boolean).map(a => omit(a, 'id')),
  ];
  const base = {
    sender: `Alex Rivera <${account.email_address}>`,
    to_recipients: addressList(email.to) || null,
    cc_recipients: addressList(email.cc) || null,
    subject: email.subject,
    body: email.body,
    snippet: email.body.replace(/\s+/g, ' ').slice(0, 200),
    received_at: sentAt,
    has_attachments: attachments.length > 0,
    pinned_at: null,
    html: null,
    reply_to: null,
  };
  let attachmentId = 20000 + state.messages.length * 10;
  const withAttachments = () => attachments.map(a => ({ ...a, id: attachmentId++, external_id: '2', pdf: a.pdf || null }));

  state.messages.push({
    ...base, id: nextId(state.messages), account_id: account.id,
    thread_id: original && original.account_id === account.id ? original.thread_id || `t-${original.id}` : null,
    labels: ['SENT'], is_read: true, attachments: withAttachments(),
  });
  if (original && original.account_id === account.id && !original.thread_id) original.thread_id = `t-${original.id}`;

  const recipients = [...email.to, ...email.cc, ...email.bcc].map(r => r.address.toLowerCase());
  for (const own of state.accounts.filter(a => recipients.includes(a.email_address.toLowerCase()) && a.id !== account.id)) {
    state.messages.push({
      ...base, id: nextId(state.messages), account_id: own.id, thread_id: null,
      labels: ['INBOX'], is_read: false, attachments: withAttachments(),
    });
  }
}

export async function sendEmail(input) {
  await wait(300);
  const account = state.accounts.find(a => a.id === Number(input.accountId)) || fail('Choose which account to send from');
  const to = parseRecipients(input.to, 'To');
  const cc = parseRecipients(input.cc, 'Cc');
  const bcc = parseRecipients(input.bcc, 'Bcc');
  if (!to.length && !cc.length && !bcc.length) fail('Add who the email is to');
  const subject = typeof input.subject === 'string' ? input.subject.trim().slice(0, 500) : '';
  const body = typeof input.body === 'string' ? input.body : '';
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const forwarded = Array.isArray(input.forwardedAttachmentIds) ? input.forwardedAttachmentIds.map(Number).filter(Boolean) : [];
  if (!subject && !body.trim() && !attachments.length && !forwarded.length) fail('The email is empty');

  const scheduled = input.sendAt != null;
  let sendAt = new Date(now() + UNDO_SECONDS * 1000);
  if (scheduled) {
    sendAt = new Date(input.sendAt);
    if (Number.isNaN(sendAt.getTime())) fail('Choose when to send it');
    if (sendAt.getTime() < now() + 60 * 1000) fail('Choose a time at least a minute from now');
    if (sendAt.getTime() > now() + 365 * 24 * 60 * 60 * 1000) fail('Emails can be scheduled up to a year ahead');
  }
  const row = {
    id: nextId(state.outbox), account_id: account.id, status: 'waiting', error: null, send_at: sendAt.toISOString(),
    email: { to, cc, bcc, subject, body, replyToMessageId: input.replyToMessageId ?? null, attachments, forwarded, scheduled },
  };
  state.outbox.push(row);
  arm(row);
  return { id: row.id, sendAt: row.send_at, scheduled };
}

export async function getSendStatus(outboxId) {
  await wait(80);
  const row = state.outbox.find(r => r.id === Number(outboxId)) || fail('Could not check on that email');
  return { status: row.status, error: row.error };
}

// Takes back an email that hasn't gone yet. Returns it, as listScheduled shapes it.
function takeBack(outboxId) {
  const row = state.outbox.find(r => r.id === Number(outboxId));
  if (!row || !['waiting', 'failed'].includes(row.status)) fail('Too late, it has already been sent');
  clearTimeout(timers.get(row.id));
  timers.delete(row.id);
  state.outbox = state.outbox.filter(r => r !== row);
  return shapeScheduled(row);
}

export async function cancelSend(outboxId) {
  await wait(150);
  takeBack(outboxId);
}

export async function getScheduled() {
  await wait();
  return state.outbox
    .filter(r => r.email.scheduled && ['waiting', 'failed'].includes(r.status))
    .sort((a, b) => a.send_at.localeCompare(b.send_at))
    .map(shapeScheduled);
}

export async function sendScheduledNow(outboxId) {
  await wait(200);
  const row = state.outbox.find(r => r.id === Number(outboxId) && r.status === 'waiting') || fail('It has already been sent or cancelled');
  row.send_at = new Date().toISOString();
  arm(row);
}

export async function takeBackScheduled(outboxId) {
  await wait(200);
  return takeBack(outboxId);
}
