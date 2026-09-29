const { UserError } = require('./errors');

// cPanel's API (UAPI) on the mail host, used for the forwarders behind temp
// addresses. Needs CPANEL_HOST (e.g. gator1234.hostgator.com), CPANEL_USER and
// CPANEL_API_TOKEN (made in cPanel > Security > Manage API Tokens).
const TIMEOUT_MS = 15000;

function cpanelConfigured() {
  return Boolean(process.env.CPANEL_HOST && process.env.CPANEL_USER && process.env.CPANEL_API_TOKEN);
}

async function uapi(module, fn, params) {
  if (!cpanelConfigured()) throw new UserError("Temp addresses aren't set up: the server has no cPanel API token");
  const { CPANEL_HOST, CPANEL_USER, CPANEL_API_TOKEN } = process.env;
  const url = `https://${CPANEL_HOST}:2083/execute/${module}/${fn}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Authorization: `cpanel ${CPANEL_USER}:${CPANEL_API_TOKEN}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`cPanel refused the API token (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`cPanel ${module}::${fn} answered HTTP ${res.status}`);

  const body = await res.json();
  const result = body.result || body; // some cPanel versions wrap the reply in "result"
  if (!result.status) throw new Error(`cPanel ${module}::${fn} failed: ${(result.errors || ['no reason given']).join('; ')}`);
  return result.data;
}

// Mail to `address` is passed on to `forwardTo`.
async function addForwarder(address, forwardTo) {
  const domain = address.split('@')[1];
  await uapi('Email', 'add_forwarder', { domain, email: address, fwdopt: 'fwd', fwdemail: forwardTo });
}

// Returns false if there was no such forwarder (already gone counts as done).
async function deleteForwarder(address, forwardTo) {
  try {
    await uapi('Email', 'delete_forwarder', { address, forwarder: forwardTo });
    return true;
  } catch (err) {
    if (/does not exist|not found|no such/i.test(err.message)) return false;
    throw err;
  }
}

// [{ dest, forward }] for the domain: dest is the forwarder's address.
async function listForwarders(domain) {
  return (await uapi('Email', 'list_forwarders', { domain })) || [];
}

module.exports = { cpanelConfigured, addForwarder, deleteForwarder, listForwarders };
