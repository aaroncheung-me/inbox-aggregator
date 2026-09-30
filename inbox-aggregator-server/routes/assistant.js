// The AI assistant, the AI providers' status for the credits banner, and voice input.
const express = require('express');
const { listAccounts } = require('../lib/accounts');
const { askAssistant } = require('../lib/assistant');
const { transcribe, TRANSCRIBE_TYPES } = require('../lib/transcribe');
const { describeProviderError } = require('../lib/providerErrors');
const { noteProviderFailure, noteProviderSuccess, currentProblems } = require('../lib/providerStatus');
const { withUserErrors, sendProviderFailure } = require('../lib/http');

const router = express.Router();

// ---------- AI assistant ----------

// The email being written, when the assistant is asked from the writing screen:
// { mode: 'new' | 'reply' | 'forward', from, to, cc, subject, body, replyToMessageId? }
function readDraft(draft) {
  if (!draft || typeof draft !== 'object') return null;
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  return {
    mode: ['new', 'reply', 'forward'].includes(draft.mode) ? draft.mode : 'new',
    from: text(draft.from, 200),
    to: text(draft.to, 2000),
    cc: text(draft.cc, 2000),
    subject: text(draft.subject, 500),
    body: text(draft.body, 10000),
    replyToMessageId: Number(draft.replyToMessageId) || null,
  };
}

// Body: { question, history?: [{ question, answer }] (earlier exchanges in this chat, oldest first),
//         openMessageId? (the email open in the app, for "note this email"), timeZone?,
//         draft? (the email being written, see readDraft) }
// Replies with a stream of JSON lines (NDJSON) as the answer is worked out, so
// the app can show progress and the answer as it's written:
//   { type: 'step', text }, { type: 'text', delta }, { type: 'text_reset' } (see lib/assistant.js),
//   then { type: 'done', result: { answer, sources, steps, createdNotes, draft, usage } }
//   or { type: 'error', error, outOfCredits }.
// A missing question is still a plain 400 with { error }.
router.post('/ask', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 1000) : '';
  if (!question) return res.status(400).json({ error: 'Ask a question first' });

  const history = (Array.isArray(req.body.history) ? req.body.history : [])
    .filter(turn => typeof turn?.question === 'string' && typeof turn?.answer === 'string')
    .map(turn => ({ question: turn.question.slice(0, 1000), answer: turn.answer.slice(0, 4000) }));

  // the assistant covers the same accounts the inbox shows; every connected
  // address counts as the user's own when spotting emails they sent
  const accounts = await listAccounts(req.userId);
  const accountIds = accounts.filter(a => a.show_in_inbox).map(a => a.id);
  const ownAddresses = accounts.map(a => a.email_address.toLowerCase());

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // tells proxies not to hold the stream back
  res.flushHeaders();
  const send = event => res.write(`${JSON.stringify(event)}\n`);

  if (!accountIds.length) {
    send({
      type: 'done',
      result: {
        answer: 'All your accounts are hidden. Check one in the Accounts panel to search it.',
        sources: [],
        steps: [],
        createdNotes: [],
        draft: null,
        usage: null,
      },
    });
    return res.end();
  }

  // Errors are sent as a line of the stream: the response has already started,
  // so the usual error handler can't send its own reply.
  try {
    const result = await askAssistant({
      userId: req.userId,
      accountIds,
      ownAddresses,
      question,
      history,
      openMessageId: Number(req.body.openMessageId) || null,
      timeZone: req.body.timeZone,
      draft: readDraft(req.body.draft),
      onEvent: send,
    });
    noteProviderSuccess('anthropic');
    send({ type: 'done', result });
  } catch (err) {
    noteProviderFailure(err);
    console.error('Assistant request failed:', err);
    const problem = describeProviderError(err);
    send({
      type: 'error',
      error: problem?.message || 'The assistant failed, check the server log',
      outOfCredits: problem?.outOfCredits || false,
    });
  }
  res.end();
});

// ---------- AI provider status ----------

// Out-of-credits problems with Anthropic or OpenAI seen recently, including in
// background syncs, for the app's banner: [{ provider, message, since }].
router.get('/status', (req, res) => {
  res.json({ problems: currentProblems() });
});

// ---------- voice ----------

// Body: the raw recording (Content-Type: audio/webm, audio/mp4, ...). Returns { text }.
// The audio is only held in memory while it's transcribed; it's never stored.
router.post('/transcribe', express.raw({ type: TRANSCRIBE_TYPES, limit: '10mb' }), withUserErrors(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No recording was received' });

  try {
    const started = Date.now();
    const text = await transcribe(req.body, req.get('content-type'));
    // for finding what makes voice slow
    console.log(`Voice timing: ${Math.round(req.body.length / 1024)}KB transcribed in ${Date.now() - started}ms`);
    noteProviderSuccess('openai');
    if (!text) return res.status(422).json({ error: "Couldn't hear anything in that recording" });
    res.json({ text });
  } catch (err) {
    sendProviderFailure(res, err, 'Transcription');
  }
}));

module.exports = router;
