/**
 * Packs the built frontend into release/ui.zip, the asset the in-app updater
 * downloads, and prints exactly what to do with it.
 *
 * Run it after `npm run build` (or use `npm run release:ui`, which does both).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractZip } = require('../electron/unzip.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const releaseDir = path.join(root, 'release');
const zipPath = path.join(releaseDir, 'ui.zip');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const shellVersion = Number(pkg.shellVersion) || 1;

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('No dist/index.html. Run `npm run build` first.');
  process.exit(1);
}

fs.mkdirSync(releaseDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

// Node has no zip writer; Compress-Archive is already on every Windows box and
// this only ever runs on the machine doing the release.
execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${dist.replace(/'/g, "''")}/*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
], { stdio: 'inherit' });

// Unpack it with the very reader the app uses, so a bundle can never ship in a
// shape the updater chokes on.
const check = fs.mkdtempSync(path.join(releaseDir, 'ui-verify-'));
try {
  const files = extractZip(fs.readFileSync(zipPath), check);
  if (!fs.existsSync(path.join(check, 'index.html'))) {
    throw new Error('index.html is not at the root of the zip.');
  }
  const size = fs.statSync(zipPath).size;

  console.log('');
  console.log(`Packed ${files.length} files into release/ui.zip (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log('');
  console.log('To publish this update:');
  console.log(`  1. Bump "version" in package.json (currently ${pkg.version}) and re-run this script.`);
  console.log(`  2. Create a GitHub release tagged v${pkg.version}.`);
  console.log('  3. Attach release/ui.zip to it.');
  console.log('  4. Write what changed in the release notes; users see that text in the popup.');
  console.log('');
  console.log(`  Shell version of this build: ${shellVersion}.`);
  console.log('  If this release changed anything under electron/, bump "shellVersion" in');
  console.log(`  package.json, rebuild the installer, and add "requires-shell: ${shellVersion + 1}"`);
  console.log('  to the release notes so existing users are told to reinstall instead.');
  console.log('');
} finally {
  fs.rmSync(check, { recursive: true, force: true });
}
