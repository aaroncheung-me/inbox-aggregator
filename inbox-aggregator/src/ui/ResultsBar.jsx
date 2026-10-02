// The row above search results (emails or notes): back to the list on the
// left, where back always is, then what was searched.
// text: e.g. '12 results for "invoice"'.
function ResultsBar({ backLabel, onBack, text }) {
  return (
    <div className="results-bar">
      <button className="pane-back" onClick={onBack}>← {backLabel}</button>
      <span className="results-bar-text">{text}</span>
    </div>
  );
}

export default ResultsBar;
