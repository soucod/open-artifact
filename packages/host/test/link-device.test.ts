import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINK_API_PREFIX, type LinkDeviceStart, type LinkToken, type LinkTokenError } from '@open-artifact/protocol';
import { makeLinkHost, type LinkHost } from './link-fixture.ts';

const start = async (host: LinkHost, name = 'Claude Code on laptop'): Promise<LinkDeviceStart> => {
  const response = await host.fetch(`${LINK_API_PREFIX}device`, { body: { client: { name, harness: 'claude-code', version: '2.1' } } });
  assert.equal(response.status, 200);
  return (await response.json()) as LinkDeviceStart;
};

const poll = (host: LinkHost, deviceCode: string): Promise<Response> => host.fetch(`${LINK_API_PREFIX}token`, { body: { grant_type: 'device_code', device_code: deviceCode } });

const decide = (host: LinkHost, cookie: string, userCode: string, decision: string, origin: string | null = host.config.appOrigin): Promise<Response> =>
  host.fetch('/link/device', {
    method: 'POST',
    cookie,
    origin,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user_code: userCode, decision }).toString(),
  });

test('device flow: pending, slow_down, approve, token once, audit', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user, cookie } = await host.person('Ada');
  const started = await start(host);
  assert.equal(started.verification_uri, `${host.config.appOrigin}/link/device`);
  assert.equal(started.verification_uri_complete, `${host.config.appOrigin}/link/device?user_code=${encodeURIComponent(started.user_code)}`);
  assert.equal(started.interval, 5);
  assert.equal(started.expires_in, 600);

  let response = await poll(host, started.device_code);
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as LinkTokenError).error, 'authorization_pending');
  response = await poll(host, started.device_code);
  assert.equal(((await response.json()) as LinkTokenError).error, 'slow_down');
  host.advance(6000);
  response = await poll(host, started.device_code);
  assert.equal(((await response.json()) as LinkTokenError).error, 'authorization_pending');

  // Anonymous: off to sign in, coming back with the code.
  response = await host.fetch(`/link/device?user_code=${started.user_code}`);
  assert.equal(response.status, 303);
  const location = response.headers.get('location')!;
  assert.match(location, /^\/auth\/sign-in\?return_to=/);
  assert.equal(new URL(location, host.config.appOrigin).searchParams.get('return_to'), `/link/device?user_code=${encodeURIComponent(started.user_code)}`);

  // Signed in: the page names the client and the account.
  response = await host.fetch(`/link/device?user_code=${started.user_code.toLowerCase()}`, { cookie });
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Claude Code on laptop/);
  assert.match(page, /claude-code 2\.1/);
  assert.match(page, /Ada/);
  assert.match(page, /name="decision" value="approve"/);

  // In Chinese.
  response = await host.fetch(`/link/device?user_code=${started.user_code}`, { cookie, headers: { 'accept-language': 'zh-CN,zh;q=0.9' } });
  assert.match(await response.text(), /请求关联到你的账号/);

  // A cross-site form post is refused.
  response = await decide(host, cookie, started.user_code, 'approve', 'https://evil.example');
  assert.equal(response.status, 403);

  response = await decide(host, cookie, started.user_code, 'approve');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /is linked/);

  host.advance(6000);
  response = await poll(host, started.device_code);
  assert.equal(response.status, 200);
  const token = (await response.json()) as LinkToken;
  assert.match(token.access_token, /^oa_at_/);
  assert.match(token.refresh_token, /^oa_rt_/);
  assert.equal(token.expires_in, 3600);
  assert.deepEqual(token.user, { id: user.id, name: 'Ada', email: 'ada@example.com' });

  const hello = await host.fetch(`${LINK_API_PREFIX}hello`, { token: token.access_token });
  assert.equal(hello.status, 200);

  // The code is spent.
  host.advance(6000);
  response = await poll(host, started.device_code);
  assert.equal(((await response.json()) as LinkTokenError).error, 'expired_token');
  response = await host.fetch(`/link/device?user_code=${started.user_code}`, { cookie });
  assert.equal(response.status, 409);

  const tokens = await host.catalog.listAgentTokens(user.id);
  assert.equal(tokens.length, 1);
  assert.deepEqual(tokens[0]!.scopes, ['link']);
  assert.equal(tokens[0]!.label, 'Claude Code on laptop');
  const actions = (await host.catalog.listAudit()).map((row) => row.action);
  assert.ok(actions.includes('link.device_approved'));
  assert.ok(actions.includes('link.token_issued'));
});

