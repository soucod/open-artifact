/**
 * Where a daemon may send its Link token: `checkHost`'s plain-http rule and its override (`--insecure-http`,
 * `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP`), the loud warning the override earns, the preset's flag staying with its
 * address, the warning for a `preset.json` others can read, and that no token-bearing Link request follows a redirect
 * (`fetch` would resend a 307/308 body, refresh token included, to a host nobody judged).
 */

import { TEST_HOME } from './helpers.ts';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { OpenArtifactError } from '@open-artifact/protocol';
import { readPreset } from '../src/preset.ts';
import { LinkClient, RemotesFile, checkHost, insecureOrigin, insecureWarning, linkDevice, linkToken } from '../src/remote.ts';

/** What reached a server. */
interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

/** A plain http server on 127.0.0.1 answering every request with `answer`, keeping what it was sent. */
async function server(answer: (req: IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ url: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
      answer(req, res);
    });
  });
  await new Promise<void>((done) => srv.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, seen, server: srv };
}

let elsewhere: Awaited<ReturnType<typeof server>>;
let redirector: Awaited<ReturnType<typeof server>>;

before(async () => {
  // The host a redirect points at: it must never see a token.
  elsewhere = await server((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'stolen', refresh_token: 'stolen', expires_in: 3600, device_code: 'd', user_code: 'u', verification_uri: 'x', host: 'elsewhere' }));
  });
  // The linked host: answers every Link route with a 307 (method and body kept by fetch) to `elsewhere`.
  redirector = await server((req, res) => {
    res.writeHead(307, { Location: `${elsewhere.url}${req.url ?? '/'}` });
    res.end();
  });
});

after(() => {
  elsewhere.server.close();
  redirector.server.close();
});

const presetFile = join(TEST_HOME, 'preset.json');
afterEach(() => rmSync(presetFile, { force: true }));

test('plain http to a public host only with the override, and then with a loud warning', () => {
  for (const bad of ['http://artifacts.example.com', 'http://8.8.8.8:4900', 'http://100.64.0.1', 'http://10.0.0.1.evil.com', 'http://localhost.evil.com', 'http://evil.com#@10.0.0.1', 'http://8.8.8.8.10.0.0.1.nip.io']) {
    assert.throws(() => checkHost(bad), (error: OpenArtifactError) => error.code === 'invalid_argument' && /insecure-http/.test(error.fix ?? ''), bad);
  }
  // `http://10.0.0.1@evil.com` is refused by the rule (the host is evil.com), and its user info on top.
  assert.throws(() => checkHost('http://10.0.0.1@evil.com/'), (error: OpenArtifactError) => /must use https/.test(error.message));
  assert.throws(() => checkHost('https://10.0.0.1@evil.com/'), (error: OpenArtifactError) => /user name or password/.test(error.message));
  // The URL standard reads these as 10.0.0.1: allowed, and kept as the address fetch will use.
  assert.equal(checkHost('http://0x0a.0.0.1:4900'), 'http://10.0.0.1:4900');
  assert.equal(checkHost('http://167772161'), 'http://10.0.0.1');
  // The override lets a public host through ...
  const host = checkHost('http://artifacts.example.com', { insecureHttp: true });
  assert.equal(host, 'http://artifacts.example.com');
  assert.equal(insecureOrigin(host), true);
  // ... with a warning that says the token crosses the internet, unlike a LAN host's reminder.
  assert.match(insecureWarning(host), /NOT on this computer or a private network.*--insecure-http.*token/s);
  assert.doesNotMatch(insecureWarning('http://nas.lan:4900'), /NOT/);
  assert.match(insecureWarning('http://nas.lan:4900'), /not encrypted/);
  assert.equal(insecureOrigin('http://localhost:4900'), false);
  // The override is never the default: no option, no environment read here.
  assert.throws(() => checkHost('http://artifacts.example.com', {}));
});

test('the preset\'s insecure-http flag stays with the address it came with', () => {
  writeFileSync(presetFile, JSON.stringify({ OPEN_ARTIFACT_REMOTE: 'http://oa.example.com', OPEN_ARTIFACT_REMOTE_INSECURE_HTTP: '1' }), { mode: 0o600 });
  // The file's own address: its flag applies.
  assert.deepEqual(readPreset({}), { remote: 'http://oa.example.com', insecureHttp: true });
  // An address from the environment does not inherit the file's flag ...
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_REMOTE: 'http://other.example.com' }), { remote: 'http://other.example.com' });
  // ... unless the environment says so itself.
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_REMOTE: 'http://other.example.com', OPEN_ARTIFACT_REMOTE_INSECURE_HTTP: 'yes' }), { remote: 'http://other.example.com', insecureHttp: true });
});

