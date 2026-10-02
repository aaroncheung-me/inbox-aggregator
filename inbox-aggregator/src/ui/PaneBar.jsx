import { useContext } from 'react';
import { PaneClose } from './paneContext';

// The first row of every page in the main pane (and of the phone's assistant
// screen while writing), always laid out the same way, so controls are where
// you expect them: where to go back to on the left, then the page's name, then
// its actions on the right. The main action is the filled button, and Delete or
// Discard is always the last one. It stays put while the page scrolls under it.
// On a phone, a page that can be closed (PaneClose) ends with ×; on desktop its
// tab has the ×.
// left: the back or switch button(s). children: the actions.
function PaneBar({ left, title, children, className = '' }) {
  const onClose = useContext(PaneClose);
  return (
    <div className={`pane-bar ${className}`}>
      <div className="pane-bar-inner">
        {left}
        {title && <span className="pane-title">{title}</span>}
        <span className="pane-actions">
          {children}
          {onClose && (
            <button className="pane-close phone-only" onClick={onClose} aria-label="Close" title="Close">×</button>
          )}
        </span>
      </div>
    </div>
  );
}

export default PaneBar;
