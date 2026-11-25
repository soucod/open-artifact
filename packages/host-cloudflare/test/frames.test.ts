/**
 * Page artifacts on the Worker's side (`frames.ts`, `site.ts`, `agents.ts`), without an object:
 *
 * - the rules both sites share are the Node site's (`node/frames.ts`, `node/mcp.ts`): levels, colours, the network
 *   setting and its CSP, the page type the agent tools list, the marker a new page gets;
 * - the Worker sends a page host to the artifact's object (no cookie), and refuses it as a stray name where pages do
 *   not run (one origin for both, or a build with no frame type); `typeInfo('page')` and `OA_PAGE_NETWORK` follow;
 * - the Link and MCP services carry `pages` only where pages run, and a capabilities change not made by the Link is
 *   told to it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pageHostOpaque, pageOriginOf, type AppCtx } from '@open-artifact/host';
import { readMcpTypes } from '@open-artifact/host/node';
import { frameLevelOf as nodeLevelOf, pageNetworkPolicy as nodePolicy, parsePageNetwork as nodeNetwork } from '../../host/src/node/frames.ts';
import { cloudflareLinkServices, cloudflareMcpServices, mcpTypesOf, roomPageServices } from '../src/agents.ts';
import { colorOf, frameLevelOf, pageNetworkPolicy, pageScaffold, parsePageNetwork, sitePagesOf, type FrameBuild } from '../src/frames.ts';
import { ARTIFACT_HEADER } from '../src/room.ts';
import { Site } from '../src/site.ts';
import { fakeD1 } from './d1-fake.ts';

const typesDir = fileURLToPath(new URL('../../../artifact-types', import.meta.url));
const OWNER_KEY = 'o'.repeat(30);

function frameBuild(): FrameBuild {
  const dir = join(typesDir, 'page');
  return {
    types: [{ id: 'page', label: 'artifact-types/page', fingerprint: 'f'.repeat(16), manifest: JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8')), skill: readFileSync(join(dir, 'SKILL.md'), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim(), indexHtml: null, files: {}, page: true }],
    client: { base: '/_open-artifact/frame/ffff/', files: ['runtime.js'] },
  };
}

describe('the rules both sites share', () => {
  it('levels, the network setting and its CSP are the Node site\'s', () => {
    for (const role of ['owner', 'editor', 'commenter', 'viewer'] as const) assert.deepEqual(frameLevelOf(role), nodeLevelOf(role), role);
    for (const value of [undefined, '', 'self', 'HTTPS', ' https ']) assert.equal(parsePageNetwork({ OA_PAGE_NETWORK: value }), nodeNetwork({ OA_PAGE_NETWORK: value }), String(value));
    assert.throws(() => parsePageNetwork({ OA_PAGE_NETWORK: 'any' }), /OA_PAGE_NETWORK/);
    for (const network of ['self', 'https'] as const) assert.deepEqual(pageNetworkPolicy(network), nodePolicy(network));
    assert.match(colorOf('u_ada'), /^#[0-9a-f]{6}$/);
    assert.equal(colorOf('u_ada'), colorOf('u_ada'));
  });

  it('the page type the agent tools list is the Node site\'s, and only where pages run', () => {
    const node = readMcpTypes(typesDir, { pages: true });
    const worker = mcpTypesOf([], frameBuild());
    assert.deepEqual(worker.get('page'), node.get('page'));
    assert.equal(worker.skill('page'), node.skill('page'));
    assert.equal(mcpTypesOf([]).get('page'), null);
    assert.equal(mcpTypesOf([], null).get('page'), null);
  });

  it('a new page is its marker alone, as the Node site scaffolds it', () => {
    assert.deepEqual(JSON.parse(pageScaffold('art_x', 'Poll')['.artifact.json']!), { type: 'page', id: 'art_x', title: 'Poll', release: null, capabilities: {} });
  });

  it('pages run unless one origin serves both or the build has no frame type', () => {
    assert.deepEqual(sitePagesOf({}, {}, frameBuild())?.network, 'self');
    assert.equal(sitePagesOf({}, { OA_PAGE_NETWORK: 'https' }, frameBuild())?.network, 'https');
    assert.equal(sitePagesOf({ contentSameSite: true }, {}, frameBuild()), null);
    assert.equal(sitePagesOf({}, {}, undefined), null);
    assert.equal(sitePagesOf({}, {}, { ...frameBuild(), types: [] }), null);
    assert.throws(() => sitePagesOf({}, { OA_PAGE_NETWORK: 'all' }, frameBuild()), /OA_PAGE_NETWORK/);
  });
});

/** A Site whose objects are a stub that records what it was sent. */
async function siteWith(vars: Record<string, string>, frames?: FrameBuild) {
  const sent: Request[] = [];
  const rooms = {
    idFromName: (name: string) => ({ toString: () => name, name }),
    get: () => ({
      fetch: async (request: Request) => {
        sent.push(request);
        return new Response('from the object', { headers: { 'set-cookie': 'x=1' } });
      },
    }),
  };
  const hub = { idFromName: (name: string) => ({ toString: () => name }), get: () => ({ fetch: async () => new Response('{}') }) };
  const env = { DB: fakeD1(), ROOMS: rooms, HUB: hub, ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, OA_SIGNING_KEYS: 'k'.repeat(40), OA_OWNER_KEY: OWNER_KEY, ...vars };
  const site = new Site(env as never, { version: 'x', types: [], shellHtml: '', homeHtml: '', ...(frames ? { frames } : {}) }, { log: () => undefined });
  assert.equal(site.configError, null, String(site.configError));
  const catalog = await site.ready();
  const ada = await catalog.createUser({ name: 'Ada' });
  const page = await catalog.createArtifact({ type: 'page', title: 'Poll', ownerUser: ada.id });
  const opaque = await pageHostOpaque(site.config.signingKeys, page.id, { kind: 'user', id: ada.id }, await catalog.siteEpoch());
  return { site, sent, page, host: new URL(pageOriginOf(site.config, page.id, opaque)).host };
}

