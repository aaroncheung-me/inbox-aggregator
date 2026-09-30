const crypto = require('crypto');
const supabase = require('./supabase');

// Files attached to emails being sent. The app uploads each one as Send is
// pressed; it waits in a private storage bucket (migration 015) while its
// email waits out the undo time (or until a scheduled email goes), and is
// deleted once the email has been sent or undone. Anything left behind (an
// upload whose email was never queued) is removed by the cron after a day.

const BUCKET = 'outbox-attachments';
// Gmail's limit for everything attached to one email
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const LEFTOVER_AFTER_MS = 24 * 60 * 60 * 1000;

// Stored as "<userId>/<random id>", so an upload id shows whose it is.
function isUsersUpload(userId, uploadId) {
  return typeof uploadId === 'string'
    && uploadId.startsWith(`${userId}/`)
    && /^[0-9a-f-]{36}$/.test(uploadId.slice(userId.length + 1));
}

// Returns the upload id to send the email with.
async function saveUpload(userId, buffer, contentType) {
  const uploadId = `${userId}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage.from(BUCKET).upload(uploadId, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return uploadId;
}

async function loadUpload(uploadId) {
  const { data, error } = await supabase.storage.from(BUCKET).download(uploadId);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

// Failures are only logged: the cron clears anything left behind.
async function removeUploads(uploadIds) {
  if (!uploadIds.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(uploadIds);
  if (error) console.error('Removing sent attachments failed (the cron will retry):', error.message);
}

// The cron's tidy-up: uploads older than a day, in every user's folder, that
// no email still waiting (a scheduled one) or failed-while-scheduled uses.
async function removeLeftoverUploads() {
  const { data: folders, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) throw error;
  const cutoff = Date.now() - LEFTOVER_AFTER_MS;

  const { data: rows, error: rowsError } = await supabase
    .from('outbox')
    .select('email')
    .in('status', ['waiting', 'failed']);
  if (rowsError) throw rowsError;
  const inUse = new Set(rows.flatMap(r => (r.email?.attachments || []).map(a => a.uploadId)));

  for (const folder of folders) {
    const { data: files, error: listError } = await supabase.storage.from(BUCKET).list(folder.name, { limit: 1000 });
    if (listError) throw listError;
    const old = files
      .filter(f => f.created_at && new Date(f.created_at).getTime() < cutoff)
      .map(f => `${folder.name}/${f.name}`)
      .filter(uploadId => !inUse.has(uploadId));
    if (old.length) await removeUploads(old);
  }
}

module.exports = { MAX_TOTAL_BYTES, isUsersUpload, saveUpload, loadUpload, removeUploads, removeLeftoverUploads };
