'use strict';

/**
 * The price-check overlay: a small always-on-top window plus the global
 * hotkey that summons it, so a price lookup never needs alt-tabbing out of
 * the raid.
 *
 * Hotkey: Ctrl+G+G by default, read as "hold Ctrl, tap G twice in quick
 * succession" (the other reading -- Ctrl+G as a chord, pressed twice --
 * collapses to the same implementation). Electron's `globalShortcut` only
 * registers single accelerators; there is no cross-platform API for a true
 * OS-level key *sequence*. So this registers one combo and times the gap
 * between firings itself -- two presses inside DOUBLE_PRESS_MS count as the
 * trigger, matching what holding Ctrl and double-tapping G actually generates
 * (two separate keydowns on the base key, Ctrl held throughout).
 *
 * The combo itself is user-changeable from Settings (persisted via
 * store.cjs), because it can silently lose the registration race to any other
 * app already bound to Ctrl+G. `setHotkey` is the single entry point for both
 * the initial registration at startup and a later change, so both paths get
 * the same "put the old one back if the new one fails" behaviour.
 */

const path = require('path');
const { BrowserWindow, globalShortcut, screen, ipcMain } = require('electron');

const DEFAULT_HOTKEY = 'Control+G';
const DOUBLE_PRESS_MS = 450;
const OVERLAY_WIDTH = 460;
/** The renderer asks for the height its content needs; kept inside these. */
const MIN_HEIGHT = 90;
const MAX_HEIGHT = 520;

/** Current binding and whether it is actually live with the OS right now. */
let state = { accelerator: null, ok: false };

/** Where the player last dragged the overlay, read and written through the store. */
let positionStore = { read: () => null, write: () => {} };
/**
 * Where showOverlay last put the window. On hide, a different position can
 * only be the player's drag, so that one is remembered. (Comparing on hide
 * rather than listening for 'moved', which a resize can also set off.)
 */
let placedAt = null;

/**
 * Built once and shown/hidden from then on, so the item list and any
 * in-progress search survive between lookups instead of reloading every time.
 * `store` reads and writes the remembered position (see showOverlay).
 */
