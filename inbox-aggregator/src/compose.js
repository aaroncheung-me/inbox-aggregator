// Building replies and forwards, and handling address lists, for the writing screen.

// Splits "Ann <a@x.com>, "Doe, John" <j@y.com>" at the commas between
// addresses, not the ones inside quotes or <...>.
export function splitAddresses(text) {
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

// A blank writing screen. accountId: the account it's sent from.
export function newDraft(accountId) {
  return {
    mode: 'new',
    accountId,
    to: '',
    cc: '',
    bcc: '',
    showCcBcc: false,
    subject: '',
    body: '',
    quoted: '', // the original, added under the body when sending
    originalMessageId: null, // the email being replied to or forwarded
    aiPrevious: null, // what the body/subject were before an AI draft was used, for Undo
    attachmentsLeftOut: 0, // forwarding doesn't carry attachments yet
    error: null,
  };
}

// kind: 'reply' | 'replyAll' | 'forward'. message: the full email (from getMessage).
// ownAddresses: every connected address, left out of reply-all.
// replyTo: the Reply-To address, when the sender set one (fetched separately).
export function draftFromMessage(kind, message, ownAddresses, replyTo = null) {
  const draft = { ...newDraft(message.account_id), originalMessageId: message.id };

  if (kind === 'forward') {
    return {
      ...draft,
      mode: 'forward',
      attachmentsLeftOut: message.attachments?.length || 0,
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

export function draftHasContent(draft) {
  return Boolean(draft.body.trim() || (draft.mode === 'new' && (draft.subject.trim() || draft.to.trim())));
}
