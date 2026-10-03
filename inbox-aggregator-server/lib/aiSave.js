const supabase = require('./supabase');
const { anthropic, MODEL, forceTool, newUsage, addUsage, usageReport } = require('./claude');
const { SEARCH_EMAILS_TOOL, READ_EMAIL_TOOL, runTool } = require('./assistantTools');
const { listNotes, firstLine } = require('./notes');
const { validTimeZone, describeNow } = require('./time');
const { NOTE_WRITING_RULES, NOTE_FIELDS, SEARCH_NOTES_TOOL, saveAiNote } = require('./noteWriting');

// searches and emails opened, together; research notes need several of each
const MAX_TOOL_CALLS = 8;

const SAVE_NOTE_TOOL = {
  name: 'save_note',
  description: 'Save the note. Call exactly once, when you are done.',
  input_schema: {
    type: 'object',
    properties: {
      ...NOTE_FIELDS,
      message_to_user: {
        type: ['string', 'null'],
        description: 'A short heads-up, e.g. that an email they mentioned could not be found. Null if nothing to say.',
      },
    },
    required: ['text', 'remind_at', 'pin', 'email_ids', 'note_ids', 'message_to_user'],
  },
};

function systemPrompt(timeZone) {
  return `You file a note for the user, the way a sharp personal assistant would. It is now ${describeNow(timeZone)} in the user's time zone (${timeZone}).

${NOTE_WRITING_RULES}
- If you couldn't find something the user referred to, say so in message_to_user.

You can use the search and read tools at most ${MAX_TOOL_CALLS} times in total; then call save_note.`;
}

// What the user already attached by hand, so the AI builds on it instead of redoing it.
async function describeManualAddons(addons, notesById) {
  const lines = [];
  const messageIds = addons.filter(a => a.kind === 'email_link').map(a => a.messageId);
  const subjects = new Map();
  if (messageIds.length) {
    const { data } = await supabase.from('messages').select('id, subject').in('id', messageIds);
    for (const m of data || []) subjects.set(m.id, m.subject);
  }
  for (const a of addons) {
    if (a.kind === 'reminder') lines.push('- a reminder (so do not set one; leave remind_at null)');
    if (a.kind === 'pin') lines.push('- a pin');
    if (a.kind === 'email_link') lines.push(`- a link to the email "${subjects.get(Number(a.messageId)) || 'unknown'}" [#${a.messageId}]`);
    if (a.kind === 'note_link') lines.push(`- a link to the note "${firstLine(notesById.get(Number(a.noteId))?.body)}"`);
  }
  return lines.length ? `The user already attached these themselves:\n${lines.join('\n')}` : '';
}

// Runs the model until it calls save_note. Returns that call's input, or null
// if it never did.
async function decide({ text, manualDescription, timeZone, ctx, usage }) {
  const messages = [{
    role: 'user',
    content: `The note:\n"""\n${text}\n"""${manualDescription ? `\n\n${manualDescription}` : ''}`,
  }];
  let toolCalls = 0;

  for (let round = 0; round <= MAX_TOOL_CALLS + 1; round++) {
    const outOfToolCalls = toolCalls >= MAX_TOOL_CALLS || round === MAX_TOOL_CALLS + 1;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt(timeZone),
      tools: [SEARCH_EMAILS_TOOL, READ_EMAIL_TOOL, SEARCH_NOTES_TOOL, SAVE_NOTE_TOOL],
      tool_choice: outOfToolCalls ? forceTool('save_note') : { type: 'auto' },
      messages,
    });
    addUsage(usage, response);

    const toolUses = response.content.filter(block => block.type === 'tool_use');
    const save = toolUses.find(block => block.name === 'save_note');
    if (save) return save.input;

    messages.push({ role: 'assistant', content: response.content });
    if (!toolUses.length) {
      // answered in text instead of saving: ask once more, now forced to save
      messages.push({ role: 'user', content: 'Call save_note now.' });
      toolCalls = MAX_TOOL_CALLS;
      continue;
    }

    const results = [];
    for (const toolUse of toolUses) {
      toolCalls++;
      let content;
      if (toolCalls > MAX_TOOL_CALLS) {
        content = 'Tool limit reached.';
      } else {
        try {
          content = (await runTool(toolUse.name, toolUse.input, ctx)).content;
        } catch (err) {
          console.error('AI save search failed:', err);
          content = 'That search failed.';
        }
      }
      results.push({ type: 'tool_result', tool_use_id: toolUse.id, content });
    }
    messages.push({ role: 'user', content: results });
  }
  return null;
}

// Rewrites a note with the AI, works out its add-ons, and saves it.
// manualAddons are ones the user picked in the composer; they're kept as the
// user's. Returns { id, message, usage }.
async function aiSaveNote({ userId, accountIds, ownAddresses, text, manualAddons = [], timeZone }) {
  const zone = validTimeZone(timeZone);
  const notes = await listNotes(userId);
  const notesById = new Map(notes.map(note => [note.id, note]));
  // seen and seenNotes: what searches found or the model opened, the only things it may link
  const ctx = { userId, accountIds, ownAddresses, notes, seen: new Set(), seenNotes: new Set() };
  const usage = newUsage();

  const decision = await decide({
    text,
    manualDescription: await describeManualAddons(manualAddons, notesById),
    timeZone: zone,
    ctx,
    usage,
  });

  const { id, messages } = await saveAiNote({
    userId,
    decision,
    fallbackText: text,
    manualAddons,
    timeZone: zone,
    seenEmailIds: ctx.seen,
    seenNoteIds: ctx.seenNotes,
  });
  if (decision?.message_to_user) messages.push(decision.message_to_user);

  return { id, message: messages.join(' ') || null, usage: usageReport(usage) };
}

module.exports = { aiSaveNote };
