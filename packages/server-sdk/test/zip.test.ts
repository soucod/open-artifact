/**
 * `checkZip` and `unpackZip` (src/zip.ts), against zips built here byte by byte: every way a package or an archive
 * from anyone can try to write outside its folder, pass for something else, or unpack to more than it says.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkZip, moveIntoPlace, unpackZip, ZipRefusal, zipBytes, type ZipRules } from '../src/zip.ts';
import { rawZip, type RawEntry } from './zip-builder.ts';

const RULES: ZipRules = { noun: 'a test zip', maxFiles: 10, maxBytes: 1 << 20, maxFileBytes: 1 << 19 };
const tmp = mkdtempSync(join(tmpdir(), 'open-artifact-zip-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** checkZip refuses `entries` with `code`, its message matching `message`. */
function refused(entries: RawEntry[], message: RegExp, code: 'invalid' | 'too_large' = 'invalid', rules: ZipRules = RULES): void {
  assert.throws(
    () => checkZip(rawZip(entries), rules),
    (error: unknown) => error instanceof ZipRefusal && error.code === code && message.test(error.message),
    `${entries.map((e) => JSON.stringify(e.name)).join(', ')} should be refused with ${message}`,
  );
}

describe('checkZip', () => {
  it('takes one top folder of plain files, and drops the top folder from the paths', () => {
    const { top, files } = checkZip(rawZip([{ name: 'pkg/a.txt', data: 'a' }, { name: 'pkg/dir/b.txt', data: 'bb' }]), RULES);
    assert.equal(top, 'pkg');
    assert.deepEqual(
      files.map((f) => [f.path, f.entry.size]),
      [
        ['a.txt', 1],
        ['dir/b.txt', 2],
      ],
    );
  });

  it('refuses an absolute path, by slash or by drive letter', () => {
    refused([{ name: '/etc/passwd', data: 'x' }], /absolute/);
    refused([{ name: 'C:/Windows/x', data: 'x' }], /absolute/);
  });

  it('refuses .., an empty step and a "." step', () => {
    refused([{ name: 'pkg/../evil.txt', data: 'x' }], /climbs out/);
    refused([{ name: 'pkg/a/../../evil.txt', data: 'x' }], /climbs out/);
    refused([{ name: 'pkg//a.txt', data: 'x' }], /empty or "\." step/);
    refused([{ name: 'pkg/./a.txt', data: 'x' }], /empty or "\." step/);
  });

  it('refuses a backslash and a NUL in a name', () => {
    refused([{ name: 'pkg\\..\\evil.txt', data: 'x' }], /backslash or a NUL/);
    refused([{ name: 'pkg/a\0.txt', data: 'x' }], /backslash or a NUL/);
  });

  it('refuses names that differ only by case or by Unicode normalization', () => {
    refused([{ name: 'pkg/Readme.md', data: 'a' }, { name: 'pkg/README.md', data: 'b' }], /twice/);
    refused([{ name: 'pkg/caf\u00e9.txt', data: 'a' }, { name: 'pkg/cafe\u0301.txt', data: 'b' }], /twice/);
    refused([{ name: 'pkg/a.txt', data: 'a' }, { name: 'pkg/a.txt', data: 'b' }], /twice/);
  });

  it('refuses a name that is both a file and a folder', () => {
    refused([{ name: 'pkg/a', data: 'a' }, { name: 'pkg/A/b.txt', data: 'b' }], /both as a file and as a folder/);
  });

  it('refuses entries outside the single top folder, and a file at the top', () => {
    refused([{ name: 'one/a.txt', data: 'a' }, { name: 'two/b.txt', data: 'b' }], /more than one top folder/);
    refused([{ name: 'a.txt', data: 'a' }], /at the top of the zip/);
  });

  it('refuses a symbolic link and a device, by the Unix mode', () => {
    refused([{ name: 'pkg/link', data: '/etc/passwd', method: 0, mode: 0o120777 }], /symbolic link or a device/);
    refused([{ name: 'pkg/tty', method: 0, mode: 0o020644 }], /symbolic link or a device/);
    refused([{ name: 'pkg/fifo', method: 0, mode: 0o010644 }], /symbolic link or a device/);
  });

  it('refuses a folder entry unless folders are taken, and a folder with data', () => {
    refused([{ name: 'pkg/', method: 0 }, { name: 'pkg/a.txt', data: 'a' }], /folder entry/);
    const rules = { ...RULES, folders: true };
    assert.equal(checkZip(rawZip([{ name: 'pkg/', method: 0 }, { name: 'pkg/a.txt', data: 'a' }]), rules).files.length, 1);
    refused([{ name: 'pkg/dir/', data: 'x', method: 0, mode: 0o040755 }], /has data/, 'invalid', rules);
  });

  it('refuses encryption and other packing methods', () => {
    refused([{ name: 'pkg/a.txt', data: 'a', flags: 0x0801 }], /encrypted/);
    refused([{ name: 'pkg/a.txt', data: 'a', method: 12 }], /method 12/);
  });

  it('refuses more files, and more bytes declared, than the limits', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `pkg/f${i}.txt`, data: 'x' }));
    refused(many, /more than 10 files/, 'too_large');
    refused([{ name: 'pkg/big.bin', data: 'x', declaredSize: (1 << 19) + 1 }], /more than/, 'too_large');
    const half = { data: 'x', declaredSize: 1 << 19 };
    refused([{ name: 'pkg/a.bin', ...half }, { name: 'pkg/b.bin', ...half }, { name: 'pkg/c.bin', ...half }], /unpacks to more than/, 'too_large');
  });

  it('refuses a stored file whose sizes differ', () => {
    refused([{ name: 'pkg/a.txt', data: 'abc', method: 0, declaredSize: 2 }], /stored but its sizes differ/);
  });

  it('refuses something that is not a zip, and an empty zip', () => {
    assert.throws(() => checkZip(Buffer.from('not a zip at all, just some text'), RULES), /not a zip/);
    assert.throws(() => checkZip(rawZip([]), RULES), /empty/);
  });
});