const SPLIT = { OA_APP_ORIGIN: 'http://localhost:8787', OA_CONTENT_ORIGIN: 'http://{id}.content.localhost:8787' };
const SAME = { OA_APP_ORIGIN: 'http://app.oa.localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa.localhost:4900', OA_CONTENT_SAME_SITE: 'true' };

test('the Worker sends a page host to the artifact\'s object, with no cookie either way', async () => {
  const { site, sent, page, host } = await siteWith(SPLIT, frameBuild());
  assert.ok(site.pages);
  assert.deepEqual(site.typeInfo('page'), { title: 'Page' });
  const answer = await site.fetch(new Request(`http://${host}/_f/1/app.js`, { headers: { cookie: 'oa_session=secret', [ARTIFACT_HEADER]: 'art_forged' } }), { waitUntil: () => undefined });
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get('set-cookie'), null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.headers.get('cookie'), null);
  assert.equal(sent[0]!.headers.get(ARTIFACT_HEADER), page.id);
  assert.equal(new URL(sent[0]!.url).host, host, 'the object sees the page host');
  // A page host of an artifact the catalog does not know creates no object.
  const unknown = new URL(pageOriginOf(site.config, 'art_0000000000unknown00000a', 'a'.repeat(24))).host;
  assert.equal((await site.fetch(new Request(`http://${unknown}/`), { waitUntil: () => undefined })).status, 404);
  assert.equal(sent.length, 1);
});

test('without pages (one origin for both, or no frame type in the build) a page host is a stray name and `page` no type', async () => {
  for (const [vars, frames] of [[SAME, frameBuild()], [SPLIT, undefined]] as const) {
    const { site, sent, host } = await siteWith(vars, frames);
    assert.equal(site.pages, null);
    assert.equal(site.typeInfo('page'), null);
    const answer = await site.fetch(new Request(`http://${host}/`), { waitUntil: () => undefined });
    assert.equal(answer.status, 421, host);
    assert.equal(sent.length, 0);
  }
});

test('a bad OA_PAGE_NETWORK is a configuration error naming it', () => {
  const stub = { idFromName: (name: string) => ({ toString: () => name }), get: () => ({ fetch: async () => new Response() }) };
  const site = new Site({ DB: fakeD1(), ROOMS: stub, HUB: stub, ASSETS: { fetch: async () => new Response() }, OA_SIGNING_KEYS: 'k'.repeat(40), OA_OWNER_KEY: OWNER_KEY, OA_PAGE_NETWORK: 'everything', ...SPLIT } as never, { version: 'x', types: [], shellHtml: '', homeHtml: '', frames: frameBuild() }, { log: () => undefined });
  assert.match(String(site.configError), /OA_PAGE_NETWORK/);
});

test('the Link and MCP services carry pages only where they run; a change not made by the Link is told to it', async () => {
  const calls: unknown[] = [];
  const room = {
    capabilities: async () => ({ db: true }),
    setCapabilities: async (caps: Record<string, unknown>) => {
      calls.push(caps);
      return calls.length === 1;
    },
  };
  const emitted: unknown[] = [];
  const ctx = { events: { emit: (name: string, payload: unknown) => emitted.push({ name, payload }) }, access: {} } as unknown as AppCtx;
  const base = { build: { version: 'x', types: [] }, room: () => room as never, removeArtifact: async () => undefined, hub: { stream: async () => new Response() } };
  assert.equal(cloudflareLinkServices({ ...base, pages: null }, ctx).pages, undefined);
  assert.ok(cloudflareLinkServices({ ...base, pages: { build: frameBuild() } }, ctx).pages);
  assert.ok(cloudflareMcpServices({ ...base, pages: { build: frameBuild() } }, ctx, mcpTypesOf([])).pages);
  assert.equal(cloudflareMcpServices(base, ctx, mcpTypesOf([])).pages, undefined);
  const pages = roomPageServices({ room: () => room as never }, ctx.events);
  assert.deepEqual(await pages.capabilities('art_x'), { db: true });
  await pages.setCapabilities('art_x', { db: true, identity: true }, 'mcp');
  assert.deepEqual(emitted, [{ name: 'artifact-changed', payload: { id: 'art_x', author: 'mcp', capabilities: { db: true, identity: true } } }]);
  // Unchanged: nothing told; the Link's own change: nothing told either.
  await pages.setCapabilities('art_x', { db: true, identity: true }, 'mcp');
  calls.length = 0;
  await pages.setCapabilities('art_x', { db: true }, 'agent');
  assert.equal(emitted.length, 1);
});
