// Replies usually carry a copy of the conversation so far. When the app shows
// the conversation itself, those copies only repeat it, so they're hidden
// (with a way to show them again), the way Gmail does. Mail programs mark the
// copy in different ways; these cover the ones seen in real mail here.

// Mail programs that wrap the quoted copy in a marked element.
const QUOTE_SELECTORS = [
  '.gmail_quote_container', // Gmail (newer: attribution line + quote)
  '.gmail_quote', // Gmail
  '.gmail_extra', // older Gmail
  'blockquote[type="cite"]', // Apple Mail, Thunderbird
  '.moz-cite-prefix', // Thunderbird's "On ... wrote:" line
  '.yahoo_quoted', // Yahoo
  '.protonmail_quote', // Proton
  '[id^="mail-editor-reference-message-container"]', // Outlook on the web
];
// Outlook marks where the copy starts; everything after the marker is the copy.
const QUOTE_START_IDS = ['divRplyFwdMsg', 'appendonsend'];
const BLOCK_TAGS = new Set(['DIV', 'P', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL', 'HR', 'H1', 'H2', 'H3', 'SECTION']);
// "On Thursday, July 10, 2025, Ann <ann@x.com> wrote:"
const ATTRIBUTION = /^\s*(On|Le|Am|El)\b[\s\S]{0,300}(wrote|a écrit|schrieb|escribió)\s*:\s*$/;
// The header block Outlook (and others) put above the copy: From, Sent/Date and
// Subject, with plain or full-width colons.
const HEADER_FROM = /^\s*(From|De|Von)\s*[:：]/;

function isBreak(node) {
  return node.nodeType === 1 && (node.tagName === 'BR' || BLOCK_TAGS.has(node.tagName));
}

function isBlank(node) {
  return (node.nodeType === 3 && !node.textContent.trim()) || (node.nodeType === 1 && node.tagName === 'BR');
}

// Removes the "On ..., X wrote:" line just before a quote: either its own
// element, or loose text (and links) since the last line break.
function removeAttribution(quote) {
  let node = quote.previousSibling;
  const gap = [];
  while (node && isBlank(node)) {
    gap.push(node);
    node = node.previousSibling;
  }
  if (node?.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) {
    if (ATTRIBUTION.test(node.textContent)) [node, ...gap].forEach(n => n.remove());
    return;
  }
  const line = [];
  while (node && !isBreak(node)) {
    line.unshift(node);
    node = node.previousSibling;
  }
  if (line.length && ATTRIBUTION.test(line.map(n => n.textContent).join(''))) [...line, ...gap].forEach(n => n.remove());
}

// Removes an element and everything after it in the document.
function cutFrom(element) {
  for (let node = element; node && node.tagName !== 'BODY'; node = node.parentElement) {
    while (node.nextSibling) node.nextSibling.remove();
  }
  element.remove();
}

// The header block that starts a copy: a short element reading "From: ...
// Sent/Date: ... Subject: ...", taken with any wrapper that holds only it.
function findHeaderBlock(root) {
  for (const element of root.querySelectorAll('p, div, ul, table')) {
    const text = element.textContent;
    if (text.length > 600 || !HEADER_FROM.test(text)) continue;
    if (!/(Sent|Date|Datum|Envoyé)\s*[:：]/.test(text) || !/(Subject|Objet|Betreff)\s*[:：]/.test(text)) continue;
    let block = element;
    while (block.parentElement && block.parentElement.tagName !== 'BODY'
      && block.parentElement.textContent.trim() === block.textContent.trim()) {
      block = block.parentElement;
    }
    return block;
  }
  return null;
}

// Removes the quoted copy from a sanitized email document (its <html>
// element). Returns whether anything was removed.
export function trimQuotedHtml(root) {
  let removed = false;

  for (const id of QUOTE_START_IDS) {
    const start = root.querySelector(`#${id}`);
    if (!start) continue;
    const before = start.previousElementSibling;
    if (before?.tagName === 'HR') before.remove(); // the line Outlook draws above it
    cutFrom(start);
    removed = true;
  }

  for (const element of root.querySelectorAll(QUOTE_SELECTORS.join(','))) {
    if (!element.isConnected) continue; // inside one already removed
    removeAttribution(element);
    element.remove();
    removed = true;
  }

  // Help desks built on Zendesk repeat the whole ticket in every email, newest
  // comment first; only that first one is new.
  const comments = root.querySelectorAll('.zd-liquid-comment');
  for (const comment of [...comments].slice(1)) {
    if (!comment.isConnected) continue;
    comment.remove();
    removed = true;
  }

  // no marked quote: look for the From / Sent / Subject header that starts one
  if (!removed) {
    const header = findHeaderBlock(root);
    if (header && header.textContent.trim() !== root.querySelector('body')?.textContent.trim()) {
      const before = header.previousElementSibling;
      if (before?.tagName === 'HR') before.remove();
      cutFrom(header);
      removed = true;
    }
  }
  return removed;
}

// ---------- plain text ----------

const isQuoteLine = line => line.trim().startsWith('>');

// A plain-text quote: an "On ... wrote:" line (maybe wrapped onto a second
// line) and the ">" lines under it. Returns the line after it, or -1.
function quoteBlockEnd(lines, start) {
  let i = start;
  if (ATTRIBUTION.test(lines[i])) i++;
  else if (/^\s*(On|Le|Am|El)\b/.test(lines[i]) && ATTRIBUTION.test(`${lines[i]} ${lines[i + 1] || ''}`)) i += 2;
  else if (!isQuoteLine(lines[i])) return -1;
  while (i < lines.length && (isQuoteLine(lines[i]) || !lines[i].trim())) i++;
  return i;
}

// Where an Outlook-style copy starts: "-----Original Message-----", or a
// From: line with Sent:/Date: just below.
function headerStart(lines) {
  return lines.findIndex((line, i) => /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)
    || (HEADER_FROM.test(line) && lines.slice(i + 1, i + 4).some(l => /^\s*(Sent|Date)\s*[:：]/.test(l))));
}

// { text, trimmed }: a plain-text email without the quoted copy at its top
// (bottom-posted replies) or its end. Answers written between quoted lines
// keep their quotes, which they need to make sense.
export function trimQuotedText(text) {
  let lines = (text || '').split('\n');
  const original = lines.length;

  // a copy that starts the email, with the reply below it
  const firstText = lines.findIndex(l => l.trim());
  if (firstText >= 0) {
    const end = quoteBlockEnd(lines, firstText);
    if (end > firstText && lines.slice(end).some(l => l.trim())) lines = lines.slice(end);
  }

  // a copy that ends the email: from its "On ... wrote:" line (or the first
  // of the ">" lines that run to the end), or an Outlook-style header
  const header = headerStart(lines);
  let cut = header > 0 ? header : -1;
  for (let i = lines.length - 1; i > 0 && cut < 0; i--) {
    if (!lines[i].trim()) continue;
    if (!isQuoteLine(lines[i])) break;
    let start = i;
    while (start > 0 && (isQuoteLine(lines[start - 1]) || !lines[start - 1].trim())) start--;
    if (start > 0 && ATTRIBUTION.test(lines[start - 1])) start--;
    else if (start > 1 && ATTRIBUTION.test(`${lines[start - 2]} ${lines[start - 1]}`)) start -= 2;
    cut = start;
  }
  if (cut > 0 && lines.slice(0, cut).some(l => l.trim())) lines = lines.slice(0, cut);

  const trimmed = lines.length !== original;
  return { text: trimmed ? lines.join('\n').trim() : text, trimmed };
}
