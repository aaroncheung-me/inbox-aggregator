const { createClient } = require('@supabase/supabase-js');

// With the new secret keys (sb_secret_...), Supabase's gateway turns the key
// into a short-lived token on every request. Now and then the gateway's clock
// runs a moment ahead of the database's, which rejects the token as "JWT
// issued at future" (PGRST303). Waiting a moment and trying again gets through.
const RETRIES = 2;
const RETRY_WAIT_MS = 500;

async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 401 || attempt >= RETRIES) return res;
    const body = await res.clone().json().catch(() => null);
    if (body?.code !== 'PGRST303') return res;
    await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS * (attempt + 1)));
  }
}

module.exports = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  global: { fetch: fetchWithRetry },
});
