// A red banner at the top of the sidebar while Anthropic or OpenAI credits have
// run out, so a failing feature explains itself. It goes away by itself once a
// request to that provider works again; "Hide" hides it until the next problem.
function CreditsBanner({ problems, hiddenSince, onHide }) {
  const visible = problems.filter(problem => hiddenSince[problem.provider] !== problem.since);
  if (!visible.length) return null;

  return (
    <div className="credits-banner" role="alert">
      {visible.map(problem => (
        <div key={problem.provider} className="credits-banner-row">
          <span>{problem.message}</span>
          <button className="credits-banner-hide" onClick={() => onHide(problem)}>Hide</button>
        </div>
      ))}
    </div>
  );
}

export default CreditsBanner;
