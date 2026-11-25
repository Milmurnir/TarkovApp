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
 * A release that needs a newer shell (main process, local server, preload)
 * says so with a `requires-shell:` line in its notes. Since shellVersion 6 the
 * app then downloads the release's packaged app instead and swaps itself out
 * on the next restart (selfUpdate.cjs). Only when that cannot work -- running
 * from source, no app zip attached, or a swap that already failed once -- does
 * it fall back to asking the user to reinstall.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, ipcMain, shell } = require('electron');
const { extractZip, extractZipAsync } = require('./unzip.cjs');
const selfUpdate = require('./selfUpdate.cjs');
const signature = require('./updateSignature.cjs');

const config = require('./update-config.json');
const appPackage = require('../package.json');

/** Bumped whenever a change needs a real reinstall, not just a new bundle. */
const SHELL_VERSION = Number(appPackage.shellVersion) || 1;

const USER_AGENT = `TarkovQuestRouter/${app.getVersion()} (desktop app)`;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
/** The packaged app is ~140 MB zipped; anything far past that is not ours. */
const MAX_APP_BYTES = 600 * 1024 * 1024;
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
/** A whole-app update the last check found, when this build can install it itself. */
let pendingApp = null;
/** Downloads already running, so a second click or check joins them instead of racing. */
let uiDownload = null;
let appDownload = null;

/** The `<asset>.sig` attached next to an asset, if any. */
function signatureAsset(release, asset) {
  return asset ? (release.assets || []).find((a) => a.name === `${asset.name}.sig`) || null : null;
}

/** Fetches and checks an asset's signature; a build with no publicKey configured skips this. */
async function checkSignature(assetName, version, sigUrl, sha256Hex) {
  if (!config.publicKey) return;
  if (!sigUrl) throw new Error(`${assetName} in v${version} is not signed; refusing the update.`);
  const text = (await readBody(await request(sigUrl))).toString('utf8');
  signature.verify(config.publicKey, assetName, version, sha256Hex, text);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
}

const { compareVersions } = selfUpdate;

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
  // The packaged app itself, when a release attaches one -- the only thing a
  // "reinstall" prompt can actually point at, since ui.zip alone cannot help.
  const appAsset = config.appAsset && (release.assets || []).find((a) => a.name === config.appAsset);
  const notes = cleanNotes(release.body);
  const needsShell = requiredShell(release.body);
  const current = currentUiVersion();
  const newer = version !== '' && compareVersions(version, current) > 0;

  const assetSig = signatureAsset(release, asset);
  const appSig = signatureAsset(release, appAsset);
  // Never swap the target of a download that is already running.
  if (!uiDownload) {
    pending = newer && asset
      ? { version, name: asset.name, url: asset.browser_download_url, sigUrl: assetSig && assetSig.browser_download_url }
      : null;
  }

  const needsNewShell = newer && (needsShell > SHELL_VERSION || !asset);
  // Installed by swapping the whole app on restart -- unless this is not a
  // packaged build, or this exact version already failed to swap in once.
  if (!appDownload) {
    pendingApp = needsNewShell && appAsset && selfUpdate.canSelfUpdate() && selfUpdate.failedVersion() !== version
      ? {
        version,
        name: appAsset.name,
        url: appAsset.browser_download_url,
        sigUrl: appSig && appSig.browser_download_url,
        size: appAsset.size,
      }
      : null;
  }
  const staged = selfUpdate.stagedUpdate();

  return {
    configured: true,
    available: newer,
    // A newer shell cannot be delivered as a bundle: the user has to reinstall.
    requiresReinstall: needsNewShell,
    /** The new shell can be downloaded and swapped in by the app itself. */
    canSelfUpdate: Boolean(pendingApp),
    /** That swap is already downloaded and waits only for a restart. */
    selfUpdateStaged: Boolean(staged && staged.version === version),
    version,
    currentVersion: current,
    notes,
    size: asset ? asset.size : 0,
    releaseUrl: release.html_url || `https://github.com/${config.repo}/releases/latest`,
    appAssetUrl: appAsset ? appAsset.browser_download_url : null,
    appAssetSize: appAsset ? appAsset.size : 0,
  };
}

/** Removes every downloaded bundle except the one just installed. */
function pruneOldBundles(keep) {
  for (const entry of fs.readdirSync(uiDir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keep) continue;
    fs.rmSync(path.join(uiDir(), entry.name), { recursive: true, force: true });
  }
}

function downloadUpdate(onProgress) {
  if (!uiDownload) {
    uiDownload = installUiUpdate(onProgress).finally(() => { uiDownload = null; });
  }
  return uiDownload;
}