test('a value an app left as a ${…} placeholder counts as unset', () => {
  // What Cursor hands the MCP server for an unset plugin variable or `${env:NAME}`.
  assert.deepEqual(
    readPreset({
      OPEN_ARTIFACT_PLUGIN_REMOTE: '${OPEN_ARTIFACT_SERVER}',
      OPEN_ARTIFACT_REMOTE: '${env:OPEN_ARTIFACT_REMOTE}',
      OPEN_ARTIFACT_REMOTE_TOKEN: '${env:OPEN_ARTIFACT_REMOTE_TOKEN}',
      OPEN_ARTIFACT_PUBLISH: '${env:OPEN_ARTIFACT_PUBLISH}',
      OPEN_ARTIFACT_REMOTE_INSECURE_HTTP: '${env:OPEN_ARTIFACT_REMOTE_INSECURE_HTTP}',
    }),
    {},
  );
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_PLUGIN_REMOTE: 'https://oa.example.com', OPEN_ARTIFACT_REMOTE: '${env:OPEN_ARTIFACT_REMOTE}' }), { remote: 'https://oa.example.com' });
});

test('a preset.json holding a token that others can read is used, with a warning', { skip: process.platform === 'win32' }, () => {
  writeFileSync(presetFile, JSON.stringify({ OPEN_ARTIFACT_REMOTE: 'https://oa.example.com', OPEN_ARTIFACT_REMOTE_TOKEN: 'oa_rt_secret' }));
  chmodSync(presetFile, 0o644);
  const loose = readPreset({});
  assert.equal(loose.token, 'oa_rt_secret');
  assert.match(loose.warning ?? '', /can be read by other users \(mode 644\).*chmod 600/);
  assert.doesNotMatch(loose.warning ?? '', /oa_rt_secret/);
  chmodSync(presetFile, 0o600);
  assert.equal(readPreset({}).warning, undefined);
  // No token in it: nothing secret to warn about.
  writeFileSync(presetFile, JSON.stringify({ OPEN_ARTIFACT_REMOTE: 'https://oa.example.com' }));
  chmodSync(presetFile, 0o644);
  assert.equal(readPreset({}).warning, undefined);
});

test('a Link request never follows a redirect: the token does not reach the other host', async () => {
  elsewhere.seen.length = 0;
  redirector.seen.length = 0;
  const redirected = (error: OpenArtifactError): boolean => error.code === 'redirected' && error.message.includes(elsewhere.url) && error.status === 307;

  // link.token with a refresh token in its body (fetch would resend a 307's body).
  await assert.rejects(linkToken(redirector.url, { grant_type: 'refresh_token', refresh_token: 'oa_rt_secret' }), redirected);
  // link.device.
  await assert.rejects(linkDevice(redirector.url, { client: { name: 'test' } }), redirected);

  // A signed-in client: its Bearer token on a route.
  const remotes = new RemotesFile();
  remotes.set('lan', { host: redirector.url, user: null, accessToken: 'oa_at_secret', refreshToken: 'oa_rt_secret', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastEventId: null, addedAt: new Date().toISOString() });
  const client = new LinkClient({ name: 'lan', remotes });
  await assert.rejects(client.hello(), redirected);
  await assert.rejects(client.writeFiles('art_1', [{ path: 'index.html', content: Buffer.from('secret page').toString('base64') }]), redirected);
  assert.equal(client.lastCode, 'error');
  assert.match(client.lastError ?? '', /redirect/);

  assert.equal(redirector.seen.length, 4, 'each request reached the linked host once');
  assert.ok(redirector.seen.some((s) => s.authorization === 'Bearer oa_at_secret'), 'the linked host got the token, as it should');
  assert.deepEqual(elsewhere.seen, [], 'nothing reached the host the redirect pointed at');
});

test('without redirect: manual, fetch would have carried the refresh token to the other host (the danger is real)', async () => {
  elsewhere.seen.length = 0;
  await fetch(`${redirector.url}/api/x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: 'oa_rt_secret' }) });
  assert.equal(elsewhere.seen.length, 1);
  assert.match(elsewhere.seen[0]!.body, /oa_rt_secret/);
  elsewhere.seen.length = 0;
});
