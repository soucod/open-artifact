/**
 * The built-in `page` type: how the registry resolves it (frame-host in page mode, no index.html of its own), the
 * `capabilities` argument of Artifact publish (kept, cleared, replaced, refused for other types), its title from
 * `<title>`, quickstart's free-text matches, and that only a custom page-style type is refused a site outright.
 */
import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactIdOf, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { capabilitiesOf, capabilityNotes } from '../src/tools.ts';
import { BUILTIN_TYPE_IDS, CUSTOM_NO_SITE, frameHostBin, isBuiltinPage, isPageType, isSiteKindType, readTypeFolder, siteRefusal, typePublishRefusal } from '../src/types.ts';

const PAGE_DIR = join(import.meta.dirname, '..', '..', '..', 'artifact-types', 'page');

let daemon: Daemon;
let state: DaemonState;
const workspace = tempDir('open-artifact-ws-');
const caller = { harness: 'dsh', session: 'page-1', workspace };

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

const tool = (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller });
const marker = (root: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, '.artifact.json'), 'utf8'));

async function createPage(title: string, extra: Record<string, unknown> = {}): Promise<{ url: string; root: string; made: ToolCallResult }> {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/page', title, open: 'never', ...extra });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  return { url: String(made.url), root: String(made.root), made };
}

test('the page type resolves to frame-host in page mode, with no index.html of its own', () => {
  assert.ok(BUILTIN_TYPE_IDS.includes('page'));
  assert.equal(existsSync(join(PAGE_DIR, 'index.html')), false);
  const type = readTypeFolder(PAGE_DIR, { root: join(PAGE_DIR, '..'), scope: 'builtin', trusted: true } as never);
  assert.ok(type);
  assert.deepEqual(type.problems, []);
  assert.equal(type.runtime, 'frame');
  assert.equal(type.runnable, true);
  assert.equal(type.titleFrom, 'index.html');
  assert.ok(isPageType(type));
  assert.deepEqual(type.entry, { kind: 'server', start: { command: 'node', args: [frameHostBin()!], env: {} }, url: null, open: true, share: false, actions: true });
  assert.equal(isPageType(daemon.types.get('design', undefined)), false);
});

test('a page with no capabilities declares none; the result says so', async () => {
  const { root, made } = await createPage('Bare page');
  assert.deepEqual(made.capabilities, {});
  assert.equal(marker(root).capabilities, undefined);
  assert.equal(made.notes, undefined);
});

test('capabilities on create go to the record and the marker, with notes for those that only answer with an error', async () => {
  const { url, root, made } = await createPage('Lunch poll', { capabilities: { db: true, assets: { maxBytes: 1 }, mcp: true, holo: true } });
  assert.deepEqual(made.capabilities, { db: true, assets: { maxBytes: 1 }, mcp: true, holo: true });
  assert.deepEqual(marker(root).capabilities, { db: true, assets: { maxBytes: 1 }, mcp: true, holo: true });
  assert.deepEqual(daemon.store.require(url).capabilities, { db: true, assets: { maxBytes: 1 }, mcp: true, holo: true });
  const notes = (made.notes as string[]).join('\n');
  assert.match(notes, /mcp: declared.*server_not_connected/);
  assert.match(notes, /holo: no such capability here/);
});

test('on a write, capabilities left out are kept, {} clears, and an object replaces the whole set', async () => {
  const { url, root } = await createPage('Counter', { capabilities: { db: true } });

  const kept = await tool('Artifact', { action: 'publish', url, files: { 'index.html': '<!doctype html><title>Counter</title><p>0</p>' } });
  assert.equal(kept.error, undefined, JSON.stringify(kept.error));
  assert.equal(kept.capabilities, undefined, 'not said when not given');
  assert.deepEqual(marker(root).capabilities, { db: true });
  assert.deepEqual(daemon.store.require(url).capabilities, { db: true });

  const replaced = await tool('Artifact', { action: 'publish', url, capabilities: { room: true, user: {} } });
  assert.equal(replaced.error, undefined, 'capabilities alone, with no files');
  assert.deepEqual(replaced.capabilities, { room: true, user: {} });
  assert.deepEqual(marker(root).capabilities, { room: true, user: {} });
  assert.deepEqual(daemon.store.require(url).capabilities, { room: true, user: {} });
  assert.equal(readFileSync(join(root, 'index.html'), 'utf8'), '<!doctype html><title>Counter</title><p>0</p>', 'files untouched');

  const cleared = await tool('Artifact', { action: 'publish', url, capabilities: {} });
  assert.deepEqual(cleared.capabilities, {});
  assert.equal(marker(root).capabilities, undefined);
  assert.ok(!daemon.store.require(url).capabilities);
  assert.equal(marker(root).id, artifactIdOf(url), 'the rest of the marker is kept');
});

