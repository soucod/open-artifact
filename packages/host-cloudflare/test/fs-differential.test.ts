/**
 * The same operations against real `node:fs` in a temp folder and against the SQLite file system mounted at `/vol`:
 * identical results and identical error codes. Where macOS and Linux disagree (`unlink` of a folder), the shim
 * answers as Linux does, which is what workerd reports.
 */
import assert from 'node:assert/strict';
import * as realFs from 'node:fs';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import * as shimModule from '../src/fs/index.ts';
import shimPromises from '../src/fs/promises.ts';
import { CHUNK_SIZE, INLINE_MAX, mount } from '../src/fs/index.ts';
import { testStorage } from './sqlite.ts';

type Fs = typeof import('node:fs');
type FsPromises = typeof import('node:fs/promises');
const shimFs = shimModule as unknown as Fs;

interface Side {
  name: 'real' | 'shim';
  fs: Fs;
  promises: FsPromises;
  root: string;
}

let real: Side;
let shim: Side;
let unmount: () => void;

before(() => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-artifact-fs-diff-')));
  real = { name: 'real', fs: realFs, promises: realFs.promises, root: dir };
  unmount = mount('/vol', testStorage());
  shim = { name: 'shim', fs: shimFs, promises: shimPromises as unknown as FsPromises, root: '/vol' };
});

after(() => {
  rmSync(real.root, { recursive: true, force: true });
  unmount();
});

/** Linux's answer where macOS gives another (the shim answers as workerd's Linux). */
const LINUX: Record<string, string> = { 'unlink dir': 'EISDIR' };

type Outcome = { ok: unknown } | { error: string };

function normalize(value: unknown, side: Side): unknown {
  if (value instanceof realFs.Stats || value instanceof shimModule.Stats) {
    const stats = value as realFs.Stats;
    return { file: stats.isFile(), dir: stats.isDirectory(), link: stats.isSymbolicLink(), ...(stats.isFile() ? { size: stats.size } : {}) };
  }
  if (Buffer.isBuffer(value)) return { buffer: value.toString('hex') };
  if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('hex') };
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'isDirectory' in item) {
          const dirent = item as realFs.Dirent;
          return { name: String(dirent.name), dir: dirent.isDirectory(), file: dirent.isFile(), parent: String(dirent.parentPath).slice(side.root.length) };
        }
        return normalize(item, side);
      })
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  if (typeof value === 'string' && value.startsWith(side.root)) return '<root>' + value.slice(side.root.length);
  return value;
}

function outcomeOf(run: () => unknown, side: Side): Outcome {
  try {
    return { ok: normalize(run(), side) };
  } catch (error) {
    return { error: String((error as { code?: string }).code ?? error) };
  }
}

async function asyncOutcomeOf(run: () => Promise<unknown>, side: Side): Promise<Outcome> {
  try {
    return { ok: normalize(await run(), side) };
  } catch (error) {
    return { error: String((error as { code?: string }).code ?? error) };
  }
}

/** Runs `op` on both sides (real first) and asserts the same outcome. */
function same(label: string, op: (side: Side, p: (rel?: string) => string) => unknown): Outcome {
  const run = (side: Side) => outcomeOf(() => op(side, (rel = '') => (rel ? `${side.root}/${rel}` : side.root)), side);
  const expected = run(real);
  const got = run(shim);
  if (LINUX[label] && 'error' in got) assert.equal(got.error, LINUX[label], label);
  else assert.deepEqual(got, expected, label);
  return got;
}

async function sameAsync(label: string, op: (side: Side, p: (rel?: string) => string) => Promise<unknown>): Promise<Outcome> {
  const run = (side: Side) => asyncOutcomeOf(() => op(side, (rel = '') => (rel ? `${side.root}/${rel}` : side.root)), side);
  const expected = await run(real);
  const got = await run(shim);
  assert.deepEqual(got, expected, label);
  return got;
}

