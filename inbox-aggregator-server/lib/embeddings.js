const OpenAI = require('openai');
const supabase = require('./supabase');
const { noteProviderFailure, noteProviderSuccess } = require('./providerStatus');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_CHARS = 8000; // stay well under the model's per-input limit
const BATCH_SIZE = 50;  // texts per embeddings request

async function generateEmbeddings(texts) {
  let response;
  try {
    response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts.map(t => t.slice(0, MAX_CHARS)),
    });
  } catch (err) {
    noteProviderFailure(err); // e.g. out of credits, shown as a banner in the app
    throw err;
  }
  noteProviderSuccess('openai');
  // results carry their input position; sort rather than trust response order
  return response.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function generateEmbedding(text) {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}

// Embeds every message in the account that doesn't have an embedding yet,
// BATCH_SIZE at a time. Returns how many were embedded.
async function embedPending(accountId) {
  let total = 0;

  for (;;) {
    const { data: batch, error } = await supabase
      .from('messages')
      .select('id, subject, body, snippet')
      .eq('account_id', accountId)
      .is('embedding', null)
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!batch.length) return total;

    const embeddings = await generateEmbeddings(
      batch.map(m => `${m.subject || ''}\n${m.body || m.snippet || ''}`)
    );

    for (let i = 0; i < batch.length; i++) {
      const { error: updateError } = await supabase
        .from('messages')
        .update({ embedding: embeddings[i] })
        .eq('id', batch[i].id);
      if (updateError) throw updateError;
    }

    total += batch.length;
  }
}

module.exports = { generateEmbedding, embedPending };
