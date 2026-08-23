'use strict';

/**
 * Small JSON store in the user-data folder.
 *
 * Quest progress must not depend on the renderer's localStorage: that is keyed
 * by origin, so it is only as stable as the local server's port, and it lives
 * inside the app's own profile. This writes to %APPDATA%/<app>/store instead,
 * which survives replacing the application folder — the whole point of asking
 * for progress that outlives an update.
 *
 * Writes go to a temporary file first and are renamed into place, so a crash
 * mid-write leaves the previous contents rather than a truncated file.
 */

const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

/** Only these keys can be read or written; the renderer picks the key. */
const ALLOWED_KEYS = new Set(['progress']);
const MAX_BYTES = 2 * 1024 * 1024;

const storeDir = () => path.join(app.getPath('userData'), 'store');
const filePath = (key) => path.join(storeDir(), `${key}.json`);

function readKey(key) {
  if (!ALLOWED_KEYS.has(key)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath(key), 'utf8'));
  } catch {
    return null;
  }
}

function writeKey(key, value) {
  if (!ALLOWED_KEYS.has(key)) return false;

  const serialised = JSON.stringify(value);
  if (serialised.length > MAX_BYTES) return false;

  fs.mkdirSync(storeDir(), { recursive: true });
  const target = filePath(key);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, serialised);
  fs.renameSync(temporary, target);
  return true;
}

function registerStoreIpc() {
  ipcMain.handle('store:get', (_event, key) => readKey(String(key)));
  ipcMain.handle('store:set', (_event, key, value) => {
    try {
      return writeKey(String(key), value);
    } catch (error) {
      console.error('Could not write to the store:', error);
      return false;
    }
  });
}

module.exports = { registerStoreIpc };
