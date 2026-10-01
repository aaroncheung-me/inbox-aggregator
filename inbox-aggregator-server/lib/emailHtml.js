const { getMessageAccess } = require('./accounts');
const { connectorFor } = require('../connectors');
const { normalizeCid } = require('./text');

// An email's formatted (HTML) version, fetched from the mail provider each time
// it's opened rather than stored: HTML is often 50-200 KB, too much to keep for
// every email in the free database. The app shows it in a locked-down frame.

const MAX_HTML_BYTES = 2 * 1024 * 1024;
// Images inside the email (cid: links) travel as data: URLs, up to this much in total.
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

// parts: [{ partId, cid, mimeType, content }] from the connector.
function inlineImages(html, parts) {
  const byCid = new Map(parts.map(p => [normalizeCid(p.cid), p]));
  return html.replace(/cid:([^"'\s)>]+)/gi, (link, target) => {
    const part = byCid.get(normalizeCid(target));
    return part ? `data:${part.mimeType};base64,${part.content.toString('base64')}` : link;
  });
}

// Returns { html, text, inlinePartIds }: html is null for a plain-text email,
// whose whole text is in text instead (the database keeps only the start);
// inlinePartIds are the attachments shown inside the email. null if the
// message doesn't exist or isn't this user's.
async function getEmailHtml(userId, messageId) {
  const access = await getMessageAccess(userId, messageId);
  if (!access) return null;

  const { html, text, inlineParts } = await connectorFor(access.provider).getHtml({
    credentials: access.credentials,
    messageExternalId: access.externalId,
    maxHtmlBytes: MAX_HTML_BYTES,
    maxInlineBytes: MAX_INLINE_BYTES,
  });
  if (!html) return { html: null, text: text || null, inlinePartIds: [] };

  return { html: inlineImages(html, inlineParts), inlinePartIds: inlineParts.map(p => p.partId) };
}

module.exports = { getEmailHtml };