function createOverlayWindow(baseUrl, isQuitting, store) {
  if (store) positionStore = store;
  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: 160,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b0f14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Plain alwaysOnTop sits below a screensaver/lock layer on Windows; the
  // 'screen-saver' level is the one that also clears a fullscreen game.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(`${baseUrl}/?overlay=1`);

  // Focus elsewhere -- back into the game, or any other window -- is exactly
  // "click outside the popup", so it hides the same way Esc does.
  win.on('blur', () => { if (!win.isDestroyed()) win.hide(); });

  // A drag by the player (the overlay's top strip) is remembered, so it
  // opens there next time rather than over the middle of the screen.
  win.on('hide', () => {
    if (win.isDestroyed() || !placedAt) return;
    const [x, y] = win.getPosition();
    // A pixel or two is display-scaling rounding, not a drag.
    if (Math.abs(x - placedAt.x) > 2 || Math.abs(y - placedAt.y) > 2) positionStore.write({ x, y });
    placedAt = null;
  });

  // Alt+F4 while the overlay has focus would otherwise destroy it outright;
  // it is meant to persist for the app's lifetime like any other panel.
  win.on('close', (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  ipcMain.on('pricecheck:hide', () => { if (!win.isDestroyed()) win.hide(); });

  // The window is as tall as what it shows: a bare search box when empty,
  // longer as matches come in. A fixed 300 px was mostly empty space over
  // the game on open, and cut the list short once there were results.
  ipcMain.on('pricecheck:resize', (_event, height) => {
    if (win.isDestroyed() || typeof height !== 'number' || !Number.isFinite(height)) return;
    const next = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
    // Full bounds, width included: setContentSize on a non-resizable
    // window collapsed its width on Windows. The page gets a few pixels less
    // than the bounds, by an amount only known once applied, so it is
    // measured and the height corrected once.
    const apply = (outer) => {
      const { x, y } = win.getBounds();
      win.setBounds({ x, y, width: OVERLAY_WIDTH, height: outer });
    };
    if (win.getContentSize()[1] === next && win.getBounds().width === OVERLAY_WIDTH) return;
    apply(next);
    const short = next - win.getContentSize()[1];
    if (short > 0) apply(next + short);
  });

  return win;
}

/** The remembered spot, if it is still on a connected display. */
function savedPosition() {
  const saved = positionStore.read();
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  const onScreen = screen.getAllDisplays().some(({ workArea: area }) => saved.x >= area.x
    && saved.y >= area.y
    && saved.x + 80 <= area.x + area.width
    && saved.y + 40 <= area.y + area.height);
  return onScreen ? { x: saved.x, y: saved.y } : null;
}

/** Centred across, a quarter of the way down: it grows downwards as results arrive. */
function defaultPosition(win) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  return { x: Math.round(x + (width - OVERLAY_WIDTH) / 2), y: Math.round(y + height * 0.25) };
}

/**
 * Opens the overlay where the player last dragged it, else on whichever
 * display the mouse is on, then focuses it.
 */
function showOverlay(win) {
  if (!win || win.isDestroyed()) return;

  const position = savedPosition() ?? defaultPosition(win);
  win.setPosition(position.x, position.y);
  placedAt = position;

  win.show();
  win.focus();
  // Tells the renderer to clear the last query and refocus the input, since
  // the window itself is reused rather than recreated on every trigger.
  win.webContents.send('pricecheck:show');
}

/** Registers `accelerator` with the double-tap detector wired to `getOverlayWindow`. */
function tryRegister(accelerator, getOverlayWindow) {
  let lastPress = 0;
  return globalShortcut.register(accelerator, () => {
    const now = Date.now();
    if (now - lastPress <= DOUBLE_PRESS_MS) {
      lastPress = 0; // a stray third tap should not immediately retrigger
      showOverlay(getOverlayWindow());
    } else {
      lastPress = now;
    }
  });
}

/**
 * Switches the live hotkey to `accelerator`. On failure the previous binding
 * (if any) is put back rather than leaving the user with nothing bound, since
 * a rejected change should not also break what already worked.
 */
function setHotkey(accelerator, getOverlayWindow) {
  const previous = state.accelerator;
  if (previous) globalShortcut.unregister(previous);

  if (tryRegister(accelerator, getOverlayWindow)) {
    state = { accelerator, ok: true };
    return { ...state };
  }

  console.error(`Could not register the price-check hotkey (${accelerator}); another app may already be using it.`);

  if (previous && tryRegister(previous, getOverlayWindow)) {
    state = { accelerator: previous, ok: true };
  } else {
    state = { accelerator, ok: false };
  }
  return { ...state, attempted: accelerator };
}

function getHotkeyState() {
  return { ...state };
}

/** Wires the Settings panel's read/change controls to the live registration. */
function registerHotkeyIpc(getOverlayWindow, onChanged) {
  ipcMain.handle('pricecheck:get-hotkey', () => getHotkeyState());
  ipcMain.handle('pricecheck:set-hotkey', (_event, accelerator) => {
    if (typeof accelerator !== 'string' || !accelerator.trim()) {
      return { ...state, attempted: accelerator };
    }
    const result = setHotkey(accelerator, getOverlayWindow);
    if (result.ok && result.accelerator === accelerator) onChanged(result.accelerator);
    return result;
  });
}

function unregisterPriceCheckHotkey() {
  if (state.accelerator) globalShortcut.unregister(state.accelerator);
}

module.exports = {
  DEFAULT_HOTKEY,
  DOUBLE_PRESS_MS,
  createOverlayWindow,
  showOverlay,
  setHotkey,
  getHotkeyState,
  registerHotkeyIpc,
  unregisterPriceCheckHotkey,
};
