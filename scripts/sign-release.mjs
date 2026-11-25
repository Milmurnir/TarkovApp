/**
 * Signs the release assets so the app will install them (electron/updateSignature.cjs).
 *
 *   node scripts/sign-release.mjs          signs release/ui.zip and the app zip, whichever exist
 *   node scripts/sign-release.mjs ui.zip   signs only the named asset(s)
 *   node scripts/sign-release.mjs --init   makes the signing key, once per release machine
 *
 * The private key lives outside the repo, in ~/.tarkov-quest-router/ (or
 * wherever TQR_SIGNING_KEY points). Back it up: without it no app that
 * trusts its public key will take another update, short of a reinstall.
 *
 * Attach each `<asset>.sig` to the GitHub release next to its asset.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const signature = require('../electron/updateSignature.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = process.env.TQR_SIGNING_KEY
  || path.join(os.homedir(), '.tarkov-quest-router', 'update-signing-key.pem');
const configPath = path.join(root, 'electron', 'update-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (process.argv.includes('--init')) {
  if (fs.existsSync(keyPath)) {
    console.error(`A signing key already exists at ${keyPath}; refusing to replace it.`);
    process.exit(1);
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  config.publicKey = publicKey.export({ type: 'spki', format: 'pem' }).trim();
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Signing key written to ${keyPath} -- back it up somewhere safe.`);
  console.log('Its public half is now in electron/update-config.json.');
  process.exit(0);
}

if (!fs.existsSync(keyPath)) {
  console.error(`No signing key at ${keyPath}. Run \`node scripts/sign-release.mjs --init\` once.`);
  process.exit(1);
}
if (!config.publicKey) {
  console.error('electron/update-config.json has no publicKey; the app would not check signatures.');
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, 'utf8');
// Naming the asset matters in the release scripts: signing whatever zip is
// lying in release/ would stamp a stale one from an earlier build with this
// version, and the app would then accept it.
const named = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const known = [config.asset, config.appAsset].filter(Boolean);
const unknown = named.filter((name) => !known.includes(name));
if (unknown.length > 0) {
  console.error(`Not a release asset: ${unknown.join(', ')} (expected ${known.join(' or ')}).`);
  process.exit(1);
}
const assets = named.length > 0 ? named : known;
let signed = 0;

for (const name of assets) {
  const file = path.join(root, 'release', name);
  if (!fs.existsSync(file)) continue;
  const hash = await signature.sha256OfFile(file);
  const sig = signature.sign(privateKey, name, pkg.version, hash);
  // Checked against the key the app actually ships with, so a mismatched key
  // fails here rather than on every player's machine.
  signature.verify(config.publicKey, name, pkg.version, hash, sig);
  fs.writeFileSync(`${file}.sig`, `${sig}\n`);
  console.log(`Signed release/${name} for v${pkg.version} -> release/${name}.sig`);
  signed += 1;
}

if (signed === 0) {
  console.error('Nothing to sign: build release/ui.zip or the app zip first.');
  process.exit(1);
}
