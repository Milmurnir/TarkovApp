import { useEffect } from 'react';
import type { Route } from './types';

/**
 * ← / → step through the route without reaching for the mouse mid-raid.
 * Ignored while typing, and while a dialog is open.
 */
export function useRouteKeys(
  route: Route | null,
  enabled: boolean,
  selectedOrder: number | null,
  select: (order: number) => void,
) {
  useEffect(() => {
    if (!enabled || !route || route.stops.length === 0) return;
    const stops = route.stops;

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))) return;
      if (document.querySelector('.modal-backdrop')) return;

      const index = stops.findIndex((s) => s.order === selectedOrder);
      const nextIndex = event.key === 'ArrowRight'
        ? (index === -1 ? 0 : Math.min(stops.length - 1, index + 1))
        : (index === -1 ? -1 : Math.max(0, index - 1));
      if (nextIndex < 0) return;
      event.preventDefault();
      select(stops[nextIndex].order);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, route, selectedOrder, select]);
}
