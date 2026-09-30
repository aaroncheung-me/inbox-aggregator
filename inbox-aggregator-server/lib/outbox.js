const crypto = require('crypto');
const addressparser = require('nodemailer/lib/addressparser');
const supabase = require('./supabase');
const { getAccount, getCredentials, listAccounts } = require('./accounts');
const { syncAccount } = require('./sync');
const { UserError } = require('./errors');
const { connectorFor } = require('../connectors');
const { downloadAttachmentFile } = require('./attachments');
const { MAX_TOTAL_BYTES, isUsersUpload, loadUpload, removeUploads } = require('./outboxFiles');

// Sending waits this long, so Undo can take it back.
const UNDO_SECONDS = 15;
// Send later: from a minute to a year ahead
const MIN_SCHEDULE_MS = 60 * 1000;
const MAX_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;
// emails due within this get a timer; the cron (every 10 minutes) arms the rest in time
const TIMER_AHEAD_MS = 15 * 60 * 1000;
// mail still marked 'sending' after this long was cut off by a server restart
const STUCK_SENDING_MS = 5 * 60 * 1000;
const MAX_RECIPIENTS = 50;
const MAX_SUBJECT_CHARS = 500;
const MAX_BODY_CHARS = 100000;
const MAX_REFERENCES = 20; // the newest ones are enough for mail programs to thread
const MAX_ATTACHMENTS = 20;
const TOO_BIG = 'Attachments can add up to 25 MB per email';

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// outbox id -> the timer that sends it
const timers = new Map();

// "Ann <ann@x.com>, bob@y.com" -> [{ name, address }]. Throws a UserError
// naming the first entry that isn't a valid address.
function parseRecipients(text, field) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const list = addressparser(text, { flatten: true });
  for (const entry of list) {
    if (!EMAIL_ADDRESS.test(entry.address || '')) {
      throw new UserError(`"${entry.address || entry.name}" in ${field} isn't a valid email address`);
    }
  }
  return list.map(({ name, address }) => ({ name: name || '', address }));
}

// The message being replied to, if it belongs to one of the user's accounts.
async function ownedMessage(userId, messageId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, account_id, external_id, thread_id')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const accountIds = (await listAccounts(userId)).map(a => a.id);
  return accountIds.includes(data.account_id) ? data : null;
}

// A file name that's safe in an email: no folders or control characters.
function cleanFilename(name) {
  const cleaned = String(name || '').replace(/[\\/\x00-\x1f]/g, '_').trim().slice(0, 255);
  return cleaned || 'attachment';
}

// input.attachments: [{ uploadId, filename, mimeType, size }], files uploaded
// for this email (see lib/outboxFiles.js). input.forwardedAttachmentIds: the
// original's attachments a forward keeps, fetched from the mailbox when it's sent.
// Returns { attachments, forwarded } to store, after checking they're the
// user's and fit in 25 MB (sizes are checked again when sending).
async function readAttachments(userId, input) {
  const uploads = Array.isArray(input.attachments) ? input.attachments : [];
  const forwardedIds = Array.isArray(input.forwardedAttachmentIds) ? input.forwardedAttachmentIds.map(Number).filter(Boolean) : [];
  if (uploads.length + forwardedIds.length > MAX_ATTACHMENTS) throw new UserError(`At most ${MAX_ATTACHMENTS} attachments per email`);

  const attachments = uploads.map(upload => {
    if (!isUsersUpload(userId, upload?.uploadId)) throw new UserError('An attachment was not uploaded, remove it and attach it again');
    return {
      uploadId: upload.uploadId,
      filename: cleanFilename(upload.filename),
      mimeType: typeof upload.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(upload.mimeType) ? upload.mimeType : 'application/octet-stream',
      size: Number(upload.size) || 0,
    };
  });

  let forwarded = [];
  if (forwardedIds.length) {
    const accountIds = (await listAccounts(userId)).map(a => a.id);
    const { data, error } = await supabase
      .from('attachments')
      .select('id, size_bytes, messages!inner(account_id)')
      .in('id', forwardedIds);
    if (error) throw error;
    forwarded = data.filter(a => accountIds.includes(a.messages.account_id));
    if (forwarded.length !== forwardedIds.length) throw new UserError("One of the original's attachments couldn't be found");
  }

  const total = attachments.reduce((sum, a) => sum + a.size, 0) + forwarded.reduce((sum, a) => sum + (a.size_bytes || 0), 0);
  if (total > MAX_TOTAL_BYTES) throw new UserError(TOO_BIG);
  return { attachments, forwarded: forwarded.map(a => a.id) };
}

