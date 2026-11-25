import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLibraryApi } from '../src/lib/api.ts';
import { translate, type MessageKey } from '../src/lib/i18n.ts';
import {
  checkHostAddress,
  checkName,
  connectFailure,
  hostLabel,
  publishFailure,
  publishedOf,
  remoteState,
  suggestName,
  syncText,
  syncView,
  unpublishFailure,
  type RemoteArtifact,
  type RemoteInfo,
} from '../src/lib/publish.ts';

function artifact(patch: Partial<RemoteArtifact> = {}): RemoteArtifact {
  return { id: 'art_1', url: 'artifact://art_1', title: 'Plan', view_url: 'https://oa.example/a/art_1', syncedAt: '2026-11-20T10:00:00Z', lastSyncAt: null, pending: [], lastError: null, code: null, ...patch };
}

function remote(patch: Partial<RemoteInfo> = {}): RemoteInfo {
  return { name: 'work', host: 'https://oa.example', user: { id: 'u1', name: 'Ada' }, signedIn: true, connected: true, reachable: true, lastEventId: null, lastError: null, code: null, artifacts: [], ...patch };
}

describe('checkHostAddress', () => {
  it('takes https addresses as their origin', () => {
    assert.deepEqual(checkHostAddress(' https://oa.example.com/some/path '), { ok: true, host: 'https://oa.example.com' });
    assert.deepEqual(checkHostAddress('https://oa.example.com:8443'), { ok: true, host: 'https://oa.example.com:8443' });
  });

  it('reads a bare name as https, and localhost as http', () => {
    assert.deepEqual(checkHostAddress('oa.example.com'), { ok: true, host: 'https://oa.example.com' });
    assert.deepEqual(checkHostAddress('localhost:4900'), { ok: true, host: 'http://localhost:4900' });
    assert.deepEqual(checkHostAddress('127.0.0.1:4900'), { ok: true, host: 'http://127.0.0.1:4900' });
    assert.deepEqual(checkHostAddress('app.localhost:4900'), { ok: true, host: 'http://app.localhost:4900' });
  });

  it('allows http only on this computer (and a private network, see publish-auto.test.ts)', () => {
    assert.deepEqual(checkHostAddress('http://localhost:4900'), { ok: true, host: 'http://localhost:4900' });
    assert.deepEqual(checkHostAddress('http://oa.example.com'), { ok: false, reason: { key: 'pubHostNotHttps' } });
  });

  it('refuses empty, malformed, other schemes and credentials', () => {
    assert.deepEqual(checkHostAddress('  '), { ok: false, reason: { key: 'pubHostEmpty' } });
    assert.deepEqual(checkHostAddress('https://'), { ok: false, reason: { key: 'pubHostInvalid' } });
    assert.deepEqual(checkHostAddress('ftp://oa.example.com'), { ok: false, reason: { key: 'pubHostInvalid' } });
    assert.deepEqual(checkHostAddress('https://me:secret@oa.example.com'), { ok: false, reason: { key: 'pubHostInvalid' } });
  });
});

describe('names', () => {
  it('suggests the host name\'s first word, numbered when taken', () => {
    assert.equal(suggestName('https://artifacts.example.com', []), 'artifacts');
    assert.equal(suggestName('http://localhost:4900', []), 'localhost');
    assert.equal(suggestName('https://oa.example.com', ['oa', 'OA-2']), 'oa-3');
    assert.equal(suggestName('not a url', []), 'web');
  });

  it('checks a name like the daemon does', () => {
    assert.equal(checkName('work'), null);
    assert.equal(checkName('my_site-2'), null);
    assert.deepEqual(checkName('-work'), { key: 'pubNameInvalid' });
    assert.deepEqual(checkName('two words'), { key: 'pubNameInvalid' });
    assert.deepEqual(checkName('x'.repeat(33)), { key: 'pubNameInvalid' });
  });
});

