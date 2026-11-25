import assert from 'node:assert/strict';
import { readFile, symlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { LINK_API_PREFIX, type LinkArtifact, type LinkArtifactsResult, type LinkFilesResult, type LinkHello, type LinkManifest } from '@open-artifact/protocol';
import { archiveEntries } from '@open-artifact/type-server';
import { b64, makeLinkHost } from './link-fixture.ts';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const url = (name: string, query: Record<string, string> = {}): string => `${LINK_API_PREFIX}${name}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`;

test('every Link route wants a Link token, and reaches only the token user\'s own artifacts', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada, cookie } = await host.person('Ada');
  const { user: bob } = await host.person('Bob');
  const token = await host.token(ada);
  const other = await host.token(ada, ['mcp']);
  const revoked = await host.token(ada);
  await host.catalog.revokeAgentToken(revoked.id);
  const mine = await host.artifact(ada);
  const bobs = await host.artifact(bob);

  const routes: Array<{ path: string; method: 'GET' | 'POST'; body?: unknown }> = [
    { path: url('hello'), method: 'GET' },
    { path: url('artifacts'), method: 'GET' },
    { path: url('manifest', { id: mine.id }), method: 'GET' },
    { path: url('export', { id: mine.id }), method: 'GET' },
    { path: url('files', { id: mine.id, path: 'index.html' }), method: 'GET' },
    { path: url('files'), method: 'POST', body: { id: mine.id, writes: [{ path: 'a.txt', content: b64('a') }] } },
    { path: url('call'), method: 'POST', body: { id: mine.id, action: 'context' } },
    { path: url('unpublish'), method: 'POST', body: { id: mine.id } },
    { path: url('ack'), method: 'POST', body: { ids: [] } },
    { path: url('events'), method: 'GET' },
  ];
  for (const route of routes) {
    const none = await host.fetch(route.path, { method: route.method, body: route.body });
    assert.equal(none.status, 401, `${route.path} without a token`);
    assert.ok(none.headers.get('www-authenticate'), route.path);
    const session = await host.fetch(route.path, { method: route.method, body: route.body, cookie });
    assert.equal(session.status, 401, `${route.path} with a session only`);
    const bad = await host.fetch(route.path, { method: route.method, body: route.body, token: revoked.access });
    assert.equal(bad.status, 401, `${route.path} with a revoked token`);
    assert.equal(bad.headers.get('www-authenticate'), 'Bearer error="invalid_token"');
    const scoped = await host.fetch(route.path, { method: route.method, body: route.body, token: other.access });
    assert.equal(scoped.status, 403, `${route.path} without the link scope`);
    assert.equal(((await scoped.json()) as { code: string }).code, 'not_granted');
  }

  // Bob's artifact is not there for Ada's Link.
  const theirs: Array<{ path: string; method: 'GET' | 'POST'; body?: unknown }> = [
    { path: url('manifest', { id: bobs.id }), method: 'GET' },
    { path: url('export', { id: bobs.id }), method: 'GET' },
    { path: url('files', { id: bobs.id, path: 'index.html' }), method: 'GET' },
    { path: url('files'), method: 'POST', body: { id: bobs.id, writes: [{ path: 'a.txt', content: b64('a') }] } },
    { path: url('call'), method: 'POST', body: { id: bobs.id, action: 'context' } },
    { path: url('unpublish'), method: 'POST', body: { id: bobs.id } },
    { path: url('manifest', { id: 'art_doesnotexist0' }), method: 'GET' },
  ];
  for (const route of theirs) {
    const response = await host.fetch(route.path, { method: route.method, body: route.body, token: token.access });
    assert.equal(response.status, 404, route.path);
    assert.equal(((await response.json()) as { code: string }).code, 'not_found');
  }
  assert.equal(host.actions.length, 0);
  assert.equal((await host.catalog.getArtifact(bobs.id))!.trashedAt, null);

  const hello = (await (await host.fetch(url('hello'), { token: token.access })).json()) as LinkHello;
  assert.equal(hello.openArtifact, 1);
  assert.equal(hello.user.id, ada.id);
  assert.ok(hello.limits.maxBodyBytes > hello.limits.maxFileBytes);

  const listed = (await (await host.fetch(url('artifacts'), { token: token.access })).json()) as LinkArtifactsResult;
  assert.deepEqual(listed.artifacts.map((a) => a.id), [mine.id]);
  assert.equal(listed.artifacts[0]!.url, `${host.config.appOrigin}/a/${mine.id}`);
  assert.equal(listed.artifacts[0]!.files, undefined, 'no manifests unless asked');
  const withFiles = (await (await host.fetch(url('artifacts', { files: '1' }), { token: token.access })).json()) as LinkArtifactsResult;
  assert.equal(withFiles.artifacts[0]!.files!['index.html']!.etag, sha('<h1>Board</h1>'));
});

