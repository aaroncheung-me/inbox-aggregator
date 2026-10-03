const { UserError } = require('./errors');
const { describeProviderError } = require('./providerErrors');
const { noteProviderFailure } = require('./providerStatus');

// Runs a route, answering 400 with { error } for problems the user can fix.
function withUserErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof UserError) return res.status(400).json({ error: err.message });
      throw err;
    }
  };
}

// An AI provider (Anthropic or OpenAI) failed: records it for the credits
// banner and answers 502 with a message the app can show (plus `extra`).
// Anything that isn't a provider error is rethrown, for withUserErrors or the
// general error handler.
function sendProviderFailure(res, err, what, extra = '') {
  noteProviderFailure(err);
  const problem = describeProviderError(err);
  if (!problem) throw err;
  console.error(`${what} failed:`, err);
  res.status(502).json({ error: `${problem.message}${extra}`, outOfCredits: problem.outOfCredits });
}

module.exports = { withUserErrors, sendProviderFailure };
