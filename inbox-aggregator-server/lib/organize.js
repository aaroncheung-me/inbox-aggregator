const { anthropic, MODEL, forceTool, newUsage, addUsage, usageReport } = require('./claude');
const { listNotes, firstLine } = require('./notes');
const { validTimeZone, describeNow } = require('./time');
const { parseId } = require('./noteWriting');

const NOTE_EXCERPT_CHARS = 400;
const MAX_NOTES = 150; // beyond this, only the newest are shown to the AI
const ACTIONS = ['pin', 'unpin', 'mark_done', 'link'];

const SUGGEST_TOOL = {
  name: 'suggest_changes',
  description: 'Suggest how to tidy up the notes. The user reviews every suggestion before anything changes.',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ACTIONS },
            note_id: { type: 'integer' },
            other_note_id: { type: ['integer', 'null'], description: 'For link: the note to link it to.' },
            reason: { type: 'string', description: 'Why, in a few words the user will see.' },
          },
          required: ['action', 'note_id', 'other_note_id', 'reason'],
        },
      },
      order: {
        type: ['array', 'null'],
        items: { type: 'integer' },
        description: 'A better order for the notes that are not done, most important first, as note ids. Null to keep the current order.',
      },
      order_reason: { type: ['string', 'null'], description: 'Why this order, in a few words. Null if order is null.' },
    },
    required: ['changes', 'order', 'order_reason'],
  },
};

function systemPrompt(timeZone) {
  return `You help the user keep their notes tidy. It is now ${describeNow(timeZone)} in their time zone (${timeZone}).

Look over their notes and suggest only changes that clearly help. Every suggestion is shown to the user to accept or skip, so it's fine to suggest nothing when things look fine.

- pin: a note that is clearly important right now (an upcoming deadline or task the user can't miss). Pin sparingly; a few pinned notes at most.
- unpin: a pinned note that no longer needs to be on top (its moment has passed, or it's done).
- mark_done: a reminder whose task is evidently finished or whose time is well past and no longer matters.
- link: two notes about the same thing that aren't linked yet. If they look like duplicates, say so in the reason.
- order: a better order for the notes that aren't done, most important first: upcoming deadlines and open tasks before reference notes. Only suggest an order if it's clearly better than the current one.

Never suggest deleting anything. Keep each reason to a few words, and refer to other notes by their title, never by id number (the user doesn't see ids).`;
}

function formatNotes(notes, timeZone) {
  const localTime = iso => new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));

  return notes.map(note => {
    const flags = [];
    if (note.pin) flags.push('pinned');
    if (note.reminder) flags.push(`reminder ${localTime(note.reminder.remind_at)}${note.reminder.done_at ? ' (done)' : ''}`);
    if (note.noteLinks.length) flags.push(`linked to notes ${note.noteLinks.map(l => l.noteId).join(', ')}`);
    if (note.emailLinks.length) flags.push(`${note.emailLinks.length} linked email${note.emailLinks.length === 1 ? '' : 's'}`);
    flags.push(`written ${note.created_at.slice(0, 10)}`);
    return `[note ${note.id}] (${flags.join('; ')})\n${note.body.slice(0, NOTE_EXCERPT_CHARS)}`;
  }).join('\n\n');
}

// Keeps only suggestions that make sense for these notes (real ids, not
// already true), and describes each for the review list:
//   { action, noteId, otherNoteId, title, otherTitle, reason }
function checkSuggestions(decision, notes) {
  const byId = new Map(notes.map(note => [note.id, note]));
  const seen = new Set();
  const changes = [];

  for (const change of decision?.changes || []) {
    const noteId = parseId(change.note_id);
    const note = byId.get(noteId);
    if (!note || !ACTIONS.includes(change.action)) continue;

    const otherNoteId = change.action === 'link' ? parseId(change.other_note_id) : null;
    const other = byId.get(otherNoteId);
    if (change.action === 'pin' && note.pin) continue;
    if (change.action === 'unpin' && !note.pin) continue;
    if (change.action === 'mark_done' && (!note.reminder || note.reminder.done_at)) continue;
    if (change.action === 'link' && (!other || other.id === note.id || note.noteLinks.some(l => l.noteId === other.id))) continue;

    // one suggestion per note/action (and per pair, for links)
    const key = change.action === 'link'
      ? `link:${Math.min(noteId, otherNoteId)}:${Math.max(noteId, otherNoteId)}`
      : `${change.action}:${noteId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    changes.push({
      action: change.action,
      noteId,
      otherNoteId: other ? other.id : null,
      title: firstLine(note.body),
      otherTitle: other ? firstLine(other.body) : null,
      reason: String(change.reason || '').slice(0, 200),
    });
  }

  // a new order must cover the notes that aren't done, each once; others are appended in their current order
  let order = null;
  const active = notes.filter(note => !note.reminder?.done_at);
  const proposed = [...new Set((decision?.order || []).map(parseId))].filter(id => active.some(note => note.id === id));
  if (proposed.length >= 2) {
    const rest = active.map(note => note.id).filter(id => !proposed.includes(id));
    const full = [...proposed, ...rest];
    const unchanged = full.every((id, i) => id === active[i].id);
    if (!unchanged) {
      order = {
        noteIds: full,
        titles: full.map(id => firstLine(byId.get(id).body)),
        reason: String(decision.order_reason || '').slice(0, 200),
      };
    }
  }

  return { changes, order };
}

// Asks the AI how to tidy the notes. Changes nothing: returns suggestions for
// the user to review, { changes, order, usage }.
async function suggestOrganizing({ userId, timeZone }) {
  const zone = validTimeZone(timeZone);
  const allNotes = await listNotes(userId);
  // the newest notes if there are very many
  const notes = allNotes.length > MAX_NOTES
    ? [...allNotes].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, MAX_NOTES).sort((a, b) => a.position - b.position)
    : allNotes;

  const usage = newUsage();
  let decision = null;
  if (notes.length) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt(zone),
      tools: [SUGGEST_TOOL],
      tool_choice: forceTool('suggest_changes'),
      messages: [{ role: 'user', content: `The notes, in their current order:\n\n${formatNotes(notes, zone)}` }],
    });
    addUsage(usage, response);
    decision = response.content.find(block => block.type === 'tool_use' && block.name === 'suggest_changes')?.input || null;
  }

  return { ...checkSuggestions(decision, notes), usage: usageReport(usage) };
}

module.exports = { suggestOrganizing };
