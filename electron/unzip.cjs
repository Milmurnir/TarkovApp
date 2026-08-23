'use strict';

/**
 * Minimal zip reader, enough to unpack a UI bundle.
 *
 * Electron ships no unzip and the app has no runtime dependencies, so rather
 * than shelling out to PowerShell (which antivirus tends to dislike coming from
 * a game-adjacent app) the two compression methods a normal zip uses are read
 * directly: stored and deflate, both of which zlib already handles.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The end record is 22 bytes plus a comment of at most 64 KB. */
const MAX_EOCD_SCAN = 22 + 0xffff;

function findEndRecord(buffer) {
  const start = Math.max(0, buffer.length - MAX_EOCD_SCAN);
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error('Not a zip file: no end-of-central-directory record.');
}

/** Entries listed in the central directory, with their file data resolved. */
function readEntries(buffer) {
  const eocd = findEndRecord(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  if (offset === 0xffffffff) throw new Error('Zip64 archives are not supported.');

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('Corrupt zip: bad central directory entry.');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('Zip64 archives are not supported.');
    }
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error('Corrupt zip: bad local file header.');
    }

    // The local header repeats the name and extra lengths, and only its own
    // values locate the data; the central copies can differ.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    entries.push({ name, method, raw });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decompress(entry) {
  if (entry.method === 0) return entry.raw;
  if (entry.method === 8) return zlib.inflateRawSync(entry.raw);
  throw new Error(`Unsupported zip compression method ${entry.method} in ${entry.name}.`);
}

/**
 * Extracts every file into `targetDir`. Entry names are treated as hostile:
 * anything absolute or climbing out of the target is rejected outright.
 */
function extractZip(buffer, targetDir) {
  const root = path.resolve(targetDir);
  const written = [];

  for (const entry of readEntries(buffer)) {
    // Some zip writers (older PowerShell among them) use backslashes.
    const name = entry.name.replace(/\\/g, '/');
    if (name.endsWith('/')) continue;
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
      throw new Error(`Refusing to extract unsafe path: ${entry.name}`);
    }

    const destination = path.join(root, name);
    if (destination !== root && !destination.startsWith(root + path.sep)) {
      throw new Error(`Refusing to extract outside the target: ${entry.name}`);
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, decompress(entry));
    written.push(name);
  }
  return written;
}

module.exports = { extractZip };
