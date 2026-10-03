import { useEffect, useRef } from 'react';

// While `open`, calls onClose on a pointerdown outside `ref` or on Escape. For
// menus and popovers. onClose can be a new function every render.
export function useDismiss(ref, open, onClose) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e) {
      if (!ref.current?.contains(e.target)) close.current();
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') close.current();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, open]);
}
