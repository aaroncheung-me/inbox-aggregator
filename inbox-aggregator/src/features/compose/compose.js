import { senderName } from '../../format';

// Drafts for the writing screen (new, reply, forward, a scheduled email taken
// back), their signatures and attachments, and address lists.

// Splits "Ann <a@x.com>, "Doe, John" <j@y.com>" at the commas between
// addresses, not the ones inside quotes or <...>.
function splitAddresses(text) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of text || '') {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '<' && !inQuotes) inAngle = true;
    else if (ch === '>' && !inQuotes) inAngle = false;

    if ((ch === ',' || ch === ';') && !inQuotes && !inAngle) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// '"Ann" <a@x.com>, b@y.com' -> 'To: Ann +1', for lists of sent mail
export function recipientsLabel(recipients) {
  const list = splitAddresses(recipients);
  if (!list.length) return 'To: (nobody)';
  return `To: ${senderName(list[0])}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
}

// 'Ann <A@x.com>' -> 'a@x.com'
function addressOf(entry) {
  const match = /<([^>]+)>/.exec(entry);
  return (match ? match[1] : entry).trim().toLowerCase();
}

// Entries from all the lists, minus the user's own addresses and repeats.
function mergeAddresses(lists, ownAddresses) {
  const seen = new Set(ownAddresses);
  const merged = [];
  for (const entry of lists.flatMap(splitAddresses)) {
    const address = addressOf(entry);
    if (seen.has(address)) continue;
    seen.add(address);
    merged.push(entry);
  }
  return merged.join(', ');
}

function withPrefix(subject, prefix, alreadyPrefixed) {
  const text = (subject || '').trim();
  return alreadyPrefixed.test(text) ? text : `${prefix} ${text}`.trim();
}

function formatWhen(isoString) {
  return isoString
    ? new Date(isoString).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'an unknown date';
}

// Only the start of long emails is stored, so a quote may be cut short.
const STORED_BODY_CHARS = 5000;

function originalText(message) {
  const text = (message.body || message.snippet || '').trimEnd();
  return text.length >= STORED_BODY_CHARS ? `${text}\n[...]` : text;
}

export const DRAFT_TITLES = { new: 'New email', reply: 'Reply', forward: 'Forward' };

// ---------- signatures ----------
// A signature sits under the text, after the usual "-- " line mail apps
// recognize. The draft remembers the block it added (draft.signature), so it
// can tell whether the user has changed it.
const SIGNATURE_LINE = '\n\n-- \n';

// The block for an account's signature, or '' when it has none.
function signatureBlock(signature) {
  const text = (signature || '').trim();
  return text ? `${SIGNATURE_LINE}${text}` : '';
}

// Whether the body still ends with the signature exactly as it was added.
function signatureUntouched(draft) {
  return Boolean(draft.signature) && draft.body.endsWith(draft.signature);
}

// The body without an untouched signature: what the user has written.
function writtenText(draft) {
  return signatureUntouched(draft) ? draft.body.slice(0, -draft.signature.length) : draft.body;
}

// Moves the draft to another sending account. Its signature is swapped for
// that account's, unless the user changed it (then it's left as they made it).
export function withAccount(draft, accountId, signature) {
  if (draft.signature && !signatureUntouched(draft)) return { ...draft, accountId };
  const next = signatureBlock(signature);
  return { ...draft, accountId, body: writtenText(draft) + next, signature: next };
}

// An AI-written body with the draft's signature under it, unless the AI
// already included it.
export function withSignature(body, draft) {
  if (!draft.signature || body.includes(draft.signature.slice(SIGNATURE_LINE.length))) return body;
  return body.trimEnd() + draft.signature;
}

// A blank writing screen. accountId: the account it's sent from, and signature
// that account's signature (text), added under where the user writes.
export function newDraft(accountId, signature = '') {
  const block = signatureBlock(signature);
  return {
    mode: 'new',
    accountId,
    to: '',
    cc: '',
    bcc: '',
    showCcBcc: false,
    subject: '',
    body: block,
    signature: block, // the signature block as added, see signatureUntouched
    quoted: '', // the original, added under the body when sending
    originalMessageId: null, // the email being replied to or forwarded
    aiPrevious: null, // what the body/subject were before an AI draft was used, for Undo
    // [{ key, name, size, type, file }] for files picked on this device,
    // [{ key, name, size, attachmentId }] for a forwarded original's, or
    // [{ key, name, size, type, uploadId }] for files already uploaded (a
    // scheduled email taken back for Edit)
    attachments: [],
    error: null,
  };
}

// kind: 'reply' | 'replyAll' | 'forward'. message: the full email (from getMessage).
// ownAddresses: every connected address, left out of reply-all.
// replyTo: the Reply-To address, when the sender set one (fetched separately).
// signature: the signature of the account that received it, which the reply is sent from.
export function draftFromMessage(kind, message, ownAddresses, replyTo = null, signature = '') {
  const draft = { ...newDraft(message.account_id, signature), originalMessageId: message.id };

  if (kind === 'forward') {
    return {
      ...draft,
      mode: 'forward',
      // the original's attachments come along, and can be removed like any other
      attachments: (message.attachments || []).map(a => ({
        key: `original-${a.id}`,
        name: a.filename || 'attachment',
        size: a.size_bytes,
        attachmentId: a.id,
      })),
      subject: withPrefix(message.subject, 'Fwd:', /^(fwd?|fw):/i),
      quoted: [
        '---------- Forwarded message ----------',
        `From: ${message.sender || ''}`,
        `Date: ${formatWhen(message.received_at)}`,
        `Subject: ${message.subject || ''}`,
        `To: ${message.to_recipients || ''}`,
        ...(message.cc_recipients ? [`Cc: ${message.cc_recipients}`] : []),
        '',
        originalText(message),
      ].join('\n'),
    };
  }

  // replying to an email the user sent goes to the people it was sent to, like Gmail does
  const sentByUser = ownAddresses.includes(addressOf(message.sender || ''));
  const replyAddress = sentByUser ? message.to_recipients : (replyTo || message.sender);
  const to = kind === 'replyAll'
    ? mergeAddresses([replyAddress, message.to_recipients], ownAddresses)
    : mergeAddresses([replyAddress], ownAddresses);
  const cc = kind === 'replyAll' ? mergeAddresses([message.cc_recipients], [...ownAddresses, ...splitAddresses(to).map(addressOf)]) : '';

  return {
    ...draft,
    mode: 'reply',
    to,
    cc,
    showCcBcc: Boolean(cc),
    subject: withPrefix(message.subject, 'Re:', /^re:/i),
    quoted: `On ${formatWhen(message.received_at)}, ${message.sender || 'someone'} wrote:\n` +
      originalText(message).split('\n').map(line => (line ? `> ${line}` : '>')).join('\n'),
  };
}

// The text that is actually sent: what was written, then the quoted original.
export function fullBody(draft) {
  if (!draft.quoted) return draft.body;
  return `${draft.body.trimEnd()}\n\n${draft.quoted}`;
}

// Everything attached to one email can add up to this much (Gmail's limit).
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export function attachmentsSize(draft) {
  return draft.attachments.reduce((sum, a) => sum + (a.size || 0), 0);
}

// Files it picks up, for the attachments list (key: unique within the draft).
export function attachmentsFromFiles(files) {
  return [...files].map(file => ({ key: crypto.randomUUID(), name: file.name, size: file.size, type: file.type, file }));
}

// A scheduled email taken back for Edit (see GET /scheduled), as a draft. Its
// body already holds any quoted original and signature; its uploaded files
// come back as chips that point at the upload instead of a file.
export function draftFromScheduled(email) {
  return {
    ...newDraft(email.accountId),
    mode: email.replyToMessageId ? 'reply' : 'new',
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    showCcBcc: Boolean(email.cc || email.bcc),
    subject: email.subject,
    body: email.body,
    originalMessageId: email.replyToMessageId,
    attachments: [
      ...email.attachments.map(a => ({ key: a.uploadId, name: a.filename, size: a.size, type: a.mimeType, uploadId: a.uploadId })),
      ...email.forwarded.map(a => ({ key: `original-${a.attachmentId}`, name: a.filename, size: a.size, attachmentId: a.attachmentId })),
    ],
  };
}

// An untouched signature on its own doesn't count as something written; a
// file attached here does (a forward's own attachments don't).
export function draftHasContent(draft) {
  return Boolean(writtenText(draft).trim() || draft.attachments.some(a => a.file || a.uploadId) || (draft.mode === 'new' && (draft.subject.trim() || draft.to.trim())));
}
