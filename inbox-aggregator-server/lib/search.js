const supabase = require('./supabase');
const { generateEmbedding } = require('./embeddings');
const { emailAddress } = require('./text');

// Filters shared by every search. Dates are "YYYY-MM-DD" strings or null.
// { sender, after, before, hasAttachments }
function filterParams({ sender, after, before, hasAttachments } = {}) {
  return {
    sender_filter: sender || null,
    after_date: after || null,
    before_date: before || null,
    attachments_only: !!hasAttachments,
  };
}

async function keywordSearch(userId, accountIds, query, { filters, limit = 10, offset = 0, matchAny = false } = {}) {
  const { data, error } = await supabase.rpc('search_messages_keyword', {
    search_query: query || '',
    match_user_id: userId,
    match_account_ids: accountIds,
    match_count: limit,
    match_offset: offset,
    match_any: matchAny,
    ...filterParams(filters),
  });
  if (error) throw error;
  return data;
}

async function semanticSearch(userId, accountIds, query, { filters, limit = 10 } = {}) {
  const { data, error } = await supabase.rpc('search_messages_semantic', {
    query_embedding: await generateEmbedding(query),
    match_user_id: userId,
    match_account_ids: accountIds,
    match_count: limit,
    ...filterParams(filters),
  });
  if (error) throw error;
  return data;
}

// ---------- what kind of email is this ----------

// Rough signals from the sender address alone, so they work on every message
// ever synced. Wrong guesses only nudge ranking; nothing is hidden.
const MARKETING_LOCAL = /^(digital|news|newsletters?|marketing|promos?|promotions?|deals|offers|specials|sales?|shop)$/;
const MARKETING_SUBDOMAIN = /^(promo|promos|em|email|e|mail|mailer|news|newsletter|marketing|mkt|engage|offers)\./;
const TRANSACTIONAL_LOCAL = /^(support|help|care|service|customerservice|customercare|orders?|receipts?|billing|invoices?|shipping|appointments?|returns?|warranty)$/;

// 'yours' | 'reply' | 'transactional' | 'marketing' | null
function emailKind(message, ownAddresses = []) {
  const address = emailAddress(message.sender);
  const [local = '', domain = ''] = address.split('@');
  if (ownAddresses.includes(address)) return 'yours';
  if (TRANSACTIONAL_LOCAL.test(local)) return 'transactional';
  if (/^(re|fwd?):/i.test((message.subject || '').trim())) return 'reply';
  if (MARKETING_LOCAL.test(local) || MARKETING_SUBDOMAIN.test(domain)) return 'marketing';
  return null;
}

// Questions about "my ..." are usually answered by the user's own dealings
// (orders, support threads, their replies), rarely by promotions.
// Kept gentle: fused scores sit close together, so strong weights would let
// barely-relevant emails jump ahead just for being personal.
const KIND_WEIGHT = { yours: 1.15, transactional: 1.25, reply: 1.15, marketing: 0.6 };
const MAX_MARKETING_PER_SENDER = 2;
// Standard rank fusion constant; smaller values let one list's top results dominate.
const FUSION_K = 60;
// Postgres's code for "canceling statement due to statement timeout"
const STATEMENT_TIMEOUT = '57014';

// Words that say how a question is asked rather than what it's about. They
// appear in thousands of emails ("Ask anything", "Find out more") and would
// swamp the keyword half of a question search. Postgres already drops the
// usual stop words (my, the, about...); these are the ones it keeps.
const QUESTION_FILLER = new Set([
  'anything', 'something', 'everything', 'find', 'show', 'tell', 'give', 'get', 'got', 'know', 'look',
  'looking', 'search', 'email', 'emails', 'mail', 'message', 'messages', 'info', 'information',
  'please', 'recent', 'latest', 'last', 'ever', 'stuff', 'thing', 'things', 'regarding', 'related',
]);

// The words of a question worth matching literally: no single letters (the
// "T" of "AT&T" appears everywhere) and no question filler.
function questionKeywords(question) {
  return question
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 1 && !QUESTION_FILLER.has(word.toLowerCase()))
    .join(' ');
}

// Runs both searches and merges them with reciprocal rank fusion: a message
// scores 1/(FUSION_K + rank) in each list it appears in, so something ranked well by
// both beats something ranked first by only one. Keyword search uses "any of
// these words" here, since the query is usually a whole question. Scores are
// then weighted by emailKind, and one sender's marketing can take at most
// MAX_MARKETING_PER_SENDER of the slots.
async function hybridSearch(userId, accountIds, query, { filters, limit = 8, ownAddresses = [] } = {}) {
  const keywordQuery = questionKeywords(query);

  const [byMeaning, byKeyword] = await Promise.all([
    semanticSearch(userId, accountIds, query, { filters, limit: limit * 2 }),
    keywordQuery
      ? keywordSearch(userId, accountIds, keywordQuery, { filters, limit: limit * 2, matchAny: true })
        // A long question of common words can match most of the mailbox and
        // run past the database's time limit; the meaning results still count.
        .catch(err => {
          if (err.code !== STATEMENT_TIMEOUT) throw err;
          console.error(`Keyword half of a search timed out; using meaning results only: "${keywordQuery}"`);
          return [];
        })
      : [],
  ]);

  const merged = new Map();
  for (const list of [byMeaning, byKeyword]) {
    list.forEach((message, rank) => {
      const entry = merged.get(message.id) || { message, score: 0 };
      entry.score += 1 / (FUSION_K + rank);
      merged.set(message.id, entry);
    });
  }

  const ranked = [...merged.values()]
    .map(({ message, score }) => {
      const kind = emailKind(message, ownAddresses);
      return { message, kind, score: score * (KIND_WEIGHT[kind] || 1) };
    })
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const marketingPerSender = new Map();
  for (const entry of ranked) {
    if (entry.kind === 'marketing') {
      const sender = emailAddress(entry.message.sender);
      const count = marketingPerSender.get(sender) || 0;
      if (count >= MAX_MARKETING_PER_SENDER) continue;
      marketingPerSender.set(sender, count + 1);
    }
    picked.push(entry.message);
    if (picked.length === limit) break;
  }
  return picked;
}

// Splits a search-box query into free text and Gmail-style operators:
//   from:dr.patel   from:"Eye Care"   after:2025-01-01   before:2025-06-30   has:attachment
// Unrecognized "word:thing" pairs stay in the text.
function parseSearchQuery(input) {
  const filters = {};
  const text = (input || '').replace(
    /\b(from|after|before|has):(?:"([^"]*)"|(\S+))/gi,
    (match, key, quoted, bare) => {
      const value = (quoted ?? bare).trim();
      switch (key.toLowerCase()) {
        case 'from':
          filters.sender = value;
          return '';
        case 'after':
        case 'before':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return match;
          filters[key.toLowerCase()] = value;
          return '';
        case 'has':
          if (!/^attachments?$/i.test(value)) return match;
          filters.hasAttachments = true;
          return '';
        default:
          return match;
      }
    }
  );
  return { text: text.replace(/\s+/g, ' ').trim(), filters };
}

module.exports = { keywordSearch, semanticSearch, hybridSearch, parseSearchQuery, emailKind, questionKeywords };
