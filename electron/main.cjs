'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server.cjs');
const { getUiRoot, registerUpdateIpc } = require('./updater.cjs');
const { registerStoreIpc } = require('./store.cjs');

/** Chosen to be an unlikely collision; see startServer for why it is fixed. */
const DEFAULT_PORT = 47821;

let serverHandle = null;
let mainWindow = null;

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

  window.loadURL(url);
}

registerUpdateIpc(() => mainWindow);
registerStoreIpc();

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (serverHandle) serverHandle.close();
  if (process.platform !== 'darwin') app.quit();
});
