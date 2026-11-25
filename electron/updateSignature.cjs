'use strict';

/**
 * Signed updates.
 *
 * Every release asset the app installs (ui.zip, the packaged app zip) ships
 * with a `<asset>.sig` next to it: an Ed25519 signature over the asset's name,
 * the release version and the file's SHA-256. The public half of the key is
 * in update-config.json; the private half never leaves the machine that cuts
 * releases (scripts/sign-release.mjs). So a hijacked release, a swapped
 * asset, or an older signed bundle re-uploaded under a newer tag is refused
 * rather than installed.
 *
 * Shared by the updater (verify) and the release script (payload + sign), so
 * the two can never disagree about what is signed.
 */

const crypto = require('crypto');
const fs = require('fs');

const DOMAIN = 'tarkov-quest-router-update-v1';

/** Exactly what gets signed. Binding the name and version stops reuse elsewhere. */
function payload(assetName, version, sha256Hex) {
  return Buffer.from(`${DOMAIN}\n${assetName}\n${String(version).replace(/^[vV]/, '')}\n${sha256Hex}`, 'utf8');
}

function sha256OfBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function sign(privateKeyPem, assetName, version, sha256Hex) {
  return crypto.sign(null, payload(assetName, version, sha256Hex), privateKeyPem).toString('base64');
}

/** Throws unless `signatureText` is a valid signature for this asset, version and hash. */
function verify(publicKeyPem, assetName, version, sha256Hex, signatureText) {
  let ok = false;
  try {
    const signature = Buffer.from(String(signatureText || '').trim(), 'base64');
    ok = signature.length === 64
      && crypto.verify(null, payload(assetName, version, sha256Hex), publicKeyPem, signature);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(`The signature on ${assetName} does not match; refusing the update.`);
}

module.exports = { payload, sha256OfBuffer, sha256OfFile, sign, verify };
