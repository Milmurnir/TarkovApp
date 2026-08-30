/**
 * Typed view of the price-check overlay bridge the Electron preload installs.
 *
 * In the browser (`npm run dev` outside Electron) there is no bridge, so the
 * overlay component just never gets an `onShow` and Esc has nothing to call --
 * it still renders, for convenience while working on it.
 */

export interface PriceCheckBridge {
  /** Esc, or clicking outside the popup: hides the window without closing it. */
  hide: () => void;
  /** Fires each time the global hotkey (re)opens the reused window. */
  onShow: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    priceCheck?: PriceCheckBridge;
  }
}

/** The bridge, or null when the app runs as a plain web page. */
export function priceCheckBridge(): PriceCheckBridge | null {
  return typeof window !== 'undefined' && window.priceCheck ? window.priceCheck : null;
}
