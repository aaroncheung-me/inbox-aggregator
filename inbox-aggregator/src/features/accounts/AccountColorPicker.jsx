import { useRef, useState } from 'react';
import { ACCOUNT_COLORS } from './accountColors';
import { useDismiss } from '../../hooks/useDismiss';

// The account's color dot; clicking it opens a popover of swatches plus a custom color.
// dashed: drawn as a dashed ring, as temp addresses are.
function AccountColorPicker({ account, onChangeColor, dashed = false }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  useDismiss(pickerRef, open, setOpen);

  const name = account.display_name || account.email_address;
  const current = (account.color || '').toLowerCase();

  return (
    <div className="color-picker" ref={pickerRef}>
      <button
        className={dashed ? 'temp-dot account-dot-button' : 'account-dot account-dot-button'}
        style={dashed ? { borderColor: account.color || undefined } : { background: account.color }}
        onClick={() => setOpen(prev => !prev)}
        aria-label={`Change color for ${name}`}
        aria-expanded={open}
      />

      {open && (
        <div className="color-picker-popover" role="dialog" aria-label={`Color for ${name}`}>
          <div className="color-swatches">
            {ACCOUNT_COLORS.map(color => {
              const selected = color.hex.toLowerCase() === current;
              return (
                <button
                  key={color.hex}
                  className={`color-swatch${selected ? ' selected' : ''}`}
                  style={{ background: color.hex }}
                  title={color.name}
                  aria-label={color.name}
                  aria-pressed={selected}
                  onClick={() => {
                    onChangeColor(account.id, color.hex);
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
          <label className="color-custom">
            <input
              type="color"
              value={current || '#cccccc'}
              onChange={e => onChangeColor(account.id, e.target.value)}
            />
            Custom color
          </label>
        </div>
      )}
    </div>
  );
}

export default AccountColorPicker;
