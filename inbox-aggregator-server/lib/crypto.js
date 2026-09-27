const crypto = require('crypto');

// Account credentials (refresh tokens, IMAP passwords) are encrypted with
// AES-256-GCM before they're stored. The key lives only in CREDENTIALS_KEY —
// lose it and every account has to be reconnected.
function getKey() {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) throw new Error('CREDENTIALS_KEY is not set in .env');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIALS_KEY must be 32 bytes, base64-encoded');
  return key;
}

// Stored as "v1:<iv>:<authTag>:<ciphertext>", each part base64.
function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

function decryptJson(stored) {
  const [version, iv, tag, ciphertext] = stored.split(':');
  if (version !== 'v1') throw new Error(`Unknown credentials format "${version}"`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { getKey, encryptJson, decryptJson };
