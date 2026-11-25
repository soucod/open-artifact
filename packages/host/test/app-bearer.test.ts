/**
 * Agent tokens on the app origin: only the Link API takes them (and `/mcp`, which is answered before the app
 * handler). Every other registered route — the Library, sharing, share links, the event stream, sign-in, the pages and
 * the built files — refuses a Bearer token with a 401, even one with every scope and with a good session cookie beside
 * it. The routes are read from the router the Node host mounts, so a route added later is covered without listing it.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { LINK_API_PREFIX, LINK_ROUTES } from '@open-artifact/protocol';
import { appRouter, takesAgentToken, type AppCtx } from '../src/core/app/index.ts';
import type { Router } from '../src/core/http.ts';
import { linkApiRoutes } from '../src/core/link/routes.ts';
import type { LinkServices } from '../src/core/link/services.ts';
import { MCP_SCOPES } from '../src/core/mcp/metadata.ts';
import { connectedAppRoutes } from '../src/core/mcp/oauth.ts';
import { isMcpPath } from '../src/core/mcp/routes.ts';
import { HostEvents } from '../src/core/events.ts';
import { makeApp, type TestApp } from './app-fixture.ts';

/** Link services that are never reached by this test's calls but `hello`'s (which reads only the version). */
function linkStub(): LinkServices {
  const never = (): never => {
    throw new Error('not used by this test');
  };
  return {
    files: { manifest: async () => never(), read: async () => never(), write: async () => never() },
    importArchive: async () => never(),
    removeArtifact: async () => never(),
    archive: async () => never(),
    action: async () => never(),
    contentTitle: async () => undefined,
    refreshAccess: async () => undefined,
    presence: { connected: () => undefined, disconnected: () => undefined, online: () => false },
    events: new HostEvents(),
    version: '0.0.0-test',
  };
}

/** The app router as `startHost` assembles it: the app's routes, the Link API, the connected-apps routes. */
function hostRouter(): Router<AppCtx> {
  const router = appRouter();
  linkApiRoutes(router, linkStub());
  connectedAppRoutes(router);
  return router;
}

/** A concrete path for a route pattern: each `:param` and a final `*` filled in. */
function pathOf(pattern: string, id: string): string {
  return pattern
    .split('/')
    .map((segment) => (segment === '*' ? 'x' : segment.startsWith(':') ? (segment === ':id' ? id : 'x') : segment))
    .join('/');
}

