/**
 * The Node host behind a TLS-terminating reverse proxy (as Caddy or nginx put it in front): a small proxy written
 * here forwards to the real host with `Host` rewritten to the upstream address and the visitor's host and scheme in
 * `X-Forwarded-Host` / `X-Forwarded-Proto`, streams answers without buffering, and pipes WebSocket upgrades.
 *
 * With `OA_TRUST_PROXY=1` the host must work as if it were reached at its https origins: the `__Host-` session cookie
 * with `Secure`, https page addresses, content hosts found from `X-Forwarded-Host`, a page WebSocket and the app's
 * event stream through the proxy. Without it the forwarded headers are ignored.
 *
 * The editors are fakes (as in `host-e2e.test.ts`); the Shell and home page are stubs with the boot placeholders.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import type { ArtifactView, ShellBoot } from '@open-artifact/protocol';
import { archiveEntries, writeZip } from '@open-artifact/type-server';
import { HOME_BOOT_PLACEHOLDER, SHELL_BOOT_PLACEHOLDER } from '../src/core/app/pages.ts';
import { parseConfig } from '../src/core/config.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { PROXY_KEEP_ALIVE_MS, startHost, type RunningHost } from '../src/node/host.ts';

const OWNER_KEY = 'owner-key-for-the-proxy-test-0123456789';
const SAMPLE = fileURLToPath(new URL('../../../test-artifacts/whiteboard/elements', import.meta.url));
const APP = 'https://app.example.test';
const CONTENT = 'https://{id}.oa-content.example.net';

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A request to `port` as if to `url` (its host in the `Host` header). */
function call(port: number, method: string, url: string, headers: Record<string, string> = {}, body?: string | Uint8Array): Promise<Answer> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: target.pathname + target.search, headers: { host: target.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** The request head of `req` for the upstream, as a proxy that terminated TLS sends it. */
function forwardedHeaders(req: IncomingMessage, upstream: string): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers[name] = value;
  headers['x-forwarded-host'] = req.headers.host ?? '';
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1';
  headers.host = upstream;
  return headers;
}

/** A reverse proxy to `127.0.0.1:<upstream>`: streams both ways (no buffering) and pipes upgrades. */
async function startProxy(upstreamPort: number): Promise<{ server: Server; port: number }> {
  const upstream = `127.0.0.1:${upstreamPort}`;
  const server = createServer((req, res) => {
    const out = request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: forwardedHeaders(req, upstream) }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      res.flushHeaders();
      answer.pipe(res);
    });
    out.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(out);
  });
  server.on('upgrade', (req: IncomingMessage, client: Socket, head: Buffer) => {
    const socket = connect(upstreamPort, '127.0.0.1', () => {
      let lines = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [name, value] of Object.entries(forwardedHeaders(req, upstream))) for (const v of Array.isArray(value) ? value : [value]) lines += `${name}: ${v}\r\n`;
      socket.write(`${lines}\r\n`);
      if (head.length) socket.write(head);
      socket.pipe(client);
      client.pipe(socket);
    });
    socket.on('error', () => client.destroy());
    client.on('error', () => socket.destroy());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: (server.address() as AddressInfo).port };
}

/** A WebSocket handshake through `port`: the status (101 when it opened) and the socket. */
function socketTo(port: number, url: string, origin: string): Promise<{ status: number; socket?: Socket }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: target.pathname + target.search,
      headers: { host: target.host, origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13' },
    });
    req.on('upgrade', (res: IncomingMessage, socket: Socket) => resolve({ status: res.statusCode ?? 101, socket }));
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Opens an event stream through `port`: its status and type, the first bytes, and whether it is still open after `ms`. */
function streamFor(port: number, url: string, headers: Record<string, string>, ms: number): Promise<{ status: number; type: string; first: string; openAfter: boolean }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: target.pathname + target.search, headers: { host: target.host, accept: 'text/event-stream', ...headers } }, (res) => {
      let first = '';
      let ended = false;
      res.on('end', () => (ended = true));
      res.on('close', () => (ended = true));
      res.once('data', (chunk: Buffer) => {
        first = chunk.toString('utf8');
        setTimeout(() => {
          resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), first, openAfter: !ended });
          req.destroy();
        }, ms);
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? undefined : reject(error)));
    req.end();
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** This package's version (what the health check reports). */
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const cookieOf = (answer: Answer): string => (answer.headers['set-cookie'] ?? []).map((line) => line.split(';')[0]!).join('; ');

