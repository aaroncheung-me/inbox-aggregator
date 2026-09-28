const supabase = require('./supabase');
const { listAccounts } = require('./accounts');
const { UserError } = require('./errors');

const MAX_BODY_CHARS = 10000;
const ADDON_KINDS = ['reminder', 'email_link', 'note_link', 'pin'];
const ADDON_COLUMNS = 'id, note_id, kind, added_by, remind_at, done_at, linked_message_id, linked_note_id, created_at';

function firstLine(body) {
  return (body || '').split('\n').find(line => line.trim())?.trim().slice(0, 120) || '(empty note)';
}

async function userAccountIds(userId) {
  return (await listAccounts(userId)).map(a => a.id);
}

// ---------- reading ----------

// All of the user's notes in their order, each shaped for the app:
//   { id, body, position, created_at, updated_at,
//     pin:        { id, added_by } | null,
//     reminder:   { id, remind_at, done_at, added_by } | null,
//     emailLinks: [{ addonId, added_by, message: { id, subject, sender, received_at, account_id } }],
//     noteLinks:  [{ addonId, added_by, noteId, preview }] }
// A link between two notes is stored once but listed on both of them.
async function listNotes(userId) {
  const { data: notes, error } = await supabase
    .from('notes')
    .select('id, body, position, created_at, updated_at')
    .eq('user_id', userId)
    .order('position');
  if (error) throw error;
  if (!notes.length) return [];

  const { data: addons, error: addonError } = await supabase
    .from('note_addons')
    .select(ADDON_COLUMNS)
    .in('note_id', notes.map(n => n.id))
    .order('created_at');
  if (addonError) throw addonError;

  // details for the email chips; only emails in the user's own accounts
  const messageIds = [...new Set(addons.filter(a => a.kind === 'email_link').map(a => a.linked_message_id))];
  const messagesById = new Map();
  if (messageIds.length) {
    const { data: messages, error: messageError } = await supabase
      .from('messages')
      .select('id, subject, sender, received_at, account_id')
      .in('id', messageIds)
      .in('account_id', await userAccountIds(userId));
    if (messageError) throw messageError;
    for (const m of messages) messagesById.set(m.id, m);
  }

  const shaped = new Map(notes.map(n => [n.id, { ...n, pin: null, reminder: null, emailLinks: [], noteLinks: [] }]));
  for (const a of addons) {
    const note = shaped.get(a.note_id);
    if (a.kind === 'pin') note.pin = { id: a.id, added_by: a.added_by };
    if (a.kind === 'reminder') note.reminder = { id: a.id, remind_at: a.remind_at, done_at: a.done_at, added_by: a.added_by };
    if (a.kind === 'email_link' && messagesById.has(a.linked_message_id)) {
      note.emailLinks.push({ addonId: a.id, added_by: a.added_by, message: messagesById.get(a.linked_message_id) });
    }
    if (a.kind === 'note_link' && shaped.has(a.linked_note_id)) {
      const other = shaped.get(a.linked_note_id);
      note.noteLinks.push({ addonId: a.id, added_by: a.added_by, noteId: other.id, preview: firstLine(other.body) });
      other.noteLinks.push({ addonId: a.id, added_by: a.added_by, noteId: note.id, preview: firstLine(note.body) });
    }
  }
  return [...shaped.values()];
}

// Notes stuck to one email, for the email view: [{ id, body, reminder }]
async function notesForMessage(userId, messageId) {
  const { data, error } = await supabase
    .from('note_addons')
    .select('note_id, notes!note_addons_note_id_fkey!inner(id, body, user_id, position)')
    .eq('kind', 'email_link')
    .eq('linked_message_id', messageId)
    .eq('notes.user_id', userId);
  if (error) throw error;
  if (!data.length) return [];

  const noteIds = data.map(row => row.note_id);
  const { data: reminders, error: reminderError } = await supabase
    .from('note_addons')
    .select('note_id, remind_at, done_at')
    .eq('kind', 'reminder')
    .in('note_id', noteIds);
  if (reminderError) throw reminderError;
  const reminderByNote = new Map(reminders.map(r => [r.note_id, { remind_at: r.remind_at, done_at: r.done_at }]));

  return data
    .map(row => ({ id: row.notes.id, body: row.notes.body, position: row.notes.position, reminder: reminderByNote.get(row.note_id) || null }))
    .sort((a, b) => a.position - b.position);
}

// ---------- ownership checks ----------