test('import: a new id, the detected type and title, clashes and refusals', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const zip = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  const post = (query: Record<string, string>, body: Uint8Array, type = 'application/zip'): Promise<Response> =>
    host.fetch(url('import', query), { method: 'POST', token: token.access, body, headers: { 'content-type': type } });

  let response = await post({ id: 'art_linkimport001' }, zip({ type: 'design', title: 'Poster', files: { 'index.html': 'x', 'project/a.jsx': 'y' } }));
  assert.equal(response.status, 201);
  const imported = (await response.json()) as LinkArtifact;
  assert.equal(imported.id, 'art_linkimport001');
  assert.equal(imported.type, 'design');
  assert.equal(imported.title, 'Poster');
  assert.deepEqual(Object.keys(imported.files).sort(), ['index.html', 'project/a.jsx']);
  const row = (await host.catalog.getArtifact('art_linkimport001'))!;
  assert.equal(row.ownerUser, ada.id);
  assert.deepEqual(host.heard['artifact-changed'].at(-1), { id: 'art_linkimport001', author: 'agent' });
  assert.ok((await host.catalog.listAudit()).some((entry) => entry.action === 'link.import' && entry.artifactId === 'art_linkimport001'));

  // A title given wins over the detected one.
  response = await post({ id: 'art_linkimport002', title: 'My title' }, zip({ title: 'Detected' }));
  assert.equal(((await response.json()) as LinkArtifact).title, 'My title');
  // ...but the title the content declares (a doc's name in doc/doc.json) wins over both: a folder adopted and
  // published shows the document's title, not the folder's name.
  response = await post({ id: 'art_linkimport006', title: 'docs-browser-qa' }, zip({ type: 'docs', title: 'docs-browser-qa', files: { 'doc/doc.json': '{"name":"Docs Browser QA"}' } }));
  assert.equal(response.status, 201);
  assert.equal(((await response.json()) as LinkArtifact).title, 'Docs Browser QA');
  assert.equal((await host.catalog.getArtifact('art_linkimport006'))?.title, 'Docs Browser QA');

  // The id is taken.
  response = await post({ id: 'art_linkimport001' }, zip({}));
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { code: string }).code, 'conflict');

  response = await post({ id: 'nope' }, zip({}));
  assert.equal(response.status, 400);

  response = await post({ id: 'art_linkimport003' }, zip({ bad: true }));
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, 'not_artifact');
  assert.equal(await host.catalog.getArtifact('art_linkimport003'), undefined);

  response = await post({ id: 'art_linkimport004' }, zip({}), 'application/json');
  assert.equal(response.status, 415);

  // Past the body cap.
  const big = new Uint8Array(100 * 1024 * 1024 + 1);
  response = await post({ id: 'art_linkimport005' }, big);
  assert.equal(response.status, 413);
  assert.equal(await host.catalog.getArtifact('art_linkimport005'), undefined);
});

