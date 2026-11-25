/**
 * The bundle's `node:zlib` (`src/zlib.ts`): `maxOutputLength` counts the bytes unpacked, as Node's does, whatever
 * buffer the engine grows underneath. (workerd's own refuses a 52457-byte entry at a limit of 52458; that is checked
 * end to end by `e2e/cloudflare-host.test.mjs`, which imports such a file.)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { deflateRawSync } from 'node:zlib';
import { inflateRaw, inflateRawSync } from '../src/zlib.ts';

const bytes = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7919 + (i >> 5)) & 0xff));

test('a limit equal to the size unpacks; one byte under is a RangeError', async () => {
  const inflate = promisify(inflateRaw) as (b: Buffer, o: { maxOutputLength: number }) => Promise<Buffer>;
  for (const n of [1, 16384, 52457, 200000]) {
    const data = bytes(n);
    const packed = deflateRawSync(data);
    assert.deepEqual(inflateRawSync(packed, { maxOutputLength: n }), data);
    assert.deepEqual(await inflate(packed, { maxOutputLength: n }), data);
    if (n > 1) {
      assert.throws(() => inflateRawSync(packed, { maxOutputLength: n - 1 }), RangeError);
      await assert.rejects(inflate(packed, { maxOutputLength: n - 1 }), RangeError);
    }
  }
});

test('without a limit it is zlib as it is', () => {
  const data = bytes(1000);
  assert.deepEqual(inflateRawSync(deflateRawSync(data)), data);
});
