'use strict';

/**
 * In-app updates for the frontend bundle.
 *
 * The whole app is an Electron shell around a local server that serves the
 * built frontend, so almost every fix lives in that bundle. Publishing a GitHub
 * release with a `ui.zip` asset is therefore enough to update users: the app
 * downloads the bundle into its user-data folder and serves that instead of the
 * one it shipped with. No installer, no signing, ~1 MB per update.
 *
 * What this cannot update is the shell itself (main process, local server,
 * preload). A release that needs a newer shell says so with a `requires-shell:`
 * line in its notes, and the app then asks the user to reinstall rather than
 * pretending an update will do.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, ipcMain, shell } = require('electron');
const { extractZip } = require('./unzip.cjs');

const config = require('./update-config.json');
const appPackage = require('../package.json');

/** Bumped whenever a change needs a real reinstall, not just a new bundle. */
const SHELL_VERSION = Number(appPackage.shellVersion) || 1;

const USER_AGENT = `TarkovQuestRouter/${app.getVersion()} (desktop app)`;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** Only these hosts are ever downloaded from. */
const ALLOWED_HOSTS = new Set([
  'api.github.com', 'github.com', 'objects.githubusercontent.com',
  'release-assets.githubusercontent.com', 'codeload.github.com',
]);

const uiDir = () => path.join(app.getPath('userData'), 'ui');
const statePath = () => path.join(uiDir(), 'state.json');

/** The update the last check found, so the renderer never supplies a URL. */
let pending = null;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
}

/** Numeric dot-separated compare; anything unparsable sorts as 0. */
function compareVersions(a, b) {
  const parse = (v) => String(v ?? '').replace(/^[vV]/, '').split(/[.-]/).map((n) => Number(n) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The frontend actually in use: a downloaded bundle when it is newer than the
 * one packaged into this build, otherwise the packaged one. Comparing against
 * the app version means a fresh install always wins over a stale download.
 */
function currentUiVersion() {
  const state = readState();
  if (state && state.version && compareVersions(state.version, app.getVersion()) > 0) {
    return state.version;
  }
  return app.getVersion();
}

function getUiRoot(bundledDir) {
  const state = readState();
  if (!state || !state.version || !state.dir) return bundledDir;
  if (compareVersions(state.version, app.getVersion()) <= 0) return bundledDir;
  // A half-extracted or hand-deleted folder must never break startup.
  if (!fs.existsSync(path.join(state.dir, 'index.html'))) return bundledDir;
  return state.dir;
}

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      reject(new Error(`Refusing to fetch from ${target.hostname}.`));
      return;
    }

    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('Too many redirects while downloading the update.'));
          return;
        }
        resolve(request(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        const error = new Error(`GitHub returned ${status}.`);
        error.status = status;
        reject(error);
        return;
      }
      resolve(response);
    });

    req.on('error', (error) => reject(new Error(`Could not reach GitHub: ${error.message}`)));
    req.setTimeout(30000, () => req.destroy(new Error('GitHub timed out.')));
  });
}

function readBody(response, onProgress) {
  return new Promise((resolve, reject) => {
    const total = Number(response.headers['content-length']) || 0;
    const chunks = [];
    let received = 0;

    response.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BUNDLE_BYTES) {
        response.destroy();
        reject(new Error('The update is larger than expected; refusing it.'));
        return;
      }
      chunks.push(chunk);
      if (onProgress) onProgress(received, total);
    });
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', reject);
  });
}

/** `requires-shell: 2` anywhere in the release notes, if present. */
function requiredShell(notes) {
  const match = /requires-shell:\s*(\d+)/i.exec(notes || '');
  return match ? Number(match[1]) : 1;
}

/** Release notes with the machine-readable markers stripped out. */
function cleanNotes(notes) {
  return String(notes || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*requires-shell:/i.test(line))
    .join('\n')
    .trim();
}

async function checkForUpdate() {
  if (!config.repo) {
    return { configured: false, available: false, currentVersion: currentUiVersion() };
  }

  let response;
  try {
    response = await request(`https://api.github.com/repos/${config.repo}/releases/latest`);
  } catch (error) {
    // A repo with no releases yet answers 404. That is a normal state before the
    // first publish, not something to alarm the user about.
    if (error.status === 404) {
      return { configured: true, available: false, noReleases: true, currentVersion: currentUiVersion() };
    }
    throw error;
  }
  const release = JSON.parse((await readBody(response)).toString('utf8'));

  const version = String(release.tag_name || '').replace(/^[vV]/, '');
  const asset = (release.assets || []).find((a) => a.name === config.asset);
  const notes = cleanNotes(release.body);
  const needsShell = requiredShell(release.body);
  const current = currentUiVersion();
  const newer = version !== '' && compareVersions(version, current) > 0;

  pending = newer && asset ? { version, url: asset.browser_download_url } : null;

  return {
    configured: true,
    available: newer,
    // A newer shell cannot be delivered as a bundle: the user has to reinstall.
    requiresReinstall: newer && (needsShell > SHELL_VERSION || !asset),
    version,
    currentVersion: current,
    notes,
    size: asset ? asset.size : 0,
    releaseUrl: release.html_url || `https://github.com/${config.repo}/releases/latest`,
  };
}

/** Removes every downloaded bundle except the one just installed. */
function pruneOldBundles(keep) {
  for (const entry of fs.readdirSync(uiDir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keep) continue;
    fs.rmSync(path.join(uiDir(), entry.name), { recursive: true, force: true });
  }
}

async function downloadUpdate(onProgress) {
  if (!pending) throw new Error('No update is ready to install. Check again first.');

  const response = await request(pending.url);
  const archive = await readBody(response, onProgress);

  fs.mkdirSync(uiDir(), { recursive: true });
  const staging = path.join(uiDir(), `${pending.version}.part`);
  const target = path.join(uiDir(), pending.version);

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  try {
    extractZip(archive, staging);
    if (!fs.existsSync(path.join(staging, 'index.html'))) {
      throw new Error('The downloaded bundle has no index.html; it is not a UI build.');
    }

    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  fs.writeFileSync(
    statePath(),
    JSON.stringify({ version: pending.version, dir: target, installedAt: Date.now() }, null, 2),
  );
  pruneOldBundles(pending.version);

  const version = pending.version;
  pending = null;
  return { installed: true, version };
}

/** Wires the renderer-facing channels. Call once, before the window is created. */
function registerUpdateIpc(getWindow) {
  ipcMain.handle('update:info', () => ({
    configured: Boolean(config.repo),
    appVersion: app.getVersion(),
    uiVersion: currentUiVersion(),
    checkOnStartup: config.checkOnStartup !== false,
  }));

  ipcMain.handle('update:check', async () => {
    try {
      return await checkForUpdate();
    } catch (error) {
      return { configured: Boolean(config.repo), available: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      return await downloadUpdate((received, total) => {
        const window = getWindow();
        if (window && !window.isDestroyed()) {
          window.webContents.send('update:progress', { received, total });
        }
      });
    } catch (error) {
      return { installed: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle('update:restart', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('update:open-release', async (_event, url) => {
    // Only ever the release page the last check reported.
    if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) await shell.openExternal(url);
  });
}

module.exports = { getUiRoot, registerUpdateIpc, currentUiVersion, compareVersions, SHELL_VERSION };
