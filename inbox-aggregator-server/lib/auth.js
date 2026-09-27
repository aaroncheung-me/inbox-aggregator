const supabase = require('./supabase');
const { encryptJson, decryptJson } = require('./crypto');

// ---------- signed-in user ----------

// Verified tokens are remembered briefly so each request doesn't need a round
// trip to Supabase. A signed-out token keeps working for at most this long.
const TOKEN_CACHE_MS = 60 * 1000;
const tokenCache = new Map(); // access token -> { userId, expiresAt }

async function userIdForToken(token) {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  if (tokenCache.size > 500) {
    for (const [key, entry] of tokenCache) if (entry.expiresAt <= Date.now()) tokenCache.delete(key);
  }
  tokenCache.set(token, { userId: data.user.id, expiresAt: Date.now() + TOKEN_CACHE_MS });
  return data.user.id;
}

// Express middleware: rejects the request unless it carries a valid Supabase
// access token ("Authorization: Bearer <token>"), and sets req.userId.
async function requireUser(req, res, next) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const userId = match && await userIdForToken(match[1]);
  if (!userId) return res.status(401).send('Sign in required');

  req.userId = userId;
  next();
}

// ---------- connect state ----------

// Sign-in-based connects (Gmail) leave the app for the provider's page and come
// back through a redirect that carries no login. This token rides along in the
// OAuth `state` parameter to say which user started the connect. It's encrypted
// and authenticated, so it can't be forged, and expires quickly.
const CONNECT_STATE_TTL_MS = 10 * 60 * 1000;

function createConnectState(userId) {
  return encryptJson({ purpose: 'connect', userId, expiresAt: Date.now() + CONNECT_STATE_TTL_MS });
}

// The user id the state was made for, or null if it's missing, tampered with or expired.
function readConnectState(state) {
  try {
    const payload = decryptJson(state);
    if (payload.purpose === 'connect' && payload.expiresAt > Date.now()) return payload.userId;
  } catch {
    // falls through: not a state we issued
  }
  return null;
}

module.exports = { requireUser, createConnectState, readConnectState };
