'use strict';

/**
 * Replacing the whole app, not just its UI bundle.
 *
 * A running Windows app cannot overwrite its own exe and DLLs, so the swap is
 * done by the *new* copy: the updater (updater.cjs) downloads and unpacks the
 * release's packaged app into userData/app-update/<version>/, and on restart
 * this hands off to that unpacked exe with `--finish-update`. The new copy
 * waits for the old process to exit, copies itself over the install folder,
 * and starts the app from there. All plain Node -- no PowerShell, for the same
 * antivirus reason unzip.cjs exists.
 *
 * A failed swap is recorded in ready.json and never retried automatically, so
 * a read-only install folder cannot turn into a restart loop; the update popup
 * then falls back to the manual download.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, dialog } = require('electron');

const FINISH_FLAG = '--finish-update=';
const PID_FLAG = '--wait-pid=';
/** Old processes (renderer, GPU) can hold the exe for a moment after the main one exits. */
const COPY_ATTEMPTS = 60;
/**
 * Hand-offs allowed per staged version. If the new copy dies before it can
 * even record a failure, this is what stops every launch from handing off and
 * exiting again -- the app opens normally and offers the manual download.
 */
const MAX_HANDOFFS = 2;

const updateRoot = () => path.join(app.getPath('userData'), 'app-update');
const readyPath = () => path.join(updateRoot(), 'ready.json');

/** Numeric dot-separated compare; anything unparsable sorts as 0. Shared with updater.cjs. */
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
 * Electron's fs treats *.asar files as folders. Copying or unpacking a
 * packaged app has to see app.asar as the plain file it is.
 */
function withoutAsar(work) {
  const previous = process.noAsar;
  process.noAsar = true;
  try {
    return work();
  } finally {
    process.noAsar = previous;
  }
}

function readReady() {
  try {
    return JSON.parse(fs.readFileSync(readyPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeReady(ready) {
  fs.mkdirSync(updateRoot(), { recursive: true });
  fs.writeFileSync(readyPath(), JSON.stringify(ready, null, 2));
}

/** Whole-app updates only make sense for the packaged Windows build. */
function canSelfUpdate() {
  return app.isPackaged && process.platform === 'win32';
}

/** The staged update to apply, if there is one newer than this build that has not already failed. */
function stagedUpdate() {
  const ready = readReady();
  if (!ready || !ready.version || !ready.exe || ready.failed) return null;
  if ((ready.handoffs || 0) >= MAX_HANDOFFS) return null;
  if (compareVersions(ready.version, app.getVersion()) <= 0) return null;
  if (!fs.existsSync(ready.exe)) return null;
  return ready;
}

/** A staged version that already failed to install, so the updater offers the manual route instead. */
function failedVersion() {
  const ready = readReady();
  return ready && (ready.failed || (ready.handoffs || 0) >= MAX_HANDOFFS) ? ready.version : null;
}

/** Starts the staged exe to do the swap, then exits so it can. */
function handOff(ready) {
  const installDir = path.dirname(process.execPath);
  writeReady({ ...ready, handoffs: (ready.handoffs || 0) + 1 });
  spawn(ready.exe, [`${FINISH_FLAG}${installDir}`, `${PID_FLAG}${process.pid}`], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(ready.exe),
  }).unref();
  app.exit(0);
}

/** Leftovers from an update that is installed (or superseded) now. Never blocks startup. */
function cleanUpLater() {
  if (!canSelfUpdate() || stagedUpdate()) return;
  setTimeout(() => {
    const failed = failedVersion();
    // A failure is kept so it is not retried; everything else is done with.
    if (failed && compareVersions(failed, app.getVersion()) > 0) {
      // ...but its unpacked copy is 400 MB of nothing now.
      try {
        withoutAsar(() => {
          for (const entry of fs.readdirSync(updateRoot(), { withFileTypes: true })) {
            if (entry.isDirectory()) fs.rmSync(path.join(updateRoot(), entry.name), { recursive: true, force: true });
          }
        });
      } catch {
        // Tried again on a later start.
      }
      return;
    }
    try {
      withoutAsar(() => fs.rmSync(updateRoot(), { recursive: true, force: true }));
    } catch {
      // A locked file just means it goes on a later start.
    }
  }, 15000);
}

function argValue(prefix) {
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function finish(installDir, pid) {
  const source = path.dirname(process.execPath);
  const exeName = path.basename(process.execPath);

  // Only ever overwrite a folder that is already this app.
  if (!fs.existsSync(path.join(installDir, exeName))) {
    throw new Error(`${installDir} does not look like the app's folder.`);
  }

  for (let i = 0; i < 60 && pid && isRunning(pid); i++) await sleep(500);

  // All or nothing: the old folder is moved aside whole (which only succeeds
  // once nothing holds its files), the new one copied into the now-empty
  // path, and on any failure the old one moved straight back. A half-copied
  // mix of two versions is never left behind.
  const backup = `${installDir}.old-${Date.now()}`;
  let lastError = null;
  let moved = false;
  for (let attempt = 0; attempt < COPY_ATTEMPTS && !moved; attempt++) {
    try {
      withoutAsar(() => fs.renameSync(installDir, backup));
      moved = true;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) break;
      await sleep(1000);
    }
  }
  if (!moved) throw lastError || new Error('The app folder stayed in use.');

  try {
    withoutAsar(() => fs.cpSync(source, installDir, { recursive: true }));
  } catch (error) {
    withoutAsar(() => {
      fs.rmSync(installDir, { recursive: true, force: true });
      fs.renameSync(backup, installDir);
    });
    throw error;
  }

  try {
    withoutAsar(() => fs.rmSync(backup, { recursive: true, force: true }));
  } catch {
    // Harmless leftover next to the app; nothing reads it.
  }
}

/**
 * Call first thing in main.cjs. Returns true when this process was started to
 * finish an update -- the caller must then do nothing else.
 */
function finishUpdateIfAsked() {
  const installDir = argValue(FINISH_FLAG);
  if (!installDir) return false;
  const pid = Number(argValue(PID_FLAG)) || 0;

  // Tests set this so a successful swap does not open the app.
  const relaunch = process.env.TQR_UPDATE_NO_RELAUNCH !== '1';

  finish(installDir, pid)
    .then(() => {
      if (!relaunch) { app.exit(0); return; }
      spawn(path.join(installDir, path.basename(process.execPath)), [], {
        detached: true, stdio: 'ignore', cwd: installDir,
      }).unref();
      app.exit(0);
    })
    .catch(async (error) => {
      const ready = readReady() || { version: app.getVersion() };
      writeReady({ ...ready, failed: String(error && error.message || error) });
      if (!relaunch) { app.exit(1); return; }
      await app.whenReady();
      dialog.showErrorBox(
        'Update could not be installed',
        `The new version could not replace the old one:\n\n${error && error.message || error}\n\n`
        + 'The app will start as it was. Use "Download app" in the update popup to install it by hand.',
      );
      spawn(path.join(installDir, path.basename(process.execPath)), [], {
        detached: true, stdio: 'ignore', cwd: installDir,
      }).unref();
      app.exit(0);
    });
  return true;
}

module.exports = {
  canSelfUpdate, stagedUpdate, failedVersion, handOff, cleanUpLater, finishUpdateIfAsked,
  writeReady, withoutAsar, updateRoot, compareVersions,
};
