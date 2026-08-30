'use strict';

const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server.cjs');
const { getUiRoot, registerUpdateIpc } = require('./updater.cjs');
const { registerStoreIpc, readKey, writeKey } = require('./store.cjs');
const {
  DEFAULT_HOTKEY, createOverlayWindow, showOverlay, setHotkey, getHotkeyState,
  registerHotkeyIpc, unregisterPriceCheckHotkey,
} = require('./priceCheck.cjs');
const { createTrayIcon } = require('./trayIcon.cjs');

/** Chosen to be an unlikely collision; see startServer for why it is fixed. */
const DEFAULT_PORT = 47821;
const HOTKEY_STORE_KEY = 'priceCheckHotkey';

let serverHandle = null;
let mainWindow = null;
let overlayWindow = null;
let tray = null;
/** Set only by a real quit path, so a window's own close button can hide it instead. */
let quitting = false;

/** "Control+G" -> "Ctrl+G", the form the tray menu and Settings show. */
function formatAccelerator(accelerator) {
  return accelerator.replace(/\bControl\b/g, 'Ctrl').replace(/\bSuper\b/g, 'Win');
}

async function createWindow() {
  // Works both from source and from inside the packaged asar. A frontend
  // downloaded by the in-app updater lives outside the asar and wins when it is
  // newer than the one this build shipped with.
  const distDir = getUiRoot(path.join(__dirname, '..', 'dist'));

  let url;
  try {
    // A stable port means a stable origin, which is what lets the renderer's
    // stored state survive a restart at all. TQR_PORT overrides it for tests.
    const port = Number(process.env.TQR_PORT) || DEFAULT_PORT;
    const started = await startServer(distDir, port, true);
    serverHandle = started.server;
    url = started.url;
  } catch (error) {
    console.error('Could not start the local server:', error);
    app.quit();
    return;
  }

  const window = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    title: 'Tarkov Quest Router',
    webPreferences: {
      // The renderer is an ordinary web app and needs no Node access; the
      // preload adds the update channel and nothing more.
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = window;

  // Wiki links belong in the real browser, not in a bare app window.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  // The whole point of the tray icon: closing the window backgrounds the app
  // (so the price-check hotkey keeps working) instead of quitting it.
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.loadURL(url);

  overlayWindow = createOverlayWindow(url, () => quitting);

  // Whatever Settings last saved, falling back to the default on a first run
  // or a corrupted store; a rejected custom binding is reported, not silently
  // swapped for something the user did not choose.
  const saved = readKey(HOTKEY_STORE_KEY);
  const initial = typeof saved === 'string' && saved ? saved : DEFAULT_HOTKEY;
  const initialResult = setHotkey(initial, () => overlayWindow);
  if (initialResult.ok && initialResult.accelerator !== saved) writeKey(HOTKEY_STORE_KEY, initialResult.accelerator);

  registerHotkeyIpc(() => overlayWindow, (accelerator) => {
    writeKey(HOTKEY_STORE_KEY, accelerator);
    refreshTray();
  });

  tray = createTray();
}

function createTray() {
  const t = new Tray(createTrayIcon());
  updateTrayMenu(t);
  // The one-click default on Windows/Linux; macOS ignores it in favour of the menu.
  t.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  return t;
}

/** Rebuilds the tray tooltip/menu so it reflects whatever hotkey is live right now. */
function updateTrayMenu(t) {
  const { accelerator, ok } = getHotkeyState();
  const label = ok
    ? `Price check (hold ${formatAccelerator(accelerator)}, tap twice)`
    : 'Price check hotkey not active — see Settings';

  t.setToolTip('Tarkov Quest Router');
  t.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Tarkov Quest Router', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label, click: () => showOverlay(overlayWindow) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function refreshTray() {
  if (tray) updateTrayMenu(tray);
}

registerUpdateIpc(() => mainWindow);
registerStoreIpc();

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Covers every path that actually means "exit" -- the tray's Quit item, Cmd+Q
// on macOS -- so the window close handlers above stop hiding and let it happen.
app.on('before-quit', () => { quitting = true; });

app.on('will-quit', () => { unregisterPriceCheckHotkey(); });

app.on('window-all-closed', () => {
  // Both windows now hide rather than close on their own, so this only fires
  // once quitting is already true (or on a platform without the tray habit).
  if (serverHandle) serverHandle.close();
  if (process.platform !== 'darwin') app.quit();
});
