const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

// Turns an error from the AI providers into something the app can show:
//   { provider, outOfCredits, message }
// or null if it isn't a provider error. Running out of credits gets its own
// message saying where to top up, so a failure doesn't need investigating.
function describeProviderError(err) {
  if (err instanceof Anthropic.APIError) {
    // Anthropic answers 400 "Your credit balance is too low to access the Anthropic API"
    if (/credit balance is too low/i.test(err.message || '')) {
      return {
        provider: 'anthropic',
        outOfCredits: true,
        message: 'Your Anthropic credits have run out, so AI features are paused. Top up at console.anthropic.com (Settings, Billing).',
      };
    }
    const busy = err instanceof Anthropic.RateLimitError || err.status === 529;
    return {
      provider: 'anthropic',
      outOfCredits: false,
      message: busy ? 'The AI is busy right now, try again in a moment.' : 'The AI request failed, check the server log.',
    };
  }

  if (err instanceof OpenAI.APIError) {
    // OpenAI answers 429 with code "insufficient_quota" when the account has no credit left
    if (err.code === 'insufficient_quota' || /insufficient_quota|exceeded your current quota/i.test(err.message || '')) {
      return {
        provider: 'openai',
        outOfCredits: true,
        message: 'Your OpenAI credits have run out, so search indexing and voice are paused. Top up at platform.openai.com (Settings, Billing).',
      };
    }
    return {
      provider: 'openai',
      outOfCredits: false,
      message: err.status === 429 ? 'OpenAI is busy right now, try again in a moment.' : 'The OpenAI request failed, check the server log.',
    };
  }

  return null;
}

module.exports = { describeProviderError };
