const OpenAI = require('openai');
const { UserError } = require('./errors');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Accurate and cheap (about $0.003 per minute of audio).
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

// What browsers record in (Chrome/Edge: webm, iPhone Safari: mp4), and the file
// extension OpenAI needs to recognize each.
const EXTENSIONS = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

// Recorded audio -> text. The audio only lives in memory for this request;
// it's never written anywhere.
async function transcribe(audio, contentType) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSIONS[type];
  if (!extension) throw new UserError(`This recording format (${type || 'unknown'}) isn't supported`);

  const file = await OpenAI.toFile(audio, `recording.${extension}`, { type });
  const result = await openai.audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL });
  return (result.text || '').trim();
}

module.exports = { transcribe, TRANSCRIBE_TYPES: Object.keys(EXTENSIONS) };