function bytesOf(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let x = seed * 2654435761;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe('fs differential', () => {
  test('folders', () => {
    same('mkdir', ({ fs }, p) => fs.mkdirSync(p('a')));
    same('mkdir again', ({ fs }, p) => fs.mkdirSync(p('a')));
    same('mkdir missing parent', ({ fs }, p) => fs.mkdirSync(p('x/y')));
    same('mkdir recursive', ({ fs }, p) => fs.mkdirSync(p('a/b/c'), { recursive: true }));
    same('mkdir recursive existing', ({ fs }, p) => fs.mkdirSync(p('a/b'), { recursive: true }));
    same('mkdir recursive deep', ({ fs }, p) => fs.mkdirSync(p('d1/d2/d3'), { recursive: true }));
    same('stat dir', ({ fs }, p) => fs.statSync(p('a/b')));
    same('exists dir', ({ fs }, p) => fs.existsSync(p('a/b/c')));
    same('exists missing', ({ fs }, p) => fs.existsSync(p('a/zz')));
    same('rmdir non-empty', ({ fs }, p) => fs.rmdirSync(p('a/b')));
    same('rmdir empty', ({ fs }, p) => fs.rmdirSync(p('a/b/c')));
    same('rmdir missing', ({ fs }, p) => fs.rmdirSync(p('a/b/c')));
  });

  test('files', () => {
    same('write', ({ fs }, p) => fs.writeFileSync(p('a/f.txt'), 'hello'));
    same('read utf8', ({ fs }, p) => fs.readFileSync(p('a/f.txt'), 'utf8'));
    same('read buffer', ({ fs }, p) => fs.readFileSync(p('a/f.txt')));
    same('read options', ({ fs }, p) => fs.readFileSync(p('a/f.txt'), { encoding: 'base64' }));
    same('stat file', ({ fs }, p) => fs.statSync(p('a/f.txt')));
    same('lstat file', ({ fs }, p) => fs.lstatSync(p('a/f.txt')));
    same('exists file', ({ fs }, p) => fs.existsSync(p('a/f.txt')));
    same('exists file slash', ({ fs }, p) => fs.existsSync(p('a/f.txt/')));
    same('write wx existing', ({ fs }, p) => fs.writeFileSync(p('a/f.txt'), 'x', { flag: 'wx' }));
    same('write wx new', ({ fs }, p) => fs.writeFileSync(p('a/g.txt'), 'x', { flag: 'wx' }));
    same('append', ({ fs }, p) => fs.appendFileSync(p('a/f.txt'), ' world'));
    same('append new', ({ fs }, p) => fs.appendFileSync(p('a/h.txt'), 'new'));
    same('read appended', ({ fs }, p) => fs.readFileSync(p('a/f.txt'), 'utf8'));
    same('write r+', ({ fs }, p) => fs.writeFileSync(p('a/f.txt'), 'J', { flag: 'r+' }));
    same('read r+', ({ fs }, p) => fs.readFileSync(p('a/f.txt'), 'utf8'));
    same('write r+ missing', ({ fs }, p) => fs.writeFileSync(p('a/none.txt'), 'J', { flag: 'r+' }));
    same('write typed array', ({ fs }, p) => fs.writeFileSync(p('a/t.bin'), new Uint16Array([1, 2, 3])));
    same('read typed array', ({ fs }, p) => fs.readFileSync(p('a/t.bin')));
    same('write missing parent', ({ fs }, p) => fs.writeFileSync(p('nope/f.txt'), 'x'));
    same('write over dir', ({ fs }, p) => fs.writeFileSync(p('a'), 'x'));
    same('write under file', ({ fs }, p) => fs.writeFileSync(p('a/f.txt/x'), 'x'));
    same('read dir', ({ fs }, p) => fs.readFileSync(p('a')));
    same('read under file', ({ fs }, p) => fs.readFileSync(p('a/f.txt/x')));
    same('read missing', ({ fs }, p) => fs.readFileSync(p('a/missing')));
    same('stat missing', ({ fs }, p) => fs.statSync(p('a/missing')));
    same('stat missing quiet', ({ fs }, p) => fs.statSync(p('a/missing'), { throwIfNoEntry: false }));
    same('stat under file quiet', ({ fs }, p) => fs.statSync(p('a/f.txt/x'), { throwIfNoEntry: false }));
    same('stat file slash', ({ fs }, p) => fs.statSync(p('a/f.txt/')));
    same('access', ({ fs }, p) => fs.accessSync(p('a/f.txt')));
    same('access missing', ({ fs }, p) => fs.accessSync(p('a/missing')));
    same('realpath', ({ fs }, p) => fs.realpathSync(p('a/../a/f.txt')));
    same('realpath missing', ({ fs }, p) => fs.realpathSync(p('a/missing')));
    same('truncate', ({ fs }, p) => fs.truncateSync(p('a/f.txt'), 3));
    same('read truncated', ({ fs }, p) => fs.readFileSync(p('a/f.txt'), 'utf8'));
    same('truncate grow', ({ fs }, p) => fs.truncateSync(p('a/f.txt'), 6));
    same('read grown', ({ fs }, p) => fs.readFileSync(p('a/f.txt')));
    same('utimes', ({ fs }, p) => {
      fs.utimesSync(p('a/f.txt'), 1_700_000_000, 1_700_000_001);
      return fs.statSync(p('a/f.txt')).mtimeMs;
    });
    same('utimes date', ({ fs }, p) => {
      fs.utimesSync(p('a/f.txt'), new Date(1_600_000_000_000), new Date(1_600_000_000_500));
      return fs.statSync(p('a/f.txt')).mtime.getTime();
    });
    same('mtime moves', ({ fs }, p) => {
      const before = fs.statSync(p('a/f.txt')).mtimeMs;
      fs.writeFileSync(p('a/f.txt'), 'later');
      return fs.statSync(p('a/f.txt')).mtimeMs > before;
    });
  });

  test('listing', () => {
    same('readdir', ({ fs }, p) => fs.readdirSync(p('a')));
    same('readdir types', ({ fs }, p) => fs.readdirSync(p('a'), { withFileTypes: true }));
    same('readdir recursive', ({ fs }, p) => fs.readdirSync(p(), { recursive: true }));
    same('readdir recursive types', ({ fs }, p) => fs.readdirSync(p('d1'), { recursive: true, withFileTypes: true }));
    same('readdir buffer', ({ fs }, p) => fs.readdirSync(p('a'), { encoding: 'buffer' }));
    same('readdir file', ({ fs }, p) => fs.readdirSync(p('a/f.txt')));
    same('readdir missing', ({ fs }, p) => fs.readdirSync(p('zz')));
    same('readdir unicode', ({ fs }, p) => {
      fs.mkdirSync(p('u'));
      for (const name of ['é.txt', 'z', 'A', '中文', 'a b']) fs.writeFileSync(p(`u/${name}`), name);
      return fs.readdirSync(p('u'));
    });
  });

  test('rename', () => {
    same('rename file', ({ fs }, p) => fs.renameSync(p('a/g.txt'), p('a/g2.txt')));
    same('rename over file', ({ fs }, p) => {
      fs.renameSync(p('a/g2.txt'), p('a/h.txt'));
      return fs.readFileSync(p('a/h.txt'), 'utf8');
    });
    same('rename missing', ({ fs }, p) => fs.renameSync(p('a/g2.txt'), p('a/x')));
    same('rename to missing parent', ({ fs }, p) => fs.renameSync(p('a/h.txt'), p('none/x')));
    same('rename to under file', ({ fs }, p) => fs.renameSync(p('a/h.txt'), p('a/f.txt/x')));
    same('rename same', ({ fs }, p) => fs.renameSync(p('a/h.txt'), p('a/h.txt')));
    same('rename file over dir', ({ fs }, p) => fs.renameSync(p('a/h.txt'), p('d1')));
    same('rename dir over file', ({ fs }, p) => fs.renameSync(p('d1'), p('a/h.txt')));
    same('rename dir into itself', ({ fs }, p) => fs.renameSync(p('d1'), p('d1/d2/inside')));
    same('rename dir tree', ({ fs }, p) => {
      fs.writeFileSync(p('d1/d2/d3/leaf'), 'leaf');
      fs.writeFileSync(p('d1/top'), 'top');
      fs.renameSync(p('d1'), p('moved'));
      return [fs.existsSync(p('d1')), fs.readFileSync(p('moved/d2/d3/leaf'), 'utf8'), fs.readdirSync(p('moved'), { recursive: true })];
    });
    same('rename dir over empty dir', ({ fs }, p) => {
      fs.mkdirSync(p('empty'));
      fs.renameSync(p('moved'), p('empty'));
      return fs.readdirSync(p('empty'), { recursive: true });
    });
    same('rename dir over non-empty dir', ({ fs }, p) => {
      fs.mkdirSync(p('full/x'), { recursive: true });
      fs.renameSync(p('empty'), p('full'));
    });
    same('rename mkdir after move', ({ fs }, p) => {
      // The old name is free again; the moved tree is reachable only by its new name.
      fs.mkdirSync(p('d1/d2'), { recursive: true });
      return [fs.readdirSync(p('d1/d2')), fs.readdirSync(p('empty/d2/d3'))];
    });
  });

  test('remove', () => {
    same('unlink', ({ fs }, p) => fs.unlinkSync(p('a/h.txt')));
    same('unlink missing', ({ fs }, p) => fs.unlinkSync(p('a/h.txt')));
    same('unlink dir', ({ fs }, p) => fs.unlinkSync(p('a')));
    same('rm file', ({ fs }, p) => fs.rmSync(p('a/t.bin')));
    same('rm missing', ({ fs }, p) => fs.rmSync(p('a/t.bin')));
    same('rm missing force', ({ fs }, p) => fs.rmSync(p('a/t.bin'), { force: true }));
    same('rm dir', ({ fs }, p) => fs.rmSync(p('empty')));
    same('rm dir recursive', ({ fs }, p) => {
      fs.rmSync(p('empty'), { recursive: true });
      return fs.existsSync(p('empty/d2/d3/leaf'));
    });
    same('rm recreated', ({ fs }, p) => {
      fs.mkdirSync(p('empty/d2'), { recursive: true });
      return fs.readdirSync(p('empty'), { recursive: true });
    });
    same('rmdir file', ({ fs }, p) => fs.rmdirSync(p('a/f.txt')));
    same('rm full', ({ fs }, p) => fs.rmSync(p('full'), { recursive: true }));
  });

  test('copy', () => {
    same('copy', ({ fs }, p) => {
      fs.copyFileSync(p('a/f.txt'), p('a/copy.txt'));
      return fs.readFileSync(p('a/copy.txt'), 'utf8');
    });
    same('copy excl', ({ fs }, p) => fs.copyFileSync(p('a/f.txt'), p('a/copy.txt'), fs.constants.COPYFILE_EXCL));
    same('copy over', ({ fs }, p) => {
      fs.writeFileSync(p('a/other'), 'other');
      fs.copyFileSync(p('a/other'), p('a/copy.txt'));
      return fs.readFileSync(p('a/copy.txt'), 'utf8');
    });
    same('copy missing', ({ fs }, p) => fs.copyFileSync(p('a/none'), p('a/copy2')));
    same('copy to missing parent', ({ fs }, p) => fs.copyFileSync(p('a/f.txt'), p('none/copy2')));
  });

  test('descriptors', () => {
    same('open wx', ({ fs }, p) => {
      const fd = fs.openSync(p('a/lock'), 'wx');
      fs.closeSync(fd);
      return fs.existsSync(p('a/lock'));
    });
    same('open wx existing', ({ fs }, p) => fs.openSync(p('a/lock'), 'wx'));
    same('open r missing', ({ fs }, p) => fs.openSync(p('a/none'), 'r'));
    same('open w dir', ({ fs }, p) => fs.openSync(p('a'), 'w'));
    same('open numeric excl', ({ fs }, p) => {
      const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
      const fd = fs.openSync(p('a/numeric'), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644);
      fs.writeSync(fd, Buffer.from('abc'));
      fs.writeSync(fd, 'def');
      fs.closeSync(fd);
      return fs.readFileSync(p('a/numeric'), 'utf8');
    });
    same('open numeric excl existing', ({ fs }, p) => {
      const { O_WRONLY, O_CREAT, O_EXCL } = fs.constants;
      return fs.openSync(p('a/numeric'), O_WRONLY | O_CREAT | O_EXCL);
    });
    same('read write positions', ({ fs }, p) => {
      const fd = fs.openSync(p('a/rw'), 'w+');
      fs.writeSync(fd, Buffer.from('0123456789'));
      fs.writeSync(fd, Buffer.from('XY'), 0, 2, 3);
      fs.writeSync(fd, 'Z', 12);
      const buffer = Buffer.alloc(20);
      const n = fs.readSync(fd, buffer, 0, 20, 0);
      const stat = fs.fstatSync(fd);
      fs.ftruncateSync(fd, 4);
      const after = fs.fstatSync(fd).size;
      fs.closeSync(fd);
      return [n, buffer.subarray(0, n), stat.size, after, fs.readFileSync(p('a/rw'))];
    });
    same('read sequential', ({ fs }, p) => {
      fs.writeFileSync(p('a/seq'), 'abcdefgh');
      const fd = fs.openSync(p('a/seq'), 'r');
      const one = Buffer.alloc(3);
      const two = Buffer.alloc(10);
      const a = fs.readSync(fd, one, 0, 3, null);
      const b = fs.readSync(fd, two, { offset: 0, length: 10 });
      fs.closeSync(fd);
      return [a, one, b, two.subarray(0, b)];
    });
    same('append fd', ({ fs }, p) => {
      const fd = fs.openSync(p('a/seq'), 'a');
      fs.writeSync(fd, 'IJ');
      fs.appendFileSync(fd, 'K');
      fs.closeSync(fd);
      return fs.readFileSync(p('a/seq'), 'utf8');
    });
    same('close twice', ({ fs }, p) => {
      const fd = fs.openSync(p('a/seq'), 'r');
      fs.closeSync(fd);
      fs.closeSync(fd);
    });
    same('write to read-only fd', ({ fs }, p) => {
      const fd = fs.openSync(p('a/seq'), 'r');
      try {
        fs.writeSync(fd, 'x');
      } finally {
        fs.closeSync(fd);
      }
    });
    same('open w truncates', ({ fs }, p) => {
      fs.closeSync(fs.openSync(p('a/seq'), 'w'));
      return fs.readFileSync(p('a/seq'));
    });
  });

  test('mkdtemp', () => {
    same('mkdtemp', ({ fs }, p) => {
      const made = fs.mkdtempSync(p('tmp-'));
      const ok = made.length === p('tmp-').length + 6 && fs.statSync(made).isDirectory();
      fs.rmSync(made, { recursive: true });
      return ok;
    });
    same('mkdtemp missing parent', ({ fs }, p) => fs.mkdtempSync(p('none/tmp-')));
  });

  test('chunk boundaries', () => {
    const sizes = [0, 1, INLINE_MAX - 1, INLINE_MAX, INLINE_MAX + 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 3 * CHUNK_SIZE + 17];
    same('mkdir chunks', ({ fs }, p) => fs.mkdirSync(p('chunks')));
    for (const [i, size] of sizes.entries()) {
      same(`write ${size}`, ({ fs }, p) => fs.writeFileSync(p(`chunks/${size}`), bytesOf(size, i + 1)));
      same(`read ${size}`, ({ fs }, p) => fs.readFileSync(p(`chunks/${size}`)).equals(bytesOf(size, i + 1)));
      same(`stat ${size}`, ({ fs }, p) => fs.statSync(p(`chunks/${size}`)).size);
      same(`append ${size}`, ({ fs }, p) => {
        fs.appendFileSync(p(`chunks/${size}`), bytesOf(CHUNK_SIZE + 3, 99));
        return fs.readFileSync(p(`chunks/${size}`)).equals(Buffer.concat([bytesOf(size, i + 1), bytesOf(CHUNK_SIZE + 3, 99)]));
      });
      same(`truncate ${size}`, ({ fs }, p) => {
        fs.truncateSync(p(`chunks/${size}`), size);
        return fs.readFileSync(p(`chunks/${size}`)).equals(bytesOf(size, i + 1));
      });
      same(`rewrite ${size}`, ({ fs }, p) => {
        const next = bytesOf(size, i + 1);
        if (size > 0) next[size - 1] ^= 0xff;
        fs.writeFileSync(p(`chunks/${size}`), next);
        return fs.readFileSync(p(`chunks/${size}`)).equals(next);
      });
    }
    const big = 3 * CHUNK_SIZE + 17;
    for (const [start, end] of [
      [0, 0],
      [0, 9],
      [CHUNK_SIZE - 2, CHUNK_SIZE + 2],
      [CHUNK_SIZE, 2 * CHUNK_SIZE - 1],
      [2 * CHUNK_SIZE - 1, 3 * CHUNK_SIZE + 40],
      [big + 5, big + 10],
    ] as const) {
      same(`range read ${start}-${end}`, ({ fs }, p) => {
        const fd = fs.openSync(p(`chunks/${big}`), 'r');
        const out = Buffer.alloc(end - start + 1);
        const n = fs.readSync(fd, out, 0, out.length, start);
        fs.closeSync(fd);
        return out.subarray(0, n).toString('hex');
      });
    }
    same('write at across chunks', ({ fs }, p) => {
      const fd = fs.openSync(p(`chunks/${big}`), 'r+');
      fs.writeSync(fd, bytesOf(CHUNK_SIZE + 10, 7), 0, CHUNK_SIZE + 10, CHUNK_SIZE - 5);
      fs.writeSync(fd, Buffer.from('tail'), 0, 4, big + CHUNK_SIZE);
      fs.closeSync(fd);
      const all = fs.readFileSync(p(`chunks/${big}`));
      return [all.length, all.toString('base64').length, Buffer.from(all.subarray(CHUNK_SIZE - 8, CHUNK_SIZE + 20)).toString('hex'), all.subarray(-8).toString('hex'), all.subarray(big - 2, big + 6).toString('hex')];
    });
    same('truncate chunked to small', ({ fs }, p) => {
      fs.truncateSync(p(`chunks/${big}`), 100);
      return fs.readFileSync(p(`chunks/${big}`)).toString('hex');
    });
    same('truncate small to chunked', ({ fs }, p) => {
      fs.truncateSync(p(`chunks/${big}`), CHUNK_SIZE * 2 + 1);
      const all = fs.readFileSync(p(`chunks/${big}`));
      return [all.length, all.subarray(0, 100).toString('hex'), all.subarray(100).every((b) => b === 0)];
    });
  });

  test('streams', async () => {
    const big = 3 * CHUNK_SIZE + 17;
    for (const [start, end] of [
      [undefined, undefined],
      [0, 0],
      [10, CHUNK_SIZE + 10],
      [CHUNK_SIZE * 2, undefined],
    ] as const) {
      await sameAsync(`read stream ${start}-${end}`, async ({ fs }, p) => {
        fs.writeFileSync(p('stream.bin'), bytesOf(big, 5));
        const parts: Buffer[] = [];
        for await (const chunk of fs.createReadStream(p('stream.bin'), { start, end })) parts.push(chunk as Buffer);
        return Buffer.concat(parts).toString('base64');
      });
    }
    await sameAsync('read stream missing', async ({ fs }, p) => {
      for await (const _ of fs.createReadStream(p('none.bin'))) void _;
    });
    await sameAsync('read stream encoding', async ({ fs }, p) => {
      fs.writeFileSync(p('text.txt'), 'héllo');
      let out = '';
      for await (const chunk of fs.createReadStream(p('text.txt'), { encoding: 'utf8' })) out += chunk;
      return out;
    });
    await sameAsync('write stream', async ({ fs }, p) => {
      const stream = fs.createWriteStream(p('written.txt'));
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject);
        stream.write('one ');
        stream.write(Buffer.from('two '));
        stream.end('three', () => resolve());
      });
      await new Promise((resolve) => (stream.closed ? resolve(null) : stream.on('close', () => resolve(null))));
      return [stream.bytesWritten, fs.readFileSync(p('written.txt'), 'utf8')];
    });
    await sameAsync('write stream wx existing', async ({ fs }, p) => {
      const stream = fs.createWriteStream(p('written.txt'), { flags: 'wx' });
      await new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('open', resolve);
      });
    });
  });

  test('promises', async () => {
    await sameAsync('p mkdir', ({ promises }, p) => promises.mkdir(p('pr/x'), { recursive: true }));
    await sameAsync('p writeFile', ({ promises }, p) => promises.writeFile(p('pr/x/f'), 'promised'));
    await sameAsync('p writeFile iterable', ({ promises }, p) => promises.writeFile(p('pr/x/it'), (async function* () {
      yield 'a';
      yield Buffer.from('b');
    })()));
    await sameAsync('p readFile iterable', ({ promises }, p) => promises.readFile(p('pr/x/it'), 'utf8'));
    await sameAsync('p readFile', ({ promises }, p) => promises.readFile(p('pr/x/f'), 'utf8'));
    await sameAsync('p readFile missing', ({ promises }, p) => promises.readFile(p('pr/x/none')));
    await sameAsync('p appendFile', ({ promises }, p) => promises.appendFile(p('pr/x/f'), '!'));
    await sameAsync('p stat', ({ promises }, p) => promises.stat(p('pr/x/f')));
    await sameAsync('p lstat', ({ promises }, p) => promises.lstat(p('pr/x')));
    await sameAsync('p access', ({ promises }, p) => promises.access(p('pr/none')));
    await sameAsync('p readdir', ({ promises }, p) => promises.readdir(p('pr/x'), { withFileTypes: true }));
    await sameAsync('p rename', ({ promises }, p) => promises.rename(p('pr/x/f'), p('pr/g')));
    await sameAsync('p copyFile', ({ promises }, p) => promises.copyFile(p('pr/g'), p('pr/h')));
    await sameAsync('p realpath', ({ promises }, p) => promises.realpath(p('pr/./h')));
    await sameAsync('p utimes', async ({ promises }, p) => {
      await promises.utimes(p('pr/h'), 1_700_000_000, 1_700_000_000);
      return (await promises.stat(p('pr/h'))).mtimeMs;
    });
    await sameAsync('p truncate', async ({ promises }, p) => {
      await promises.truncate(p('pr/h'), 2);
      return promises.readFile(p('pr/h'), 'utf8');
    });
    await sameAsync('p open', async ({ promises }, p) => {
      const { O_WRONLY, O_CREAT, O_EXCL } = promises.constants;
      const handle = await promises.open(p('pr/new'), O_WRONLY | O_CREAT | O_EXCL, 0o644);
      try {
        await handle.writeFile(Buffer.from('handle bytes'));
        return (await handle.stat()).size;
      } finally {
        await handle.close();
      }
    });
    await sameAsync('p open existing excl', ({ promises }, p) => promises.open(p('pr/new'), 'wx'));
    await sameAsync('p handle read', async ({ promises }, p) => {
      const handle = await promises.open(p('pr/new'), 'r+');
      try {
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(6), 0, 6, 7);
        await handle.write('HANDLE', 0);
        await handle.truncate(9);
        return [bytesRead, buffer, await handle.readFile('utf8'), await promises.readFile(p('pr/new'), 'utf8')];
      } finally {
        await handle.close();
      }
    });
    await sameAsync('p rm', ({ promises }, p) => promises.rm(p('pr'), { recursive: true }));
    await sameAsync('p unlink missing', ({ promises }, p) => promises.unlink(p('pr/h')));
    await sameAsync('p rmdir missing', ({ promises }, p) => promises.rmdir(p('pr')));
    await sameAsync('p mkdtemp', async ({ promises }, p) => (await promises.mkdtemp(p('t-'))).length - p('t-').length);
  });

  test('callbacks', async () => {
    const call = <T>(fn: (cb: (error: Error | null, value?: T) => void) => void): Promise<T | undefined> =>
      new Promise((resolve, reject) => fn((error, value) => (error ? reject(error) : resolve(value))));
    await sameAsync('cb mkdir', ({ fs }, p) => call((cb) => fs.mkdir(p('cb'), cb)));
    await sameAsync('cb writeFile', ({ fs }, p) => call((cb) => fs.writeFile(p('cb/f'), 'cb', cb)));
    await sameAsync('cb readFile', ({ fs }, p) => call<string>((cb) => fs.readFile(p('cb/f'), 'utf8', cb)));
    await sameAsync('cb readFile missing', ({ fs }, p) => call((cb) => fs.readFile(p('cb/none'), cb)));
    await sameAsync('cb stat', ({ fs }, p) => call((cb) => fs.stat(p('cb/f'), cb)));
    await sameAsync('cb readdir', ({ fs }, p) => call((cb) => fs.readdir(p('cb'), cb)));
    await sameAsync('cb rename', ({ fs }, p) => call((cb) => fs.rename(p('cb/f'), p('cb/g'), cb)));
    await sameAsync('cb exists', ({ fs }, p) => new Promise((resolve) => fs.exists(p('cb/g'), (exists) => resolve(exists))));
    await sameAsync('cb unlink', ({ fs }, p) => call((cb) => fs.unlink(p('cb/g'), cb)));
    await sameAsync('cb rm', ({ fs }, p) => call((cb) => fs.rm(p('cb'), { recursive: true }, cb)));
  });
});
