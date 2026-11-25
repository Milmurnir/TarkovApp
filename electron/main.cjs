'use strict';

// A copy started only to swap a downloaded update into place (see
// selfUpdate.cjs) must not open windows, bind the port or touch anything else.
const selfUpdate = require('./selfUpdate.cjs');
if (selfUpdate.finishUpdateIfAsked()) return;

const { app, BrowserWindow, Tray, Menu, shell, screen } = require('electron');

// One copy at a time. A second one could not get the fixed port, so it would
// start on a random one with none of the saved state, fail to register the
// hotkey and run a second log watcher. Starting the app again instead brings
// the running copy forward.
// Tests point this at a scratch folder, so they never touch real progress
// (and, since the lock is per profile, never collide with a running copy).
if (process.env.TQR_USER_DATA) app.setPath('userData', process.env.TQR_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
const path = require('path');
const { startServer } = require('./server.cjs');
const { getUiRoot, registerUpdateIpc } = require('./updater.cjs');
const { registerStoreIpc, readKey, writeKey } = require('./store.cjs');
const {
  DEFAULT_HOTKEY, createOverlayWindow, showOverlay, setHotkey, getHotkeyState,
  registerHotkeyIpc, unregisterPriceCheckHotkey,
} = require('./priceCheck.cjs');
const { createTrayIcon } = require('./trayIcon.cjs');
const { registerGameLogIpc } = require('./gameLogs.cjs');

/** Chosen to be an unlikely collision; see startServer for why it is fixed. */
const DEFAULT_PORT = 47821;
const HOTKEY_STORE_KEY = 'priceCheckHotkey';
const BOUNDS_STORE_KEY = 'windowBounds';
const DEFAULT_SIZE = { width: 1500, height: 950 };

let serverHandle = null;
let mainWindow = null;
let overlayWindow = null;
let tray = null;
/** Set on any real quit path, so the overlay window closes instead of hiding. */
let quitting = false;

/**
 * Where the window was last left, if that spot is still on a connected
 * display -- a monitor unplugged since must not strand it off-screen.
 */
function savedBounds() {
  const saved = readKey(BOUNDS_STORE_KEY);
  if (!saved || typeof saved !== 'object') return null;
  const { x, y, width, height, maximized } = saved;
  if (![x, y, width, height].every(Number.isFinite) || width < 400 || height < 300) return null;
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    x < a.x + a.width - 100 && x + width > a.x + 100 && y >= a.y - 20 && y < a.y + a.height - 100);
  return visible ? { x, y, width, height, maximized: Boolean(maximized) } : null;
}

function saveBounds(window) {
  try {
    writeKey(BOUNDS_STORE_KEY, { ...window.getNormalBounds(), maximized: window.isMaximized() });
  } catch (error) {
    console.error('Could not save the window position:', error);
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

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

  const bounds = savedBounds();
  const window = new BrowserWindow({
    ...(bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : DEFAULT_SIZE),
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
  if (bounds?.maximized) window.maximize();

  // Wiki links belong in the real browser, not in a bare app window.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  // The window's X quits the whole app, as players expect -- hiding to the
  // tray instead read as "I closed it but it is still running". Minimising
  // is how to keep it (and the price-check hotkey) alive in the background.
  // Setting `quitting` first lets the overlay window close too rather than
  // hide, so nothing is left behind.
  window.on('close', () => {
    saveBounds(window);
    quitting = true;
    app.quit();
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
  t.on('click', showMainWindow);
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
    { label: 'Show Tarkov Quest Router', click: showMainWindow },
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
registerGameLogIpc(() => mainWindow);

app.whenReady().then(() => {
  // A whole-app update downloaded last session goes in before anything opens:
  // the new copy swaps itself in and starts the app again.
  const staged = selfUpdate.stagedUpdate();
  if (staged) {
    selfUpdate.handOff(staged);
    return;
  }
  selfUpdate.cleanUpLater();
  createWindow();
});

app.on('second-instance', showMainWindow);

app.on('activate', () => {
  if (mainWindow) showMainWindow();
  else if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Covers every path that actually means "exit" -- the tray's Quit item, Cmd+Q
// on macOS -- so the window close handlers above stop hiding and let it happen.
app.on('before-quit', () => { quitting = true; });

app.on('will-quit', () => { unregisterPriceCheckHotkey(); });

app.on('window-all-closed', () => {
  // Only reached once quitting: the main window's X quits, and the overlay
  // only ever closes for real once `quitting` is set.
  if (serverHandle) serverHandle.close();
  if (process.platform !== 'darwin') app.quit();
});