describe('agent tokens on the app origin', () => {
  let app: TestApp;
  let router: Router<AppCtx>;
  let token: string;
  let cookie: string;
  let boardId: string;

  before(async () => {
    router = hostRouter();
    app = await makeApp({ router });
    const ada = await app.person('Ada');
    cookie = ada.cookie;
    boardId = (await app.artifact(ada.user, { generalAccess: 'link' })).id;
    // Every scope there is: what is refused is the credential's kind, not a missing scope.
    token = (await app.catalog.issueAgentToken({ userId: ada.user.id, label: 'Everything', scopes: ['link', ...MCP_SCOPES], accessTtlMs: 3600_000 })).accessToken;
  });
  after(() => app.close());

  it('the router lists the browser routes this rule is about', () => {
    const patterns = new Set(router.routes().map((r) => r.pattern));
    for (const name of ['artifacts', 'artifact', 'artifacts.boot', 'artifacts.update', 'artifact.share', 'artifacts.import', 'artifacts.ask', 'artifact.archive', 'events', 'artifacts.delete', 'artifacts.restore', 'auth.me', 'auth.tokens']) {
      assert.ok(patterns.has(`/api/open-artifact.${name}`), name);
    }
    assert.ok(patterns.has(`${LINK_API_PREFIX}${LINK_ROUTES.hello}`));
    // `/mcp` and OAuth are not app routes: the host sends them elsewhere before the app handler.
    for (const pattern of patterns) assert.equal(isMcpPath(pattern), false, pattern);
  });

  it('every route but the Link API refuses a Bearer token with a 401, a session cookie beside it or not', async () => {
    const routes = router.routes().filter((r) => !takesAgentToken(r.pattern));
    assert.ok(routes.length > 25, `only ${routes.length} routes`);
    for (const route of routes) {
      const method = route.method === '*' ? 'GET' : route.method;
      const path = pathOf(route.pattern, boardId);
      for (const withCookie of [false, true]) {
        const body = method === 'GET' || method === 'HEAD' ? undefined : { id: boardId, title: 'Renamed by an agent', text: 'hi' };
        const response = await app.fetch(path, { method, headers: { authorization: `Bearer ${token}` }, ...(withCookie ? { cookie } : {}), ...(body ? { body } : {}) });
        const where = `${method} ${route.pattern}${withCookie ? ' (with a session cookie)' : ''}`;
        assert.equal(response.status, 401, where);
        assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer error="invalid_token"/, where);
        if ((response.headers.get('content-type') ?? '').includes('json')) {
          const answer = (await response.json()) as { code: string; message: string };
          assert.equal(answer.code, 'unauthorized', where);
          assert.match(answer.message, /an agent token for the Link API .* and \/mcp: it works only there/, where);
        } else {
          await response.body?.cancel();
        }
      }
    }
    // Nothing changed hands: the title is the owner's still.
    assert.equal((await app.catalog.getArtifact(boardId))?.title, 'Board');
  });

  it('says which kind of token came and where that kind works', async () => {
    const bob = (await app.person('Bob2')).user.id;
    const linkOnly = (await app.catalog.issueAgentToken({ userId: bob, label: 'Laptop', scopes: ['link'], accessTtlMs: 3600_000 })).accessToken;
    const mcpOnly = (await app.catalog.issueAgentToken({ userId: bob, label: 'MCP', scopes: [...MCP_SCOPES], accessTtlMs: 3600_000 })).accessToken;
    const messageOf = async (bearer: string): Promise<string> => {
      const response = await app.fetch('/api/open-artifact.artifacts', { headers: { authorization: `Bearer ${bearer}` } });
      assert.equal(response.status, 401);
      return ((await response.json()) as { message: string }).message;
    };
    const link = await messageOf(linkOnly);
    assert.match(link, /is a Link token .*works only on the Link API .*not here and not on \/mcp/);
    const mcp = await messageOf(mcpOnly);
    assert.match(mcp, /is an MCP token .*works only on \/mcp/);
    assert.match(await messageOf('not-a-token-at-all'), /not one this site knows/);
  });

  it('a lower-case scheme is a Bearer token too; a Basic login (a proxy in front) is not ours and is ignored', async () => {
    const lower = await app.fetch(`/api/open-artifact.artifact?id=${boardId}`, { headers: { authorization: `bearer ${token}` }, cookie });
    assert.equal(lower.status, 401);
    const basic = await app.fetch(`/api/open-artifact.artifact?id=${boardId}`, { headers: { authorization: 'Basic dXNlcjpwYXNz' }, cookie });
    assert.equal(basic.status, 200);
    assert.equal(((await basic.json()) as { role: string }).role, 'owner');
  });

  it('the Link API still takes the token (and asks for the link scope itself)', async () => {
    const hello = await app.fetch(`${LINK_API_PREFIX}${LINK_ROUTES.hello}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(hello.status, 200);
    const mcpOnly = (await app.catalog.issueAgentToken({ userId: (await app.person('Bob')).user.id, label: 'MCP', scopes: ['artifacts.read'], accessTtlMs: 3600_000 })).accessToken;
    const refused = await app.fetch(`${LINK_API_PREFIX}${LINK_ROUTES.hello}`, { headers: { authorization: `Bearer ${mcpOnly}` } });
    assert.equal(refused.status, 403);
    // And an MCP-only token cannot rename through the Library either.
    const rename = await app.fetch('/api/open-artifact.artifacts.update', { headers: { authorization: `Bearer ${mcpOnly}` }, body: { id: boardId, title: 'Nope' } });
    assert.equal(rename.status, 401);
  });
});
