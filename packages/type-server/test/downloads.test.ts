import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MAX_DOWNLOAD_BYTES, downloadName, saveDownload } from '../src/downloads.ts';
import { sendError, sendJson } from '../src/http.ts';

const LIMIT = 64 * 1024;

describe('downloads', () => {
  let dir: string;
  let server: Server;
  let origin: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oa-downloads-'));
    server = createServer((req, res) => {
      const name = downloadName(new URL(req.url ?? '/', 'http://x').searchParams.get('name'));
      saveDownload(req, dir, name, LIMIT).then(
        (savedTo) => sendJson(res, 200, { savedTo }),
        (error: unknown) => sendError(res, error),
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  });

  /** POSTs `chunks` one after another without a declared length; the status, or null when the connection broke. */
  function sendChunked(name: string, chunks: Buffer[]): Promise<number | null> {
    return new Promise((done) => {
      const req = request(`${origin}/?name=${encodeURIComponent(name)}`, { method: 'POST' }, (res) => {
        res.resume();
        res.on('end', () => done(res.statusCode ?? null));
      });
      req.on('error', () => done(null));
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  }

  it('takes files of up to 512 MB', () => {
    assert.equal(MAX_DOWNLOAD_BYTES, 512 * 1024 * 1024);
  });

  it('streams the body to the folder under a free name', async () => {
    const body = Buffer.alloc(LIMIT, 7);
    const first = await fetch(`${origin}/?name=film.mov`, { method: 'POST', body });
    assert.equal(first.status, 200);
    const { savedTo } = (await first.json()) as { savedTo: string };
    assert.equal(savedTo, join(dir, 'film.mov'));
    assert.deepEqual(await readFile(savedTo), body);
    const second = (await (await fetch(`${origin}/?name=film.mov`, { method: 'POST', body: 'again' })).json()) as { savedTo: string };
    assert.equal(second.savedTo, join(dir, 'film (2).mov'));
    assert.deepEqual((await readdir(dir)).sort(), ['film (2).mov', 'film.mov']);
  });

  it('refuses a body over the limit by its declared length, saving nothing', async () => {
    const response = await fetch(`${origin}/?name=big.mov`, { method: 'POST', body: Buffer.alloc(LIMIT + 1) });
    assert.equal(response.status, 413);
    assert.match(((await response.json()) as { message: string }).message, /over/);
    assert.ok(!(await readdir(dir)).some((name) => name.includes('big')));
  });

  it('stops a body that grows past the limit and leaves no partial file', async () => {
    const status = await sendChunked('grown.mov', [Buffer.alloc(LIMIT / 2), Buffer.alloc(LIMIT / 2), Buffer.alloc(LIMIT / 2)]);
    assert.notEqual(status, 200);
    await new Promise((done) => setTimeout(done, 50));
    assert.ok(!(await readdir(dir)).some((name) => name.includes('grown')));
  });

  it('makes the asked name safe', () => {
    assert.equal(downloadName('../../etc/passwd'), 'passwd');
    assert.equal(downloadName('a:b*c?.mov'), 'a_b_c_.mov');
    assert.equal(downloadName(null), 'download');
    assert.equal(downloadName('x'.repeat(200)).length, 120);
    assert.equal(downloadName('x'.repeat(120) + '.mp4'), 'x'.repeat(120) + '.mp4', 'a long title keeps its extension');
    const wide = downloadName('影'.repeat(120) + '.mov');
    assert.ok(wide.endsWith('.mov') && Buffer.byteLength(wide) <= 230, 'cut to fit 230 bytes');
    assert.equal(downloadName('😀'.repeat(130)), '😀'.repeat(57), 'no half emoji');
  });
});
