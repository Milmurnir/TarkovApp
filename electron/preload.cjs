'use strict';

/**
 * The only bridge between the page and Electron: durable storage, the update
 * flow, and the price-check overlay's show/hide channel. The renderer never
 * gets to say *what* to update to, for instance -- the main process remembers
 * that from its own check.
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

/**
 * The price-check overlay window's own bridge. `onShow` fires each time the
 * global hotkey (re)opens the reused window, so the renderer knows to reset
 * its query and refocus the input; `hide` is how Esc backs out of it.
 * `getHotkey`/`setHotkey` back the Settings panel's hotkey control -- the main
 * process is the source of truth for whether the binding is actually live.
 */
contextBridge.exposeInMainWorld('priceCheck', {
  hide: () => ipcRenderer.send('pricecheck:hide'),
  onShow: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('pricecheck:show', handler);
    return () => ipcRenderer.removeListener('pricecheck:show', handler);
  },
  getHotkey: () => ipcRenderer.invoke('pricecheck:get-hotkey'),
  setHotkey: (accelerator) => ipcRenderer.invoke('pricecheck:set-hotkey', accelerator),
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
