const Anthropic = require('@anthropic-ai/sdk');

// The Claude client and model shared by the assistant, AI save and Organize.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Change ASSISTANT_MODEL in .env to switch.
const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';

// $ per million tokens [input, output, cache read], for the cost shown in the
// app. Cache writes cost 1.25x input.
const PRICES = {
  'claude-haiku-4-5': [1, 5, 0.1],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-fable-5-1': [10, 50, 0.25],
};

// Models that answer a forced tool_choice with a 400; the prompt steers them instead.
const NO_FORCED_TOOL = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-mythos-5-1']);

function forceTool(name) {
  return NO_FORCED_TOOL.has(MODEL) ? { type: 'auto' } : { type: 'tool', name };
}

function newUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

function addUsage(usage, response) {
  usage.inputTokens += response.usage.input_tokens;
  usage.outputTokens += response.usage.output_tokens;
  usage.cacheWriteTokens += response.usage.cache_creation_input_tokens || 0;
  usage.cacheReadTokens += response.usage.cache_read_input_tokens || 0;
}

// The usage as the app shows it, with its cost (null for a model not in PRICES).
function usageReport(usage) {
  const prices = PRICES[MODEL];
  const costUsd = prices
    ? ((usage.inputTokens + usage.cacheWriteTokens * 1.25) * prices[0] + usage.outputTokens * prices[1] + usage.cacheReadTokens * prices[2]) / 1e6
    : null;
  return { model: MODEL, ...usage, costUsd };
}

module.exports = { anthropic, MODEL, forceTool, newUsage, addUsage, usageReport };
