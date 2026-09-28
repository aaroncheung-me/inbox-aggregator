const { describeProviderError } = require('./providerErrors');

// The latest out-of-credits problem per AI provider, so the app can show a
// banner even when the failure happened in the background (e.g. indexing new
// mail during the scheduled sync). Cleared by the next successful request to
// that provider. Kept in memory: after a server restart it's re-learned on the
// next failure, at most one background sync later.
const problems = new Map(); // provider -> { provider, message, since }

// Call from a catch block; remembers the error if it means credits ran out.
function noteProviderFailure(err) {
  const problem = describeProviderError(err);
  if (problem?.outOfCredits && !problems.has(problem.provider)) {
    problems.set(problem.provider, { provider: problem.provider, message: problem.message, since: new Date().toISOString() });
  }
}

// Call after a request to the provider worked: credits are evidently back.
function noteProviderSuccess(provider) {
  problems.delete(provider);
}

function currentProblems() {
  return [...problems.values()];
}

module.exports = { noteProviderFailure, noteProviderSuccess, currentProblems };
