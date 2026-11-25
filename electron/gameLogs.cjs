'use strict';

/**
 * Reads quest progress out of the game's own log files.
 *
 * There is no API for a player's character, but every time a trader messages
 * you about a quest the client writes it to `Logs/log_<session>/... push-
 * notifications_000.log`: a timestamped "Got notification" header followed by
 * the notification as JSON. Quest messages carry `message.type` 10 (started),
 * 11 (failed) or 12 (finished) and a `templateId` of "<questId> <text key>".
 * The quest id is the same BSG id tarkov.dev uses, which is what progress is
 * stored under, so nothing has to be matched by name.
 *
 * This only reads text files the game writes to disk for itself -- no memory
 * reading, no packet capture -- so it is nothing the anti-cheat cares about.
 *
 * The renderer never names a path: the folder is found here (registry, then
 * the usual install places) or picked by the player in a native dialog, and the
 * renderer only ever gets back parsed events.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { dialog, ipcMain } = require('electron');
const { readKey, writeKey } = require('./store.cjs');

const STORE_KEY = 'gameLogsDir';
const POLL_MS = 5000;
const STATUS_BY_TYPE = { 10: 'started', 11: 'failed', 12: 'finished' };
const HEADER = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d+))?\|/;
const TEMPLATE = /^([0-9a-f]{24}) (description|failMessageText|successMessageText)\b/;

const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov',
];

const COMMON_INSTALLS = [
  'C:\\Battlestate Games\\EFT',
  'C:\\Battlestate Games\\Escape from Tarkov',
  'D:\\Battlestate Games\\EFT',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Escape from Tarkov\\build',
];

/** True when `dir` looks like the game's Logs folder: it holds log_* session folders. */
function isLogsDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && entry.name.startsWith('log_'));
  } catch {
    return false;
  }
}

/** A picked folder may be the install, the Logs folder, or a session inside it. */
function normaliseLogsDir(picked) {
  const candidates = [picked, path.join(picked, 'Logs'), path.join(picked, 'build', 'Logs'), path.dirname(picked)];
  return candidates.find(isLogsDir) ?? null;
}

function registryInstallLocation(key) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', 'InstallLocation'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      const match = /InstallLocation\s+REG_\w+\s+(.+)/.exec(stdout);
      resolve(match ? match[1].trim() : null);
    });
  });
}

/** The folder last found, so the 5-second watcher does not search (and run reg.exe) every tick. */
let found = { dir: null, source: null };
let lastSearch = 0;
/** How often a lost folder is looked for again. */
const RESEARCH_MS = 60000;

async function findLogsDir() {
  if (found.dir && isLogsDir(found.dir)) return found;
  if (!found.dir && lastSearch > 0 && Date.now() - lastSearch < RESEARCH_MS) return found;
  lastSearch = Date.now();
  found = await searchLogsDir();
  return found;
}

/** The chosen folder if it still works, else the registry, else the usual places. */
async function searchLogsDir() {
  const saved = readKey(STORE_KEY);
  if (typeof saved === 'string' && isLogsDir(saved)) return { dir: saved, source: 'picked' };

  if (process.platform === 'win32') {
    for (const key of REGISTRY_KEYS) {
      const install = await registryInstallLocation(key);
      const dir = install && normaliseLogsDir(install);
      if (dir) return { dir, source: 'registry' };
    }
  }
  for (const install of COMMON_INSTALLS) {
    const dir = normaliseLogsDir(install);
    if (dir) return { dir, source: 'default' };
  }
  return { dir: null, source: null };
}

