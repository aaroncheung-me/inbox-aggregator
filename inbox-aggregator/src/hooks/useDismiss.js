import { useEffect } from 'react';

// While `open`, closes a popup (via setOpen(false)) on a pointerdown outside
// `ref` or on Escape. For menus and popovers.
export function useDismiss(ref, open, setOpen) {
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, open, setOpen]);
}
