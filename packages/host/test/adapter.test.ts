import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { Router, json, readBody, readJson, serializeCookie, type BaseCtx } from '../src/core/http.ts';
import type { SqlDriver } from '../src/core/types.ts';
import { LINK_API_PREFIX } from '@open-artifact/protocol';
import { APP_MAX_BODY_BYTES } from '../src/core/app/routes.ts';
import { LINK_MAX_BODY_BYTES } from '../src/core/link/services.ts';
import { nodeHandler } from '../src/node/adapter.ts';
import { maxBodyBytesOf } from '../src/node/host.ts';

const nullDriver: SqlDriver = { all: async () => [], get: async () => undefined, run: async () => ({ changes: 0 }), batch: async () => undefined };
const config = parseConfig({ OA_SIGNING_KEYS: 'k'.repeat(32) });
const ctx: BaseCtx = { config, catalog: new Catalog(nullDriver, { signingKeys: config.signingKeys }), now: () => new Date(), log: () => undefined };

const router = new Router()
  .post('/echo', async (request) => json({ got: await readJson(request), url: request.url, header: request.headers.get('x-test') }))
  .post('/count', async (request) => json({ bytes: (await readBody(request, 1024 * 1024)).byteLength }))
  .get('/stream', async () => {
    let n = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (n === 5) return controller.close();
        await new Promise((resolve) => setTimeout(resolve, 5));
        controller.enqueue(new TextEncoder().encode(`chunk${n++};`));
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/plain' } });
  })
  .get('/cookies', async () => {
    const headers = new Headers();
    headers.append('set-cookie', serializeCookie('a', '1', { httpOnly: true }));
    headers.append('set-cookie', serializeCookie('b', '2', { maxAge: 0 }));
    return json({ ok: true }, { headers });
  });

async function withServer(fn: (base: string) => Promise<void>, maxBodyBytes: number | ((req: IncomingMessage) => number) = 1024): Promise<void> {
  const server: Server = createServer(nodeHandler(router.handle, () => ctx, { maxBodyBytes, origin: (req) => `https://${req.headers.host}` }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('JSON round trip through a real server, URL built on the given origin', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/echo?q=1`, { method: 'POST', body: JSON.stringify({ hello: 'world' }), headers: { 'content-type': 'application/json', 'x-test': 'yes' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.got, { hello: 'world' });
    assert.match(body.url, /^https:\/\/127\.0\.0\.1:\d+\/echo\?q=1$/);
    assert.equal(body.header, 'yes');
  });
});

test('a streamed request body and a streamed response body', async () => {
  await withServer(async (base) => {
    const chunks = ['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(next));
      },
    });
    const counted = await fetch(`${base}/count`, { method: 'POST', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
    assert.deepEqual(await counted.json(), { bytes: 900 });

    const response = await fetch(`${base}/stream`);
    assert.equal(response.headers.get('transfer-encoding'), 'chunked');
    const reader = response.body!.getReader();
    const parts: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(new TextDecoder().decode(value));
    }
    assert.equal(parts.join(''), 'chunk0;chunk1;chunk2;chunk3;chunk4;');
  });
});

test('a body over the cap is refused with too_large, by length or while streaming', async () => {
  await withServer(async (base) => {
    const declared = await fetch(`${base}/count`, { method: 'POST', body: 'x'.repeat(2000) });
    assert.equal(declared.status, 413);
    assert.equal((await declared.json()).code, 'too_large');

    // Chunked (no Content-Length): refused as it passes the cap.
    const status = await new Promise<number>((resolve, reject) => {
      const { hostname, port } = new URL(base);
      const req = httpRequest({ hostname, port, path: '/count', method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.write('y'.repeat(800));
      req.end('z'.repeat(800));
    });
    assert.equal(status, 413);
  });
});

test('the cap may depend on the request: the Link routes take what link.hello advertises, others the app cap', async () => {
  assert.equal(maxBodyBytesOf(`${LINK_API_PREFIX}files`), Math.max(LINK_MAX_BODY_BYTES, APP_MAX_BODY_BYTES));
  assert.ok(maxBodyBytesOf(`${LINK_API_PREFIX}files?id=art_x`) >= LINK_MAX_BODY_BYTES);
  assert.equal(maxBodyBytesOf('/api/open-artifact.artifact.import'), APP_MAX_BODY_BYTES);
  assert.equal(maxBodyBytesOf(undefined), APP_MAX_BODY_BYTES);
  // Per request: /count takes 1500 bytes under one cap and refuses them under the other.
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/count?big=1`, { method: 'POST', body: 'x'.repeat(1500) })).status, 200);
    assert.equal((await fetch(`${base}/count`, { method: 'POST', body: 'x'.repeat(1500) })).status, 413);
  }, (req) => (req.url?.includes('big=1') ? 2048 : 1024));
});

test('two Set-Cookie headers arrive as two', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/cookies`);
    assert.deepEqual(response.headers.getSetCookie(), ['a=1; Path=/; HttpOnly', 'b=2; Max-Age=0; Path=/']);
  });
});

test('unknown routes and HEAD', async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'not_found');
    const head = await fetch(`${base}/cookies`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});
