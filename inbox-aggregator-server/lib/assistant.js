const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');
const { hybridSearch, keywordSearch, semanticSearch, emailKind } = require('./search');
const { readAttachment } = require('./attachments');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Which Claude model answers questions. Change ASSISTANT_MODEL in .env to switch.
const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
// $ per million tokens [input, output], for the cost shown under each answer
const PRICES = {
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5': [2, 10],
  'claude-opus-5': [5, 25],
};

const MAX_TOOL_CALLS = 6;
const INITIAL_RESULTS = 8;
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
];

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You help the user find information in their own email. Today is ${today}.

Each question comes with initial search results. If they answer it, answer right away without using tools. Otherwise use the tools: search again with different wording, likely senders or related businesses, open promising emails, and read attachments when the answer is probably inside a document. You can make at most ${MAX_TOOL_CALLS} tool calls.

Think about where the information would realistically be. For example, a glasses prescription might come from an optometrist, an eye clinic or an eyewear store, often as a PDF attachment, and never mention "glasses" in the subject.

Questions about the user's own things ("my headphones", "my order", "my appointment") are usually answered by their personal dealings: orders, receipts, support threads, appointments, and emails they sent or replied to. Results are tagged when they look like one of these, or like marketing. Marketing rarely answers such questions, so if the results are mostly marketing, search again (for example for the company's support or order emails, or the user's own messages) before answering. Search before asking the user to clarify anything.

When you answer:
- Be brief and direct.
- Cite each email your answer relies on with its id in brackets, like [#123], right after the fact it supports.
- Only state what the emails actually show. If you can't find it, say so and briefly say what you searched for.`;
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
    const { data: m, error } = await supabase
      .from('messages')
      .select('id, account_id, sender, to_recipients, cc_recipients, subject, body, snippet, received_at')
      .eq('id', input.email_id)
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
    const file = await readAttachment(ctx.userId, input.attachment_id);
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

  return { content: `Unknown tool ${name}.`, step: null, isError: true };
}

// ---------- the answer loop ----------

// Keeps only citations of emails Claude actually saw (so it can't point at
// made-up ids), and returns them in order of first mention.
async function collectSources(answer, seen, accountIds) {
  const cited = [];
  const cleaned = answer.replace(/\[#(\d+)\]/g, (marker, id) => {
    const messageId = Number(id);
    if (!seen.has(messageId)) return '';
    if (!cited.includes(messageId)) cited.push(messageId);
    return marker;
  });
  if (!cited.length) return { answer: cleaned, sources: [] };

  const { data, error } = await supabase
    .from('messages')
    .select('id, account_id, subject, sender, received_at, snippet')
    .in('id', cited)
    .in('account_id', accountIds);
  if (error) throw error;

  const byId = new Map(data.map(m => [m.id, m]));
  const sources = cited.filter(id => byId.has(id)).map(id => {
    const m = byId.get(id);
    return {
      id: m.id,
      accountId: m.account_id,
      subject: m.subject,
      sender: m.sender,
      received_at: m.received_at,
      preview: (m.snippet || '').slice(0, 150),
    };
  });
  return { answer: cleaned, sources };
}

// history: earlier exchanges in this chat, [{ question, answer }], oldest first.
// ownAddresses: the user's connected email addresses, to spot emails they sent.
async function askAssistant({ userId, accountIds, ownAddresses = [], question, history = [] }) {
  const ctx = { userId, accountIds, ownAddresses, seen: new Set() };
  const steps = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  const initial = await hybridSearch(userId, accountIds, question, { limit: INITIAL_RESULTS, ownAddresses });
  initial.forEach(m => ctx.seen.add(m.id));
  steps.push(`Searched for your question: ${initial.length} result${initial.length === 1 ? '' : 's'}`);

  const messages = [];
  for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
    messages.push({ role: 'user', content: turn.question });
    messages.push({ role: 'assistant', content: turn.answer || '(no answer)' });
  }
  messages.push({
    role: 'user',
    content: `Question: ${question}\n\nInitial search results:\n\n${
      initial.length ? await formatResults(initial, ownAddresses, INITIAL_RESULTS_WITH_BODY) : '(no matches)'
    }`,
  });

  let toolCalls = 0;
  for (;;) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt(),
      tools: TOOLS,
      // once the limit is hit, the next reply has to be the answer
      ...(toolCalls >= MAX_TOOL_CALLS && { tool_choice: { type: 'none' } }),
      messages,
    });
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    const toolUses = response.content.filter(block => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const { answer, sources } = await collectSources(text || "I couldn't come up with an answer to that.", ctx.seen, accountIds);
      const [inputPrice, outputPrice] = PRICES[MODEL] || [];
      return {
        answer,
        sources,
        steps,
        usage: {
          model: MODEL,
          ...usage,
          costUsd: inputPrice == null ? null : (usage.inputTokens * inputPrice + usage.outputTokens * outputPrice) / 1e6,
        },
      };
    }

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
        if (step) steps.push(step);
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content, ...(isError && { is_error: true }) });
      } catch (err) {
        console.error(`Assistant tool ${toolUse.name} failed:`, err);
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'That lookup failed.', is_error: true });
      }
    }
    if (toolCalls >= MAX_TOOL_CALLS) {
      results.push({ type: 'text', text: 'That was the last tool call. Answer now with what you found.' });
    }
    messages.push({ role: 'user', content: results });
  }
}

module.exports = { askAssistant };
