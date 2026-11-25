/**
 * A host on a LAN over plain http: the private names `OA_APP_ORIGIN` and `OA_CONTENT_ORIGIN` may use http for,
 * `OA_ALLOW_HTTP` for anything else, the content origin's `{id}` label with an explanation of the two LAN setups, and
 * the cookies over http (no `__Host-` prefix, no `Secure`).
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { guestCookie } from '../src/core/auth/session.ts';
import { ConfigError, parseConfig } from '../src/core/config.ts';
import { sessionCookie } from '../src/core/http.ts';
import { withSigningKeys } from '../src/node/main.ts';

const KEY = 'k'.repeat(32);

function fails(env: Record<string, string>, variable: string, pattern?: RegExp): void {
  assert.throws(
    () => parseConfig({ OA_SIGNING_KEYS: KEY, ...env }),
    (error: unknown) => error instanceof ConfigError && error.variable === variable && (!pattern || pattern.test(error.message)),
  );
}

test('http is accepted for private-network names, decided by the name as written', () => {
  const setups: Array<[string, string]> = [
    // The app at the address, artifacts under nip.io names spelling it.
    ['http://192.168.1.20:4900', 'http://{id}.192-168-1-20.nip.io:4900'],
    // A wildcard DNS record on the LAN.
    ['http://oa.lan:4900', 'http://{id}.oa-content.lan:4900'],
    ['http://nas.local:4900', 'http://{id}.content.nas-oa.local:4900'],
    ['http://oa.home.arpa', 'http://{id}.content.home.arpa'],
    ['http://10.0.0.5', 'http://{id}.10.0.0.5.sslip.io'],
    ['http://oa.internal:8080', 'http://{id}.oa-content.internal:8080'],
  ];
  for (const [app, content] of setups) {
    const config = parseConfig({ OA_SIGNING_KEYS: KEY, OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: content });
    assert.equal(config.appOrigin, app);
    assert.equal(config.contentOrigin, content);
  }
});

test('http for a public name (or a nip.io name spelling a public address) needs OA_ALLOW_HTTP', () => {
  fails({ OA_APP_ORIGIN: 'http://artifacts.example.com', OA_CONTENT_ORIGIN: 'http://{id}.content.example.net' }, 'OA_APP_ORIGIN', /private network.*nip\.io \/ sslip\.io name/s);
  fails({ OA_APP_ORIGIN: 'http://8.8.8.8', OA_CONTENT_ORIGIN: 'http://{id}.content.localhost' }, 'OA_APP_ORIGIN', /OA_ALLOW_HTTP/);
  fails({ OA_APP_ORIGIN: 'http://192.168.1.20', OA_CONTENT_ORIGIN: 'http://{id}.8-8-8-8.nip.io' }, 'OA_CONTENT_ORIGIN', /https/);
  const allowed = parseConfig({ OA_SIGNING_KEYS: KEY, OA_ALLOW_HTTP: '1', OA_APP_ORIGIN: 'http://artifacts.example.com', OA_CONTENT_ORIGIN: 'http://{id}.content.example.net' });
  assert.equal(allowed.appOrigin, 'http://artifacts.example.com');
  fails({ OA_ALLOW_HTTP: 'maybe' }, 'OA_ALLOW_HTTP');
});

test('a content origin without an {id} host label says why it needs one and how to get one on a LAN', () => {
  fails({ OA_APP_ORIGIN: 'http://oa.lan:4900', OA_CONTENT_ORIGIN: 'http://192.168.1.20:4900' }, 'OA_CONTENT_ORIGIN', /wildcard DNS record.*nip\.io/s);
  fails({ OA_CONTENT_ORIGIN: 'http://content-{id}.lan' }, 'OA_CONTENT_ORIGIN', /first label.*own host name/s);
  // nip.io names are their own sites (it is on the Public Suffix List): two of them can be app and content.
  assert.ok(parseConfig({ OA_SIGNING_KEYS: KEY, OA_APP_ORIGIN: 'http://oa.192-168-1-20.nip.io', OA_CONTENT_ORIGIN: 'http://{id}.c.192-168-1-21.nip.io' }));
  fails({ OA_APP_ORIGIN: 'http://oa.192-168-1-20.nip.io', OA_CONTENT_ORIGIN: 'http://{id}.192-168-1-20.nip.io' }, 'OA_CONTENT_ORIGIN', /different site/);
});

test('over http the cookies drop __Host- and Secure; over https they keep them', () => {
  const lan = { appOrigin: 'http://oa.lan:4900' };
  assert.equal(sessionCookie(lan).name, 'oa_session');
  assert.equal(sessionCookie(lan).options.secure, false);
  assert.ok(!guestCookie(lan, 'art_0123456789').name.startsWith('__Host-'));
  assert.equal(guestCookie(lan, 'art_0123456789').options.secure, false);
  const web = { appOrigin: 'https://oa.example.com' };
  assert.equal(sessionCookie(web).name, '__Host-oa_session');
  assert.equal(sessionCookie(web).options.secure, true);
  assert.ok(guestCookie(web, 'art_0123456789').name.startsWith('__Host-'));
});

test('a host on a private network may generate its signing key; one on a public name may not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-keys-'));
  const lan = await withSigningKeys({ OA_APP_ORIGIN: 'http://192.168.1.20:4900' }, dir);
  assert.ok(lan.OA_SIGNING_KEYS && lan.OA_SIGNING_KEYS.length >= 32);
  assert.ok(JSON.parse(await readFile(join(dir, 'keys.json'), 'utf8')).signingKeys);
  const web = await withSigningKeys({ OA_APP_ORIGIN: 'https://oa.example.com' }, await mkdtemp(join(tmpdir(), 'open-artifact-host-keys-')));
  assert.equal(web.OA_SIGNING_KEYS, undefined);
});

test('a refused configuration generates no signing key: nothing is written until the settings are valid', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-keys-'));
  // Both origins on one site without OA_CONTENT_SAME_SITE: refused, so no keys.json.
  const refused = { OA_APP_ORIGIN: 'http://192.168.1.20.nip.io:4900', OA_CONTENT_ORIGIN: 'http://{id}.192.168.1.20.nip.io:4900' };
  assert.throws(() => parseConfig({ OA_SIGNING_KEYS: KEY, ...refused }), ConfigError);
  const lines: string[] = [];
  const env = await withSigningKeys(refused, dir, (line) => lines.push(line));
  assert.equal(env.OA_SIGNING_KEYS, undefined);
  assert.equal(lines.length, 0);
  await assert.rejects(readFile(join(dir, 'keys.json'), 'utf8'), { code: 'ENOENT' });
  // Corrected, the key is made and said once.
  const good = await withSigningKeys({ OA_APP_ORIGIN: 'http://192.168.1.20:4900', OA_CONTENT_ORIGIN: 'http://{id}.192.168.1.20.nip.io:4900' }, dir, (line) => lines.push(line));
  assert.ok(good.OA_SIGNING_KEYS);
  assert.match(lines.join('\n'), /Generated a signing key/);
});
