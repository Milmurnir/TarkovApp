'use strict';

/**
 * The only bridge between the page and Electron. It exposes the update flow and
 * nothing else, and the renderer never gets to say *what* to download: the main
 * process remembers that from its own check.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appUpdates', {
  info: () => ipcRenderer.invoke('update:info'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  restart: () => ipcRenderer.invoke('update:restart'),
  openRelease: (url) => ipcRenderer.invoke('update:open-release', url),
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
});
