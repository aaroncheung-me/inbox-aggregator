import { useState } from 'react';
import Linkify from '../../ui/Linkify';
import { trimQuotedText } from './quotes';

// A plain-text email. hideQuoted (in a conversation): the copy of earlier
// emails a reply carries is left out, with a small "⋯" to bring it back.
function PlainBody({ text, hideQuoted = false }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const trimmed = hideQuoted ? trimQuotedText(text) : { text, trimmed: false };

  return (
    <>
      <div className="body"><Linkify text={showQuoted ? text : trimmed.text} /></div>
      {trimmed.trimmed && (
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

export default PlainBody;