describe('host behind a reverse proxy', () => {
  let dir: string;
  let trusting: RunningHost;
  let plain: RunningHost;
  let proxy: { server: Server; port: number };

  const startOne = async (name: string, trustProxy: boolean): Promise<RunningHost> => {
    const config = parseConfig({ OA_APP_ORIGIN: APP, OA_CONTENT_ORIGIN: CONTENT, OA_SIGNING_KEYS: 'p'.repeat(40), OA_OWNER_KEY: OWNER_KEY });
    const env = parseNodeEnv({ OA_DATA_DIR: join(dir, name), OA_PORT: String(await freePort()), OA_BIND: '127.0.0.1', OA_ASSETS_DIR: join(dir, 'assets') });
    return startHost({ config, env, uiDir: join(dir, 'ui'), trustProxy, log: () => undefined });
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-proxy-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard', 'assets'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><html><head><script src="./assets/index-Ab12Cd34.js"></script></head><body></body></html>');
    await writeFile(join(assets, 'editors', 'whiteboard', 'assets', 'index-Ab12Cd34.js'), '/* editor */');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    const ui = join(dir, 'ui');
    await mkdir(join(ui, 'shell'), { recursive: true });
    await mkdir(join(ui, 'home'), { recursive: true });
    await writeFile(join(ui, 'shell', 'index.html'), `<!doctype html><script>window.boot=${SHELL_BOOT_PLACEHOLDER};</script>`);
    await writeFile(join(ui, 'home', 'index.html'), `<!doctype html><script>window.home=${HOME_BOOT_PLACEHOLDER};</script>`);
    trusting = await startOne('trusting', true);
    plain = await startOne('plain', false);
    proxy = await startProxy(trusting.port);
  });

  after(async () => {
    proxy?.server.closeAllConnections();
    await new Promise<void>((done) => (proxy ? proxy.server.close(() => done()) : done()));
    await trusting?.stop();
    await plain?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('works at its https origins through the proxy (OA_TRUST_PROXY=1)', async () => {
    const p = proxy.port;
    // Health answers without a session, through the proxy too.
    const health = await call(p, 'GET', `${APP}/__open-artifact/health`);
    assert.equal(health.status, 200, health.body);
    assert.equal((JSON.parse(health.body) as { openArtifact: number }).openArtifact, 1);

    // Sign-in sets the __Host- cookie with Secure.
    const signIn = await call(p, 'POST', `${APP}/auth/owner-key`, { origin: APP, 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ key: OWNER_KEY, return_to: '/' }).toString());
    assert.equal(signIn.status, 303, signIn.body);
    const setCookie = (signIn.headers['set-cookie'] ?? []).find((line) => line.startsWith('__Host-oa_session='));
    assert.ok(setCookie, String(signIn.headers['set-cookie']));
    assert.match(setCookie, /;\s*Secure/i);
    assert.match(setCookie, /;\s*HttpOnly/i);
    assert.match(setCookie, /;\s*Path=\//i);
    const location = String(signIn.headers.location);
    assert.ok(location.startsWith('/') || location.startsWith(`${APP}/`), `redirect stays on the https app origin: ${location}`);
    const cookie = cookieOf(signIn);

    // Import a sample and open it: the Shell boot carries https page addresses.
    const chunks: Buffer[] = [];
    await writeZip(await archiveEntries(SAMPLE), async (chunk) => {
      chunks.push(chunk);
    });
    const imported = await call(p, 'POST', `${APP}/api/open-artifact.artifacts.import`, { cookie, origin: APP, 'content-type': 'application/zip' }, new Uint8Array(Buffer.concat(chunks)));
    assert.equal(imported.status, 201, imported.body);
    const id = (JSON.parse(imported.body) as ArtifactView).id;
    const shell = await call(p, 'GET', `${APP}/a/${id}`, { cookie });
    assert.equal(shell.status, 200);
    assert.match(String(shell.headers['content-security-policy']), new RegExp(`frame-src https://${id.replace('_', '-')}\\.oa-content\\.example\\.net`));
    const boot = JSON.parse((await call(p, 'GET', `${APP}/api/open-artifact.artifacts.boot?id=${id}`, { cookie })).body) as ShellBoot;
    assert.ok(boot.pageUrl?.startsWith(`https://${id.replace('_', '-')}.oa-content.example.net/`), String(boot.pageUrl));
    assert.ok(boot.url.startsWith('https://'), boot.url);
    assert.equal(boot.cloud?.appOrigin, APP);

    // The content host is found from X-Forwarded-Host: the page and its session answer through the proxy.
    const page = await call(p, 'GET', boot.pageUrl!);
    assert.equal(page.status, 200, page.body);
    assert.equal(page.headers['set-cookie'], undefined);
    const session = await call(p, 'GET', `${boot.pageUrl!}_api/session`);
    assert.equal(session.status, 200, session.body);

    // A content-origin WebSocket opens through the proxy.
    const ws = await socketTo(p, `${boot.pageUrl!}_api/events?client=${randomBytes(4).toString('hex')}`, APP);
    assert.equal(ws.status, 101);
    ws.socket?.destroy();

    // The app's event stream is sent at once and stays open.
    const stream = await streamFor(p, `${APP}/api/open-artifact.events`, { cookie }, 400);
    assert.equal(stream.status, 200);
    assert.match(stream.type, /^text\/event-stream/);
    assert.equal(stream.openAfter, true);
  });

  it('ignores forwarded headers without OA_TRUST_PROXY', async () => {
    const label = 'art-0000000000000000';
    const contentHost = `${label}.oa-content.example.net`;
    // Without trust, X-Forwarded-Host does not make a request a content host's: the app answers it.
    const direct = await call(plain.port, 'GET', `${APP}/_api/session`, { 'x-forwarded-host': contentHost, 'x-forwarded-proto': 'https' });
    const asContent = await call(trusting.port, 'GET', `http://127.0.0.1:${trusting.port}/_api/session`, { 'x-forwarded-host': contentHost, 'x-forwarded-proto': 'https' });
    assert.equal(direct.headers['x-frame-options'], 'DENY', 'the app answered');
    assert.notEqual(asContent.headers['x-frame-options'], 'DENY', 'the content host answered');
    // Nor does it make a stray name the app's: the Host header decides, and the listener's own address is not the app.
    const byAddress = await call(plain.port, 'GET', `http://127.0.0.1:${plain.port}/`, { 'x-forwarded-host': new URL(APP).host });
    assert.equal(byAddress.status, 421, byAddress.body);

    // And the session cookie still follows the configured origin, not the forwarded scheme.
    const signIn = await call(plain.port, 'POST', `${APP}/auth/owner-key`, { origin: APP, 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'http' }, new URLSearchParams({ key: OWNER_KEY, return_to: '/' }).toString());
    assert.equal(signIn.status, 303, signIn.body);
    assert.ok((signIn.headers['set-cookie'] ?? []).some((line) => line.startsWith('__Host-oa_session=') && /;\s*Secure/i.test(line)));
  });

  it('keeps idle connections open longer than a proxy does, only behind one', () => {
    assert.equal(trusting.server.keepAliveTimeout, PROXY_KEEP_ALIVE_MS);
    assert.ok(trusting.server.headersTimeout > PROXY_KEEP_ALIVE_MS);
    assert.equal(plain.server.keepAliveTimeout, 5_000, "Node's default without a proxy");
  });

  it('answers the health check on any host name, without a session', async () => {
    for (const host of [trusting, plain]) {
      const answer = await call(host.port, 'GET', `http://127.0.0.1:${host.port}/__open-artifact/health`);
      assert.equal(answer.status, 200);
      assert.equal(answer.headers['cache-control'], 'no-store');
      assert.deepEqual(JSON.parse(answer.body), { openArtifact: 1, version: VERSION });
      assert.equal((await call(host.port, 'HEAD', `http://127.0.0.1:${host.port}/__open-artifact/health`)).status, 200);
      assert.equal((await call(host.port, 'POST', `http://127.0.0.1:${host.port}/__open-artifact/health`)).status === 200, false);
    }
  });
});
