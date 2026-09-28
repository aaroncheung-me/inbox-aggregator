// How the AI writes and saves notes. Shared by AI save (lib/aiSave.js) and the
// assistant's "create a note" tool (lib/assistant.js), so both make the same
// kind of note and go through the same checks.
const { createNote, deleteNote, addAddon } = require('./notes');
const { localTimeToUtc } = require('./time');

const NOTE_SEARCH_RESULTS = 8;

// The rules for writing a note, for either model prompt.
const NOTE_WRITING_RULES = `There are two kinds of note; decide which this is.

A. The user's own note: a task, idea or reminder in their own words ("call mom tomorrow about thanksgiving", "reply to the M&D support email friday", "buy milk"). Rewrite it short and clear, keeping every fact they gave and nothing else. If it mentions an email, find it only to link it; never copy details from it (ticket numbers, statuses, what it says) into the note, since the link already connects them.

B. A request to note something from their email: they name a topic and want it written up ("note my IBM job progress", "note my flight details", "save what the landlord said about the lease"). Research it: search their email, and open the emails that matter to see what they actually say. Search results are ranked by how well they match, not by date, so also make sure you've seen the latest: search with just the sender filter (e.g. from "ibm") and an empty query, which lists that sender's newest emails first. Then write the note from what you found: a title line, then short lines with the key facts, most recent first (statuses, dates, amounts, deadlines, next steps). Anything that needs the user to act (an assessment to complete, a form, a reply, a deadline) comes first. Group similar emails into one line (e.g. "3 applications from Jan to May: all declined") rather than listing each. Only state what the emails show. Link the emails the note relies on most, up to 5, starting with any that need action.

For both kinds:
- Writing: the first line works as a title. Drop filler ("uh", "like", "so") and instructions meant for you ("remind me", "pin this", "note my"), and time phrases that become the reminder.
- Reminder: set remind_at when the user says when to be reminded or when something is due, in their local time. A day without a time means 09:00; "morning" 09:00, "afternoon" 14:00, "evening" or "tonight" 18:00. Relative times ("in 2 hours") count from now. If no time is mentioned, leave it null.
- Pin: only when the user themselves says it's important or urgent, or asks to pin it. Never pin just because something has a deadline; the reminder covers that.
- Links for kind A: only when the note clearly refers to a specific email or note and you're confident which one. Don't link things that are merely related.`;

// The fields describing a note to save, for AI save's save_note tool and the
// assistant's create_note tool.
const NOTE_FIELDS = {
  text: { type: 'string', description: 'The note. Its first line works as a title.' },
  remind_at: {
    type: ['string', 'null'],
    description: 'When to remind the user, as local time "YYYY-MM-DDTHH:mm", or null for no reminder.',
  },
  pin: { type: 'boolean', description: 'True only if the user themselves said it is important or urgent, or asked to pin it. Not for deadlines.' },
  email_ids: {
    type: 'array',
    items: { type: 'integer' },
    description: 'Ids of emails to link: ones the note refers to, or (for a write-up) relies on most. Only ids you saw in search results or opened.',
  },
  note_ids: {
    type: 'array',
    items: { type: 'integer' },
    description: 'Ids of existing notes the note clearly refers to, from note search results.',
  },
};

const SEARCH_NOTES_TOOL = {
  name: 'search_notes',
  description: "Search the user's existing notes by words. Returns up to 8 matches with their ids.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Words to look for.' } },
    required: ['query'],
  },
};

// Ids as the model writes them: 2914, "2914", "#2914", "note 12" -> a number (NaN if none).
function parseId(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : NaN;
}

function firstLine(body) {
  return (body || '').split('\n').find(line => line.trim())?.trim().slice(0, 100) || '(empty note)';
}

// Notes containing any of the query's words, most matching words first.
function searchNotes(notes, query) {
  const words = (query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2);
  return notes
    .map(note => ({ note, hits: words.filter(w => note.body.toLowerCase().includes(w)).length }))
    .filter(r => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, NOTE_SEARCH_RESULTS)
    .map(r => r.note);
}

// Notes as the model sees them: "[note 12] Title: the rest of the note"
function formatNotes(notes) {
  return notes.map(note => {
    const rest = note.body.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    return `[note ${note.id}] ${firstLine(note.body)}${rest ? `: ${rest}` : ''}`;
  }).join('\n');
}

// Runs search_notes: returns what the model sees, and records what it found
// in seenNoteIds (only those can be linked later).
function runNoteSearch(notes, query, seenNoteIds) {
  const found = searchNotes(notes, query);
  found.forEach(note => seenNoteIds.add(note.id));
  return found.length ? formatNotes(found) : 'No matching notes.';
}

// Saves a note the AI decided on (the NOTE_FIELDS above). Only emails and notes
// the AI actually found in this user's account get linked, and add-ons the user
// picked by hand are kept as theirs; the AI's own are marked as the AI's.
// With no decision, fallbackText is saved as written.
// Returns { id, messages } where messages are heads-ups for the user.
async function saveAiNote({ userId, decision, fallbackText, manualAddons = [], timeZone, seenEmailIds, seenNoteIds }) {
  const messages = [];
  const body = (typeof decision?.text === 'string' && decision.text.trim()) || fallbackText;
  if (!decision) messages.push("The AI couldn't process this one, so it was saved as written.");

  const id = await createNote(userId, body);
  try {
    for (const addon of manualAddons) await addAddon(userId, id, addon, 'user');
  } catch (err) {
    await deleteNote(userId, id).catch(() => {});
    throw err;
  }
  if (!decision) return { id, messages };

  const hasManual = kind => manualAddons.some(a => a.kind === kind);
  const aiAddons = [];

  if (decision.remind_at && !hasManual('reminder')) {
    const remindAt = localTimeToUtc(decision.remind_at, timeZone);
    if (remindAt) aiAddons.push({ kind: 'reminder', remindAt });
    else messages.push("The reminder time couldn't be understood, so no reminder was set.");
  }
  if (decision.pin === true && !hasManual('pin')) aiAddons.push({ kind: 'pin' });
  for (const messageId of new Set((decision.email_ids || []).map(parseId))) {
    if (seenEmailIds.has(messageId)) aiAddons.push({ kind: 'email_link', messageId });
  }
  for (const noteId of new Set((decision.note_ids || []).map(parseId))) {
    if (seenNoteIds.has(noteId) && noteId !== id) aiAddons.push({ kind: 'note_link', noteId });
  }

  for (const addon of aiAddons) {
    try {
      await addAddon(userId, id, addon, 'ai');
    } catch (err) {
      console.error('Skipped an AI add-on:', addon, err.message);
    }
  }
  return { id, messages };
}

module.exports = {
  NOTE_WRITING_RULES,
  NOTE_FIELDS,
  SEARCH_NOTES_TOOL,
  parseId,
  firstLine,
  searchNotes,
  formatNotes,
  runNoteSearch,
  saveAiNote,
};
