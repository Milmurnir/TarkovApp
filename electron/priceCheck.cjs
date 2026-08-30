'use strict';

/**
 * The price-check overlay: a small always-on-top window plus the global
 * hotkey that summons it, so a price lookup never needs alt-tabbing out of
 * the raid.
 *
 * Hotkey: Ctrl+G+G, read as "hold Ctrl, tap G twice in quick succession" (the
 * other reading -- Ctrl+G as a chord, pressed twice -- collapses to the same
 * implementation). Electron's `globalShortcut` only registers single
 * accelerators; there is no cross-platform API for a true OS-level key
 * *sequence*. So this registers the single combo `Control+G` once and times
 * the gap between firings itself -- two presses inside DOUBLE_PRESS_MS count
 * as the trigger, matching what holding Ctrl and double-tapping G actually
 * generates (two separate keydowns on G, Ctrl held throughout).
 */

const path = require('path');
const { BrowserWindow, globalShortcut, screen, ipcMain } = require('electron');

const HOTKEY = 'Control+G';
const DOUBLE_PRESS_MS = 450;

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

/**
 * Registers the global hotkey. Returns whether registration succeeded --
 * another application can already own Ctrl+G, and there is no way to force
 * the OS to hand it over.
 */
function registerPriceCheckHotkey(getOverlayWindow) {
  let lastPress = 0;

  const ok = globalShortcut.register(HOTKEY, () => {
    const now = Date.now();
    if (now - lastPress <= DOUBLE_PRESS_MS) {
      lastPress = 0; // a stray third tap should not immediately retrigger
      showOverlay(getOverlayWindow());
    } else {
      lastPress = now;
    }
  });

  if (!ok) {
    console.error(`Could not register the price-check hotkey (${HOTKEY}); another app may already be using it.`);
  }
  return ok;
}

function unregisterPriceCheckHotkey() {
  globalShortcut.unregister(HOTKEY);
}

module.exports = {
  HOTKEY,
  DOUBLE_PRESS_MS,
  createOverlayWindow,
  showOverlay,
  registerPriceCheckHotkey,
  unregisterPriceCheckHotkey,
};
