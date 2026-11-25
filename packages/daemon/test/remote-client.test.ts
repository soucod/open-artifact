/**
 * The Link client on its own (`remote.ts`), against the fake host: which host addresses are taken, the device sign-in
 * (with `slow_down` and a refusal), refreshing the access token once however many calls need it, a dead refresh
 * token, and that the paths a sync carries are the ones the export zip carries.
 */

import { TEST_HOME } from './helpers.ts';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { OpenArtifactError, archiveIncludes } from '@open-artifact/protocol';
import { archiveKeeps } from '../../type-server/src/archive.ts';
import { files } from '../src/paths.ts';
import { LinkClient, RemotesFile, checkHost, linkDevice, parseLinkEvent, pollDeviceToken, readSse, remoteErrorCode, tokenFields } from '../src/remote.ts';
import { remoteRemovedText, remoteStatusText } from '../src/remote-status.ts';
import { FakeHost } from './fake-host.ts';

let host: FakeHost;
const remotes = new RemotesFile();

before(async () => {
  host = await new FakeHost().start();
});

after(() => host.close());

/** Signs `name` in on the fake host (approved at once) and stores it. */
async function signIn(name: string): Promise<LinkClient> {
  const start = await linkDevice(host.url, { client: { name: 'test' } });
  host.devices.get(start.device_code)!.state = 'approved';
  const token = await pollDeviceToken(host.url, start, { sleep: async () => undefined });
  remotes.set(name, { host: host.url, lastEventId: null, addedAt: new Date().toISOString(), ...tokenFields(token) });
  return new LinkClient({ name, remotes });
}

test('a failure is one stable code beside its text', () => {
  const cases: Array<[unknown, string]> = [
    [new OpenArtifactError('connect_failed', 'dev (https://x) is not reachable: fetch failed'), 'unreachable'],
    [new OpenArtifactError('timeout', 'slow'), 'unreachable'],
    [new OpenArtifactError('unauthorized', 'not signed in to dev'), 'signed_out'],
    [new OpenArtifactError('conflict', 'taken', { status: 409 }), 'conflict'],
    [new OpenArtifactError('server_failed', 'x', { status: 409 }), 'conflict'],
    [new OpenArtifactError('too_large', 'big', { status: 413 }), 'too_large'],
    [new OpenArtifactError('not_granted', 'no', { status: 403 }), 'refused'],
    [new OpenArtifactError('bad_path', 'no', { status: 400 }), 'refused'],
    [new OpenArtifactError('server_failed', 'boom', { status: 500 }), 'error'],
    // A connection lost while an answer was read is not wrapped: still the host out of reach.
    [new TypeError('terminated'), 'unreachable'],
    [Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), 'unreachable'],
    [new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'UND_ERR_SOCKET' }) }), 'unreachable'],
    [new DOMException('The operation timed out.', 'TimeoutError'), 'unreachable'],
    [new Error('EACCES: permission denied'), 'error'],
    ['a string', 'error'],
  ];
  for (const [error, code] of cases) assert.equal(remoteErrorCode(error), code, String((error as Error).message ?? error));
});

test('remote status in words: who, whether the host answers, and each artifact\'s sync state', () => {
  assert.match(remoteStatusText([]), /^No remotes\./);
  const base = { host: 'https://oa.example', user: { id: 'u1', name: 'Ada', email: 'ada@example.com' }, signedIn: true, connected: true, reachable: true, lastEventId: null, lastError: null, code: null };
  const artifact = { url: 'open-artifact://artifact/art_1', title: 'Plan', view_url: 'https://oa.example/a/art_1', syncedAt: '2026-11-20T10:00:00Z', lastSyncAt: null, pending: [], lastError: null, code: null };
  const text = remoteStatusText([
    { ...base, name: 'work', artifacts: [{ ...artifact, id: 'art_1' }, { ...artifact, id: 'art_2', pending: ['a', 'b'], lastError: 'dev is not reachable', code: 'unreachable' }] },
    { ...base, name: 'old', signedIn: false, connected: false, lastError: 'not signed in to old', code: 'signed_out', artifacts: [] },
  ]);
  assert.equal(
    text,
    [
      'work (https://oa.example): signed in as ada@example.com, connected',
      '  art_1  "Plan"  https://oa.example/a/art_1',
      '    in sync (2026-11-20T10:00:00Z)',
      '  art_2  "Plan"  https://oa.example/a/art_1',
      '    sync failed (unreachable): dev is not reachable; 2 changes waiting',
      '',
      'old (https://oa.example): not signed in',
      '  nothing published',
    ].join('\n'),
  );
});

