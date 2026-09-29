const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');
const { hybridSearch, keywordSearch, semanticSearch, emailKind, questionKeywords } = require('./search');
const { readAttachment } = require('./attachments');
const { listNotes } = require('./notes');
const { validTimeZone, describeNow } = require('./time');
const {
  NOTE_WRITING_RULES,
  NOTE_FIELDS,
  SEARCH_NOTES_TOOL,
  parseId,
  firstLine,
  searchNotes,
  formatNotes,
  runNoteSearch,
  saveAiNote,
} = require('./noteWriting');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Which Claude model answers questions. Change ASSISTANT_MODEL in .env to switch.
const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
// $ per million tokens [input, output], for the cost shown under each answer
const PRICES = {
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5': [2, 10],
  'claude-opus-5': [5, 25],
};

const MAX_TOOL_CALLS = 8;
const INITIAL_RESULTS = 8;
const INITIAL_NOTES = 3; // notes matching the question's words, included up front
const INITIAL_RESULTS_WITH_BODY = 3; // the top few include body text, so easy questions need no tool calls
const EXCERPT_CHARS = 1500;
const READ_EMAIL_CHARS = 5000;
const TOOL_SEARCH_RESULTS = 10;
const MAX_HISTORY_TURNS = 6;

const TOOLS = [
  {
    name: 'search_emails',
    description:
      "Search the user's email. Returns up to 10 matches: id, date, sender, subject, a short preview, and attachment " +
      'names with their ids. mode "meaning" finds emails about a topic even when they use different words. ' +
      'mode "keywords" finds exact names, words, numbers or phrases. Try different wording, likely senders and ' +
      'related businesses before concluding something isn\'t there.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to look for. In keywords mode every word must appear; use "quotes" for a phrase and "or" between ' +
            'alternatives. May be empty when only filtering by sender or date.',
        },
        mode: { type: 'string', enum: ['meaning', 'keywords'] },
        from: { type: 'string', description: "Only emails whose sender contains this (name, address or domain)." },
        after: { type: 'string', description: 'Only emails on or after this date, YYYY-MM-DD.' },
        before: { type: 'string', description: 'Only emails before this date, YYYY-MM-DD.' },
        has_attachments: { type: 'boolean', description: 'Only emails with attachments.' },
      },
      required: ['query', 'mode'],
    },
  },
  {
    name: 'read_email',
    description: 'Read the full text of one email, with its attachment names and ids.',
    input_schema: {
      type: 'object',
      properties: { email_id: { type: 'integer' } },
      required: ['email_id'],
    },
  },
  {
    name: 'read_attachment',
    description:
      'Read one attachment (PDF, image or text file). Use it when the answer is probably inside a document, ' +
      'like a prescription, receipt, invoice, ticket, statement or form.',
    input_schema: {
      type: 'object',
      properties: { attachment_id: { type: 'integer' } },
      required: ['attachment_id'],
    },
  },
  SEARCH_NOTES_TOOL,
  {
    name: 'create_note',
    description:
      'Create a note for the user. Only when they ask you to note, save, write down, remember or remind them of ' +
      'something. Call once per note.',
    input_schema: {
      type: 'object',
      properties: NOTE_FIELDS,
      required: ['text', 'remind_at', 'pin', 'email_ids', 'note_ids'],
    },
  },
];

// Only offered while the user is writing an email.
const WRITE_DRAFT_TOOL = {
  name: 'write_draft',
  description:
    'Write or rewrite the email the user is writing. Only when they ask you to draft, write, rewrite, shorten or ' +
    'otherwise change it. They see it with a button to use it, which replaces their draft, so give the whole ' +
    'email from greeting to sign-off, but not the quoted original.',
  input_schema: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'The complete email text, plain text.' },
      subject: {
        type: 'string',
        description: 'A new subject, only when they asked for one or the draft has none. Empty to keep theirs.',
      },
    },
    required: ['body'],
  },
};

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

// ---------- formatting results for Claude ----------

