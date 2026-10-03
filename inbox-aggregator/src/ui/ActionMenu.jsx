import { useEffect, useRef, useState } from 'react';
import { useDismiss } from '../hooks/useDismiss';

const MENU_WIDTH = 190; // a little over the menu's min-width
const ITEM_HEIGHT = 36;
const EDGE = 8; // keep this far from the screen's edges

// A button that opens a short list of actions, for the top bar ("More",
// "+ Add") and rows like a temp address's. items: [{ label, onClick, danger? }],
// falsy entries skipped. The list is placed against the screen rather than its
// container, so a scrolling box can't cut it off, and opens toward whichever
// side has room: below or above, right- or left-aligned.
// A symbol label (e.g. "⋯") can drop the ▾ with arrow={false}; give it an ariaLabel.
function ActionMenu({ label, items, className = '', arrow = true, ariaLabel, buttonClassName = '' }) {
  const shown = items.filter(Boolean);
  const [position, setPosition] = useState(null); // fixed-position style while open, else null
  const open = position !== null;
  const ref = useRef(null);
  useDismiss(ref, open, () => setPosition(null));

  // it would drift away from its button if the page scrolled underneath
  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setPosition(null);
      return;
    }
    const button = ref.current.getBoundingClientRect();
    const height = shown.length * ITEM_HEIGHT + 10;
    const below = window.innerHeight - button.bottom;
    const openUp = below < height + EDGE && button.top > below;
    const alignLeft = button.right - MENU_WIDTH < EDGE;
    setPosition({
      ...(openUp ? { bottom: window.innerHeight - button.top + 4 } : { top: button.bottom + 4 }),
      ...(alignLeft
        ? { left: Math.max(EDGE, button.left) }
        : { right: Math.max(EDGE, window.innerWidth - button.right) }),
    });
  }

  return (
    <span className={`action-menu ${className}`} ref={ref}>
      <button
        type="button"
        className={`btn btn-ghost btn-small ${buttonClassName}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {arrow ? `${label} ▾` : label}
      </button>
      {open && (
        <span className="action-menu-options" role="menu" style={position}>
          {shown.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              onClick={() => { setPosition(null); item.onClick(); }}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export default ActionMenu;
