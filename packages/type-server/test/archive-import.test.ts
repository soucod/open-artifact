/**
 * Importing an artifact archive: what `archive` writes comes back byte for byte (a `project/` type and a `db/` type),
 * and a zip from someone else that is not exactly that shape is refused without leaving anything on disk.
 */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { archiveEntries, archiveKeeps, crc32, importArchive, writeZip } from '../src/archive.ts';
import { HttpError } from '../src/http.ts';
import { contentDirOf, TYPES, type TypeName } from '../src/types.ts';

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'open-artifact-import-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFiles(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, ...path.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

/** A new artifact folder of `type`, as `open` scaffolds it, with `.artifact.json` and `extra` files. */
async function scaffold(name: string, type: TypeName, extra: Record<string, string | Uint8Array>): Promise<string> {
  const root = join(dir, name);
  const content = contentDirOf(type);
  const files: Record<string, string | Uint8Array> = {};
  for (const [path, text] of Object.entries(TYPES[type].scaffold(name, join(root, content)))) files[`${content}/${path}`] = text;
  await writeFiles(root, { ...files, '.artifact.json': `${JSON.stringify({ type, id: `art_${name.toLowerCase()}`, release: null }, null, 2)}\n`, ...extra });
  return root;
}

/** The zip `archive` writes of a folder. */
async function zipOf(root: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await writeZip(await archiveEntries(root), async (chunk) => void chunks.push(chunk));
  return Buffer.concat(chunks);
}

/** Every file under a folder: path -> bytes. */
async function tree(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const walk = async (folder: string, rel: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(folder, entry.name), path);
      else out.set(path, await readFile(join(folder, entry.name)));
    }
  };
  await walk(root, '');
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

interface Raw {
  name: string;
  data?: Buffer;
  /** Bytes stored in the zip (default: `data`, or `data` deflated when `method` is 8). */
  packed?: Buffer;
  method?: number;
  madeBy?: number;
  attributes?: number;
  flags?: number;
  size?: number;
}