test('import: publishing again an artifact the person unpublished replaces it; anyone else\'s id stays a conflict', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const { user: bob } = await host.person('Bob');
  const adaToken = await host.token(ada);
  const bobToken = await host.token(bob);
  const zip = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  const post = (token: string, id: string, body: Uint8Array): Promise<Response> =>
    host.fetch(url('import', { id }), { method: 'POST', token, body, headers: { 'content-type': 'application/zip' } });
  const id = 'art_republish0001';

  assert.equal((await post(adaToken.access, id, zip({ title: 'First', files: { 'index.html': 'v1', 'old.txt': 'gone soon' } }))).status, 201);
  // Shared before it was unpublished: a person, a link with a guest, a pin.
  await host.catalog.upsertGrant({ artifactId: id, subjectKind: 'user', subject: bob.id, role: 'editor', createdBy: ada.id });
  const { link } = await host.catalog.createLink(id, 'commenter');
  await host.catalog.joinGuest(link.id, 'Gus');
  await host.catalog.setPinned(bob.id, id, true);

  // Not trashed: still a conflict, for its owner too.
  let response = await post(adaToken.access, id, zip({}));
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { code: string }).code, 'conflict');

  // Unpublished (trashed): someone else's Link still gets a conflict, and nothing is touched.
  assert.equal((await host.call('unpublish', adaToken.access, { id })).status, 200);
  response = await post(bobToken.access, id, zip({}));
  assert.equal(response.status, 409);
  assert.equal((await host.catalog.getArtifact(id))?.trashedAt !== null, true);
  assert.deepEqual(host.removed, []);

  // Its owner's Link publishes it again: a fresh artifact under the same id, the old folder and sharing gone.
  response = await post(adaToken.access, id, zip({ title: 'Second', files: { 'index.html': 'v2' } }));
  assert.equal(response.status, 201, await response.clone().text());
  const again = (await response.json()) as LinkArtifact;
  assert.equal(again.title, 'Second');
  assert.deepEqual(Object.keys(again.files), ['index.html']);
  const row = (await host.catalog.getArtifact(id))!;
  assert.equal(row.trashedAt, null);
  assert.equal(row.ownerUser, ada.id);
  assert.equal(row.generalAccess, 'restricted');
  assert.deepEqual(host.removed, [id]);
  await assert.rejects(stat(join(host.dataDir, 'artifacts', id, 'old.txt')));
  assert.equal(await readFile(join(host.dataDir, 'artifacts', id, 'index.html'), 'utf8'), 'v2');
  const counts = async (table: string): Promise<number> => Number((await host.catalog.driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE artifact_id = ?`, [id]))?.n ?? 0);
  for (const table of ['grants', 'links', 'guests', 'pins']) assert.equal(await counts(table), 0, table);
  const audit = await host.catalog.listAudit();
  assert.ok(audit.some((entry) => entry.action === 'link.import_replaced' && entry.artifactId === id));
});

test('manifest equals the export zip\'s entries; files GET reads one file', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const art = await host.artifact(ada, {
    'index.html': '<h1>x</h1>',
    'db/elements/n1.json': '{"type":"note"}',
    '.artifact.json': '{"type":"whiteboard"}',
    '_agent/inbox.json': '[]',
    '.DS_Store': 'junk',
    'node_modules/x/index.js': 'junk',
    'doc/tabs/t1.json': '{}',
  });
  const manifest = (await (await host.fetch(url('manifest', { id: art.id }), { token: token.access })).json()) as LinkManifest;
  const root = join(host.dataDir, 'artifacts', art.id);
  const entries = await archiveEntries(root);
  assert.deepEqual(Object.keys(manifest.files).sort(), entries.map((e) => e.name.slice(e.name.indexOf('/') + 1)).sort());
  assert.ok(!('_agent/inbox.json' in manifest.files));
  assert.ok(!('.DS_Store' in manifest.files));
  assert.ok('.artifact.json' in manifest.files);
  for (const entry of entries) {
    const path = entry.name.slice(entry.name.indexOf('/') + 1);
    assert.equal(manifest.files[path]!.etag, createHash('sha256').update(await readFile(entry.file)).digest('hex'));
    assert.equal(manifest.files[path]!.size, entry.size);
  }

  let response = await host.fetch(url('files', { id: art.id, path: 'db/elements/n1.json' }), { token: token.access });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"type":"note"}');
  assert.equal(response.headers.get('etag'), `"${sha('{"type":"note"}')}"`);
  response = await host.fetch(url('files', { id: art.id, path: '_agent/inbox.json' }), { token: token.access });
  assert.equal(response.status, 404);
  response = await host.fetch(url('files', { id: art.id, path: '../x' }), { token: token.access });
  assert.equal(response.status, 404);

  response = await host.fetch(url('export', { id: art.id }), { token: token.access });
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(await response.text(), `PK-${art.id}`);
});

test('files push: create, update, conflict, delete, refusals', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const art = await host.artifact(ada, { 'index.html': 'v1' });
  const root = join(host.dataDir, 'artifacts', art.id);
  const push = async (writes: unknown[]): Promise<Response> => host.call('files', token.access, { id: art.id, writes });

  let response = await push([
    { path: 'db/elements/n2.json', content: b64('{"a":1}'), if_match: null },
    { path: 'index.html', content: b64('v2'), if_match: sha('v1') },
    { path: 'styles.css', content: b64('body{}') },
  ]);
  assert.equal(response.status, 200);
  let result = (await response.json()) as LinkFilesResult;
  assert.deepEqual(result.results, [
    { path: 'db/elements/n2.json', etag: sha('{"a":1}') },
    { path: 'index.html', etag: sha('v2') },
    { path: 'styles.css', etag: sha('body{}') },
  ]);
  assert.equal(await readFile(join(root, 'db/elements/n2.json'), 'utf8'), '{"a":1}');
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), 'v2');
  assert.deepEqual(host.heard['artifact-touched'].at(-1), { id: art.id, author: 'agent', paths: ['db/elements/n2.json', 'index.html', 'styles.css'] });

  // A stale etag and a file that is there already conflict; the other write goes through.
  response = await push([
    { path: 'index.html', content: b64('v3'), if_match: sha('v1') },
    { path: 'styles.css', content: b64('x'), if_match: null },
    { path: 'notes.md', content: b64('n') },
  ]);
  result = (await response.json()) as LinkFilesResult;
  assert.deepEqual(result.results, [
    { path: 'index.html', conflict: true, etag: sha('v2') },
    { path: 'styles.css', conflict: true, etag: sha('body{}') },
    { path: 'notes.md', etag: sha('n') },
  ]);
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), 'v2');

  // Delete.
  response = await push([{ path: 'styles.css', content: null, if_match: sha('body{}') }]);
  assert.deepEqual(((await response.json()) as LinkFilesResult).results, [{ path: 'styles.css', etag: null }]);
  await assert.rejects(stat(join(root, 'styles.css')));
  const manifest = (await (await host.fetch(url('manifest', { id: art.id }), { token: token.access })).json()) as LinkManifest;
  assert.ok(!('styles.css' in manifest.files));
  assert.equal(manifest.files['index.html']!.etag, sha('v2'));

  // Refused paths fail the whole request before anything is written.
  await mkdir(join(host.dataDir, 'outside'), { recursive: true });
  await symlink(join(host.dataDir, 'outside'), join(root, 'escape'));
  for (const path of ['doc/tabs/t1.json', 'Doc/tabs/t1.json', 'sheet/a.json', '.artifact.json', 'history/index.json', 'history', '_agent/x', '../x', '/etc/x', 'a/../../x', '.DS_Store', 'node_modules/a.js', 'a\\b', 'escape/x.txt', 'x/.tmp-1']) {
    response = await push([
      { path: 'ok.txt', content: b64('ok') },
      { path, content: b64('x') },
    ]);
    assert.equal(response.status, 400, path);
    assert.equal(((await response.json()) as { code: string }).code, 'invalid_argument', path);
  }
  await assert.rejects(stat(join(root, 'ok.txt')));
  await assert.rejects(stat(join(host.dataDir, 'outside', 'x.txt')));

  response = await push([{ path: 'a.txt', content: 'not base64!' }]);
  assert.equal(response.status, 400);
  response = await push([]);
  assert.equal(response.status, 400);

  // A push of the file the title is read from renames the artifact, and the answer says so (a whiteboard's is
  // db/board/meta.json); a push that leaves it alone answers no title.
  const board = await host.artifact(ada, { 'index.html': 'b' }, { type: 'whiteboard', title: 'Old name' });
  response = await host.call('files', token.access, { id: board.id, writes: [{ path: 'db/board/meta.json', content: b64('{"title":"New name"}') }] });
  result = (await response.json()) as LinkFilesResult;
  assert.equal(result.title, 'New name');
  assert.equal((await host.catalog.getArtifact(board.id))?.title, 'New name');
  assert.equal((host.heard['artifact-touched'].at(-1) as { title?: string }).title, 'New name');
  response = await host.call('files', token.access, { id: board.id, writes: [{ path: 'db/elements/x.json', content: b64('{}') }] });
  assert.equal(((await response.json()) as LinkFilesResult).title, undefined);

  // Past the path's limit (project/ takes 16 MiB).
  response = await push([{ path: 'project/big.bin', content: Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64') }]);
  assert.equal(response.status, 413);
  await assert.rejects(stat(join(root, 'project/big.bin')));
});

test('call forwards actions and refuses the ones a host cannot run; unpublish trashes', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const art = await host.artifact(ada);

  let response = await host.call('call', token.access, { id: art.id, action: 'open-artifact.comments.reply', args: { thread: 't1', text: 'Done' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, name: 'open-artifact.comments.reply' });
  assert.deepEqual(host.actions.at(-1), { id: art.id, name: 'open-artifact.comments.reply', args: { thread: 't1', text: 'Done' } });

  response = await host.call('call', token.access, { id: art.id, action: 'context' });
  assert.equal(response.status, 200);
  assert.deepEqual(host.actions.at(-1)!.args, {});

  for (const action of ['upload', 'snapshot', 'share', 'duplicate', 'import']) {
    response = await host.call('call', token.access, { id: art.id, action });
    assert.equal(response.status, 400, action);
    assert.equal(((await response.json()) as { code: string }).code, 'unsupported');
  }
  assert.equal(host.actions.length, 2);

  // An unknown action is the type server's to answer.
  response = await host.call('call', token.access, { id: art.id, action: 'nope' });
  assert.equal(response.status, 404);
  assert.equal(((await response.json()) as { code: string }).code, 'method_not_found');

  response = await host.call('call', token.access, { id: art.id, action: '../x' });
  assert.equal(response.status, 400);
  response = await host.call('call', token.access, { id: art.id, action: 'context', args: [1] });
  assert.equal(response.status, 400);

  response = await host.call('unpublish', token.access, { id: art.id });
  assert.equal(response.status, 200);
  assert.ok((await host.catalog.getArtifact(art.id))!.trashedAt);
  assert.deepEqual(host.refreshed, [art.id]);
  assert.deepEqual(host.heard['artifact-changed'].at(-1), { id: art.id, author: 'agent' });
  assert.ok((await host.catalog.listAudit()).some((entry) => entry.action === 'link.unpublish'));
  // Gone for the Link now.
  response = await host.fetch(url('manifest', { id: art.id }), { token: token.access });
  assert.equal(response.status, 404);
  const listed = (await (await host.fetch(url('artifacts'), { token: token.access })).json()) as LinkArtifactsResult;
  assert.equal(listed.artifacts.length, 0);
});

test('capabilities: only on a site that runs pages (its hello says so), for the owner\'s own artifact', async (t) => {
  const set: Array<{ id: string; capabilities: Record<string, unknown>; author: string }> = [];
  const pages = {
    capabilities: async () => ({}),
    setCapabilities: async (id: string, capabilities: Record<string, unknown>, author: string) => void set.push({ id, capabilities, author }),
  };
  const host = await makeLinkHost({ pages });
  const plain = await makeLinkHost();
  t.after(async () => {
    await host.close();
    await plain.close();
  });
  const { user: ada } = await host.person('Ada');
  const { user: bob } = await host.person('Bob');
  const token = await host.token(ada);
  const mine = await host.artifact(ada, undefined, { type: 'page' });
  const bobs = await host.artifact(bob, undefined, { type: 'page' });
  const hello = (await (await host.fetch(url('hello'), { token: token.access })).json()) as { features?: unknown };
  assert.deepEqual(hello.features, { pages: 1 });
  assert.equal((await host.call('capabilities', token.access, { id: mine.id, capabilities: { db: true } })).status, 200);
  assert.deepEqual(set, [{ id: mine.id, capabilities: { db: true }, author: 'agent' }]);
  assert.equal((await host.call('capabilities', token.access, { id: bobs.id, capabilities: {} })).status, 404, 'not the token user\'s');
  assert.equal((await host.call('capabilities', token.access, { id: mine.id, capabilities: [1] })).status, 400);
  assert.equal(set.length, 1);

  const { user: cy } = await plain.person('Cy');
  const plainToken = await plain.token(cy);
  const old = await plain.artifact(cy);
  const plainHello = (await (await plain.fetch(url('hello'), { token: plainToken.access })).json()) as { features?: unknown };
  assert.equal(plainHello.features, undefined, 'a site without pages does not offer them');
  assert.ok((await plain.call('capabilities', plainToken.access, { id: old.id, capabilities: {} })).status >= 400);
});
