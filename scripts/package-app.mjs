/**
 * Zips the packaged app folder into release/TarkovQuestRouter-win32-x64.zip --
 * a release asset a "needs a reinstall" prompt can actually point at, since
 * ui.zip alone cannot help someone stuck on an older shell.
 *
 * Run it after `npm run dist` (or use `npm run release:app`, which does both).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'release', 'TarkovQuestRouter-win32-x64');
const zipPath = path.join(root, 'release', 'TarkovQuestRouter-win32-x64.zip');

if (!fs.existsSync(path.join(appDir, 'TarkovQuestRouter.exe'))) {
  console.error('No packaged app. Run `npm run dist` first.');
  process.exit(1);
}

fs.rmSync(zipPath, { force: true });

// Compressing the folder itself (not its contents) keeps it as the zip's one
// top-level entry, so extracting gives back the same "keep this folder
// together" shape the README already tells people to run it from.
execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${appDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
], { stdio: 'inherit' });

const size = fs.statSync(zipPath).size;
console.log('');
console.log(`Packed release/TarkovQuestRouter-win32-x64.zip (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log('Attach it to the GitHub release alongside ui.zip -- the update popup');
console.log('links straight to it whenever a release needs a reinstall.');
console.log('');
