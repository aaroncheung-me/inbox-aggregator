import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { trimQuotedHtml } from './quotes';

// An email's formatted (HTML) version, shown the way mail apps do: in a frame
// that can't run scripts, submit forms or reach the app, sized to its content
// so the page scrolls as one. Wide emails (600px newsletters on a phone) are
// scaled down to fit. It stays on white in dark mode too, since senders design
// for white. loadImages false blocks images from the web (they tell senders
// when an email is opened); images inside the email itself always show.
// hideQuoted (in a conversation): the copy of earlier emails a reply carries is
// left out, with a small "⋯" under the frame to bring it back (as in Gmail).

// every link opens in a new tab, without telling the site where it came from
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const MIN_SCALE = 0.4; // narrower than this would be unreadable, so it scrolls sideways instead

// Before the email's own styles, so it can override them.
const BASE_STYLE = `
  html { background: #FFFFFF; color: #1A1A1A; overflow-y: hidden; }
  body { margin: 0; padding: 16px; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; overflow-wrap: break-word; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; }
`;

// { srcDoc, quoted }: quoted says whether a quoted copy was left out.
function frameDocument(html, loadImages, hideQuoted) {
  // the whole document, so the email's own <head> styles and <body> colors survive
  const root = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea'],
    ADD_ATTR: ['target'],
  });
  const quoted = hideQuoted && trimQuotedHtml(root);
  // What the email may load. No scripts, frames or connections of any kind.
  const images = loadImages ? 'data: https: http:' : 'data:';
  const policy = `default-src 'none'; img-src ${images}; style-src 'unsafe-inline' https:; font-src https: data:`;
  root.querySelector('head').insertAdjacentHTML('afterbegin', '<meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${policy}">`
    + `<style>${BASE_STYLE}</style>`);
  return { srcDoc: `<!doctype html>${root.outerHTML}`, quoted };
}

function EmailHtml({ html, loadImages = true, hideQuoted = false }) {
  const frameRef = useRef(null);
  const [showQuoted, setShowQuoted] = useState(false);
  const trim = hideQuoted && !showQuoted;
  const { srcDoc, quoted } = useMemo(() => frameDocument(html, loadImages, trim), [html, loadImages, trim]);

  useEffect(() => {
    const frame = frameRef.current;
    let contentObserver = null;
    let waiting = 0;
    let pendingFit = 0;

    // the frame as tall as the content (its size already reflects any scaling)
    function fitHeight() {
      const root = frame.contentDocument?.documentElement;
      if (root) frame.style.height = `${Math.ceil(root.getBoundingClientRect().height)}px`;
    }

    // scale wide emails down to the frame's width, then fit the height
    function fit() {
      const root = frame.contentDocument?.documentElement;
      if (!root) return;
      root.style.zoom = '';
      const scale = Math.max(MIN_SCALE, Math.min(1, frame.clientWidth / root.scrollWidth));
      if (scale < 1) root.style.zoom = String(scale);
      fitHeight();
    }

    // Resizing the frame from inside a ResizeObserver callback resizes what's
    // being observed, which browsers report as a loop, so it waits for the next frame.
    function fitLater(fn) {
      cancelAnimationFrame(pendingFit);
      pendingFit = requestAnimationFrame(fn);
    }

    // the new document replaces the frame's blank one; start watching it as soon
    // as it's there, rather than waiting for every image to load
    function watchWhenReady() {
      const doc = frame.contentDocument;
      if (doc?.body && doc.URL === 'about:srcdoc') {
        fit();
        contentObserver = new ResizeObserver(() => fitLater(fitHeight));
        contentObserver.observe(doc.body);
      } else {
        waiting = requestAnimationFrame(watchWhenReady);
      }
    }
    watchWhenReady();

    // images have loaded (so widths are final), or the frame changed width
    let lastWidth = frame.clientWidth;
    const frameObserver = new ResizeObserver(() => {
      if (frame.clientWidth !== lastWidth) {
        lastWidth = frame.clientWidth;
        fitLater(fit);
      }
    });
    frameObserver.observe(frame);
    frame.addEventListener('load', fit);

    return () => {
      cancelAnimationFrame(waiting);
      cancelAnimationFrame(pendingFit);
      contentObserver?.disconnect();
      frameObserver.disconnect();
      frame.removeEventListener('load', fit);
    };
  }, [srcDoc]);

  return (
    <>
      <iframe
        // a new frame when images or the quoted text are switched on, rather than
        // swapping the document inside one that's still being measured
        key={`${loadImages}-${trim}`}
        ref={frameRef}
        className="email-html"
        title="Email content"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
      />
      {(quoted || showQuoted) && (
        <button
          type="button"
          className="quoted-toggle"
          onClick={() => setShowQuoted(prev => !prev)}
          aria-expanded={showQuoted}
          aria-label={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
          title={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
        >
          ⋯
        </button>
      )}
    </>
  );
}

export default EmailHtml;
