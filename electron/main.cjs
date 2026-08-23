'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server.cjs');
const { getUiRoot, registerUpdateIpc } = require('./updater.cjs');

let serverHandle = null;
let mainWindow = null;

async function createWindow() {
  // Works both from source and from inside the packaged asar. A frontend
  // downloaded by the in-app updater lives outside the asar and wins when it is
  // newer than the one this build shipped with.
  const distDir = getUiRoot(path.join(__dirname, '..', 'dist'));

  let url;
  try {
    // A fixed port is only used for smoke-testing the packaged app; normally
    // the server takes any free port.
    const port = Number(process.env.TQR_PORT) || 0;
    const started = await startServer(distDir, port);
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

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (serverHandle) serverHandle.close();
  if (process.platform !== 'darwin') app.quit();
});