function uploadIdsOf(email) {
  return (email?.attachments || []).map(a => a.uploadId);
}

// When a scheduled email (Send later) goes: at least a minute ahead, at most a year.
function readSendAt(value) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) throw new UserError('Choose a valid time to send it');
  if (when.getTime() < Date.now() + MIN_SCHEDULE_MS) throw new UserError('Choose a time at least a minute from now');
  if (when.getTime() > Date.now() + MAX_SCHEDULE_MS) throw new UserError('Emails can be scheduled up to a year ahead');
  return when;
}

// Body: { accountId, to, cc, bcc, subject, body, replyToMessageId?, attachments?,
// forwardedAttachmentIds?, sendAt? }. Checks it, stores it, and sends it
// UNDO_SECONDS from now, or at sendAt (Send later). Returns { id, sendAt, scheduled }.
async function queueEmail(userId, input) {
  const account = await getAccount(userId, Number(input.accountId) || 0);
  if (!account) throw new UserError('Choose which account to send from');

  const to = parseRecipients(input.to, 'To');
  const cc = parseRecipients(input.cc, 'Cc');
  const bcc = parseRecipients(input.bcc, 'Bcc');
  const recipientCount = to.length + cc.length + bcc.length;
  if (!recipientCount) throw new UserError('Add at least one recipient');
  if (recipientCount > MAX_RECIPIENTS) throw new UserError(`At most ${MAX_RECIPIENTS} recipients per email`);

  const subject = typeof input.subject === 'string' ? input.subject.trim().slice(0, MAX_SUBJECT_CHARS) : '';
  const body = typeof input.body === 'string' ? input.body : '';
  if (body.length > MAX_BODY_CHARS) throw new UserError('That email is too long to send');
  const { attachments, forwarded } = await readAttachments(userId, input);
  if (!subject && !body.trim() && !attachments.length && !forwarded.length) throw new UserError('The email is empty');

  let replyToMessageId = null;
  if (input.replyToMessageId != null) {
    const original = await ownedMessage(userId, Number(input.replyToMessageId) || 0);
    if (!original) throw new UserError("The email you're replying to couldn't be found");
    replyToMessageId = original.id;
  }

  const scheduled = input.sendAt != null;
  const sendAt = (scheduled ? readSendAt(input.sendAt) : new Date(Date.now() + UNDO_SECONDS * 1000)).toISOString();
  const { data, error } = await supabase
    .from('outbox')
    .insert({
      user_id: userId,
      account_id: account.id,
      send_at: sendAt,
      email: { to, cc, bcc, subject, body, replyToMessageId, attachments, forwarded, scheduled },
    })
    .select('id')
    .single();
  if (error) throw error;

  schedule(data.id, sendAt);
  return { id: data.id, sendAt, scheduled };
}

// Undo, or Cancel on a scheduled email: takes it back if it hasn't started
// sending (or has failed). Returns false when it's too late, else the email as listScheduled
// shapes it. keepFiles (Edit on a scheduled email): its uploaded files stay,
// so sending it again reuses them; otherwise they're deleted (after an Undo
// the app still has the files themselves).
async function cancelEmail(userId, outboxId, { keepFiles = false } = {}) {
  const { data, error } = await supabase
    .from('outbox')
    .delete()
    .eq('id', outboxId)
    .eq('user_id', userId)
    .in('status', ['waiting', 'failed'])
    .select('id, account_id, status, error, send_at, email');
  if (error) throw error;
  if (!data.length) return false;

  clearTimeout(timers.get(Number(outboxId)));
  timers.delete(Number(outboxId));
  if (!keepFiles) await removeUploads(uploadIdsOf(data[0].email));
  return (await shapeScheduled(data))[0];
}

// "Ann <a@x.com>, b@y.com" from the stored [{ name, address }]
function addressList(list) {
  return (list || []).map(({ name, address }) => (name ? `"${name.replace(/"/g, '')}" <${address}>` : address)).join(', ');
}

