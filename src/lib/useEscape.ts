import { useEffect, useRef } from 'react';

/** Calls `onEscape` when Esc is pressed anywhere -- how every dialog here closes. */
export function useEscape(onEscape: () => void): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') handler.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