async function getOwnedNote(userId, noteId) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, body, position')
    .eq('id', noteId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOwnedAddon(userId, addonId) {
  const { data, error } = await supabase
    .from('note_addons')
    .select(`${ADDON_COLUMNS}, notes!note_addons_note_id_fkey!inner(user_id)`)
    .eq('id', addonId)
    .eq('notes.user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function cleanBody(body) {
  if (typeof body !== 'string') throw new UserError('Note text is missing');
  return body.slice(0, MAX_BODY_CHARS);
}

function parseTime(value) {
  const time = new Date(value);
  if (!value || Number.isNaN(time.getTime())) throw new UserError('That reminder time is not a valid date');
  return time.toISOString();
}

// ---------- changing notes ----------

// New notes go to the top of the list.
async function createNote(userId, body) {
  const { data: first, error: firstError } = await supabase
    .from('notes')
    .select('position')
    .eq('user_id', userId)
    .order('position')
    .limit(1);
  if (firstError) throw firstError;

  const { data, error } = await supabase
    .from('notes')
    .insert({ user_id: userId, body: cleanBody(body), position: first.length ? first[0].position - 1 : 0 })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// changes: { body?, position? }. Returns false if the note isn't the user's.
async function updateNote(userId, noteId, { body, position }) {
  const changes = { updated_at: new Date().toISOString() };
  if (body !== undefined) changes.body = cleanBody(body);
  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isFinite(position)) throw new UserError('Invalid position');
    changes.position = position;
  }

  const { data, error } = await supabase
    .from('notes')
    .update(changes)
    .eq('id', noteId)
    .eq('user_id', userId)
    .select('id');
  if (error) throw error;
  return data.length > 0;
}

async function deleteNote(userId, noteId) {
  const { data, error } = await supabase.from('notes').delete().eq('id', noteId).eq('user_id', userId).select('id');
  if (error) throw error;
  return data.length > 0;
}

// ---------- add-ons ----------

// addon: { kind, remindAt?, messageId?, noteId? }. addedBy: 'user' or 'ai'.
// A note has at most one reminder (adding another moves it) and one pin, and
// adding a link that already exists does nothing. Returns the add-on's id, or
// null if the note isn't the user's.
async function addAddon(userId, noteId, addon, addedBy = 'user') {
  const note = await getOwnedNote(userId, noteId);
  if (!note) return null;
  if (!ADDON_KINDS.includes(addon.kind)) throw new UserError('Unknown kind of add-on');

  const row = { note_id: note.id, kind: addon.kind, added_by: addedBy };
  let existing = supabase.from('note_addons').select('id').eq('note_id', note.id).eq('kind', addon.kind);

  if (addon.kind === 'reminder') {
    row.remind_at = parseTime(addon.remindAt);
  } else if (addon.kind === 'email_link') {
    const { data: message, error } = await supabase
      .from('messages')
      .select('id')
      .eq('id', addon.messageId)
      .in('account_id', await userAccountIds(userId))
      .maybeSingle();
    if (error) throw error;
    if (!message) throw new UserError('That email was not found');
    row.linked_message_id = message.id;
    existing = existing.eq('linked_message_id', message.id);
  } else if (addon.kind === 'note_link') {
    const other = await getOwnedNote(userId, addon.noteId);
    if (!other) throw new UserError('That note was not found');
    if (other.id === note.id) throw new UserError("A note can't link to itself");
    row.linked_note_id = other.id;
    // a link in the other direction already connects them
    const { data: reverse, error } = await supabase
      .from('note_addons')
      .select('id')
      .eq('kind', 'note_link')
      .eq('note_id', other.id)
      .eq('linked_note_id', note.id)
      .maybeSingle();
    if (error) throw error;
    if (reverse) return reverse.id;
    existing = existing.eq('linked_note_id', other.id);
  }

  const { data: found, error: findError } = await existing.maybeSingle();
  if (findError) throw findError;

  if (found && addon.kind === 'reminder') {
    // one reminder per note: a new time replaces the old one and un-ticks it
    const { error } = await supabase
      .from('note_addons')
      .update({ remind_at: row.remind_at, done_at: null, added_by: addedBy })
      .eq('id', found.id);
    if (error) throw error;
    return found.id;
  }
  if (found) return found.id;

  const { data, error } = await supabase.from('note_addons').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

// changes: { remindAt?, done? } (reminders only). Returns false if not the user's.
async function updateAddon(userId, addonId, { remindAt, done }) {
  const addon = await getOwnedAddon(userId, addonId);
  if (!addon) return false;
  if (addon.kind !== 'reminder') throw new UserError('Only reminders can be changed');

  const changes = {};
  if (remindAt !== undefined) changes.remind_at = parseTime(remindAt);
  if (done !== undefined) changes.done_at = done ? new Date().toISOString() : null;
  if (!Object.keys(changes).length) return true;

  const { error } = await supabase.from('note_addons').update(changes).eq('id', addon.id);
  if (error) throw error;
  return true;
}

async function removeAddon(userId, addonId) {
  const addon = await getOwnedAddon(userId, addonId);
  if (!addon) return false;
  const { error } = await supabase.from('note_addons').delete().eq('id', addon.id);
  if (error) throw error;
  return true;
}

module.exports = {
  listNotes,
  notesForMessage,
  createNote,
  updateNote,
  deleteNote,
  addAddon,
  updateAddon,
  removeAddon,
};
