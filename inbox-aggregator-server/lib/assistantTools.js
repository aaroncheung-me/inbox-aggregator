const supabase = require('./supabase');
const { keywordSearch, semanticSearch, emailKind } = require('./search');
const { readAttachment } = require('./attachments');
const { firstLine } = require('./notes');
const { NOTE_FIELDS, SEARCH_NOTES_TOOL, parseId, runNoteSearch, saveAiNote } = require('./noteWriting');

// The tools Claude can use to look through the user's email and notes, shared
// by the assistant (lib/assistant.js) and AI save (lib/aiSave.js).

const EXCERPT_CHARS = 1500;
const READ_EMAIL_CHARS = 5000;
const TOOL_SEARCH_RESULTS = 10;

const TOOLS = [
  {
    name: 'search_emails',
    description:
      `Search the user's email. Returns up to ${TOOL_SEARCH_RESULTS} matches: id, date, sender, subject, a short preview, and attachment ` +
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

// The email search and read tools on their own, for AI save.
const SEARCH_EMAILS_TOOL = TOOLS.find(tool => tool.name === 'search_emails');
const READ_EMAIL_TOOL = TOOLS.find(tool => tool.name === 'read_email');

module.exports = { TOOLS, WRITE_DRAFT_TOOL, SEARCH_EMAILS_TOOL, READ_EMAIL_TOOL, runTool, formatResults };
