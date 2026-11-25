/**
 * The Share panel's remote configuration, as pure functions: http addresses on a private network (with the warning),
 * the default site, publishing by itself (an artifact waiting for it, or retried after a failure), and the routes the
 * panel calls to change them (`cloud.settings`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLibraryApi } from '../src/lib/api.ts';
import { translate, type MessageKey } from '../src/lib/i18n.ts';
import { autoText, autoView, checkHostAddress, defaultSite, offersDefaultPicker, type CloudInfo, type RemoteInfo } from '../src/lib/publish.ts';

function remote(patch: Partial<RemoteInfo> = {}): RemoteInfo {
  return { name: 'work', host: 'https://oa.example', user: { id: 'u1', name: 'Ada' }, signedIn: true, connected: true, reachable: true, lastEventId: null, lastError: null, code: null, artifacts: [], ...patch };
}

function cloud(patch: Partial<CloudInfo> = {}): CloudInfo {
  return { default: null, publish: 'manual', pending: [], ...patch };
}

describe('http on a private network', () => {
  it('accepts private addresses and LAN names over http, flagged insecure', () => {
    assert.deepEqual(checkHostAddress('http://192.168.1.20:4900'), { ok: true, host: 'http://192.168.1.20:4900', insecure: true });
    assert.deepEqual(checkHostAddress('http://oa.lan:4900'), { ok: true, host: 'http://oa.lan:4900', insecure: true });
    assert.deepEqual(checkHostAddress('http://nas.local'), { ok: true, host: 'http://nas.local', insecure: true });
    assert.deepEqual(checkHostAddress('http://oa.192-168-1-20.nip.io'), { ok: true, host: 'http://oa.192-168-1-20.nip.io', insecure: true });
    assert.deepEqual(checkHostAddress('http://[fd00::1]:4900'), { ok: true, host: 'http://[fd00::1]:4900', insecure: true });
  });

  it('reads a bare private address as http, a bare public name as https', () => {
    assert.deepEqual(checkHostAddress('192.168.1.20:4900'), { ok: true, host: 'http://192.168.1.20:4900', insecure: true });
    assert.deepEqual(checkHostAddress('nas'), { ok: true, host: 'http://nas', insecure: true });
    assert.deepEqual(checkHostAddress('oa.example.com'), { ok: true, host: 'https://oa.example.com' });
  });

  it('still refuses http for public names and addresses; this computer is not flagged', () => {
    assert.deepEqual(checkHostAddress('http://8.8.8.8'), { ok: false, reason: { key: 'pubHostNotHttps' } });
    assert.deepEqual(checkHostAddress('http://oa.8-8-8-8.nip.io'), { ok: false, reason: { key: 'pubHostNotHttps' } });
    assert.deepEqual(checkHostAddress('http://localhost:4900'), { ok: true, host: 'http://localhost:4900' });
  });
});

describe('the default site', () => {
  it('is the daemon\'s choice, else the only site', () => {
    const two = [remote({ name: 'work' }), remote({ name: 'home', host: 'http://192.168.1.20:4900' })];
    assert.equal(defaultSite(two, cloud({ default: 'home' })), 'home');
    assert.equal(defaultSite(two, cloud()), null);
    assert.equal(defaultSite(two, null), null);
    assert.equal(defaultSite([remote({ name: 'work', default: true }), remote({ name: 'home' })], null), 'work');
    assert.equal(defaultSite([remote()], cloud()), 'work');
    assert.equal(defaultSite(two, cloud({ default: 'gone' })), null);
    assert.equal(defaultSite([], cloud({ default: 'work' })), null);
  });

  it('has a picker only with more than one site', () => {
    assert.equal(offersDefaultPicker(null), false);
    assert.equal(offersDefaultPicker([remote()]), false);
    assert.equal(offersDefaultPicker([remote(), remote({ name: 'home' })]), true);
  });
});

describe('publishing by itself', () => {
  const pending = { id: 'art_1', url: 'open-artifact://artifact/art_1', title: 'Plan', remote: 'work', attempts: 0, lastError: null, code: null, nextAt: null };

  it('shows an artifact being published, then why it is still waiting', () => {
    assert.equal(autoView(cloud(), 'art_1'), null);
    assert.equal(autoView(null, 'art_1'), null);
    const going = autoView(cloud({ publish: 'auto', pending: [pending] }), 'art_1')!;
    assert.deepEqual(going, { kind: 'publishing', site: 'work' });
    assert.deepEqual(autoText(going, [remote()]), { key: 'pubAutoPublishing', vars: { host: 'oa.example' } });
    const signedOut = autoView(cloud({ publish: 'auto', pending: [{ ...pending, attempts: 2, lastError: 'Sign in again.', code: 'signed_out' }] }), 'art_1')!;
    assert.equal(autoText(signedOut, [remote()]).key, 'pubAutoSignedOut');
    const down = autoView(cloud({ pending: [{ ...pending, attempts: 1, lastError: 'not reachable', code: 'unreachable' }] }), 'art_1')!;
    assert.equal(autoText(down, [remote()]).key, 'pubAutoUnreachable');
    const other = autoView(cloud({ pending: [{ ...pending, attempts: 1, lastError: 'Too large.', code: 'too_large' }] }), 'art_1')!;
    assert.deepEqual(autoText(other, [remote()]), { key: 'pubAutoFailed', vars: { host: 'oa.example', error: 'Too large.' } });
  });

  it('every new message has English and Chinese', () => {
    const keys: MessageKey[] = [
      'pubInsecureWarning', 'pubAutoSwitch', 'pubAutoHint', 'pubAutoNoSite', 'pubDefaultSite', 'pubDefaultMark', 'pubAutoPublishing', 'pubAutoSignedOut',
      'pubAutoUnreachable', 'pubAutoFailed', 'pubApprovalTitle', 'pubApprovalBody', 'pubCloudSettingsFailed',
    ];
    for (const key of keys) assert.notEqual(translate('zh-CN', key), translate('en', key), key);
  });

  it('reads `cloud` from GET remotes and changes it through cloud.settings', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const answer = url.endsWith('.remotes') ? { remotes: [remote({ default: true })], cloud: cloud({ default: 'work', publish: 'auto', pending: [pending] }) } : { cloud: cloud({ default: 'work', publish: 'manual' }) };
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const api = createLibraryApi({ fetch });
    const answer = await api.remotes();
    assert.equal(answer.cloud?.publish, 'auto');
    assert.equal(answer.cloud?.pending[0]?.id, 'art_1');
    assert.equal((await api.cloudSettings({ publish: 'manual' })).cloud.publish, 'manual');
    await api.cloudSettings({ default: 'work' });
    assert.deepEqual(calls.slice(1), [
      { url: '/api/open-artifact.cloud.settings', method: 'POST', body: { publish: 'manual' } },
      { url: '/api/open-artifact.cloud.settings', method: 'POST', body: { default: 'work' } },
    ]);
  });
});
