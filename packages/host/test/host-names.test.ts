/**
 * Which host names the Node host answers, in every mode (FX7):
 *
 * - `hostKindOf`: the app host exactly (case, a default port written out and an IPv6 literal's spelling do not
 *   matter; a trailing dot, another port, another name do), content hosts, strays, malformed values;
 * - the running host in two-origin mode: the app only on its own host, a content host to the rooms, a stray name 421
 *   (no cookie, no redirect, no form) on every route, a malformed `Host` 400 (not a 500), the health check on any name,
 *   `X-Forwarded-Host` only with `OA_TRUST_PROXY`, WebSocket upgrades refused the same way;
 * - the dev defaults (`localhost`, `{id}.content.localhost`) and an IPv6 app origin.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import { parseConfig } from '../src/core/config.ts';
import { hostKindOf } from '../src/core/page-token.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { startHost, type RunningHost } from '../src/node/host.ts';

const KEY = 'k'.repeat(40);
const OWNER_KEY = 'o'.repeat(30);
const APP = 'https://app.example.com';
const CONTENT = 'https://{id}.content.example.net';
const ARTIFACT_HOST = 'art-0000000000000000.content.example.net';

interface Raw {
  status: number;
  head: string;
  body: string;
}

/** Sends a request head exactly as written (`lines` without the request line) and reads the whole answer. */
function raw(port: number, requestLine: string, lines: string[], body = ''): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const split = text.indexOf('\r\n\r\n');
      const head = split >= 0 ? text.slice(0, split) : text;
      resolve({ status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0), head: head.toLowerCase(), body: split >= 0 ? text.slice(split + 4) : '' });
    });
    socket.write(`${requestLine}\r\n${[...lines, 'Connection: close'].join('\r\n')}\r\n\r\n${body}`);
  });
}

const get = (port: number, host: string | null, path = '/', extra: string[] = []): Promise<Raw> =>
  raw(port, `GET ${path} HTTP/1.1`, [...(host === null ? [] : [`Host: ${host}`]), ...extra]);