describe('unpackZip', () => {
  /** Nothing of a failed unpack is left beside `dest`. */
  const leftovers = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

  it('unpacks into a dot folder beside the destination, then moves it into place', async () => {
    const bytes = rawZip([{ name: 'pkg/a.txt', data: 'hello' }, { name: 'pkg/sub/b.txt', data: 'world' }]);
    const { files } = checkZip(bytes, RULES);
    const parent = join(tmp, 'ok');
    const dest = join(parent, 'pkg');
    const out = await unpackZip(bytes, files, dest, RULES.maxBytes);
    assert.match(out.temp, /\/\.pkg\.[0-9a-f]+\.unpack$/);
    assert.equal(existsSync(dest), false, 'nothing at the destination before the move');
    await moveIntoPlace(out.temp, dest);
    assert.equal(readFileSync(join(dest, 'sub', 'b.txt'), 'utf8'), 'world');
    assert.deepEqual(leftovers(parent), ['pkg']);
  });

  it('a zip bomb: a file that inflates past the size it declares fails while inflating, and leaves nothing', async () => {
    // 4 MiB of zeros deflates to a few KiB; the directory says 100 bytes, which every limit allows.
    const bytes = rawZip([{ name: 'pkg/bomb.bin', data: Buffer.alloc(4 << 20), declaredSize: 100 }]);
    const { files } = checkZip(bytes, RULES);
    const parent = join(tmp, 'bomb');
    await assert.rejects(unpackZip(bytes, files, join(parent, 'pkg'), RULES.maxBytes), (error: unknown) => error instanceof ZipRefusal && error.code === 'too_large');
    assert.deepEqual(leftovers(parent), []);
  });

  it('a file whose CRC does not hold fails, and leaves nothing', async () => {
    const bytes = rawZip([{ name: 'pkg/a.txt', data: 'fine' }, { name: 'pkg/b.txt', data: 'tampered', crc: 1234 }]);
    const { files } = checkZip(bytes, RULES);
    const parent = join(tmp, 'crc');
    await assert.rejects(unpackZip(bytes, files, join(parent, 'pkg'), RULES.maxBytes), /CRC/);
    assert.deepEqual(leftovers(parent), []);
  });

  it('counts the bytes actually inflated against the total', async () => {
    const bytes = rawZip([{ name: 'pkg/a.bin', data: Buffer.alloc(600) }, { name: 'pkg/b.bin', data: Buffer.alloc(600) }]);
    const { files } = checkZip(bytes, RULES);
    const parent = join(tmp, 'total');
    await assert.rejects(unpackZip(bytes, files, join(parent, 'pkg'), 1000), /more than 1000 bytes/);
    assert.deepEqual(leftovers(parent), []);
  });

  it('refuses to move into a destination that exists by then', async () => {
    const bytes = await zipBytes([]);
    assert.ok(bytes.length > 0);
    const good = rawZip([{ name: 'pkg/a.txt', data: 'a' }]);
    const parent = join(tmp, 'exists');
    const out = await unpackZip(good, checkZip(good, RULES).files, join(parent, 'pkg'), RULES.maxBytes);
    const again = await unpackZip(good, checkZip(good, RULES).files, join(parent, 'pkg'), RULES.maxBytes);
    await moveIntoPlace(out.temp, join(parent, 'pkg'));
    await assert.rejects(moveIntoPlace(again.temp, join(parent, 'pkg')), /exists already/);
    assert.deepEqual(leftovers(parent), ['pkg']);
  });
});