test('remote remove and automatic publishing with no site: sentences a person can act on', () => {
  assert.equal(remoteRemovedText({ removed: 'home', unlinked: [], default: null }), 'Removed the site home: this computer no longer publishes or syncs there.');
  const off = remoteRemovedText({ removed: 'home', unlinked: ['art_1'], autoPublishOff: true, default: null });
  assert.match(off, /This artifact is local only now .*: art_1\./);
  assert.match(off, /Automatic publishing went to that site, so it is now off.*open-artifact remote auto on/s);
  assert.match(remoteRemovedText({ removed: 'old', unlinked: [], default: 'work' }), /Publishing without --remote now uses work\./);
  const cloud = { publish: 'auto' as const, default: null, pending: [] };
  assert.match(remoteStatusText([], cloud), /no site is connected, so new artifacts stay on this computer until one is: connect one with open-artifact remote add/);
  const remote = { name: 'a', host: 'https://oa.example', user: null, signedIn: true, connected: true, reachable: true, lastEventId: null, lastError: null, code: null, artifacts: [] };
  assert.match(remoteStatusText([remote, { ...remote, name: 'b' }], cloud), /no site is chosen for it, .*open-artifact remote default <name>, or turn it off with open-artifact remote auto off/);
});

test('a host is https, or http only on this computer or a private network', () => {
  assert.equal(checkHost('https://artifacts.example.com/some/path'), 'https://artifacts.example.com');
  assert.equal(checkHost('http://localhost:4900'), 'http://localhost:4900');
  assert.equal(checkHost('http://dev.localhost:4900'), 'http://dev.localhost:4900');
  assert.equal(checkHost('http://127.0.0.1:4900'), 'http://127.0.0.1:4900');
  // A private network's names, decided by the name given (no DNS lookup).
  assert.equal(checkHost('http://192.168.1.5:4900'), 'http://192.168.1.5:4900');
  assert.equal(checkHost('http://oa.lan:4900'), 'http://oa.lan:4900');
  assert.equal(checkHost('http://artifacts.example.com', { insecureHttp: true }), 'http://artifacts.example.com');
  for (const bad of ['http://artifacts.example.com', 'http://8.8.8.8:4900', 'ftp://localhost', 'artifacts.example.com', 'https://kim:secret@example.com']) {
    assert.throws(() => checkHost(bad), (error: OpenArtifactError) => error.code === 'invalid_argument', bad);
  }
});

test('the paths a sync carries are the ones the export zip carries', () => {
  const paths = [
    'index.html',
    'assets/app.js',
    '.artifact.json',
    '.gitignore',
    '.env',
    'doc/.sessions.json',
    'doc/.people.json',
    'doc/tabs/.deleted',
    'doc/tabs/.other',
    'doc/content.json',
    'sheet/book.json',
    '_agent/notes.md',
    'sub/_agent/notes.md',
    'node_modules/x/index.js',
    'src/.git/config',
    '.DS_Store',
    'img/Thumbs.db',
    'desktop.ini',
    'data.json.tmp',
    '.tmp-123',
    'a/b/c/d.txt',
  ];
  for (const path of paths) assert.equal(archiveIncludes(path), archiveKeeps(path), path);
  assert.equal(archiveIncludes('a/../b'), false);
  assert.equal(archiveIncludes(''), false);
});