test('capabilities are refused for another type and for a bad shape', async () => {
  const other = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title: 'Notes', capabilities: { db: true } });
  assert.equal((other.error as { code: string }).code, 'invalid_argument');
  assert.match((other.error as { message: string }).message, /page artifacts only/);
  const listed = await tool('Artifact', { action: 'list', query: 'Notes' });
  assert.deepEqual(listed.artifacts, [], 'nothing was created');

  const docs = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title: 'Plain doc' });
  assert.equal(docs.error, undefined, JSON.stringify(docs.error));
  const write = await tool('Artifact', { action: 'publish', url: docs.url, capabilities: {} });
  assert.equal((write.error as { code: string }).code, 'invalid_argument');

  const { url } = await createPage('Shapes');
  for (const bad of [[], 'db', { db: 1 }, { db: 'yes' }, null]) {
    const r = await tool('Artifact', { action: 'publish', url, capabilities: bad });
    assert.equal((r.error as { code: string } | undefined)?.code, 'invalid_argument', JSON.stringify(bad));
  }
  assert.throws(() => capabilitiesOf({ db: true }, { id: 'slides', openArtifact: {} } as never), /page artifacts only/);
  assert.deepEqual(capabilitiesOf({ db: true, comments: false }, { id: 'page', openArtifact: { style: 'page' } } as never), { db: true, comments: false });
  assert.deepEqual(capabilityNotes({ db: true, comments: false, tts: true }), ['tts: declared, but on this computer it answers only with an error (tts: capability_disabled); the page should handle that.']);
});

test("the page's <title> becomes the artifact's title when the agent writes index.html", async () => {
  const { url } = await createPage('Untitled');
  await tool('Artifact', { action: 'publish', url, files: { 'index.html': '<!doctype html><html><head><title>  Unit   converter &amp; more </title></head><body></body></html>' } });
  assert.equal(daemon.store.require(url).title, 'Unit converter & more');
  await tool('Artifact', { action: 'publish', url, files: { 'index.html': '<!doctype html><title></title>' } });
  assert.equal(daemon.store.require(url).title, 'Unit converter & more', 'an empty <title> never clears it');
  await tool('Artifact', { action: 'publish', url, files: { 'app.js': '1' } });
  assert.equal(daemon.store.require(url).title, 'Unit converter & more');
});

test('adopting a page folder keeps the capabilities its marker declares', async () => {
  const dir = join(workspace, 'old-page');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Old poll</title>');
  writeFileSync(join(dir, '.artifact.json'), JSON.stringify({ capabilities: { db: true } }));
  const adopted = await tool('Artifact', { action: 'adopt', folder: 'old-page', type_url: 'open-artifact://type/page' });
  assert.equal(adopted.error, undefined, JSON.stringify(adopted.error));
  const record = daemon.store.require(adopted.url);
  assert.deepEqual(record.capabilities, { db: true });
  assert.equal(record.title, 'Old poll');
  assert.deepEqual(marker(dir).capabilities, { db: true });
});

test('quickstart: "other" and the plain words for a page find the page type', async () => {
  const pick = async (intent: string): Promise<string | null> => ((await tool('Artifact', { action: 'quickstart', intent })).recommended as { id: string } | null)?.id ?? null;
  for (const intent of ['other', '做个小游戏', '帮我做一个网页', '做个解释页', '小工具', 'a mini game', 'a widget to convert units', 'web page']) assert.equal(await pick(intent), 'page', intent);
  assert.equal(await pick('landing page'), 'design', 'a landing page stays a design');
  assert.equal(await pick('a pitch deck'), 'slides');
  assert.equal(await pick('dashboard'), 'data');
});

test('a page is not refused before the site is asked; a custom page-style type is', () => {
  assert.equal(siteRefusal(daemon.types.get('page', undefined)), null, 'the built-in page goes to a site that runs pages');
  assert.equal(isBuiltinPage(daemon.types.get('page', undefined)), true);
  assert.equal(siteRefusal({ id: 'mine', scope: 'user', runtime: 'frame', openArtifact: { style: 'page' } } as never), CUSTOM_NO_SITE);
  assert.equal(siteRefusal(daemon.types.get('docs', undefined)), null);
  // A custom type whose own index.html frame-host runs goes to a site that has it; a static one stays.
  assert.equal(siteRefusal({ id: 'poll', scope: 'user', runtime: 'frame', openArtifact: {} } as never), null);
  assert.equal(isSiteKindType({ id: 'poll', scope: 'user', runtime: 'frame', openArtifact: {} } as never), true);
  assert.equal(siteRefusal({ id: 'flat', scope: 'user', runtime: 'static', openArtifact: {} } as never), CUSTOM_NO_SITE);
});

test('which types go to a site\'s catalog: the person\'s own page-kind types with a uid', () => {
  const base = { id: 'poll', scope: 'user', trusted: true, runtime: 'frame', openArtifact: {}, uid: 'u-1', root: '/r' };
  assert.equal(typePublishRefusal(base as never), null);
  assert.equal(typePublishRefusal({ ...base, scope: 'extra' } as never), null);
  assert.equal(typePublishRefusal({ ...base, scope: 'project', trusted: true } as never), null);
  assert.match(typePublishRefusal({ ...base, scope: 'project', trusted: false } as never) ?? '', /does not trust/);
  assert.match(typePublishRefusal({ ...base, scope: 'installed' } as never) ?? '', /only its author publishes it/);
  assert.match(typePublishRefusal({ ...base, scope: 'builtin' } as never) ?? '', /built in/);
  assert.match(typePublishRefusal({ ...base, openArtifact: { style: 'page' } } as never) ?? '', /served as they are/);
  assert.match(typePublishRefusal({ ...base, runtime: 'server' } as never) ?? '', /served as they are/);
  assert.match(typePublishRefusal({ ...base, uid: null } as never) ?? '', /no uid/);
});

test('Artifact share to a cloud remote: a page asks the site like any other type (here: only the person publishes)', async () => {
  const { url } = await createPage('Share me');
  const shared = await tool('Artifact', { action: 'share', url, cloud: 'somewhere' });
  assert.equal((shared.error as { code: string }).code, 'not_granted');
});
