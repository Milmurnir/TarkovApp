import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { requireCjs } from './helpers';

const { extractZip, extractZipAsync } = requireCjs('../electron/unzip.cjs');
const { compareVersions } = requireCjs('../electron/selfUpdate.cjs');

/** A minimal zip: one local header and central entry per file, then the end record. */
function makeZip(files: { name: string; data: string; method?: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const method = file.method ?? 8;
    const raw = Buffer.from(file.data);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(file.name);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tqr-unzip-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));
let n = 0;
const target = () => path.join(work, String(n++));

describe('extractZip', () => {
  const zip = makeZip([
    { name: 'index.html', data: '<!doctype html>' },
    { name: 'assets/', data: '', method: 0 },
    { name: 'assets\\app.js', data: 'console.log(1)'.repeat(50) },
    { name: 'plain.txt', data: 'stored', method: 0 },
  ]);

  it('writes stored and deflated files, folders included', () => {
    const dir = target();
    expect(extractZip(zip, dir)).toEqual(['index.html', 'assets/app.js', 'plain.txt']);
    expect(fs.readFileSync(path.join(dir, 'assets', 'app.js'), 'utf8')).toBe('console.log(1)'.repeat(50));
    expect(fs.readFileSync(path.join(dir, 'plain.txt'), 'utf8')).toBe('stored');
  });

  it('does the same off the main thread', async () => {
    const dir = target();
    expect(await extractZipAsync(zip, dir)).toEqual(['index.html', 'assets/app.js', 'plain.txt']);
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('<!doctype html>');
  });

  it.each(['../evil.txt', 'a/../../evil.txt', '/etc/evil', 'C:/evil.txt', '..\\evil.txt'])(
    'refuses to write outside the target: %s',
    (name) => {
      const dir = target();
      expect(() => extractZip(makeZip([{ name, data: 'x' }]), dir)).toThrow(/Refusing/);
      expect(fs.existsSync(path.join(work, 'evil.txt'))).toBe(false);
    },
  );

  it('rejects what is not a zip', () => {
    expect(() => extractZip(Buffer.from('definitely not a zip, just some text here'), target())).toThrow(/Not a zip/);
  });
});

describe('compareVersions', () => {
  it.each([
    ['0.13.0', '0.12.9', 1],
    ['0.9.0', '0.10.0', -1],
    ['v1.2.3', '1.2.3', 0],
    ['1.2', '1.2.0', 0],
    ['1.2.10', '1.2.9', 1],
    [undefined, '0.0.1', -1],
  ])('%s vs %s is %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});