test('device sign-in polls at the interval, waits longer after slow_down, and stores the tokens 0600', async () => {
  const start = await linkDevice(host.url, { client: { name: 'test' } });
  assert.match(start.verification_uri_complete, /\/link\?code=/);
  assert.equal(start.user_code, host.devices.get(start.device_code)!.userCode);
  const device = host.devices.get(start.device_code)!;
  device.slowDowns = 1;
  const waits: number[] = [];
  const token = await pollDeviceToken(host.url, start, {
    slowDownMs: 1000,
    sleep: async (ms) => {
      waits.push(ms);
      if (waits.length === 3) device.state = 'approved';
    },
  });
  // The first poll is told to slow down: every wait after it is longer.
  assert.deepEqual(waits, [50, 1050, 1050]);
  assert.equal(device.polls.length, 3);
  assert.equal(token.user.name, 'Kim');
  remotes.set('flow', { host: host.url, lastEventId: null, addedAt: new Date().toISOString(), ...tokenFields(token) });
  assert.equal(statSync(files.remotes()).mode & 0o777, 0o600);
  assert.ok(files.remotes().startsWith(TEST_HOME));
  assert.equal(remotes.get('flow')?.refreshToken, token.refresh_token);
});

test('a refused device sign-in fails with not_granted', async () => {
  const start = await linkDevice(host.url, { client: { name: 'test' } });
  host.devices.get(start.device_code)!.state = 'denied';
  await assert.rejects(pollDeviceToken(host.url, start, { sleep: async () => undefined }), (error: OpenArtifactError) => error.code === 'not_granted');
});

test('a sign-in whose host cannot be reached fails with connect_failed', async () => {
  await assert.rejects(linkDevice('http://127.0.0.1:9', { client: { name: 'test' } }), (error: OpenArtifactError) => error.code === 'connect_failed');
});

test('an access token the host refuses is refreshed once, however many calls wait for it', async () => {
  const client = await signIn('single');
  assert.equal((await client.hello()).user.id, 'u_kim');
  const before = host.refreshes;
  const oldRefresh = remotes.get('single')!.refreshToken;
  host.expireAccessTokens();
  host.refreshDelayMs = 100;
  try {
    const answers = await Promise.all(Array.from({ length: 6 }, () => client.hello()));
    assert.equal(answers.length, 6);
  } finally {
    host.refreshDelayMs = 0;
  }
  assert.equal(host.refreshes - before, 1);
  // The rotated pair is stored; the old refresh token is gone.
  assert.notEqual(remotes.get('single')!.refreshToken, oldRefresh);

  // A token that runs out by its time is refreshed before the call, also once.
  remotes.patch('single', { expiresAt: new Date(Date.now() - 1000).toISOString() });
  await Promise.all([client.hello(), client.hello(), client.hello()]);
  assert.equal(host.refreshes - before, 2);
});

test('a refresh token the host no longer takes means: not signed in to <name>', async () => {
  const client = await signIn('dead');
  host.revokeRefreshTokens();
  await assert.rejects(client.hello(), (error: OpenArtifactError) => {
    assert.equal(error.code, 'unauthorized');
    assert.equal(error.message, 'not signed in to dead');
    assert.match(String(error.fix), /open-artifact remote add dead /);
    return true;
  });
  assert.equal(remotes.get('dead')!.refreshToken, null);
  assert.equal(client.signedIn(), false);
  await assert.rejects(client.hello(), /not signed in to dead/);
});

test('server-sent events are read by id, in pieces too', async () => {
  const text = ': hi\n\nid: ev_1\ndata: {"type":"wake","artifact":"art_a"}\n\nid: ev_2\r\ndata: {"id":"ev_2","type":"files",\ndata: "artifact":"art_a","author":"user","paths":["x"]}\n\ndata: not json\n\n';
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7));
      controller.close();
    },
  });
  const got = [];
  for await (const message of readSse(body)) got.push(parseLinkEvent(message));
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], { id: 'ev_1', type: 'wake', artifact: 'art_a' });
  assert.equal(got[1]?.id, 'ev_2');
  assert.equal(got[1]?.type, 'files');
  assert.equal(got[2], null);
});