/** "log_2026.11.19_20-10-49_1.3.0.2.48779" -> local time of that session's start. */
function sessionStart(name) {
  const match = /^log_(\d{4})\.(\d\d)\.(\d\d)_(\d+)-(\d\d)-(\d\d)/.exec(name);
  if (!match) return 0;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

function sessionDirs(logsDir) {
  try {
    return fs.readdirSync(logsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('log_'))
      .map((entry) => ({ name: entry.name, start: sessionStart(entry.name) }))
      .sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

function notificationFiles(sessionPath) {
  try {
    return fs.readdirSync(sessionPath)
      .filter((name) => name.includes('push-notifications') && name.endsWith('.log'))
      .sort()
      .map((name) => path.join(sessionPath, name));
  } catch {
    return [];
  }
}

/**
 * Every quest event in one log file. The JSON after a header runs until the
 * next timestamped line, so the file is cut into blocks on those lines and
 * each block parsed on its own -- one malformed block costs only itself.
 */
function parseFile(file, session) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }

  const events = [];
  let header = null;
  let body = [];

  function flush() {
    if (!header || body.length === 0) return;
    let parsed;
    try {
      parsed = JSON.parse(body.join('\n'));
    } catch {
      return;
    }
    const message = parsed && parsed.message;
    const status = message && STATUS_BY_TYPE[message.type];
    const template = message && typeof message.templateId === 'string' && TEMPLATE.exec(message.templateId);
    if (!status || !template) return;
    // `dt` is the server's unix time in seconds; the header is local time and
    // only a fallback for a message that somehow lacks it.
    const at = typeof message.dt === 'number' ? message.dt * 1000 : header.at;
    events.push({ id: template[1], status, at, session });
  }

  for (const line of text.split(/\r?\n/)) {
    const match = HEADER.exec(line);
    if (match) {
      flush();
      const [, y, mo, d, h, mi, s, ms] = match;
      const at = new Date(+y, +mo - 1, +d, +h, +mi, +s, Number((ms || '0').slice(0, 3))).getTime();
      header = line.includes('Got notification') ? { at } : null;
      body = [];
    } else if (header) {
      body.push(line);
    }
  }
  flush();
  return events;
}

const eventKey = (event) => `${event.id}|${event.status}|${event.at}`;

/** Keys already handed to the renderer, so the watcher only ever sends news. */
const sent = new Set();
let watchTimer = null;
/** Size of each file the watcher has looked at, so an unchanged file is skipped. */
const watchedSizes = new Map();

async function scan() {
  const { dir, source } = await findLogsDir();
  if (!dir) return { ok: false, dir: null, source: null, sessions: 0, events: [] };

  const sessions = sessionDirs(dir);
  const events = [];
  for (const session of sessions) {
    for (const file of notificationFiles(path.join(dir, session.name))) {
      events.push(...parseFile(file, session.start));
    }
  }
  events.sort((a, b) => a.at - b.at);
  for (const event of events) sent.add(eventKey(event));

  return {
    ok: true,
    dir,
    source,
    sessions: sessions.length,
    firstSession: sessions[0]?.start ?? null,
    lastSession: sessions[sessions.length - 1]?.start ?? null,
    events,
  };
}

/**
 * Polls the newest session's notification log. Polling rather than fs.watch:
 * the game holds these files open and appends to them, which fs.watch on
 * Windows reports unreliably, and a stat every few seconds costs nothing.
 */
function startWatching(getWindow) {
  if (watchTimer) return;
  watchTimer = setInterval(async () => {
    const { dir } = await findLogsDir();
    if (!dir) return;
    const sessions = sessionDirs(dir);
    const latest = sessions[sessions.length - 1];
    if (!latest) return;

    const fresh = [];
    for (const file of notificationFiles(path.join(dir, latest.name))) {
      let size;
      try { size = fs.statSync(file).size; } catch { continue; }
      if (watchedSizes.get(file) === size) continue;
      watchedSizes.set(file, size);
      for (const event of parseFile(file, latest.start)) {
        const key = eventKey(event);
        if (sent.has(key)) continue;
        sent.add(key);
        fresh.push(event);
      }
    }

    const window = getWindow();
    if (fresh.length > 0 && window && !window.isDestroyed()) {
      window.webContents.send('gamelogs:events', fresh);
    }
  }, POLL_MS);
}

function registerGameLogIpc(getWindow) {
  ipcMain.handle('gamelogs:scan', async () => {
    // An explicit scan always searches afresh; the cache is for the watcher.
    found = { dir: null, source: null };
    lastSearch = 0;
    const result = await scan();
    if (result.ok) startWatching(getWindow);
    return result;
  });

  ipcMain.handle('gamelogs:pick-folder', async () => {
    const window = getWindow();
    const options = {
      title: 'Find the Escape from Tarkov folder',
      message: 'Pick the game folder, or its Logs folder.',
      properties: ['openDirectory'],
    };
    const picked = window && !window.isDestroyed()
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, reason: 'canceled' };

    const dir = normaliseLogsDir(picked.filePaths[0]);
    if (!dir) return { ok: false, reason: 'not-logs' };
    writeKey(STORE_KEY, dir);
    found = { dir, source: 'picked' };
    // A different folder means different files; let the next scan send everything.
    sent.clear();
    watchedSizes.clear();
    return { ok: true, dir };
  });
}

module.exports = { registerGameLogIpc, parseFile, sessionStart };