async function installUiUpdate(onProgress) {
  // Taken once: a check finishing mid-download must not change what this installs.
  const update = pending;
  if (!update) throw new Error('No update is ready to install. Check again first.');

  const response = await request(update.url);
  const archive = await readBody(response, onProgress);
  await checkSignature(update.name, update.version, update.sigUrl, signature.sha256OfBuffer(archive));

  fs.mkdirSync(uiDir(), { recursive: true });
  const staging = path.join(uiDir(), `${update.version}.part`);
  const target = path.join(uiDir(), update.version);

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
    JSON.stringify({ version: update.version, dir: target, installedAt: Date.now() }, null, 2),
  );
  pruneOldBundles(update.version);

  if (pending === update) pending = null;
  return { installed: true, version: update.version };
}

/** Streams a download to disk, so a 140 MB app zip never sits in memory twice. */
async function downloadToFile(url, file, onProgress) {
  const response = await request(url);
  const total = Number(response.headers['content-length']) || 0;
  if (total > MAX_APP_BYTES) {
    response.destroy();
    throw new Error('The update is larger than expected; refusing it.');
  }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let received = 0;
    response.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_APP_BYTES) {
        response.destroy(new Error('The update is larger than expected; refusing it.'));
        return;
      }
      if (onProgress) onProgress(received, total);
    });
    response.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    response.pipe(out);
  });
}

/** The packaged exe inside an unpacked app zip: at its top level, or one folder down. */
function findExe(dir, exeName) {
  if (fs.existsSync(path.join(dir, exeName))) return path.join(dir, exeName);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name, exeName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Downloads and unpacks the release's whole app into userData/app-update, ready
 * to be swapped in on the next restart. Nothing about the running app changes.
 */
function downloadAppUpdate(onProgress) {
  if (!appDownload) {
    appDownload = installAppUpdate(onProgress).finally(() => { appDownload = null; });
  }
  return appDownload;
}

async function installAppUpdate(onProgress) {
  const update = pendingApp;
  if (!update) throw new Error('No app update is ready to install. Check again first.');
  const { version, url } = update;
  const root = selfUpdate.updateRoot();
  const zipFile = path.join(root, `${version}.zip`);
  const staging = path.join(root, `${version}.part`);
  const target = path.join(root, version);
  const exeName = path.basename(process.execPath);

  selfUpdate.withoutAsar(() => {
    fs.mkdirSync(root, { recursive: true });
    fs.rmSync(staging, { recursive: true, force: true });
  });

  try {
    await downloadToFile(url, zipFile, onProgress);
    await checkSignature(update.name, version, update.sigUrl, await signature.sha256OfFile(zipFile));
    const archive = await fs.promises.readFile(zipFile);
    // Async so the app stays responsive while ~350 MB is written. Writing a
    // new app.asar needs no noAsar; only the sync rm/rename below, which would
    // otherwise look inside it, do -- and noAsar must never stay on across an
    // await, since the local server reads the UI out of this build's own asar.
    await fs.promises.mkdir(staging, { recursive: true });
    await extractZipAsync(archive, staging);
    if (!findExe(staging, exeName)) throw new Error(`The download has no ${exeName}; it is not an app build.`);
    selfUpdate.withoutAsar(() => {
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
    });
  } catch (error) {
    selfUpdate.withoutAsar(() => fs.rmSync(staging, { recursive: true, force: true }));
    throw error;
  } finally {
    fs.rmSync(zipFile, { force: true });
  }

  selfUpdate.writeReady({ version, exe: findExe(target, exeName), stagedAt: Date.now() });
  if (pendingApp === update) pendingApp = null;
  return { installed: true, version, restartRequired: true };
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

  ipcMain.handle('update:download-app', async () => {
    try {
      return await downloadAppUpdate((received, total) => {
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
    // A staged whole-app update is applied by the new copy, which also starts
    // the app again afterwards; otherwise an ordinary relaunch picks up a
    // downloaded UI bundle.
    const staged = selfUpdate.stagedUpdate();
    if (staged) {
      selfUpdate.handOff(staged);
      return;
    }
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('update:open-release', async (_event, url) => {
    // Only ever the release page the last check reported.
    if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) await shell.openExternal(url);
  });
}

// checkForUpdate and downloadUpdate are exported for the updater test harness only.
module.exports = {
  getUiRoot, registerUpdateIpc, currentUiVersion, compareVersions, SHELL_VERSION, checkForUpdate, downloadUpdate,
};
