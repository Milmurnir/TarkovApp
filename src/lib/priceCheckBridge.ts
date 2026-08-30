/**
 * Typed view of the price-check overlay bridge the Electron preload installs.
 *
 * In the browser (`npm run dev` outside Electron) there is no bridge, so the
 * overlay component just never gets an `onShow` and Esc has nothing to call --
 * it still renders, for convenience while working on it.
 */

/** What the main process actually has registered with the OS right now. */
export interface HotkeyState {
  accelerator: string;
  /** False when the combo lost the registration race to another app. */
  ok: boolean;
  /** Present on a failed `setHotkey`: the combo that did not take. */
  attempted?: string;
}

export interface PriceCheckBridge {
  /** Esc, or clicking outside the popup: hides the window without closing it. */
  hide: () => void;
  /** Fires each time the global hotkey (re)opens the reused window. */
  onShow: (callback: () => void) => () => void;
  getHotkey: () => Promise<HotkeyState>;
  /** Rejected changes leave the previous binding (if any) in place. */
  setHotkey: (accelerator: string) => Promise<HotkeyState>;
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