async function attachmentsFor(messageIds) {
  if (!messageIds.length) return new Map();
  const { data, error } = await supabase
    .from('attachments')
    .select('id, message_id, filename')
    .in('message_id', messageIds);
  if (error) throw error;

  const byMessage = new Map();
  for (const a of data) {
    if (!byMessage.has(a.message_id)) byMessage.set(a.message_id, []);
    byMessage.get(a.message_id).push(a);
  }
  return byMessage;
}

function formatAttachments(list) {
  return list?.length
    ? `\nAttachments: ${list.map(a => `${a.filename || 'unnamed'} [attachment ${a.id}]`).join(', ')}`
    : '';
}

const KIND_TAGS = {
  yours: ' (sent by you)',
  reply: ' (reply in a conversation)',
  transactional: ' (support/order/account email)',
  marketing: ' (marketing)',
};

// One block per email. The first `withBody` emails include the start of their body.
async function formatResults(messages, ownAddresses, withBody = 0) {
  const attachments = await attachmentsFor(messages.map(m => m.id));
  return messages.map((m, i) => {
    const date = m.received_at ? m.received_at.slice(0, 10) : 'unknown date';
    const text = i < withBody
      ? (m.body || m.snippet || '').slice(0, EXCERPT_CHARS)
      : (m.snippet || '').slice(0, 200);
    const tag = KIND_TAGS[emailKind(m, ownAddresses)] || '';
    return `[#${m.id}]${tag} ${date} | From: ${m.sender || 'unknown'} | Subject: ${m.subject || '(no subject)'}` +
      formatAttachments(attachments.get(m.id)) +
      `\n${text}`;
  }).join('\n\n');
}

// ---------- tools ----------

function describeSearch({ query, mode, from, after, before, has_attachments: hasAttachments }) {
  const parts = [query ? `${mode === 'keywords' ? 'keywords' : 'about'} "${query}"` : 'all emails'];
  if (from) parts.push(`from "${from}"`);
  if (after) parts.push(`after ${after}`);
  if (before) parts.push(`before ${before}`);
  if (hasAttachments) parts.push('with attachments');
  return `Searched ${parts.join(', ')}`;
}

