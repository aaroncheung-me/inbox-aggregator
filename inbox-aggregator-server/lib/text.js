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

module.exports = { htmlToText, makeSnippet };
