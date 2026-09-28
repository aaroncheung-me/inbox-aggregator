const crypto = require('crypto');
const addressparser = require('nodemailer/lib/addressparser');
const supabase = require('./supabase');
const { getAccount, getCredentials, listAccounts } = require('./accounts');
const { syncAccount } = require('./sync');
const { UserError } = require('./errors');
const { connectorFor } = require('../connectors');

// Sending waits this long, so Undo can take it back.
const UNDO_SECONDS = 15;
// mail still marked 'sending' after this long was cut off by a server restart
const STUCK_SENDING_MS = 5 * 60 * 1000;
const MAX_RECIPIENTS = 50;
const MAX_SUBJECT_CHARS = 500;
const MAX_BODY_CHARS = 100000;
const MAX_REFERENCES = 20; // the newest ones are enough for mail programs to thread

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

// Body: { accountId, to, cc, bcc, subject, body, replyToMessageId? }.
// Checks it, stores it, and sends it UNDO_SECONDS from now. Returns { id, sendAt }.
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
  if (!subject && !body.trim()) throw new UserError('The email is empty');

  let replyToMessageId = null;
  if (input.replyToMessageId != null) {
    const original = await ownedMessage(userId, Number(input.replyToMessageId) || 0);
    if (!original) throw new UserError("The email you're replying to couldn't be found");
    replyToMessageId = original.id;
  }

  const sendAt = new Date(Date.now() + UNDO_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from('outbox')
    .insert({
      user_id: userId,
      account_id: account.id,
      send_at: sendAt,
      email: { to, cc, bcc, subject, body, replyToMessageId },
    })
    .select('id')
    .single();
  if (error) throw error;

  schedule(data.id, sendAt);
  return { id: data.id, sendAt };
}

// Undo: takes the email back if it hasn't started sending. Returns false when it's too late.
async function cancelEmail(userId, outboxId) {
  const { data, error } = await supabase
    .from('outbox')
    .delete()
    .eq('id', outboxId)
    .eq('user_id', userId)
    .eq('status', 'waiting')
    .select('id');
  if (error) throw error;
  if (!data.length) return false;

  clearTimeout(timers.get(Number(outboxId)));
  timers.delete(Number(outboxId));
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

function schedule(outboxId, sendAt) {
  if (timers.has(outboxId)) return;
  const delay = Math.max(0, new Date(sendAt).getTime() - Date.now());
  timers.set(outboxId, setTimeout(() => {
    timers.delete(outboxId);
    deliver(outboxId).catch(err => console.error(`Sending outbox email ${outboxId} failed:`, err));
  }, delay));
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
    return;
  }

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

  const { data, error } = await supabase
    .from('outbox')
    .select('id, send_at')
    .eq('status', 'waiting')
    .order('send_at');
  if (error) throw error;

  for (const row of data) schedule(row.id, row.send_at);
}

module.exports = { queueEmail, cancelEmail, emailStatus, sendDue, UNDO_SECONDS };
