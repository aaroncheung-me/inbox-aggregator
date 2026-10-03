// "⋯" under an email whose quoted copy of earlier emails is hidden, as in Gmail.
function QuotedToggle({ shown, onToggle }) {
  const label = shown ? 'Hide quoted text' : 'Show quoted text';
  return (
    <button type="button" className="quoted-toggle" onClick={onToggle} aria-expanded={shown} aria-label={label} title={label}>
      ⋯
    </button>
  );
}

export default QuotedToggle;