test('device flow: deny, expiry, unknown code, rate limit, bad requests', async (t) => {
  const host = await makeLinkHost({ deviceRate: { limit: 3, windowMs: 60_000 } });
  t.after(() => host.close());
  const { cookie } = await host.person('Ada');

  const denied = await start(host);
  let response = await decide(host, cookie, denied.user_code, 'deny');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Refused/);
  response = await poll(host, denied.device_code);
  assert.equal(((await response.json()) as LinkTokenError).error, 'access_denied');
  assert.ok((await host.catalog.listAudit()).some((row) => row.action === 'link.device_denied'));

  const late = await start(host);
  host.advance(11 * 60_000);
  response = await poll(host, late.device_code);
  assert.equal(((await response.json()) as LinkTokenError).error, 'expired_token');
  response = await decide(host, cookie, late.user_code, 'approve');
  assert.notEqual(response.status, 200);

  response = await poll(host, 'no-such-code');
  assert.equal(((await response.json()) as LinkTokenError).error, 'expired_token');

  response = await host.fetch(`/link/device?user_code=ZZZZ-ZZZZ`, { cookie });
  assert.equal(response.status, 404);

  // The clock moved past the window: three more fill it; the fourth waits.
  await start(host);
  await start(host);
  await start(host);
  response = await host.fetch(`${LINK_API_PREFIX}device`, { body: { client: { name: 'x' } } });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) >= 1);
  host.advance(61_000);
  response = await host.fetch(`${LINK_API_PREFIX}device`, { body: { client: {} } });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, 'invalid_argument');

  response = await host.fetch(`${LINK_API_PREFIX}token`, { body: { grant_type: 'password' } });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, 'invalid_argument');

  // RFC 8628 clients post a form.
  const formed = await start(host);
  response = await host.fetch(`${LINK_API_PREFIX}token`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'device_code', device_code: formed.device_code }).toString(),
  });
  assert.equal(((await response.json()) as LinkTokenError).error, 'authorization_pending');
});

test('refresh rotates both tokens; the old refresh stops; reusing it revokes the token', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user } = await host.person('Ada');
  const first = await host.token(user);
  const refresh = (token: string): Promise<Response> => host.fetch(`${LINK_API_PREFIX}token`, { body: { grant_type: 'refresh_token', refresh_token: token } });

  let response = await refresh(first.refresh);
  assert.equal(response.status, 200);
  const second = (await response.json()) as LinkToken;
  assert.notEqual(second.access_token, first.access);
  assert.notEqual(second.refresh_token, first.refresh);
  assert.equal((await host.fetch(`${LINK_API_PREFIX}hello`, { token: first.access })).status, 401);
  assert.equal((await host.fetch(`${LINK_API_PREFIX}hello`, { token: second.access_token })).status, 200);

  // The access token runs out after an hour; the refresh token still works.
  host.advance(3600_000 + 1000);
  response = await host.fetch(`${LINK_API_PREFIX}hello`, { token: second.access_token });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate') ?? '', /invalid_token/);
  response = await refresh(second.refresh_token);
  assert.equal(response.status, 200);
  const third = (await response.json()) as LinkToken;

  // The spent refresh token is replayed: the whole token is revoked.
  response = await refresh(second.refresh_token);
  assert.equal(((await response.json()) as LinkTokenError).error, 'expired_token');
  assert.equal((await host.fetch(`${LINK_API_PREFIX}hello`, { token: third.access_token })).status, 401);
  response = await refresh(third.refresh_token);
  assert.equal(((await response.json()) as LinkTokenError).error, 'expired_token');
  const actions = (await host.catalog.listAudit()).map((row) => row.action);
  assert.ok(actions.includes('link.token_refreshed'));
  assert.ok(actions.includes('link.token_revoked'));
});

