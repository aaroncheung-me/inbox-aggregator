// Plain text with its web addresses turned into links that open in a new tab.
// Catches http(s):// and www. addresses; punctuation that usually ends a
// sentence (".", ",", ")" etc.) is left out of the link.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

function Linkify({ text }) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0];
    const trailing = url.match(TRAILING)?.[0] || '';
    // keep a closing bracket that belongs to the link, e.g. .../Foo_(bar)
    if (trailing && !(trailing.startsWith(')') && url.includes('('))) url = url.slice(0, -trailing.length);

    if (match.index > last) parts.push(text.slice(last, match.index));
    const href = url.toLowerCase().startsWith('www.') ? `https://${url}` : url;
    parts.push(
      <a key={match.index} href={href} target="_blank" rel="noopener noreferrer">{url}</a>
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export default Linkify;