// Outbox rows as the app shows a scheduled email: { id, accountId, sendAt, failed, to,
// cc, bcc, subject, body, replyToMessageId, attachments: [{ uploadId, filename,
// mimeType, size }], forwarded: [{ attachmentId, filename, size }] }.
async function shapeScheduled(rows) {
  const forwardedIds = rows.flatMap(r => r.email?.forwarded || []);
  let names = new Map();
  if (forwardedIds.length) {
    const { data, error } = await supabase.from('attachments').select('id, filename, size_bytes').in('id', forwardedIds);
    if (error) throw error;
    names = new Map(data.map(a => [a.id, a]));
  }
  return rows.map(({ id, account_id, status, error, send_at, email }) => ({
    id,
    accountId: account_id,
    sendAt: send_at,
    failed: status === 'failed' ? (error || 'Sending failed') : null,
    to: addressList(email.to),
    cc: addressList(email.cc),
    bcc: addressList(email.bcc),
    subject: email.subject,
    body: email.body,
    replyToMessageId: email.replyToMessageId,
    attachments: email.attachments || [],
    forwarded: (email.forwarded || []).map(attachmentId => ({
      attachmentId,
      filename: names.get(attachmentId)?.filename || 'attachment',
      size: names.get(attachmentId)?.size_bytes || 0,
    })),
  }));
}

// The user's scheduled emails still waiting to go, or that failed (with the
// reason in failed), soonest first.
async function listScheduled(userId) {
  const { data, error } = await supabase
    .from('outbox')
    .select('id, account_id, status, error, send_at, email')
    .eq('user_id', userId)
    .in('status', ['waiting', 'failed'])
    .eq('email->>scheduled', 'true')
    .order('send_at');
  if (error) throw error;
  return shapeScheduled(data);
}

// "Send now" on a scheduled email. Returns false if it's no longer waiting.
async function sendNow(userId, outboxId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('outbox')
    .update({ send_at: now })
    .eq('id', outboxId)
    .eq('user_id', userId)
    .eq('status', 'waiting')
    .select('id');
  if (error) throw error;
  if (!data.length) return false;

  clearTimeout(timers.get(Number(outboxId)));
  timers.delete(Number(outboxId));
  schedule(Number(outboxId), now);
  return true;
}

