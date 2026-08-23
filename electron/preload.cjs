'use strict';

/**
 * The only bridge between the page and Electron. It exposes the update flow and
 * nothing else, and the renderer never gets to say *what* to download: the main
 * process remembers that from its own check.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Durable storage outside the renderer's own profile, so quest progress is not
 * tied to the local server's port and is not lost when the app folder is
 * replaced by an update.
 */
contextBridge.exposeInMainWorld('appStore', {
  get: (key) => ipcRenderer.invoke('store:get', key),
  set: (key, value) => ipcRenderer.invoke('store:set', key, value),
});

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
