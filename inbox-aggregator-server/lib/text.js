const { convert } = require('html-to-text');

// Readable plain text from an HTML email body: keeps link targets, drops images.
function htmlToText(html) {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: false, linkBrackets: false } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim();
}

// A one-line preview, for providers that don't supply their own (Gmail does).
function makeSnippet(text, maxChars = 200) {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

// '"Ann" <Ann@X.com>' -> 'ann@x.com'
function emailAddress(sender) {
  const match = /<([^>]+)>/.exec(sender || '');
  return (match ? match[1] : sender || '').trim().toLowerCase();
}

// A Content-ID header value ("<abc@x>") or a cid: link target, compared case-insensitively.
function normalizeCid(value) {
  let cid = String(value || '').trim().replace(/^<|>$/g, '');
  try {
    cid = decodeURIComponent(cid);
  } catch {
    // keep it as written
  }
  return cid.toLowerCase();
}

// The Content-IDs the HTML shows as images.
function referencedCids(html) {
  const cids = new Set();
  for (const match of html.matchAll(/cid:([^"'\s)>]+)/gi)) cids.add(normalizeCid(match[1]));
  return cids;
}

// A text part's bytes as text. Gmail usually hands text over already converted
// to UTF-8 whatever charset the email declares (seen in the raw source), so
// valid UTF-8 is taken as is; other bytes are read in the declared charset.
function decodeText(buffer, charset) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // not UTF-8
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer);
  } catch {
    return buffer.toString('utf-8');
  }
}

module.exports = { htmlToText, makeSnippet, emailAddress, normalizeCid, referencedCids, decodeText };
