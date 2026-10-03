const supabase = require('./supabase');
const { anthropic, MODEL, newUsage, addUsage, usageReport } = require('./claude');
const { hybridSearch, questionKeywords } = require('./search');
const { TOOLS, WRITE_DRAFT_TOOL, runTool, formatResults } = require('./assistantTools');
const { listNotes, firstLine } = require('./notes');
const { validTimeZone, describeNow } = require('./time');
const { NOTE_WRITING_RULES, searchNotes, formatNotes } = require('./noteWriting');

const MAX_TOOL_CALLS = 8;
const INITIAL_RESULTS = 8;
const INITIAL_NOTES = 3; // notes matching the question's words, included up front
const INITIAL_RESULTS_WITH_BODY = 3; // the top few include body text, so easy questions need no tool calls
const MAX_HISTORY_TURNS = 6;

const DRAFTING_PROMPT = `

The user is writing an email right now; it is shown with their request. While writing, requests come without initial search results: use the tools when a request needs facts from their email or notes. Help with it only in the way they ask: answer questions about their email and notes as usual, or, when they ask you to write or change the email, call write_draft once with the complete text and then say in a sentence what you wrote rather than repeating it. Never write or change the email unless they ask. Write plain text in the user's own voice, matching the tone of emails they sent if you've seen any. Don't invent facts, dates or promises: put a clear [placeholder] where something is unknown.`;

function systemPrompt(timeZone, drafting) {
  return `You help the user with their own email and notes. It is now ${describeNow(timeZone)} in the user's time zone (${timeZone}).

Each question comes with initial search results. If they answer it, answer right away without using tools. Otherwise use the tools: search again with different wording, likely senders or related businesses, open promising emails, and read attachments when the answer is probably inside a document. You can make at most ${MAX_TOOL_CALLS} tool calls.

The user also keeps notes. Notes matching the question come with it when there are any, and search_notes finds others. Treat them like the user's own records.

Only create a note when the user asks you to note, save, write down, remember or remind them of something. Then call create_note once for it, and afterwards tell them briefly what you saved rather than repeating the whole note. "This email" means the email they have open, if one is given. "Save that" (or similar) means write the note from your previous answer and link the emails it cited. Write notes following these rules:

${NOTE_WRITING_RULES}

Think about where the information would realistically be. For example, a glasses prescription might come from an optometrist, an eye clinic or an eyewear store, often as a PDF attachment, and never mention "glasses" in the subject.

Questions about the user's own things ("my headphones", "my order", "my appointment") are usually answered by their personal dealings: orders, receipts, support threads, appointments, and emails they sent or replied to. Results are tagged when they look like one of these, or like marketing. Marketing rarely answers such questions, so if the results are mostly marketing, search again (for example for the company's support or order emails, or the user's own messages) before answering. Search before asking the user to clarify anything.

When you answer:
- Be brief and direct.
- Cite each email your answer relies on with its id in brackets, like [#123], and each note like [note 12], right after the fact it supports.
- Only state what the emails and notes actually show. If you can't find it, say so and briefly say what you searched for.${drafting ? DRAFTING_PROMPT : ''}`;
}

// ---------- the answer loop ----------

// Where an answer's time went, logged as one line per question, so slow parts
// can be found (locally and in Render's logs).
function stopwatch() {
  const start = Date.now();
  let last = start;
  const laps = [];
  return {
    lap(label) {
      const now = Date.now();
      laps.push(`${label} ${now - last}ms`);
      last = now;
    },
    summary: () => `${laps.join(', ')} = ${Date.now() - start}ms`,
  };
}

// Keeps only citations of emails and notes Claude actually saw (so it can't
// point at made-up ids), and returns them in order of first mention as
// sources: { kind: 'email', id, accountId, subject, sender, received_at, preview }
//       or { kind: 'note', id, title }
async function collectSources(answer, ctx) {
  const cited = []; // [{ kind, id }]
  const createdIds = new Set(ctx.created.map(note => note.id));
  const cleaned = answer.replace(/\[(#|note )(\d+)\]/g, (marker, prefix, rawId) => {
    const kind = prefix === '#' ? 'email' : 'note';
    const id = Number(rawId);
    const known = kind === 'email' ? ctx.seen.has(id) : ctx.seenNotes.has(id) || createdIds.has(id);
    if (!known) return '';
    if (!cited.some(c => c.kind === kind && c.id === id)) cited.push({ kind, id });
    return marker;
  });
  if (!cited.length) return { answer: cleaned, sources: [] };

  const emailIds = cited.filter(c => c.kind === 'email').map(c => c.id);
  const emailsById = new Map();
  if (emailIds.length) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, account_id, subject, sender, received_at, snippet')
      .in('id', emailIds)
      .in('account_id', ctx.accountIds);
    if (error) throw error;
    for (const m of data) emailsById.set(m.id, m);
  }

  const notesById = new Map(ctx.notes.map(note => [note.id, note]));
  const sources = [];
  for (const { kind, id } of cited) {
    if (kind === 'email' && emailsById.has(id)) {
      const m = emailsById.get(id);
      sources.push({
        kind,
        id,
        accountId: m.account_id,
        subject: m.subject,
        sender: m.sender,
        received_at: m.received_at,
        preview: (m.snippet || '').slice(0, 150),
      });
    } else if (kind === 'note') {
      const note = notesById.get(id);
      const created = ctx.created.find(c => c.id === id);
      if (note || created) sources.push({ kind, id, title: note ? firstLine(note.body) : created.title });
    }
  }
  return { answer: cleaned, sources };
}

