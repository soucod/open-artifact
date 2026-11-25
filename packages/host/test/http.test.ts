import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenArtifactError } from '@open-artifact/protocol';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import {
  Router,
  assertSameOrigin,
  errorResponse,
  httpError,
  json,
  parseCookies,
  readJson,
  serializeCookie,
  sessionCookie,
  statusOf,
  type BaseCtx,
  type Ctx,
  type Handler,
} from '../src/core/http.ts';
import type { SqlDriver } from '../src/core/types.ts';

const nullDriver: SqlDriver = {
  all: async () => [],
  get: async () => undefined,
  run: async () => ({ changes: 0 }),
  batch: async () => undefined,
};
const config = parseConfig({ OA_SIGNING_KEYS: 'k'.repeat(32) });
const logs: string[] = [];
const ctx: BaseCtx = { config, catalog: new Catalog(nullDriver, { signingKeys: config.signingKeys }), now: () => new Date(0), log: (line) => logs.push(line) };
const req = (method: string, path: string, init: RequestInit = {}): Request => new Request(`http://localhost:4900${path}`, { method, ...init });

test('the router matches method and path, first match wins, with params and a rest', async () => {
  const router = new Router()
    .get('/a/:id', async (_r, c) => json({ route: 'a', id: c.params.id }))
    .get('/a/special', async () => json({ route: 'never' }))
    .post('/a/:id', async (_r, c) => json({ route: 'post', id: c.params.id }))
    .get('/files/*', async (_r, c) => json({ rest: c.params['*'] }))
    .on('*', '/any', async (r) => json({ method: r.method }));
  assert.deepEqual(await (await router.handle(req('GET', '/a/art%5Fx'), ctx)).json(), { route: 'a', id: 'art_x' });
  assert.deepEqual(await (await router.handle(req('GET', '/a/special'), ctx)).json(), { route: 'a', id: 'special' });
  assert.deepEqual(await (await router.handle(req('POST', '/a/1'), ctx)).json(), { route: 'post', id: '1' });
  assert.deepEqual(await (await router.handle(req('GET', '/files/x/y.png'), ctx)).json(), { rest: 'x/y.png' });
  assert.deepEqual(await (await router.handle(req('GET', '/files'), ctx)).json(), { rest: '' });
  assert.deepEqual(await (await router.handle(req('DELETE', '/any'), ctx)).json(), { method: 'DELETE' });
  const head = await router.handle(req('HEAD', '/a/1'), ctx);
  assert.equal(head.status, 200, 'HEAD falls back to GET');
  assert.throws(() => new Router().get('/*/x', async () => json({})), TypeError);
});

test('the router answers 404 and 405 in the protocol error shape', async () => {
  const router = new Router().get('/a', async () => json({})).post('/a', async () => json({}));
  const missing = await router.handle(req('GET', '/b'), ctx);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'not_found');
  const wrong = await router.handle(req('PUT', '/a'), ctx);
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'GET, POST');
  const body = await wrong.json();
  assert.equal(body.code, 'method_not_found');
  assert.equal(typeof body.message, 'string');
});

test('thrown errors become answers; unknown ones are 500 without details', async () => {
  const router = new Router()
    .get('/denied', async () => {
      throw httpError('not_granted', 'No.', { fix: 'Ask the owner.' });
    })
    .get('/boom', async () => {
      throw new Error('secret internals');
    });
  const denied = await router.handle(req('GET', '/denied'), ctx);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { code: 'not_granted', message: 'No.', fix: 'Ask the owner.' });
  const boom = await router.handle(req('GET', '/boom'), ctx);
  assert.equal(boom.status, 500);
  const body = await boom.json();
  assert.equal(body.code, 'error');
  assert.doesNotMatch(body.message, /secret/);
  assert.ok(logs.some((line) => line.includes('secret internals')), 'logged');
});

test('statusOf follows the daemon mapping', () => {
  const cases: Array<[string, number]> = [['not_found', 404], ['unauthorized', 401], ['not_granted', 403], ['conflict', 409], ['unsupported', 409], ['too_large', 413], ['rate_limited', 429], ['server_failed', 502], ['invalid_argument', 400]];
  for (const [code, status] of cases) assert.equal(statusOf(new OpenArtifactError(code, 'x')), status, code);
  assert.equal(statusOf(httpError('not_found', 'x', { status: 410 })), 410);
  assert.equal(errorResponse(httpError('conflict', 'x', { current: { v: 1 } })).status, 409);
});

test('a context extends by intersection, without casts', async () => {
  type Authed = Ctx<{ principal: { name: string } }>;
  const router = new Router<Authed>().get('/me', async (_r, c) => json({ name: c.principal.name }));
  const handler: Handler<Authed> = router.handle;
  assert.deepEqual(await (await handler(req('GET', '/me'), { ...ctx, principal: { name: 'Ada' } })).json(), { name: 'Ada' });
});