// Runs one tool call. Returns { content, step } where content goes back to
// Claude and step is the line shown to the user.
async function runTool(name, input, ctx) {
  if (name === 'search_emails') {
    const filters = { sender: input.from, after: input.after, before: input.before, hasAttachments: input.has_attachments };
    const query = (input.query || '').trim();
    const results = query && input.mode === 'meaning'
      ? await semanticSearch(ctx.userId, ctx.accountIds, query, { filters, limit: TOOL_SEARCH_RESULTS })
      : await keywordSearch(ctx.userId, ctx.accountIds, query, { filters, limit: TOOL_SEARCH_RESULTS });
    results.forEach(m => ctx.seen.add(m.id));
    return {
      content: results.length ? await formatResults(results, ctx.ownAddresses) : 'No matching emails.',
      step: `${describeSearch(input)}: ${results.length} result${results.length === 1 ? '' : 's'}`,
    };
  }

  if (name === 'read_email') {
    const emailId = parseId(input.email_id);
    if (Number.isNaN(emailId)) return { content: 'No email with that id.', step: null, isError: true };
    const { data: m, error } = await supabase
      .from('messages')
      .select('id, account_id, sender, to_recipients, cc_recipients, subject, body, snippet, received_at')
      .eq('id', emailId)
      .maybeSingle();
    if (error) throw error;
    if (!m || !ctx.accountIds.includes(m.account_id)) return { content: 'No email with that id.', step: null, isError: true };

    ctx.seen.add(m.id);
    const attachments = (await attachmentsFor([m.id])).get(m.id);
    return {
      content: `[#${m.id}] ${m.received_at?.slice(0, 10) || 'unknown date'}\nFrom: ${m.sender}\nTo: ${m.to_recipients || ''}` +
        (m.cc_recipients ? `\nCc: ${m.cc_recipients}` : '') +
        `\nSubject: ${m.subject || '(no subject)'}` +
        formatAttachments(attachments) +
        `\n\n${(m.body || m.snippet || '').slice(0, READ_EMAIL_CHARS)}`,
      step: `Opened "${m.subject || '(no subject)'}"`,
    };
  }

  if (name === 'read_attachment') {
    const attachmentId = parseId(input.attachment_id);
    const file = Number.isNaN(attachmentId) ? null : await readAttachment(ctx.userId, attachmentId);
    if (!file) return { content: 'No attachment with that id.', step: null, isError: true };

    const label = `Attachment "${file.filename || 'unnamed'}"`;
    const step = `Read attachment "${file.filename || 'unnamed'}"`;
    switch (file.kind) {
      case 'text':
        return { content: `${label}:\n\n${file.text}`, step };
      case 'pdf':
        return {
          content: [
            { type: 'text', text: `${label} (scanned PDF):` },
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } },
          ],
          step,
        };
      case 'image':
        return {
          content: [
            { type: 'text', text: `${label}:` },
            { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } },
          ],
          step,
        };
      default:
        return { content: `${label} can't be read: ${file.reason}.`, step: `Couldn't read "${file.filename}"`, isError: true };
    }
  }

  if (name === 'search_notes') {
    const content = runNoteSearch(ctx.notes, input.query, ctx.seenNotes);
    const count = content === 'No matching notes.' ? 0 : content.split('\n').length;
    return { content, step: `Searched your notes for "${input.query}": ${count} result${count === 1 ? '' : 's'}` };
  }

  if (name === 'write_draft') {
    if (!ctx.drafting) return { content: 'There is no email being written.', step: null, isError: true };
    if (!input.body?.trim()) return { content: 'The draft needs some text.', step: null, isError: true };
    ctx.draft = { body: input.body.trim(), subject: input.subject?.trim() || null };
    return {
      content: "Draft ready. The user sees it with a button to use it; don't repeat it in your answer.",
      step: 'Wrote a draft',
    };
  }

  if (name === 'create_note') {
    if (!input.text?.trim()) return { content: 'The note needs some text.', step: null, isError: true };
    const { id, messages } = await saveAiNote({
      userId: ctx.userId,
      decision: input,
      fallbackText: input.text,
      timeZone: ctx.timeZone,
      seenEmailIds: ctx.seen,
      seenNoteIds: ctx.seenNotes,
    });
    const title = firstLine(input.text);
    ctx.created.push({ id, title });
    return {
      content: `Created note ${id}: "${title}".${messages.length ? ` ${messages.join(' ')}` : ''}`,
      step: `Created note "${title}"`,
    };
  }

  return { content: `Unknown tool ${name}.`, step: null, isError: true };
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
// draft: the email being written, when asked from the writing screen (see readDraft in index.js).
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
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

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
    const [inputPrice, outputPrice] = PRICES[MODEL] || [];
    return {
      answer,
      sources,
      steps,
      createdNotes: ctx.created,
      draft: ctx.draft,
      usage: {
        model: MODEL,
        ...usage,
        // cache writes cost 1.25x the input price, cache reads 0.1x
        costUsd: inputPrice == null ? null : (
          (usage.inputTokens + usage.cacheWriteTokens * 1.25 + usage.cacheReadTokens * 0.1) * inputPrice +
          usage.outputTokens * outputPrice
        ) / 1e6,
      },
    };
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
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.cacheWriteTokens += response.usage.cache_creation_input_tokens || 0;
    usage.cacheReadTokens += response.usage.cache_read_input_tokens || 0;

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

// The email search and read tools are shared with AI save (lib/aiSave.js).
const SEARCH_EMAILS_TOOL = TOOLS.find(tool => tool.name === 'search_emails');
const READ_EMAIL_TOOL = TOOLS.find(tool => tool.name === 'read_email');

module.exports = { askAssistant, SEARCH_EMAILS_TOOL, READ_EMAIL_TOOL, runTool, MODEL, PRICES };