test('a refresh token runs out 90 days after its last use', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user } = await host.person('Ada');
  const first = await host.token(user);
  host.advance(80 * 24 * 3600_000);
  let response = await host.fetch(`${LINK_API_PREFIX}token`, { body: { grant_type: 'refresh_token', refresh_token: first.refresh } });
  assert.equal(response.status, 200);
  const second = (await response.json()) as LinkToken;
  host.advance(80 * 24 * 3600_000);
  response = await host.fetch(`${LINK_API_PREFIX}token`, { body: { grant_type: 'refresh_token', refresh_token: second.refresh_token } });
  assert.equal(response.status, 200);
  const third = (await response.json()) as LinkToken;
  host.advance(91 * 24 * 3600_000);
  response = await host.fetch(`${LINK_API_PREFIX}token`, { body: { grant_type: 'refresh_token', refresh_token: third.refresh_token } });
  assert.equal(((await response.json()) as LinkTokenError).error, 'expired_token');
});

test('approve and deny with the exact headers a browser sends: same-site forms pass, other sites are refused', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { cookie } = await host.person('Ada');
  const app = new URL(host.config.appOrigin);
  const sibling = `${app.protocol}//art-0abcdefghi1234.content.${app.host}`;
  const form = { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1', 'sec-fetch-mode': 'navigate' };
  const post = (userCode: string, decision: string, headers: Record<string, string>): Promise<Response> =>
    host.fetch('/link/device', { method: 'POST', cookie, origin: null, headers, body: new URLSearchParams({ user_code: userCode, decision }).toString() });
  const refused = async (headers: Record<string, string>, label: string): Promise<void> => {
    const device = await start(host);
    for (const decision of ['approve', 'deny']) {
      const response = await post(device.user_code, decision, headers);
      assert.equal(response.status, 403, `${label}: ${decision}`);
      assert.equal(((await response.json()) as { code: string }).code, 'not_granted', label);
    }
    // Nothing was decided: the device still waits.
    assert.equal(((await (await poll(host, device.device_code)).json()) as LinkTokenError).error, 'authorization_pending', label);
  };

  // (a) The host's own page posts its form under `Referrer-Policy: no-referrer`: Chromium sends `Origin: null`.
  let device = await start(host);
  let response = await post(device.user_code, 'approve', { ...form, origin: 'null', 'sec-fetch-site': 'same-origin' });
  assert.equal(response.status, 200);
  assert.ok(((await (await poll(host, device.device_code)).json()) as LinkToken).access_token);
  device = await start(host);
  response = await post(device.user_code, 'deny', { ...form, origin: 'null', 'sec-fetch-site': 'same-origin' });
  assert.equal(response.status, 200);
  assert.equal(((await (await poll(host, device.device_code)).json()) as LinkTokenError).error, 'access_denied');
  // (b) The same form with the app's Origin (a browser that sends it).
  device = await start(host);
  response = await post(device.user_code, 'approve', { ...form, origin: host.config.appOrigin, 'sec-fetch-site': 'same-origin' });
  assert.equal(response.status, 200);

  // (c) A form on another site.
  await refused({ ...form, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, 'cross-site');
  // (d) A same-site sibling: an artifact page on a content host, by form or fetch, even with the app's Origin.
  await refused({ ...form, origin: sibling, 'sec-fetch-site': 'same-site' }, 'content host form');
  await refused({ origin: sibling, 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }, 'content host fetch');
  await refused({ ...form, origin: host.config.appOrigin, 'sec-fetch-site': 'same-site' }, 'same-site with app origin');
  // (f) No Sec-Fetch headers and `Origin: null` (a sandboxed frame).
  await refused({ 'content-type': 'application/x-www-form-urlencoded', origin: 'null' }, 'sandboxed');
  // A matching Origin does not rescue a cross-site request.
  await refused({ ...form, origin: host.config.appOrigin, 'sec-fetch-site': 'cross-site' }, 'cross-site with app origin');
});