test('json and readJson', async () => {
  const response = json({ a: 1 }, { status: 201, headers: { 'x-y': 'z' } });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-y'), 'z');
  assert.deepEqual(await readJson(req('POST', '/', { body: '{"b":2}' })), { b: 2 });
  await assert.rejects(readJson(req('POST', '/', { body: 'nope' })), (e: unknown) => e instanceof OpenArtifactError && e.code === 'invalid_argument');
  await assert.rejects(readJson(req('POST', '/', { body: JSON.stringify({ big: 'x'.repeat(100) }) }), 50), (e: unknown) => e instanceof OpenArtifactError && e.code === 'too_large');
});

test('cookies parse and serialise', () => {
  assert.deepEqual(parseCookies('a=1; b="two"; c=%E4%B8%AD; a=again; bad; =x'), { a: '1', b: 'two', c: '中' });
  assert.deepEqual(parseCookies(null), {});
  assert.equal(serializeCookie('oa_session', 'v a', { httpOnly: true, sameSite: 'Lax', maxAge: 60 }), 'oa_session=v%20a; Max-Age=60; Path=/; HttpOnly; SameSite=Lax');
  assert.throws(() => serializeCookie('bad name', 'x'), TypeError);
  assert.deepEqual(sessionCookie({ appOrigin: 'https://a.example.com' }), { name: '__Host-oa_session', options: { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' } });
  assert.equal(sessionCookie({ appOrigin: 'http://localhost:4900' }).name, 'oa_session');
  assert.equal(sessionCookie({ appOrigin: 'http://localhost:4900' }).options.secure, false);
});

test('same-origin writes: reads pass, foreign origins and cross-site fetches are refused', () => {
  const refused = (r: Request): void => assert.throws(() => assertSameOrigin(r, config), (e: unknown) => e instanceof OpenArtifactError && e.code === 'not_granted' && statusOf(e) === 403);
  assertSameOrigin(req('GET', '/', { headers: { origin: 'https://evil.example' } }), config);
  assertSameOrigin(req('POST', '/', { headers: { origin: 'http://localhost:4900' } }), config);
  assertSameOrigin(req('POST', '/'), config);
  refused(req('POST', '/', { headers: { origin: 'https://evil.example' } }));
  refused(req('POST', '/', { headers: { origin: 'http://art-0abcdefghi1234.content.localhost:4900', 'sec-fetch-site': 'same-site' } }));
  refused(req('DELETE', '/', { headers: { 'sec-fetch-site': 'cross-site' } }));
  refused(req('POST', '/', { headers: { origin: 'null' } }));
});

test('same-origin writes with the exact headers a browser sends (decision 22)', () => {
  const allowed = (headers: Record<string, string>): void => assert.doesNotThrow(() => assertSameOrigin(req('POST', '/auth/owner-key', { headers }), config), JSON.stringify(headers));
  const refused = (headers: Record<string, string>): void =>
    assert.throws(() => assertSameOrigin(req('POST', '/auth/owner-key', { headers }), config), (e: unknown) => e instanceof OpenArtifactError && e.code === 'not_granted', JSON.stringify(headers));
  const form = { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' };
  // (a) A form posted from one of the host's pages that was under `Referrer-Policy: no-referrer`: Chromium says `Origin: null`.
  allowed({ ...form, origin: 'null', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' });
  // (b) The Shell's own fetch.
  allowed({ origin: 'http://localhost:4900', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'content-type': 'application/json' });
  // (c) A form on another site.
  refused({ ...form, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' });
  // (d) A same-site sibling: a content host under the app's parent domain, even with the app's Origin spoofed by nothing.
  refused({ origin: 'http://art-0abcdefghi1234.content.localhost:4900', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' });
  refused({ origin: 'http://localhost:4900', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' });
  // (e) A non-browser client: no Sec-Fetch headers, no Origin, a Bearer token.
  allowed({ authorization: 'Bearer oa_at_x', 'content-type': 'application/json' });
  // (f) No Sec-Fetch headers and `Origin: null` (a sandboxed frame, a file: page in an old browser).
  refused({ origin: 'null' });
  // `none` (typed, or a tool) passes only without cookies.
  allowed({ 'sec-fetch-site': 'none', authorization: 'Bearer oa_at_x' });
  refused({ 'sec-fetch-site': 'none', cookie: 'oa_session=x' });
  // With Sec-Fetch-Site present, a matching Origin does not rescue a cross-site request.
  refused({ origin: 'http://localhost:4900', 'sec-fetch-site': 'cross-site' });
});
