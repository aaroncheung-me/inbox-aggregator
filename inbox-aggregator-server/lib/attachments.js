const supabase = require('./supabase');
const { getAccount, getCredentials } = require('./accounts');
const { htmlToText } = require('./text');
const { connectorFor } = require('../connectors');
const { UserError } = require('./errors');

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
// Gmail's own limit for a received attachment
const MAX_SAVE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit
const MAX_TEXT_CHARS = 20000; // ~5k tokens, keeps one attachment from dominating the cost
// A PDF with less extractable text than this is probably a scan, so Claude gets the PDF itself.
const MIN_PDF_TEXT_CHARS = 100;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function extractPdfText(buffer) {
  // unpdf is ESM-first; its CommonJS build is loaded lazily so a broken
  // install can't stop the server from starting
  const { extractText, getDocumentProxy } = require('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}

async function saveExtractedText(attachmentId, text) {
  const { error } = await supabase.from('attachments').update({ extracted_text: text }).eq('id', attachmentId);
  if (error) throw error;
}

// Returns an attachment in the cheapest form Claude can read:
//   { kind: 'text', text }             text pulled out here (free), saved so it's only done once
//   { kind: 'pdf', data }              base64, for scanned PDFs with no text layer
//   { kind: 'image', mediaType, data } base64
//   { kind: 'unreadable', reason }
// Returns null if the attachment doesn't exist or isn't this user's.
async function readAttachment(userId, attachmentId) {
  const { data: attachment, error } = await supabase
    .from('attachments')
    .select('id, external_id, filename, mime_type, size_bytes, extracted_text, messages!inner(external_id, account_id)')
    .eq('id', attachmentId)
    .maybeSingle();

  if (error) throw error;
  if (!attachment) return null;

  const account = await getAccount(userId, attachment.messages.account_id);
  if (!account) return null;

  const base = { filename: attachment.filename, mimeType: attachment.mime_type };
  if (attachment.extracted_text != null) return { ...base, kind: 'text', text: attachment.extracted_text };

  const mimeType = (attachment.mime_type || '').toLowerCase();
  const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.filename || '');
  const isImage = IMAGE_TYPES.includes(mimeType);
  const isText = mimeType.startsWith('text/');
  if (!isPdf && !isImage && !isText) {
    return { ...base, kind: 'unreadable', reason: `${attachment.mime_type || 'this file type'} can't be read yet` };
  }
  if (attachment.size_bytes > MAX_DOWNLOAD_BYTES) {
    return { ...base, kind: 'unreadable', reason: 'the file is too large to read' };
  }

  const buffer = await connectorFor(account.provider).downloadAttachment({
    credentials: await getCredentials(account),
    messageExternalId: attachment.messages.external_id,
    attachmentExternalId: attachment.external_id,
    maxBytes: MAX_DOWNLOAD_BYTES,
  });

  if (isImage) {
    if (buffer.length > MAX_IMAGE_BYTES) return { ...base, kind: 'unreadable', reason: 'the image is too large to read' };
    return { ...base, kind: 'image', mediaType: mimeType, data: buffer.toString('base64') };
  }

  if (isText) {
    const raw = buffer.toString('utf8');
    const text = (mimeType === 'text/html' ? htmlToText(raw) : raw).slice(0, MAX_TEXT_CHARS);
    await saveExtractedText(attachment.id, text);
    return { ...base, kind: 'text', text };
  }

  // PDF
  let text = '';
  try {
    text = await extractPdfText(buffer);
  } catch (err) {
    console.error(`Text extraction failed for attachment ${attachment.id}, sending the PDF itself:`, err.message);
  }
  if (text.replace(/\s/g, '').length >= MIN_PDF_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    await saveExtractedText(attachment.id, text);
    return { ...base, kind: 'text', text };
  }
  return { ...base, kind: 'pdf', data: buffer.toString('base64') };
}

// The file itself, for saving from the app: { filename, mimeType, buffer }.
// Returns null if the attachment doesn't exist or isn't this user's.
async function downloadAttachmentFile(userId, attachmentId) {
  const { data: attachment, error } = await supabase
    .from('attachments')
    .select('external_id, filename, mime_type, size_bytes, messages!inner(external_id, account_id)')
    .eq('id', attachmentId)
    .maybeSingle();
  if (error) throw error;

  const account = attachment && await getAccount(userId, attachment.messages.account_id);
  if (!account) return null;
  if (attachment.size_bytes > MAX_SAVE_BYTES) throw new UserError('This attachment is too large to download here');

  const buffer = await connectorFor(account.provider).downloadAttachment({
    credentials: await getCredentials(account),
    messageExternalId: attachment.messages.external_id,
    attachmentExternalId: attachment.external_id,
    maxBytes: MAX_SAVE_BYTES,
  });
  return { filename: attachment.filename, mimeType: attachment.mime_type, buffer };
}

module.exports = { readAttachment, downloadAttachmentFile };
