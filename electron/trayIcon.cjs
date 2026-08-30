'use strict';

/**
 * A small solid-colour disc, hand-encoded as a PNG so the tray icon needs no
 * bundled asset file. Electron's `nativeImage` only reads raster formats (no
 * SVG), and this is the least ceremony that produces one from a few lines of
 * colour: raw RGBA scanlines, deflated, wrapped in the three PNG chunks that
 * matter (IHDR/IDAT/IEND). Verified against an independent chunk/CRC parser
 * during development; not something to hand-edit without re-checking that.
 */

const zlib = require('zlib');
const { nativeImage } = require('electron');

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = buildCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** `size`x`size` RGBA PNG: a filled circle of `hexColor` on a transparent field. */
function circlePng(size, hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  const center = (size - 1) / 2;
  const radius = size / 2 - 1;
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // scanline filter: none
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const inside = dx * dx + dy * dy <= radius * radius;
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = inside ? 255 : 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The tray icon: the app's accent green, plain enough to read at 16px. */
function createTrayIcon() {
  return nativeImage.createFromBuffer(circlePng(32, '#4ade80'));
}

module.exports = { createTrayIcon };