/** A zip written by hand, so every field can lie. Defaults are what `writeZip` writes: Unix host, a 0644 regular file, UTF-8 names, stored. */
function buildZip(entries: Raw[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const raw of entries) {
    const data = raw.data ?? Buffer.alloc(0);
    const method = raw.method ?? 0;
    const packed = raw.packed ?? (method === 8 ? deflateRawSync(data) : data);
    const name = Buffer.from(raw.name, 'utf8');
    const flags = raw.flags ?? 1 << 11;
    const size = raw.size ?? data.length;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(raw.madeBy ?? (3 << 8) | 20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(raw.attributes ?? ((0o100644 << 16) >>> 0), 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    parts.push(local, name, packed);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** A minimal Design artifact under `A/`, plus `extra`. */
function hostile(...extra: Raw[]): Buffer {
  return buildZip([
    { name: 'A/.artifact.json', data: Buffer.from('{"type":"design","id":"art_a","release":null}\n') },
    { name: 'A/project/canvas.json', data: Buffer.from('{"v":1}\n') },
    ...extra,
  ]);
}

let case_ = 0;

/** Imports into a fresh parent folder and expects `code`; the parent must be empty afterwards. */
async function refused(bytes: Uint8Array, code: string, pattern?: RegExp, limits?: Parameters<typeof importArchive>[2]): Promise<void> {
  const parent = join(dir, `refused-${case_++}`);
  await mkdir(parent);
  await assert.rejects(importArchive(bytes, join(parent, 'out'), limits), (error: unknown) => {
    assert.ok(error instanceof HttpError, String(error));
    assert.equal(error.code, code, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
  assert.deepEqual(await readdir(parent), []);
}

describe('importArchive', () => {
  it('brings back what archive wrote, byte for byte, for a project/ type and a db/ type', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
    const design = await scaffold('Poster', 'design', {
      'project/index.html': '<h1>Poster</h1>\n'.repeat(200),
      'project/assets/logo.svg': '<svg/>',
      'project/deep/er/still.txt': 'x',
      '_blobs/0123456789abcdef0123456789abcdef.png': png,
      'comments.json': '{"v":1,"threads":[]}',
      'history/0001.json': '{}',
      '.gitignore': '_agent/\n',
      'doc/.sessions.json': '[]',
      'empty.txt': '',
      'naïve 名前.txt': 'unicode',
      // Left out by the export, so not expected back:
      '_agent/inbox.json': '[]',
      '.sharing.json': '{}',
      '.DS_Store': 'x',
      'project/.env': 'SECRET=1',
      'project/node_modules/x/index.js': '',
      '_blobs/x.tmp': 'partial',
    });
    await symlink('/etc/passwd', join(design, 'project', 'link'));
    const board = await scaffold('Board', 'whiteboard', { 'db/board/elements/n1.json': '{"kind":"note"}', 'comments.json': '{"v":1,"threads":[]}' });

    for (const [root, type] of [[design, 'design'], [board, 'whiteboard']] as const) {
      const zip = await zipOf(root);
      const dest = join(dir, 'imported', type);
      const result = await importArchive(zip, dest);
      assert.equal(result.type, type);
      assert.equal(result.root, dest);
      const expected = new Map<string, Buffer>();
      for (const entry of await archiveEntries(root)) expected.set(entry.name.slice(entry.name.indexOf('/') + 1), await readFile(entry.file));
      const got = await tree(dest);
      assert.deepEqual([...got.keys()], [...new Map([...expected].sort(([a], [b]) => (a < b ? -1 : 1))).keys()]);
      for (const [path, bytes] of expected) assert.ok(got.get(path)!.equals(bytes), path);
      assert.equal(result.files, expected.size);
      assert.equal(result.bytes, [...expected.values()].reduce((sum, bytes) => sum + bytes.length, 0));
      assert.ok(!got.has('_agent/inbox.json') && !got.has('.sharing.json') && !got.has('project/link'));
      assert.deepEqual((await readdir(dirname(dest))).filter((name) => name.endsWith('.tmp')), []);
    }
    const poster = await tree(join(dir, 'imported', 'design'));
    assert.ok(poster.has('doc/.sessions.json') && poster.has('.gitignore') && poster.has('naïve 名前.txt') && poster.has('empty.txt'));
  });

  it('writes the given id into .artifact.json, keeping its shape', async () => {
    const root = await scaffold('Deck', 'slides', {});
    const dest = join(dir, 'with-id');
    const result = await importArchive(await zipOf(root), dest, { id: 'art_fresh' });
    assert.equal(result.type, 'slides');
    assert.deepEqual(JSON.parse(await readFile(join(dest, '.artifact.json'), 'utf8')), { type: 'slides', id: 'art_fresh', release: null });

    // An archive without a marker gets one.
    const bare = buildZip([{ name: 'B/project/canvas.json', data: Buffer.from('{}') }]);
    const made = join(dir, 'with-id-bare');
    assert.equal((await importArchive(bare, made, { id: 'art_b' })).type, 'design');
    assert.equal(await readFile(join(made, '.artifact.json'), 'utf8'), `${JSON.stringify({ type: 'design', id: 'art_b', release: null }, null, 2)}\n`);
  });

  it('accepts the hand-built baseline, so each refusal below is down to its one flaw', async () => {
    const dest = join(dir, 'baseline');
    assert.equal((await importArchive(hostile({ name: 'A/project/a.txt', data: Buffer.from('hi'.repeat(50)), method: 8 }), dest)).files, 3);
    assert.equal(await readFile(join(dest, 'project', 'a.txt'), 'utf8'), 'hi'.repeat(50));
  });

  it('refuses paths that leave the folder or are not plain', async () => {
    await refused(hostile({ name: 'A/../evil.txt', data: Buffer.from('x') }), 'invalid_archive', /climbs out/);
    await refused(hostile({ name: 'A/project/../../evil.txt', data: Buffer.from('x') }), 'invalid_archive', /climbs out/);
    await refused(hostile({ name: '/etc/evil', data: Buffer.from('x') }), 'invalid_archive', /absolute/);
    await refused(hostile({ name: 'C:/evil', data: Buffer.from('x') }), 'invalid_archive', /absolute/);
    await refused(hostile({ name: 'A/project\\..\\..\\evil', data: Buffer.from('x') }), 'invalid_archive', /backslash/);
    await refused(hostile({ name: 'A/project/a\0b', data: Buffer.from('x') }), 'invalid_archive', /NUL/);
    await refused(hostile({ name: 'A//project/x', data: Buffer.from('x') }), 'invalid_archive', /empty/);
    await refused(hostile({ name: 'A/./project/x', data: Buffer.from('x') }), 'invalid_archive', /empty/);
  });

  it('refuses symbolic links, folders and entries from other systems', async () => {
    await refused(hostile({ name: 'A/project/link', data: Buffer.from('/etc/passwd'), attributes: (0o120777 << 16) >>> 0 }), 'invalid_archive', /regular file/);
    await refused(hostile({ name: 'A/project/dir/', attributes: (0o040755 << 16) >>> 0 }), 'invalid_archive', /regular file/);
    await refused(hostile({ name: 'A/project/fifo', attributes: (0o010644 << 16) >>> 0 }), 'invalid_archive', /regular file/);
    await refused(hostile({ name: 'A/project/dos.txt', data: Buffer.from('x'), madeBy: 20, attributes: 0 }), 'invalid_archive', /regular file/);
    await refused(hostile({ name: 'A/project/none.txt', data: Buffer.from('x'), attributes: 0 }), 'invalid_archive', /regular file/);
  });

  it('refuses encrypted entries and unknown methods', async () => {
    await refused(hostile({ name: 'A/project/secret.txt', data: Buffer.from('x'), flags: (1 << 11) | 1 }), 'invalid_archive', /encrypted/);
    await refused(hostile({ name: 'A/project/bz.txt', data: Buffer.from('x'), method: 12, packed: Buffer.from('x') }), 'invalid_archive', /method 12/);
  });

  it('refuses a name given twice, also when only its case differs', async () => {
    await refused(hostile({ name: 'A/project/canvas.json', data: Buffer.from('{}') }), 'invalid_archive', /twice/);
    await refused(hostile({ name: 'A/project/Canvas.JSON', data: Buffer.from('{}') }), 'invalid_archive', /twice/);
    await refused(hostile({ name: 'A/PROJECT/canvas.json', data: Buffer.from('{}') }), 'invalid_archive', /twice/);
    // é composed and decomposed are one name on macOS.
    await refused(hostile({ name: 'A/project/caf\u00e9', data: Buffer.from('1') }, { name: 'A/project/cafe\u0301', data: Buffer.from('2') }), 'invalid_archive', /twice/);
    await refused(hostile({ name: 'A/project/x', data: Buffer.from('1') }, { name: 'A/project/x/y', data: Buffer.from('2') }), 'invalid_archive', /file and as a folder/);
  });

  it('refuses what the export leaves out: the agent channel, .sharing.json, dot files, junk, temp files', async () => {
    await refused(hostile({ name: 'A/_agent/inbox.json', data: Buffer.from('[]') }), 'invalid_archive', /not part of an artifact archive/);
    await refused(hostile({ name: 'A/_AGENT/inbox.json', data: Buffer.from('[]') }), 'invalid_archive', /not part of an artifact archive/);
    await refused(hostile({ name: 'A/.sharing.json', data: Buffer.from('{}') }), 'invalid_archive', /not part/);
    await refused(hostile({ name: 'A/.server.json', data: Buffer.from('{}') }), 'invalid_archive', /not part/);
    await refused(hostile({ name: 'A/project/.env', data: Buffer.from('x') }), 'invalid_archive', /not part/);
    await refused(hostile({ name: 'A/project/.hidden/x.txt', data: Buffer.from('x') }), 'invalid_archive', /not part/);
    await refused(hostile({ name: 'A/DOC/.sessions.json', data: Buffer.from('[]') }), 'invalid_archive', /not part/);
    await refused(hostile({ name: 'A/project/node_modules/x.js', data: Buffer.from('x') }), 'invalid_archive', /not part/);
    await refused(hostile({ name: 'A/project/.git/config', data: Buffer.from('x') }), 'invalid_archive', /not part/);
    await refused(hostile({ name: 'A/_blobs/x.tmp', data: Buffer.from('x') }), 'invalid_archive', /not part/);
    // The shared rule says the same.
    assert.equal(archiveKeeps('_agent/inbox.json'), false);
    assert.equal(archiveKeeps('project/_agent/x'), true);
    assert.equal(archiveKeeps('doc/.sessions.json'), true);
    assert.equal(archiveKeeps('.sharing.json'), false);
  });

  it('refuses anything but one top folder', async () => {
    await refused(hostile({ name: 'B/project/x.txt', data: Buffer.from('x') }), 'invalid_archive', /more than one folder/);
    await refused(hostile({ name: 'top.txt', data: Buffer.from('x') }), 'invalid_archive', /top of the zip/);
    await refused(buildZip([]), 'invalid_archive', /empty/);
    await refused(Buffer.from('not a zip at all, just some text that is long enough'), 'invalid_archive', /not a zip/);
  });

  it('refuses a zip bomb: data that inflates past its declared size', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024);
    await refused(hostile({ name: 'A/project/bomb.txt', data: Buffer.alloc(100), packed: deflateRawSync(big), method: 8, size: 100 }), 'too_large', /more than the 100 bytes/);
    // A declared size that is short of the real one, or data that is not deflate at all.
    await refused(hostile({ name: 'A/project/short.txt', data: Buffer.from('abc'), packed: deflateRawSync(Buffer.from('ab')), method: 8 }), 'invalid_archive', /unpacks to 2 bytes/);
    await refused(hostile({ name: 'A/project/junk.txt', data: Buffer.from('abc'), packed: Buffer.from([0xff, 0xff, 0xff]), method: 8 }), 'invalid_archive');
    // A CRC that does not hold.
    const zip = hostile({ name: 'A/project/crc.txt', data: Buffer.from('abcd') });
    const at = zip.indexOf(Buffer.from('abcd'));
    zip[at] = 0x7a;
    await refused(zip, 'invalid_archive', /CRC/);
  });

  it('enforces the limits on files, total bytes and each file', async () => {
    const three = hostile({ name: 'A/project/x.txt', data: Buffer.from('x') });
    await refused(three, 'too_large', /3 files, more than 2/, { limits: { maxFiles: 2 } });
    await refused(three, 'too_large', /more than 20 bytes/, { limits: { maxBytes: 20 } });
    await refused(three, 'too_large', /more than 4/, { limits: { maxFileBytes: 4 } });
    // The default cap of a project/ file is the store's 16 MB; under _blobs/ it is the upload limit, 25 MB. Declared sizes are refused before anything is inflated.
    await refused(hostile({ name: 'A/project/huge.bin', data: Buffer.alloc(1), size: 16 * 1024 * 1024 + 1 }), 'too_large', /project\/huge\.bin/);
    await refused(hostile({ name: 'A/_blobs/0123456789abcdef0123456789abcdef.png', data: Buffer.alloc(1), size: 25 * 1024 * 1024 + 1 }), 'too_large', /_blobs/);
    const blob = Buffer.alloc(20 * 1024 * 1024, 7);
    const dest = join(dir, 'big-blob');
    assert.equal((await importArchive(hostile({ name: 'A/_blobs/0123456789abcdef0123456789abcdef.png', data: blob, method: 8 }), dest)).files, 3);
    assert.ok((await readFile(join(dest, '_blobs', '0123456789abcdef0123456789abcdef.png'))).equals(blob));
  });

  it('refuses a folder that is no artifact', async () => {
    await refused(buildZip([{ name: 'A/notes.txt', data: Buffer.from('x') }, { name: 'A/project/readme.md', data: Buffer.from('x') }]), 'not_artifact');
  });

  it('refuses a destination that exists, and leaves it alone', async () => {
    const dest = join(dir, 'taken');
    await mkdir(dest);
    await writeFile(join(dest, 'mine.txt'), 'mine');
    await assert.rejects(importArchive(hostile(), dest), (error: unknown) => error instanceof HttpError && error.code === 'exists');
    assert.deepEqual(await readdir(dest), ['mine.txt']);
    const empty = join(dir, 'taken-empty');
    await mkdir(empty);
    await assert.rejects(importArchive(hostile(), empty), (error: unknown) => error instanceof HttpError && error.code === 'exists');
    assert.deepEqual(await readdir(empty), []);
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
    assert.ok((await lstat(dest)).isDirectory());
  });
});
