import { useRef, useState } from 'react';
import { useDismiss } from '../hooks/useDismiss';

// A button that opens a short list of actions below it, for the top bar
// ("More", "+ Add"). items: [{ label, onClick }], falsy entries skipped.
function ActionMenu({ label, items, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, open, setOpen);

  return (
    <span className={`action-menu ${className}`} ref={ref}>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(prev => !prev)} aria-expanded={open}>
        {label} ▾
      </button>
      {open && (
        <span className="action-menu-options" role="menu">
          {items.filter(Boolean).map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick(); }}
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