// Emails and notes cited in earlier answers can be linked by "save that as a
// note", so they count as seen, once checked to be the user's.
async function seedFromHistory(history, ctx) {
  const emailIds = new Set();
  const noteIds = new Set();
  for (const turn of history) {
    for (const [, prefix, id] of (turn.answer || '').matchAll(/\[(#|note )(\d+)\]/g)) {
      (prefix === '#' ? emailIds : noteIds).add(Number(id));
    }
  }
  if (emailIds.size) {
    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .in('id', [...emailIds])
      .in('account_id', ctx.accountIds);
    if (error) throw error;
    data.forEach(m => ctx.seen.add(m.id));
  }
  const ownNoteIds = new Set(ctx.notes.map(note => note.id));
  noteIds.forEach(id => { if (ownNoteIds.has(id)) ctx.seenNotes.add(id); });
}

// The email the user has open, if it's theirs: "note this email" means this one.
async function openEmailLine(messageId, ctx) {
  if (!messageId) return '';
  const { data: m, error } = await supabase
    .from('messages')
    .select('id, account_id, subject, sender, received_at')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  if (!m || !ctx.accountIds.includes(m.account_id)) return '';
  ctx.seen.add(m.id);
  return `The user has this email open: [#${m.id}] ${m.received_at?.slice(0, 10) || ''} | From: ${m.sender} | Subject: ${m.subject || '(no subject)'}\n\n`;
}

const DRAFT_MODES = {
  new: 'a new email',
  reply: 'a reply to the email above',
  forward: 'forwarding the email above',
};

// The email being written, as shown to Claude with the question.
function draftBlock(draft) {
  return `The user is writing ${DRAFT_MODES[draft.mode]} from ${draft.from || 'one of their accounts'}.\n` +
    `To: ${draft.to || '(nobody yet)'}\n` +
    (draft.cc ? `Cc: ${draft.cc}\n` : '') +
    `Subject: ${draft.subject || '(none yet)'}\n` +
    `Their draft so far:\n"""\n${draft.body.trim() || '(empty)'}\n"""\n\n`;
}

// history: earlier exchanges in this chat, [{ question, answer }], oldest first.
// ownAddresses: the user's connected email addresses, to spot emails they sent.
// openMessageId: the email open in the app, if any. timeZone: the user's, for reminders.
// draft: the email being written, when asked from the writing screen (see readDraft in routes/assistant.js).
// onEvent: called as the answer is worked out, so the app can show progress:
//   { type: 'step', text }   a search or lookup just finished (same text as in `steps`)
//   { type: 'text', delta }  the next piece of answer text
//   { type: 'text_reset' }   text streamed so far was a lead-in before a lookup, not the answer
// Returns { answer, sources, steps, createdNotes: [{ id, title }], draft: { body, subject } | null, usage }.
async function askAssistant({
  userId, accountIds, ownAddresses = [], question, history = [], openMessageId = null, timeZone, draft = null,
  onEvent = () => {},
}) {
  const timer = stopwatch();
  const recentHistory = history.slice(-MAX_HISTORY_TURNS);
  const ctx = {
    userId,
    accountIds,
    ownAddresses,
    timeZone: validTimeZone(timeZone),
    seen: new Set(),      // email ids found or opened: only these can be cited or linked
    seenNotes: new Set(), // likewise for notes
    notes: [],
    created: [],          // notes made by create_note this turn
    drafting: Boolean(draft),
    draft: null,          // set by write_draft
  };
  const steps = [];
  const addStep = text => {
    steps.push(text);
    onEvent({ type: 'step', text });
  };
  const usage = newUsage();

  // When replying or forwarding, "this email" is the one being answered.
  // While writing, requests are mostly instructions ("make it shorter"), not
  // searches, so there's no search up front; the tools are there if needed.
  // These three don't depend on each other, so they run at the same time.
  const answering = draft?.replyToMessageId || null;
  const [notes, initial, openEmailBase] = await Promise.all([
    listNotes(userId),
    ctx.drafting ? [] : hybridSearch(userId, accountIds, question, { limit: INITIAL_RESULTS, ownAddresses }),
    openEmailLine(answering || openMessageId, ctx),
  ]);
  ctx.notes = notes;
  timer.lap('search');

  await seedFromHistory(recentHistory, ctx);
  let openEmail = openEmailBase;
  // the email being answered comes with its text, so it needn't be looked up
  if (answering && openEmail) {
    const { content } = await runTool('read_email', { email_id: answering }, ctx);
    openEmail = `The email being answered:\n${content}\n\n`;
  }
  if (draft) openEmail += draftBlock(draft);

  initial.forEach(m => ctx.seen.add(m.id));
  const initialNotes = ctx.drafting ? [] : searchNotes(ctx.notes, questionKeywords(question)).slice(0, INITIAL_NOTES);
  initialNotes.forEach(note => ctx.seenNotes.add(note.id));
  if (!ctx.drafting) {
    addStep(`Searched for your question: ${initial.length} email${initial.length === 1 ? '' : 's'}` +
      (initialNotes.length ? `, ${initialNotes.length} note${initialNotes.length === 1 ? '' : 's'}` : ''));
  }

  const messages = [];
  for (const turn of recentHistory) {
    messages.push({ role: 'user', content: turn.question });
    messages.push({ role: 'assistant', content: turn.answer || '(no answer)' });
  }
  const emailResults = initial.length
    ? await formatResults(initial, ownAddresses, INITIAL_RESULTS_WITH_BODY)
    : '(no matching emails)';
  const noteResults = initialNotes.length ? `\n\nNotes that may be relevant:\n${formatNotes(initialNotes)}` : '';
  messages.push({
    role: 'user',
    content: ctx.drafting
      ? `${openEmail}Request: ${question}`
      : `${openEmail}Question: ${question}\n\nInitial search results:\n\n${emailResults}${noteResults}`,
  });
  timer.lap('setup');

  async function finish(text) {
    const fallback = ctx.draft
      ? 'Here is a draft. Press "Use this draft" to put it in your email.'
      : ctx.created.length ? 'Done.' : "I couldn't come up with an answer to that.";
    const { answer, sources } = await collectSources(text || fallback, ctx);
    timer.lap('sources');
    console.log(`Assistant timing: ${timer.summary()}`);
    return { answer, sources, steps, createdNotes: ctx.created, draft: ctx.draft, usage: usageReport(usage) };
  }

  let toolCalls = 0;
  let aiCalls = 0;
  for (;;) {
    // Streamed, so the answer shows as it's written. Automatic caching marks
    // the end of the conversation so far; each later round of this question
    // (and a follow-up within 5 minutes) re-reads that part from cache, which
    // is faster and cheaper. Below Haiku's 4096-token minimum it just doesn't cache.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      cache_control: { type: 'ephemeral' },
      system: systemPrompt(ctx.timeZone, ctx.drafting),
      tools: ctx.drafting ? [...TOOLS, WRITE_DRAFT_TOOL] : TOOLS,
      // once the limit is hit, the next reply has to be the answer
      ...(toolCalls >= MAX_TOOL_CALLS && { tool_choice: { type: 'none' } }),
      messages,
    });
    stream.on('text', delta => onEvent({ type: 'text', delta }));
    const response = await stream.finalMessage();
    timer.lap(`AI #${++aiCalls}`);
    addUsage(usage, response);

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const toolUses = response.content.filter(block => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) return finish(text);

    // any text so far was a lead-in ("Let me look..."), not the answer
    if (text) onEvent({ type: 'text_reset' });
    messages.push({ role: 'assistant', content: response.content });

    // every tool_use needs a tool_result, all in one message
    const results = [];
    for (const toolUse of toolUses) {
      if (toolCalls >= MAX_TOOL_CALLS) {
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Tool limit reached.', is_error: true });
        continue;
      }
      toolCalls++;
      try {
        const { content, step, isError } = await runTool(toolUse.name, toolUse.input, ctx);
        timer.lap(toolUse.name);
        if (step) addStep(step);
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content, ...(isError && { is_error: true }) });
      } catch (err) {
        console.error(`Assistant tool ${toolUse.name} failed:`, err);
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'That lookup failed.', is_error: true });
      }
    }

    // Once a draft is written the job is done: another AI call would only
    // say "I drafted it", and the draft card already says that.
    if (ctx.draft) return finish(text);

    if (toolCalls >= MAX_TOOL_CALLS) {
      results.push({ type: 'text', text: 'That was the last tool call. Answer now with what you found.' });
    }
    messages.push({ role: 'user', content: results });
  }
}

module.exports = { askAssistant };
