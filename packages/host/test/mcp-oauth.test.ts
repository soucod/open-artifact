/**
 * Remote MCP's OAuth: the discovery documents, the code flow with PKCE for the three kinds of client (a client
 * metadata document, dynamic registration, a configured client), its failures, refresh rotation with reuse
 * detection, revocation, the strict metadata fetcher, the consent page's escaping, the connected-apps routes and the
 * `/mcp` transport (401 shape, origins, versions, a real token).
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fetchClientMetadata } from '../src/core/mcp/cimd.ts';
import { APP, CIMD_ID, CIMD_REDIRECT, CONFIG_CLIENT, CONFIG_REDIRECT, makeMcpHost, pkce, type McpHost } from './mcp-fixture.ts';

describe('MCP OAuth', () => {
  let host: McpHost;
  let cookie: string;

  before(async () => {
    host = await makeMcpHost({ registrationRate: { limit: 3, windowMs: 3600_000 } });
    ({ cookie } = await host.person('Ada'));
  });
  after(() => host.close());

  /** A checked authorization request up to the code. */
  async function codeFor(params: Record<string, string>, decision = 'approve'): Promise<URL> {
    const response = await host.fetch('/oauth/authorize', { cookie, origin: APP, form: { ...params, decision } });
    assert.ok(response.status === 302 || response.status === 303, await response.clone().text());
    return new URL(response.headers.get('location')!);
  }
  const base = (challenge: string, extra: Record<string, string> = {}): Record<string, string> => ({
    response_type: 'code',
    client_id: CIMD_ID,
    redirect_uri: CIMD_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${APP}/mcp`,
    ...extra,
  });

  it('publishes the resource and authorization server metadata', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const response = await host.fetch(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      const doc = (await response.json()) as Record<string, unknown>;
      assert.equal(doc.resource, `${APP}/mcp`);
      assert.deepEqual(doc.authorization_servers, [APP]);
    }
    const as = (await (await host.fetch('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    assert.equal(as.issuer, APP);
    assert.equal(as.authorization_endpoint, `${APP}/oauth/authorize`);
    assert.equal(as.token_endpoint, `${APP}/oauth/token`);
    assert.equal(as.registration_endpoint, `${APP}/oauth/register`);
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(as.response_types_supported, ['code']);
    assert.equal(as.client_id_metadata_document_supported, true);
    assert.deepEqual(as.scopes_supported, ['artifacts.read', 'artifacts.write', 'comments', 'share.read']);
    assert.ok(!(as.scopes_supported as string[]).includes('link'));
  });

  it('answers /mcp without a token 401 with a challenge naming the resource metadata', async () => {
    const response = await host.fetch('/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    assert.equal(response.status, 401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    assert.match(challenge, /^Bearer /);
    assert.match(challenge, new RegExp(`resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp"`));
    const bad = await host.fetch('/mcp', { token: 'nope', body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get('www-authenticate') ?? '', /error="invalid_token"/);
    // A daemon's Link token is named as one: it works on the Link API, not here.
    const someone = await host.catalog.createUser({ name: 'Linker', email: 'linker@example.com', emailVerified: true });
    const link = (await host.catalog.issueAgentToken({ userId: someone.id, label: 'Laptop', scopes: ['link'], accessTtlMs: 3600_000 })).accessToken;
    const linked = await host.fetch('/mcp', { token: link, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(linked.status, 401);
    assert.match(((await linked.json()) as { error_description: string }).error_description, /This is a Link token .*works only on the Link API/);
  });

  it('runs the code flow with a client metadata document, and serves MCP with the token', async () => {
    const tokens = await host.connect(cookie);
    assert.equal(tokens.expires_in, 3600);
    assert.equal(tokens.scope, 'artifacts.read artifacts.write comments share.read');
    const init = await host.rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.status, 200);
    const result = init.body.result as Record<string, unknown>;
    assert.equal(result.protocolVersion, '2025-06-18');
    assert.match(String(result.instructions), /Open Artifact runs on a server/);
    const list = await host.rpc(tokens.access_token, 'tools/list', {}, { 'mcp-protocol-version': '2025-06-18' });
    const names = ((list.body.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
    assert.deepEqual(names.sort(), ['Artifact', 'ArtifactComments', 'ArtifactData', 'ShowArtifact']);
    const quick = await host.tool(tokens.access_token, 'Artifact', { action: 'quickstart', intent: 'whiteboard' });
    assert.equal((quick.recommended as { id: string }).id, 'whiteboard');
  });

  it('negotiates the version and refuses an unknown MCP-Protocol-Version header', async () => {
    const { access_token } = await host.connect(cookie);
    const old = await host.rpc(access_token, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    assert.equal((old.body.result as { protocolVersion: string }).protocolVersion, '2024-11-05');
    const future = await host.rpc(access_token, 'initialize', { protocolVersion: '2099-01-01', capabilities: {} });
    assert.equal((future.body.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
    const refused = await host.rpc(access_token, 'tools/list', {}, { 'mcp-protocol-version': '2026-07-28' });
    assert.equal(refused.status, 400);
    assert.equal((refused.body.error as { code: number }).code, -32600);
  });

  it('answers GET /mcp 405 and refuses a foreign browser origin', async () => {
    const get = await host.fetch('/mcp');
    assert.equal(get.status, 405);
    const { access_token } = await host.connect(cookie);
    const foreign = await host.fetch('/mcp', { token: access_token, origin: 'https://evil.example', body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(foreign.status, 403);
    const same = await host.fetch('/mcp', { token: access_token, origin: APP, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(same.status, 200);
    const note = await host.fetch('/mcp', { token: access_token, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    assert.equal(note.status, 202);
  });

  it('lets in an origin from OA_MCP_ORIGINS', async () => {
    const other = await makeMcpHost({ env: { OA_MCP_ORIGINS: 'https://inspector.example' } });
    try {
      const { cookie: c } = await other.person('Bo');
      const { access_token } = await other.connect(c);
      const ok = await other.fetch('/mcp', { token: access_token, origin: 'https://inspector.example', body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://inspector.example');
    } finally {
      await other.close();
    }
  });

  it('sends a signed-out person to sign in, keeping the request', async () => {
    const { challenge } = pkce();
    const query = new URLSearchParams(base(challenge));
    const response = await host.fetch(`/oauth/authorize?${query}`);
    assert.ok(response.status === 302 || response.status === 303);
    const location = new URL(response.headers.get('location')!, APP);
    assert.equal(location.pathname, '/auth/sign-in');
    assert.equal(location.searchParams.get('return_to'), `/oauth/authorize?${query}`);
  });

  it('escapes a hostile client name on the consent page, in English and Chinese', async () => {
    host.documents.set('https://client.example/evil.json', {
      body: JSON.stringify({ client_id: 'https://client.example/evil.json', client_name: '<script>alert(1)</script>"><img src=x>', redirect_uris: [CIMD_REDIRECT] }),
    });
    const { challenge } = pkce();
    const query = new URLSearchParams(base(challenge, { client_id: 'https://client.example/evil.json' }));
    const page = await host.fetch(`/oauth/authorize?${query}`, { cookie });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(!html.includes('<img src=x>'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /client\.example/);
    assert.match(html, /ada@example\.com/);
    assert.match(page.headers.get('content-security-policy') ?? '', /form-action 'self' https:\/\/client\.example/);
    const zh = await host.fetch(`/oauth/authorize?${query}`, { cookie, headers: { 'accept-language': 'zh-CN' } });
    assert.match(await zh.text(), /连接应用/);
  });

  it('passes state through, refuses a deny, and checks the same origin on approve', async () => {
    const { challenge } = pkce();
    const denied = await codeFor(base(challenge), 'deny');
    assert.equal(denied.searchParams.get('error'), 'access_denied');
    assert.equal(denied.searchParams.get('state'), 'xyz');
    assert.equal(denied.searchParams.get('iss'), APP);
    const cross = await host.fetch('/oauth/authorize', { cookie, origin: 'https://evil.example', form: { ...base(challenge), decision: 'approve' } });
    assert.equal(cross.status, 403);
    const approved = await codeFor(base(challenge));
    assert.equal(approved.origin + approved.pathname, CIMD_REDIRECT);
    assert.equal(approved.searchParams.get('state'), 'xyz');
    assert.ok(approved.searchParams.get('code'));
  });

  it('refuses a wrong verifier, a reused code, a redirect mismatch and a wrong resource', async () => {
    const { verifier, challenge } = pkce();
    const code = (await codeFor(base(challenge))).searchParams.get('code')!;
    const token = (form: Record<string, string>): Promise<Response> => host.fetch('/oauth/token', { form: { grant_type: 'authorization_code', client_id: CIMD_ID, redirect_uri: CIMD_REDIRECT, ...form } });
    const wrong = await token({ code, code_verifier: pkce().verifier });
    assert.equal(wrong.status, 400);
    assert.equal(((await wrong.json()) as { error: string }).error, 'invalid_grant');
    // The code was spent by the failed attempt: one try per code.
    const again = await token({ code, code_verifier: verifier });
    assert.equal(((await again.json()) as { error: string }).error, 'invalid_grant');

    const second = pkce();
    const code2 = (await codeFor(base(second.challenge))).searchParams.get('code')!;
    const mismatch = await token({ code: code2, code_verifier: second.verifier, redirect_uri: 'https://client.example/other' });
    assert.equal(((await mismatch.json()) as { error: string }).error, 'invalid_grant');

    const third = pkce();
    const code3 = (await codeFor(base(third.challenge))).searchParams.get('code')!;
    const ok = await token({ code: code3, code_verifier: third.verifier });
    assert.equal(ok.status, 200);
    const reused = await token({ code: code3, code_verifier: third.verifier });
    assert.equal(((await reused.json()) as { error: string }).error, 'invalid_grant');

    const badResource = await host.fetch(`/oauth/authorize?${new URLSearchParams(base(pkce().challenge, { resource: 'https://other.example/mcp' }))}`, { cookie });
    assert.ok(badResource.status === 302 || badResource.status === 303);
    assert.equal(new URL(badResource.headers.get('location')!).searchParams.get('error'), 'invalid_target');
    const noPkce = await host.fetch(`/oauth/authorize?${new URLSearchParams({ ...base('x'), code_challenge_method: 'plain' })}`, { cookie });
    assert.equal(new URL(noPkce.headers.get('location')!).searchParams.get('error'), 'invalid_request');
    const unregistered = await host.fetch(`/oauth/authorize?${new URLSearchParams(base(pkce().challenge, { redirect_uri: 'https://evil.example/cb' }))}`, { cookie });
    assert.equal(unregistered.status, 400);
    assert.equal(unregistered.headers.get('location'), null);
  });

  it('revokes the tokens issued from a code when the code comes back, refreshed ones included', async () => {
    const token = (form: Record<string, string>): Promise<Response> => host.fetch('/oauth/token', { form: { grant_type: 'authorization_code', client_id: CIMD_ID, redirect_uri: CIMD_REDIRECT, ...form } });
    const { verifier, challenge } = pkce();
    const code = (await codeFor(base(challenge))).searchParams.get('code')!;
    const issued = await token({ code, code_verifier: verifier });
    assert.equal(issued.status, 200);
    const first = (await issued.json()) as { access_token: string; refresh_token: string };
    // The client refreshes once: the rotated tokens keep the grant, so the reuse below reaches them too.
    const rotated = (await (await host.fetch('/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: CIMD_ID } })).json()) as { access_token: string; refresh_token: string };
    assert.equal((await host.rpc(rotated.access_token, 'ping')).status, 200);

    const replay = await token({ code, code_verifier: verifier });
    assert.equal(((await replay.json()) as { error: string }).error, 'invalid_grant');
    assert.equal((await host.rpc(rotated.access_token, 'ping')).status, 401, 'the reused code revoked its tokens');
    assert.equal((await host.fetch('/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: rotated.refresh_token, client_id: CIMD_ID } })).status, 400);
    const audit = await host.catalog.driver.all<{ detail_json: string }>("SELECT detail_json FROM audit WHERE action = 'mcp.token_revoked'");
    assert.ok(audit.some((row) => JSON.parse(row.detail_json).reason === 'code_reused'));

    // A code never issued, or one not used yet, revokes nothing and marks nothing.
    assert.equal(((await (await token({ code: 'never-issued', code_verifier: verifier })).json()) as { error: string }).error, 'invalid_grant');
  });

  it('a replay racing the first exchange leaves no working token', async () => {
    const token = (form: Record<string, string>): Promise<Response> => host.fetch('/oauth/token', { form: { grant_type: 'authorization_code', client_id: CIMD_ID, redirect_uri: CIMD_REDIRECT, ...form } });
    for (let round = 0; round < 5; round++) {
      const { verifier, challenge } = pkce();
      const code = (await codeFor(base(challenge))).searchParams.get('code')!;
      const answers = await Promise.all([token({ code, code_verifier: verifier }), token({ code, code_verifier: verifier })]);
      for (const answer of answers) {
        if (answer.status !== 200) {
          assert.equal(((await answer.json()) as { error: string }).error, 'invalid_grant');
          continue;
        }
        const { access_token } = (await answer.json()) as { access_token: string };
        assert.equal((await host.rpc(access_token, 'ping')).status, 401, `round ${round}: the token from a replayed code works`);
      }
    }
  });

  it('registers a public client dynamically and rate-limits registration', async () => {
    const registered = await host.fetch('/oauth/register', { body: { client_name: 'Dyn', redirect_uris: ['https://dyn.example/cb'] } });
    assert.equal(registered.status, 201);
    const client = (await registered.json()) as { client_id: string; token_endpoint_auth_method: string };
    assert.equal(client.token_endpoint_auth_method, 'none');
    const tokens = await host.connect(cookie, { clientId: client.client_id, redirectUri: 'https://dyn.example/cb', scope: 'artifacts.read' });
    assert.equal(tokens.scope, 'artifacts.read');
    const confidential = await host.fetch('/oauth/register', { body: { redirect_uris: ['https://dyn.example/cb'], token_endpoint_auth_method: 'client_secret_basic' } });
    assert.equal(confidential.status, 400);
    const http = await host.fetch('/oauth/register', { body: { redirect_uris: ['http://dyn.example/cb'] } });
    assert.equal(((await http.json()) as { error: string }).error, 'invalid_redirect_uri');
    let limited: Response | null = null;
    for (let i = 0; i < 5 && !limited; i++) {
      const r = await host.fetch('/oauth/register', { body: { redirect_uris: ['https://dyn.example/cb'] } });
      if (r.status === 429) limited = r;
    }
    assert.ok(limited, 'registration is rate limited');
  });

  it('accepts a configured client with a loopback redirect', async () => {
    const tokens = await host.connect(cookie, { clientId: CONFIG_CLIENT, redirectUri: CONFIG_REDIRECT });
    assert.ok(tokens.access_token);
  });

  it('rotates refresh tokens, revokes the grant when a spent one comes back, and revokes on request', async () => {
    const first = await host.connect(cookie);
    const refresh = (token: string): Promise<Response> => host.fetch('/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: token, client_id: CIMD_ID } });
    const rotated = await refresh(first.refresh_token);
    assert.equal(rotated.status, 200);
    const second = (await rotated.json()) as { access_token: string; refresh_token: string };
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.equal((await host.rpc(second.access_token, 'ping')).status, 200);
    const replay = await refresh(first.refresh_token);
    assert.equal(((await replay.json()) as { error: string }).error, 'invalid_grant');
    assert.equal((await host.rpc(second.access_token, 'ping')).status, 401, 'the reuse revoked the grant');
    assert.equal((await refresh(second.refresh_token)).status, 400);

    const other = await host.connect(cookie);
    const revoked = await host.fetch('/oauth/revoke', { form: { token: other.access_token, client_id: CIMD_ID } });
    assert.equal(revoked.status, 200);
    assert.equal((await host.rpc(other.access_token, 'ping')).status, 401);
    assert.equal((await host.fetch('/oauth/revoke', { form: { token: 'unknown' } })).status, 200);
  });

  it('lists and disconnects connected apps for the signed-in person', async () => {
    const tokens = await host.connect(cookie);
    const listed = (await (await host.fetch('/api/open-artifact.auth.tokens', { cookie })).json()) as { apps: Array<{ id: string; clientId: string; name: string }> };
    assert.ok(listed.apps.length >= 1);
    assert.ok(listed.apps.every((a) => a.clientId));
    const mine = listed.apps.find((a) => a.clientId === CIMD_ID)!;
    assert.equal(mine.name, 'Client <b>Example</b>');
    const none = await host.fetch('/api/open-artifact.auth.tokens', { token: tokens.access_token });
    assert.equal(none.status, 401);
    for (const app of listed.apps) {
      const r = await host.fetch('/api/open-artifact.auth.tokens.revoke', { cookie, origin: APP, body: { id: app.id } });
      assert.equal(r.status, 200);
    }
    assert.equal((await host.rpc(tokens.access_token, 'ping')).status, 401);
  });

  it('expires access tokens after an hour', async () => {
    const tokens = await host.connect(cookie);
    host.advance(3600_000 + 1000);
    assert.equal((await host.rpc(tokens.access_token, 'ping')).status, 401);
  });
});

describe('client metadata documents', () => {
  const doc = (id: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ client_id: id, client_name: 'C', redirect_uris: ['https://c.example/cb'], ...extra });
  const serving = (body: string, init: { status?: number; headers?: Record<string, string> } = {}) => ({
    fetch: async () => new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...init.headers } }),
    lookup: async () => ['93.184.216.34'],
  });

  it('reads a good document', async () => {
    const id = 'https://c.example/client.json';
    const meta = await fetchClientMetadata(id, serving(doc(id)));
    assert.equal(meta.clientId, id);
    assert.deepEqual(meta.redirectUris, ['https://c.example/cb']);
  });

  it('refuses http, a private address, an oversize document, a mismatched client_id and a cross-host redirect', async () => {
    await assert.rejects(fetchClientMetadata('http://c.example/client.json', serving('{}')), /https/);
    await assert.rejects(fetchClientMetadata('https://10.0.0.7/client.json', serving('{}')), /private/);
    await assert.rejects(fetchClientMetadata('https://localhost/client.json', serving('{}')), /private/);
    const id = 'https://c.example/client.json';
    await assert.rejects(fetchClientMetadata(id, { ...serving(doc(id)), lookup: async () => ['127.0.0.1'] }), /private/);
    await assert.rejects(fetchClientMetadata(id, serving(doc(id, { pad: 'x'.repeat(6000) }))), /larger/);
    await assert.rejects(fetchClientMetadata(id, serving(doc('https://c.example/other.json'))), /client_id/);
    await assert.rejects(fetchClientMetadata(id, serving('', { status: 302, headers: { location: 'https://elsewhere.example/c.json' } })), /another host/);
    await assert.rejects(fetchClientMetadata(id, serving(doc(id, { token_endpoint_auth_method: 'client_secret_basic' }))), /public/);
    await assert.rejects(fetchClientMetadata(id, serving(doc(id, { redirect_uris: ['http://c.example/cb'] }))), /redirect/);
  });

  it('allows a private address only when the app origin is local', async () => {
    const id = 'https://localhost/client.json';
    const meta = await fetchClientMetadata(id, { ...serving(doc(id)), allowPrivate: true });
    assert.equal(meta.clientId, id);
  });

  it('times out a slow server', async () => {
    const id = 'https://c.example/client.json';
    const slow = {
      fetch: (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    };
    await assert.rejects(fetchClientMetadata(id, { ...slow, timeoutMs: 50 }), /longer/);
  });
});