// { status: 'waiting' | 'sending' | 'sent' | 'failed', error }, or null if not found.
async function emailStatus(userId, outboxId) {
  const { data, error } = await supabase
    .from('outbox')
    .select('status, error')
    .eq('id', outboxId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Arms a timer for an email due soon. Ones due later (Send later) are left to
// sendDue, which the cron runs every 10 minutes: a timer weeks long would be
// lost on a restart anyway, and setTimeout can't count past about 24 days.
function schedule(outboxId, sendAt) {
  if (timers.has(outboxId)) return;
  const delay = Math.max(0, new Date(sendAt).getTime() - Date.now());
  if (delay > TIMER_AHEAD_MS) return;
  timers.set(outboxId, setTimeout(() => {
    timers.delete(outboxId);
    deliver(outboxId).catch(err => console.error(`Sending outbox email ${outboxId} failed:`, err));
  }, delay));
}

// The files to attach, in nodemailer's shape: the uploaded ones from storage,
// a forward's from the mailbox the original is in.
async function loadAttachments(userId, email) {
  const files = [];
  for (const a of email.attachments || []) {
    try {
      files.push({ filename: a.filename, contentType: a.mimeType, content: await loadUpload(a.uploadId) });
    } catch (err) {
      console.error(`Loading attachment ${a.uploadId} failed:`, err.message);
      throw new UserError(`The attachment "${a.filename}" couldn't be read. Nothing was sent; attach it again and resend.`);
    }
  }
  for (const attachmentId of email.forwarded || []) {
    const file = await downloadAttachmentFile(userId, attachmentId);
    if (!file) throw new UserError("One of the original's attachments couldn't be found. Nothing was sent.");
    files.push({ filename: file.filename || 'attachment', contentType: file.mimeType || undefined, content: file.buffer });
  }
  if (files.reduce((sum, f) => sum + f.content.length, 0) > MAX_TOTAL_BYTES) throw new UserError(`${TOO_BIG}. Nothing was sent.`);
  return files;
}

// The nodemailer message, plus Gmail's thread id when replying within the same Gmail account.
async function buildMail(account, email) {
  const domain = account.email_address.split('@')[1];
  const mail = {
    from: account.email_address,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    subject: email.subject,
    text: email.body,
    messageId: `<${crypto.randomUUID()}@${domain}>`,
    attachments: await loadAttachments(account.user_id, email),
  };
  if (!email.replyToMessageId) return { mail, threadId: null };

  const original = await ownedMessage(account.user_id, email.replyToMessageId);
  if (!original) return { mail, threadId: null };

  // The threading headers come from the account that received the original,
  // which may not be the one sending. Without them the reply still sends, it
  // just may not join the conversation in the recipient's mail program.
  try {
    const originalAccount = original.account_id === account.id ? account : await getAccount(account.user_id, original.account_id);
    const headers = await connectorFor(originalAccount.provider).getReplyHeaders({
      credentials: await getCredentials(originalAccount),
      messageExternalId: original.external_id,
    });
    if (headers.messageId) {
      mail.inReplyTo = headers.messageId;
      mail.references = [...headers.references.filter(id => id !== headers.messageId), headers.messageId].slice(-MAX_REFERENCES);
    }
  } catch (err) {
    console.error(`Couldn't look up threading headers for message ${original.id}; sending without them:`, err.message);
  }

  const sameGmail = account.provider === 'gmail' && original.account_id === account.id;
  return { mail, threadId: sameGmail ? original.thread_id : null };
}

async function markFailed(outboxId, message) {
  const { error } = await supabase.from('outbox').update({ status: 'failed', error: message }).eq('id', outboxId);
  if (error) console.error(`Couldn't record the failure of outbox email ${outboxId}:`, error);
}

// Sends one email if it's still waiting and due. Claiming it ('waiting' ->
// 'sending') in one update means the timer and a catch-up run can never both send it.
async function deliver(outboxId) {
  const { data: row, error } = await supabase
    .from('outbox')
    .update({ status: 'sending' })
    .eq('id', outboxId)
    .eq('status', 'waiting')
    .lte('send_at', new Date().toISOString())
    .select('id, user_id, account_id, email')
    .maybeSingle();
  if (error) throw error;
  if (!row) return; // undone, already sent, or not due yet

  const account = await getAccount(row.user_id, row.account_id);
  try {
    if (!account) throw new UserError('The account this was sent from has been removed');
    const { mail, threadId } = await buildMail(account, row.email);
    await connectorFor(account.provider).send({ credentials: await getCredentials(account), mail, threadId });
  } catch (err) {
    console.error(`Sending outbox email ${row.id} failed:`, err);
    await markFailed(row.id, err instanceof UserError ? err.message : 'Sending failed. Nothing was sent; try again.');
    // After Send, the app still has the files and uploads them again for a
    // resend. A scheduled email failed while the app wasn't watching, so its
    // files stay for Edit (the Scheduled list shows it as failed).
    if (!row.email.scheduled) await removeUploads(uploadIdsOf(row.email));
    return;
  }
  await removeUploads(uploadIdsOf(row.email));

  const { error: sentError } = await supabase
    .from('outbox')
    .update({ status: 'sent', sent_at: new Date().toISOString(), email: null })
    .eq('id', row.id);
  if (sentError) console.error(`Outbox email ${row.id} was sent, but marking it sent failed:`, sentError);

  // brings the sent copy into the app
  syncAccount(account).catch(err => console.error(`Sync after sending failed for account ${account.id}:`, err.message));
}

// After a restart: sends anything overdue, re-arms timers for what's still
// waiting, and gives up on anything cut off mid-send (it may or may not have
// gone, so it isn't retried). Runs at startup and on every cron call.
async function sendDue() {
  const { error: stuckError } = await supabase
    .from('outbox')
    .update({ status: 'failed', error: 'The server restarted while sending this. Check your Sent folder before sending it again.' })
    .eq('status', 'sending')
    .lt('send_at', new Date(Date.now() - STUCK_SENDING_MS).toISOString());
  if (stuckError) throw stuckError;

  // only what's due soon: see schedule()
  const { data, error } = await supabase
    .from('outbox')
    .select('id, send_at')
    .eq('status', 'waiting')
    .lte('send_at', new Date(Date.now() + TIMER_AHEAD_MS).toISOString())
    .order('send_at');
  if (error) throw error;

  for (const row of data) schedule(row.id, row.send_at);
}

module.exports = { queueEmail, cancelEmail, listScheduled, sendNow, emailStatus, sendDue };
