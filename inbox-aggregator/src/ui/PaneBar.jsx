import { useContext } from 'react';
import { PaneBeside, PaneClose } from './paneContext';

// The first row of every page in the main pane (and of the phone's assistant
// screen while writing), always laid out the same way, so controls are where
// you expect them: where to go back to on the left, then the page's name, then
// its actions on the right. The main action is the filled button, and Delete or
// Discard is always the last one. It stays put while the page scrolls under it.
// From MainPane (paneContext): "Show beside" first among the actions while an
// email is being written, and × last on a page that can be closed (a phone
// page, or the page beside the email being written; on desktop tabs have ×).
// left: the back or switch button(s). children: the actions.
function PaneBar({ left, title, children, className = '' }) {
  const onClose = useContext(PaneClose);
  const onShowBeside = useContext(PaneBeside);
  return (
    <div className={`pane-bar ${className}`}>
      <div className="pane-bar-inner">
        {left}
        {title && <span className="pane-title">{title}</span>}
        <span className="pane-actions">
          {onShowBeside && (
            <button
              className="btn btn-ghost btn-small desktop-only"
              onClick={onShowBeside}
              title="Show this beside the email you're writing"
            >
              Show beside
            </button>
          )}
          {children}
          {onClose && (
            <button className="pane-close" onClick={onClose} aria-label="Close" title="Close">×</button>
          )}
        </span>
      </div>
    </div>
  );
}

export default PaneBar;
