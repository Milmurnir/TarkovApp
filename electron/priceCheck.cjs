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

/** Current binding and whether it is actually live with the OS right now. */
let state = { accelerator: null, ok: false };

/**
 * Built once and shown/hidden from then on, so the item list and any
 * in-progress search survive between lookups instead of reloading every time.
 */
function createOverlayWindow(baseUrl, isQuitting) {
  const win = new BrowserWindow({
    width: 460,
    height: 300,
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

  // Alt+F4 while the overlay has focus would otherwise destroy it outright;
  // it is meant to persist for the app's lifetime like any other panel.
  win.on('close', (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  ipcMain.on('pricecheck:hide', () => { if (!win.isDestroyed()) win.hide(); });

  return win;
}

/** Centres the overlay on whichever display the mouse is on, then focuses it. */
function showOverlay(win) {
  if (!win || win.isDestroyed()) return;

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [winWidth, winHeight] = win.getSize();
  win.setPosition(Math.round(x + (width - winWidth) / 2), Math.round(y + (height - winHeight) / 2));

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