async function start(env: Record<string, string>, options: { trustProxy?: boolean } = {}): Promise<{ host: RunningHost; close(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-names-'));
  await mkdir(join(dir, 'assets', 'editors'), { recursive: true });
  const config = parseConfig({ OA_SIGNING_KEYS: KEY, OA_OWNER_KEY: OWNER_KEY, ...env });
  const nodeEnv = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: '0', OA_BIND: '127.0.0.1', OA_ASSETS_DIR: join(dir, 'assets') });
  const host = await startHost({ config, env: nodeEnv, uiDir: join(dir, 'ui'), log: () => undefined, ...(options.trustProxy ? { trustProxy: true } : {}) });
  return {
    host,
    async close() {
      await host.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('hostKindOf: the app host exactly, content hosts, strays and malformed values', () => {
  const config = { appOrigin: APP, contentOrigin: CONTENT };
  const kind = (host: string | undefined, scheme?: string): string => {
    const k = hostKindOf(config, host, scheme);
    return k.kind === 'content' ? `content:${k.id}` : k.kind;
  };
  assert.equal(kind('app.example.com'), 'app');
  assert.equal(kind('APP.Example.COM'), 'app');
  assert.equal(kind('app.example.com:443'), 'app');
  assert.equal(kind(' app.example.com '), 'app');
  assert.equal(kind('app.example.com', 'http'), 'app', 'behind a proxy that says http, the name still decides');
  assert.equal(kind('app.example.com:443', 'http'), 'stray', 'port 443 is not the default for http');
  assert.equal(kind('app.example.com.'), 'stray', 'a trailing dot is another origin to a browser');
  assert.equal(kind('app.example.com:8443'), 'stray');
  assert.equal(kind('login.content.example.net'), 'stray', 'not a well-formed artifact label');
  assert.equal(kind('www.example.com'), 'stray');
  assert.equal(kind('127.0.0.1'), 'stray');
  assert.equal(kind('[::1]:4900'), 'stray');
  assert.equal(kind(ARTIFACT_HOST), 'content:art_0000000000000000');
  assert.equal(kind(ARTIFACT_HOST.toUpperCase()), 'content:art_0000000000000000');
  assert.equal(kind(`${ARTIFACT_HOST}:443`), 'content:art_0000000000000000');
  assert.equal(kind(`${ARTIFACT_HOST}.`), 'stray');
  for (const bad of [undefined, '', '   ', 'a b', 'user@app.example.com', 'app.example.com/x', 'app.example.com?x', 'app.example.com#x', 'a:1:2', 'app.example.com:99999', 'www.127.0.0.1:5177', `${'a'.repeat(400)}.example.com`, 'app.example.com\\x', '[::1', 'ex%61mple.com']) {
    assert.equal(kind(bad), 'malformed', String(bad));
  }

  const v6 = { appOrigin: 'http://[::1]:4900', contentOrigin: 'http://{id}.content.localhost:4900' };
  assert.equal(hostKindOf(v6, '[::1]:4900').kind, 'app');
  assert.equal(hostKindOf(v6, '[0:0:0:0:0:0:0:1]:4900').kind, 'app', 'an IPv6 literal compared in its canonical form');
  assert.equal(hostKindOf(v6, '[::1]').kind, 'stray');
  assert.equal(hostKindOf(v6, 'localhost:4900').kind, 'stray');
});

describe('the Node host in two-origin mode answers the app only on its own host', () => {
  let site: Awaited<ReturnType<typeof start>>;
  let port: number;

  before(async () => {
    site = await start({ OA_APP_ORIGIN: APP, OA_CONTENT_ORIGIN: CONTENT });
    port = site.host.port;
  });
  after(() => site.close());

  it('answers its own host (any case, the default port written out)', async () => {
    for (const host of ['app.example.com', 'APP.EXAMPLE.COM', 'app.example.com:443']) {
      const answer = await get(port, host, '/auth/sign-in');
      assert.equal(answer.status, 200, `${host}: ${answer.body}`);
    }
  });

  it('refuses a stray name with 421 on every route: plain text, no cookie, no redirect, no form', async () => {
    const strays = ['login.content.example.net', 'www.example.com', 'app.example.com.', 'app.example.com:8443', `127.0.0.1:${port}`, `[::1]:${port}`, 'content.example.net'];
    const paths = ['/', '/auth/sign-in', '/auth/sign-out', '/api/open-artifact.library', '/s/abc', '/mcp', '/.well-known/oauth-authorization-server', '/plugins/x/y', '/_open-artifact/home/index.js', '/link/device', '/a/art_0000000000000000'];
    for (const host of strays) {
      for (const path of paths) {
        const answer = await get(port, host, path);
        assert.equal(answer.status, 421, `${host}${path}: ${answer.status}`);
        assert.doesNotMatch(answer.head, /set-cookie|location:/, `${host}${path}`);
        assert.match(answer.head, /content-type: text\/plain/);
        assert.doesNotMatch(answer.body, /<form|<html/i);
      }
    }
    const signIn = await raw(port, 'POST /auth/owner-key HTTP/1.1', ['Host: login.content.example.net', 'Origin: https://login.content.example.net', 'Sec-Fetch-Site: same-origin', 'Content-Type: application/x-www-form-urlencoded', `Content-Length: ${`key=${OWNER_KEY}`.length}`], `key=${OWNER_KEY}`);
    assert.equal(signIn.status, 421);
    assert.doesNotMatch(signIn.head, /set-cookie/);
  });

  it('sends a content host to its artifact (a well-formed unknown one is the rooms\' 404, not the app)', async () => {
    const page = await get(port, ARTIFACT_HOST, '/');
    assert.notEqual(page.status, 421);
    assert.doesNotMatch(page.head, /set-cookie/);
    assert.doesNotMatch(page.head, /x-frame-options: deny/, 'not the app');
  });

  it('answers 400 to a missing or malformed Host, never a 500', async () => {
    for (const host of ['www.127.0.0.1:5177', 'a b', 'user@app.example.com', 'app.example.com/x', 'a:1:2', 'app.example.com:99999', 'x'.repeat(5000), '[::1']) {
      const answer = await get(port, host);
      assert.equal(answer.status, 400, `${host.slice(0, 40)}: ${answer.status} ${answer.body}`);
      assert.doesNotMatch(answer.head, /set-cookie/);
    }
    // An empty Host and none at all (HTTP/1.0 may leave it out; Node itself refuses HTTP/1.1 without one).
    assert.equal((await get(port, '')).status, 400);
    assert.equal((await raw(port, 'GET / HTTP/1.0', [])).status, 400);
    assert.equal((await get(port, null)).status, 400);
  });

  it('answers the health check on any name, even a malformed one', async () => {
    for (const host of ['app.example.com', 'www.example.com', `127.0.0.1:${port}`, 'www.127.0.0.1:5177']) {
      assert.equal((await get(port, host, '/__open-artifact/health')).status, 200, host);
    }
  });

  it('refuses a WebSocket upgrade on a stray name with 421', async () => {
    const answer = await get(port, 'www.example.com', '/api/open-artifact.events', ['Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13']);
    assert.equal(answer.status, 421);
  });

  it('does not read X-Forwarded-Host without OA_TRUST_PROXY', async () => {
    assert.equal((await get(port, 'www.example.com', '/auth/sign-in', ['X-Forwarded-Host: app.example.com'])).status, 421);
    assert.equal((await get(port, 'app.example.com', '/auth/sign-in', ['X-Forwarded-Host: www.example.com'])).status, 200);
  });
});

test('behind a trusted proxy the forwarded host decides, with the same rule', async () => {
  const site = await start({ OA_APP_ORIGIN: APP, OA_CONTENT_ORIGIN: CONTENT }, { trustProxy: true });
  const port = site.host.port;
  try {
    const upstream = `127.0.0.1:${port}`;
    const via = (forwarded: string, path = '/auth/sign-in'): Promise<Raw> => get(port, upstream, path, [`X-Forwarded-Host: ${forwarded}`, 'X-Forwarded-Proto: https']);
    assert.equal((await via('app.example.com')).status, 200);
    assert.equal((await via('login.content.example.net')).status, 421, 'Caddy sends every name of the wildcard: a stray is refused');
    assert.equal((await via('www.127.0.0.1:5177')).status, 400);
    assert.notEqual((await via(ARTIFACT_HOST, '/')).status, 421);
    // Without a forwarded host, the upstream address is not the app.
    assert.equal((await get(port, upstream, '/auth/sign-in')).status, 421);
  } finally {
    await site.close();
  }
});

test('the dev defaults: localhost is the app, {id}.content.localhost the content, 127.0.0.1 neither', async () => {
  const site = await start({ OA_APP_ORIGIN: 'http://localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.content.localhost:4900' });
  const port = site.host.port;
  try {
    assert.equal((await get(port, 'localhost:4900', '/auth/sign-in')).status, 200);
    assert.equal((await get(port, 'localhost', '/auth/sign-in')).status, 421, 'the port is part of the app host');
    assert.equal((await get(port, '127.0.0.1:4900', '/auth/sign-in')).status, 421);
    assert.equal((await get(port, 'other.localhost:4900', '/auth/sign-in')).status, 421);
    assert.notEqual((await get(port, 'art-0000000000000000.content.localhost:4900', '/')).status, 421);
  } finally {
    await site.close();
  }
});

test('an IPv6 app origin answers its literal in any spelling', async () => {
  const site = await start({ OA_APP_ORIGIN: 'http://[::1]:4900', OA_CONTENT_ORIGIN: 'http://{id}.content.localhost:4900' });
  const port = site.host.port;
  try {
    assert.equal((await get(port, '[::1]:4900', '/auth/sign-in')).status, 200);
    assert.equal((await get(port, '[0:0:0:0:0:0:0:1]:4900', '/auth/sign-in')).status, 200);
    assert.equal((await get(port, '[::2]:4900', '/auth/sign-in')).status, 421);
    assert.equal((await get(port, 'localhost:4900', '/auth/sign-in')).status, 421);
  } finally {
    await site.close();
  }
});