describe('published state', () => {
  it('finds the artifact under its remote', () => {
    const remotes = [remote({ name: 'a' }), remote({ name: 'b', artifacts: [artifact()] })];
    assert.equal(publishedOf(remotes, 'art_1')?.remote.name, 'b');
    assert.equal(publishedOf(remotes, 'art_2'), null);
    assert.equal(publishedOf(null, 'art_1'), null);
  });

  it('says how a remote stands', () => {
    assert.equal(remoteState(remote()), 'connected');
    assert.equal(remoteState(remote({ connected: false })), 'connecting');
    assert.equal(remoteState(remote({ reachable: false })), 'unreachable');
    assert.equal(remoteState(remote({ signedIn: false, reachable: false })), 'signed_out');
  });

  it('maps the sync state the daemon reports', () => {
    assert.deepEqual(syncView(remote(), artifact()), { kind: 'in_sync', at: '2026-11-20T10:00:00Z' });
    assert.deepEqual(syncView(remote(), artifact({ lastSyncAt: '2026-11-21T09:00:00Z' })), { kind: 'in_sync', at: '2026-11-21T09:00:00Z' });
    assert.deepEqual(syncView(remote(), artifact({ pending: ['index.html', 'a.css'] })), { kind: 'waiting', count: 2 });
    assert.deepEqual(syncView(remote({ reachable: false }), artifact({ pending: ['a'], lastError: 'x', code: 'error' })), { kind: 'offline', count: 1 });
    assert.deepEqual(syncView(remote({ signedIn: false }), artifact()), { kind: 'signed_out', count: 0 });
    // Decided by the code, never by the English text.
    assert.deepEqual(syncView(remote(), artifact({ lastError: 'anything at all', code: 'unreachable' })), { kind: 'offline', count: 0 });
    assert.deepEqual(syncView(remote(), artifact({ lastError: 'anything at all', code: 'signed_out' })), { kind: 'signed_out', count: 0 });
    assert.deepEqual(syncView(remote(), artifact({ lastError: 'work is not reachable: fetch failed', code: 'error' })), { kind: 'failed', error: 'work is not reachable: fetch failed', count: 0 });
    for (const code of ['conflict', 'too_large', 'refused', 'error'] as const) {
      assert.deepEqual(syncView(remote(), artifact({ lastError: 'disk full', code, pending: ['a'] })), { kind: 'failed', error: 'disk full', count: 1 }, code);
    }
  });

  it('says the sync state in words', () => {
    const ago = (): string => '5 min ago';
    const say = (s: ReturnType<typeof syncText>): string => translate('en', s.key, s.vars);
    assert.equal(say(syncText({ kind: 'in_sync', at: '2026-11-20T10:00:00Z' }, 'https://oa.example', ago)), 'Up to date · synced 5 min ago');
    assert.equal(say(syncText({ kind: 'in_sync', at: null }, 'https://oa.example', ago)), 'Up to date');
    assert.equal(say(syncText({ kind: 'waiting', count: 1 }, 'https://oa.example', ago)), '1 change waiting to be sent');
    assert.equal(say(syncText({ kind: 'waiting', count: 3 }, 'https://oa.example', ago)), '3 changes waiting to be sent');
    assert.match(say(syncText({ kind: 'offline', count: 0 }, 'https://oa.example', ago)), /^Can't reach oa\.example: changes are kept here/);
    assert.equal(say(syncText({ kind: 'failed', error: 'disk full', count: 0 }, 'https://oa.example', ago)), 'The last sync failed: disk full');
  });

  it('names a host without https://', () => {
    assert.equal(hostLabel('https://oa.example'), 'oa.example');
    assert.equal(hostLabel('http://localhost:4900'), 'http://localhost:4900');
  });
});

describe('failures in plain words', () => {
  const host = 'https://oa.example';
  const f = (code: string, message = '', status = 400) => ({ code, message, status });

  it('connecting', () => {
    assert.equal(connectFailure(f('not_granted', 'The sign-in was refused on the host.', 403), host).key, 'pubConnectDenied');
    assert.equal(connectFailure(f('timeout', 'The sign-in code ran out before it was approved. Start again.'), host).key, 'pubConnectExpired');
    assert.equal(connectFailure(f('connect_failed', 'https://oa.example is not reachable: fetch failed'), host).key, 'pubConnectUnreachable');
    assert.equal(connectFailure(f('invalid_argument', 'http://oa.example: a host must use https (http only for localhost).'), host).key, 'pubHostNotHttps');
    assert.equal(connectFailure(f('invalid_argument', 'A remote name is letters, digits, - and _ (at most 32), like work.'), host).key, 'pubNameInvalid');
    assert.equal(connectFailure(f('conflict', 'The remote work is https://other.example.', 409), host).key, 'pubNameTaken');
    assert.equal(connectFailure(f('server_failed', 'https://oa.example answered link.device without a code: is it an Open Artifact host?', 502), host).key, 'pubConnectNotHost');
    assert.equal(connectFailure(f('not_found', 'No sign-in to work is under way.', 404), host).key, 'pubConnectExpired');
    assert.equal(connectFailure(f('connect_failed', 'fetch failed', 0), host).key, 'pubNoDaemon');
    assert.deepEqual(connectFailure(f('weird', 'boom'), host), { key: 'pubConnectFailed', vars: { error: 'boom' } });
  });

  it('publishing', () => {
    assert.deepEqual(publishFailure(f('conflict', 'https://oa.example already has an artifact with the id art_1: it could not be published there.', 409), host), { key: 'pubIdTaken', vars: { host: 'oa.example' } });
    assert.equal(publishFailure(f('conflict', 'artifact://art_1 is published to home already.', 409), host).key, 'pubAlreadyElsewhere');
    assert.equal(publishFailure(f('too_large', 'too big', 413), host).key, 'pubTooLarge');
    assert.equal(publishFailure(f('server_failed', 'x', 413), host).key, 'pubTooLarge');
    assert.equal(publishFailure(f('unauthorized', 'not signed in to work', 401), host).key, 'pubSignedOut');
    assert.equal(publishFailure(f('connect_failed', 'not reachable'), host).key, 'pubUnreachable');
    assert.equal(publishFailure(f('not_granted', 'no', 403), host).key, 'pubNotAllowed');
    assert.deepEqual(publishFailure(f('error', 'boom', 500), host), { key: 'pubFailed', vars: { error: 'boom' } });
  });

  it('unpublishing', () => {
    assert.equal(unpublishFailure(f('connect_failed', "Could not bring the host's version home first: x"), host).key, 'unpubUnreachable');
    assert.equal(unpublishFailure(f('unauthorized', 'x', 401), host).key, 'pubSignedOut');
    assert.equal(unpublishFailure(f('error', 'x', 0), host).key, 'pubNoDaemon');
  });

  it('every message has English and Chinese', () => {
    const keys: MessageKey[] = [
      'pubHostEmpty', 'pubHostInvalid', 'pubHostNotHttps', 'pubNameInvalid', 'pubNameTaken', 'pubNoDaemon', 'pubConnectDenied', 'pubConnectExpired',
      'pubConnectUnreachable', 'pubConnectNotHost', 'pubConnectFailed', 'pubIdTaken', 'pubAlreadyElsewhere', 'pubTooLarge', 'pubSignedOut',
      'pubNotAllowed', 'pubUnreachable', 'pubUnsupported', 'pubFailed', 'unpubUnreachable', 'unpubFailed', 'pubInSync', 'pubInSyncAt',
      'pubWaitingOne', 'pubWaiting', 'pubOffline', 'pubSignedOutSync', 'pubSyncFailed', 'pubTitle', 'pubIntro', 'unpubBody', 'openOnWeb', 'copyWebLink',
    ];
    for (const key of keys) assert.notEqual(translate('zh-CN', key), translate('en', key), key);
  });
});

describe('the publishing routes', () => {
  it('calls the daemon routes with the shapes it reads', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const answer = url.endsWith('.remotes') ? { remotes: [remote()] } : url.endsWith('.remotes.add.wait') ? { status: 'pending' } : {};
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const api = createLibraryApi({ fetch });
    const answer = await api.remotes();
    assert.equal(answer.remotes[0]?.name, 'work');
    // An answer without `cloud` (an older daemon): no publishing by itself in the panel.
    assert.equal(answer.cloud, null);
    await api.connect('work', 'https://oa.example');
    assert.deepEqual(await api.connectWait('work', 25000), { status: 'pending' });
    await api.connectCancel('work');
    await api.publish('art_1', 'work');
    await api.unpublish('art_1');
    assert.deepEqual(calls, [
      { url: '/api/open-artifact.remotes', method: 'GET', body: undefined },
      // The panel shows the approval link itself: the daemon opens no browser window.
      { url: '/api/open-artifact.remotes.add', method: 'POST', body: { name: 'work', host: 'https://oa.example', browse: false } },
      { url: '/api/open-artifact.remotes.add.wait', method: 'POST', body: { name: 'work', ms: 25000 } },
      { url: '/api/open-artifact.remotes.add.cancel', method: 'POST', body: { name: 'work' } },
      { url: '/api/open-artifact.artifacts.publish', method: 'POST', body: { id: 'art_1', remote: 'work' } },
      { url: '/api/open-artifact.artifacts.unpublish', method: 'POST', body: { id: 'art_1' } },
    ]);
  });
});
