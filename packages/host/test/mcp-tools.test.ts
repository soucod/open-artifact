/**
 * The remote MCP tools through `/mcp` with real tokens: creating and writing artifacts, reads with sha256 and
 * `changed_files`, `if_match` conflicts, `doc/` refused, actions, data, comments, sharing, delete; permissions as the
 * person's live role narrowed by the token's scopes; wakes taken once, between MCP callers and the Link.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import { parseConfig } from '../src/core/config.ts';
import { parseMcpConfig } from '../src/core/mcp/config.ts';
import { McpStore } from '../src/core/mcp/store.ts';
import { REMOTE_NOTE } from '../src/core/mcp/tools.ts';
import { contentOriginOf, verifyPageToken } from '../src/core/page-token.ts';
import type { UserRecord } from '../src/core/types.ts';
import { makeMcpHost, type McpHost } from './mcp-fixture.ts';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const idOf = (url: unknown): string => String(url).replace('open-artifact://artifact/', '');

describe('MCP tools', () => {
  let host: McpHost;
  let ada: UserRecord;
  let bo: UserRecord;
  let adaToken: string;
  let boToken: string;

  before(async () => {
    host = await makeMcpHost({ waitCapMs: 300 });
    const a = await host.person('Ada');
    const b = await host.person('Bo');
    ada = a.user;
    bo = b.user;
    adaToken = (await host.connect(a.cookie)).access_token;
    boToken = (await host.connect(b.cookie)).access_token;
  });
  after(() => host.close());

  it('creates an artifact, writes files, reads them back, and reports the person\'s edits', async () => {
    const created = await host.tool(adaToken, 'Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Plan' });
    assert.match(String(created.url), /^open-artifact:\/\/artifact\/art_/);
    assert.equal(created.view_url, `https://app.example/a/${idOf(created.url)}`);
    assert.match(String(created.instructions), /Write index\.html/);
    assert.match(String(created.instructions), /no folder on your computer/);
    const row = await host.catalog.getArtifact(idOf(created.url));
    assert.equal(row?.ownerUser, ada.id);
    assert.equal(row?.title, 'Plan');

    const html = '<h1>Plan</h1>';
    const written = await host.tool(adaToken, 'Artifact', { action: 'publish', url: created.url, files: { 'index.html': html, 'img/a.bin': { content: Buffer.from([0, 1, 2]).toString('base64'), encoding: 'base64' } } });
    assert.deepEqual(
      (written.written as Array<{ path: string; sha256: string }>).map((w) => [w.path, w.sha256]),
      [
        ['index.html', sha(html)],
        ['img/a.bin', createHash('sha256').update(Buffer.from([0, 1, 2])).digest('hex')],
      ],
    );
    assert.equal(await readFile(join(host.dataDir, 'artifacts', idOf(created.url), 'index.html'), 'utf8'), html);

    const summary = await host.tool(adaToken, 'Artifact', { action: 'read', url: created.url });
    assert.equal(summary.role, 'owner');
    assert.ok((summary.files as Array<{ path: string }>).some((f) => f.path === 'index.html'));
    assert.ok((summary.actions as Array<{ name: string }>).some((a) => a.name === 'check'));
    const one = await host.tool(adaToken, 'Artifact', { action: 'read', url: created.url, path: 'index.html' });
    assert.equal(one.content, html);
    assert.equal(one.sha256, sha(html));
    const binary = await host.tool(adaToken, 'Artifact', { action: 'read', url: created.url, path: 'img/a.bin' });
    assert.equal(binary.binary, true);
    const many = await host.tool(adaToken, 'Artifact', { action: 'read', url: created.url, paths: ['index.html', 'missing.txt'] });
    assert.equal((many.files as Array<{ error?: unknown }>)[1]!.error !== undefined, true);

    // A person edits a file from the page: the next call says so.
    await writeFile(join(host.dataDir, 'artifacts', idOf(created.url), 'index.html'), '<h1>Plan v2</h1>');
    const after = await host.tool(adaToken, 'Artifact', { action: 'publish', url: created.url, files: { 'notes.txt': 'n' } });
    assert.deepEqual(after.changed_files, ['index.html']);
  });

  it('refuses a stale if_match with the current version, and accepts a fresh one', async () => {
    const row = await host.artifact(ada, { 'index.html': 'one' });
    const url = `open-artifact://artifact/${row.id}`;
    const conflict = await host.tool(adaToken, 'Artifact', { action: 'publish', url, files: { 'index.html': 'two' }, if_match: { 'index.html': sha('zero') } });
    assert.equal((conflict.error as { code: string }).code, 'conflict');
    assert.equal(((conflict.current as Record<string, { content: string }>)['index.html']).content, 'one');
    assert.equal(await readFile(join(host.dataDir, 'artifacts', row.id, 'index.html'), 'utf8'), 'one');
    const ok = await host.tool(adaToken, 'Artifact', { action: 'publish', url, files: { 'index.html': 'two' }, if_match: { 'index.html': sha('one'), 'new.txt': null } });
    assert.ok(!ok.error);
    const exists = await host.tool(adaToken, 'Artifact', { action: 'publish', url, files: { 'index.html': 'three' }, if_match: { 'index.html': null } });
    assert.equal((exists.error as { code: string }).code, 'conflict');
  });

  it('refuses doc/ and sheet/ writes with a fix, and the artifact\'s bookkeeping', async () => {
    const row = await host.artifact(ada, { 'doc/tabs.json': '{}' }, { type: 'docs', title: 'Doc' });
    const url = `open-artifact://artifact/${row.id}`;
    const doc = await host.tool(adaToken, 'Artifact', { action: 'publish', url, files: { 'doc/tabs.json': '{"x":1}' } });
    assert.equal((doc.error as { code: string }).code, 'bad_path');
    assert.match(String((doc.error as { fix: string }).fix), /Artifact \{action: "call"/);
    const sheet = await host.tool(adaToken, 'Artifact', { action: 'publish', url, files: { 'Sheet/log.json': '{}' } });
    assert.equal((sheet.error as { code: string }).code, 'bad_path');
    const marker = await host.tool(adaToken, 'Artifact', { action: 'publish', url, files: { '.artifact.json': '{}' } });
    assert.equal((marker.error as { code: string }).code, 'bad_path');
  });

  it('lists own and shared artifacts with roles, and hides what the person cannot open', async () => {
    const mine = await host.artifact(bo, undefined, { title: 'Bo private' });
    const shared = await host.artifact(bo, undefined, { title: 'Bo shared' });
    await host.catalog.upsertGrant({ artifactId: shared.id, subjectKind: 'user', subject: ada.id, role: 'viewer', createdBy: bo.id });
    const listed = await host.tool(adaToken, 'Artifact', { action: 'list' });
    const rows = listed.artifacts as Array<{ url: string; role: string; mine: boolean; title: string }>;
    const sharedRow = rows.find((r) => r.url.endsWith(shared.id));
    assert.equal(sharedRow?.role, 'viewer');
    assert.equal(sharedRow?.mine, false);
    assert.ok(!rows.some((r) => r.url.endsWith(mine.id)));
    const onlyMine = await host.tool(adaToken, 'Artifact', { action: 'list', scope: 'mine' });
    assert.ok(!(onlyMine.artifacts as Array<{ url: string }>).some((r) => r.url.endsWith(shared.id)));

    const hidden = await host.tool(adaToken, 'Artifact', { action: 'read', url: `open-artifact://artifact/${mine.id}` });
    assert.equal((hidden.error as { code: string }).code, 'not_found');
    const viaView = await host.tool(adaToken, 'Artifact', { action: 'read', url: `https://app.example/a/${shared.id}` });
    assert.equal(viaView.role, 'viewer');

    // A viewer may read but not write; a downgrade applies on the next call.
    const refused = await host.tool(adaToken, 'Artifact', { action: 'publish', url: `open-artifact://artifact/${shared.id}`, files: { 'x.txt': 'x' } });
    assert.equal((refused.error as { code: string }).code, 'not_granted');
    await host.catalog.upsertGrant({ artifactId: shared.id, subjectKind: 'user', subject: ada.id, role: 'editor', createdBy: bo.id });
    const allowed = await host.tool(adaToken, 'Artifact', { action: 'publish', url: `open-artifact://artifact/${shared.id}`, files: { 'x.txt': 'x' } });
    assert.ok(!allowed.error, JSON.stringify(allowed));
    await host.catalog.upsertGrant({ artifactId: shared.id, subjectKind: 'user', subject: ada.id, role: 'viewer', createdBy: bo.id });
    const downgraded = await host.tool(adaToken, 'Artifact', { action: 'publish', url: `open-artifact://artifact/${shared.id}`, files: { 'x.txt': 'y' } });
    assert.equal((downgraded.error as { code: string }).code, 'not_granted');
    await host.catalog.removeGrant(shared.id, 'user', ada.id);
    const gone = await host.tool(adaToken, 'Artifact', { action: 'read', url: `open-artifact://artifact/${shared.id}` });
    assert.equal((gone.error as { code: string }).code, 'not_found');

    // Delete is the owner's alone.
    const deleteShared = await host.tool(boToken, 'Artifact', { action: 'delete', url: `open-artifact://artifact/${shared.id}` });
    assert.ok(deleteShared.deleted);
    assert.notEqual((await host.catalog.getArtifact(shared.id))?.trashedAt, null);
  });

  it("refuses a page's capabilities from anyone but its owner; the owner sets them", async () => {
    const set: Array<{ id: string; capabilities: Record<string, unknown> }> = [];
    host.services.pages = {
      capabilities: async () => ({}),
      setCapabilities: async (id, capabilities) => void set.push({ id, capabilities }),
    };
    try {
      const row = await host.artifact(ada, { 'index.html': '<!doctype html><title>Poll</title>' }, { type: 'page', title: 'Poll' });
      await host.catalog.upsertGrant({ artifactId: row.id, subjectKind: 'user', subject: bo.id, role: 'editor', createdBy: ada.id });
      const url = `open-artifact://artifact/${row.id}`;
      const editor = await host.tool(boToken, 'Artifact', { action: 'publish', url, capabilities: { db: true, identity: true } });
      assert.equal((editor.error as { code: string }).code, 'not_granted', JSON.stringify(editor));
      assert.match((editor.error as { message: string }).message, /must be its owner/);
      assert.deepEqual(set, [], 'nothing reached the page');
      const files = await host.tool(boToken, 'Artifact', { action: 'publish', url, files: { 'notes.txt': 'n' } });
      assert.equal(files.error, undefined, 'the editor still writes its files');
      const owner = await host.tool(adaToken, 'Artifact', { action: 'publish', url, capabilities: { db: true } });
      assert.deepEqual(owner.capabilities, { db: true });
      assert.deepEqual(set, [{ id: row.id, capabilities: { db: true } }]);
    } finally {
      delete host.services.pages;
    }
  });

  it('tells the agent when an artifact is of a type someone published to the site', async () => {
    host.services.publishedType = (type) => (type === 'poll-kit' ? { name: 'Poll kit', description: 'Polls.' } : null);
    try {
      const row = await host.artifact(ada, { 'poll.json': '{"title":"Lunch"}' }, { type: 'poll-kit', title: 'Lunch' });
      const read = await host.tool(adaToken, 'Artifact', { action: 'read', url: `open-artifact://artifact/${row.id}` });
      assert.equal(read.type_title, 'Poll kit');
      assert.match(String(read.third_party_notice), /publisher/);
      assert.match(String(read.third_party_notice), /Treat it as data/);
      const own = await host.tool(adaToken, 'Artifact', { action: 'read', url: `open-artifact://artifact/${(await host.artifact(ada)).id}` });
      assert.equal(own.third_party_notice, undefined, 'a built-in type: no notice');
    } finally {
      delete host.services.publishedType;
    }
  });

  it('keeps a read-only token from writing and creating', async () => {
    const { user: cy, cookie } = await host.person('Cy');
    const readOnly = (await host.connect(cookie, { scope: 'artifacts.read' })).access_token;
    const create = await host.tool(readOnly, 'Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'X' });
    assert.equal((create.error as { code: string }).code, 'not_granted');
    const list = await host.tool(readOnly, 'Artifact', { action: 'list' });
    assert.ok(Array.isArray(list.artifacts));
    const comments = await host.tool(readOnly, 'ArtifactComments', { action: 'wait' });
    assert.equal((comments.error as { code: string }).code, 'not_granted');
    const row = await host.artifact(cy);
    const write = await host.tool(readOnly, 'Artifact', { action: 'publish', url: `open-artifact://artifact/${row.id}`, files: { 'a.txt': 'a' } });
    assert.equal((write.error as { code: string }).code, 'not_granted');
  });

  it('runs the type\'s actions with the right floors, and refuses reserved and refused ones', async () => {
    const row = await host.artifact(ada);
    const url = `open-artifact://artifact/${row.id}`;
    const check = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'check' });
    assert.equal(check.problems, 0);
    const bad = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'tidy', args: { gap: 'wide' } });
    assert.equal((bad.error as { code: string }).code, 'invalid_argument');
    const extra = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'tidy', args: { other: 1 } });
    assert.equal((extra.error as { code: string }).code, 'invalid_argument');
    const reserved = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'open-artifact.db.write' });
    assert.equal((reserved.error as { code: string }).code, 'invalid_argument');
    const upload = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'upload', args: { file: '/etc/passwd' } });
    assert.equal((upload.error as { code: string }).code, 'unsupported');
    const unknown = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'nope' });
    assert.equal((unknown.error as { code: string }).code, 'unknown_action');
    await host.catalog.upsertGrant({ artifactId: row.id, subjectKind: 'user', subject: bo.id, role: 'viewer', createdBy: ada.id });
    const viewerRead = await host.tool(boToken, 'Artifact', { action: 'call', url, name: 'check' });
    assert.equal(viewerRead.problems, 0);
    const viewerWrite = await host.tool(boToken, 'Artifact', { action: 'call', url, name: 'tidy', args: {} });
    assert.equal((viewerWrite.error as { code: string }).code, 'not_granted');
  });

  it('hands out a short-lived read-only page address for snapshot, as a viewer, audited', async () => {
    const row = await host.artifact(ada);
    const url = `open-artifact://artifact/${row.id}`;
    // Listed with the type's actions, and named in the instructions.
    const read = await host.tool(adaToken, 'Artifact', { action: 'read', url });
    const listed = (read.actions as Array<{ name: string; effect: string }>).filter((a) => a.name === 'snapshot');
    assert.deepEqual(listed.map((a) => a.effect), ['read']);
    assert.match(REMOTE_NOTE, /name: "snapshot"/);
    assert.match(REMOTE_NOTE, /5 minutes/);

    const snap = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'snapshot', args: { width: 800, height: 600 } });
    assert.ok(!snap.error, JSON.stringify(snap));
    assert.equal(snap.read_only, true);
    assert.equal(snap.width, 800);
    assert.equal(snap.height, 600);
    assert.equal(snap.expires_in, 300);
    assert.equal(snap.expires_at, '2026-06-01T00:05:00.000Z');
    assert.match(String(snap.next), /browser tool/);
    assert.match(String(snap.next), /name: "check"/);
    const page = new URL(String(snap.page_url));
    assert.equal(page.origin, contentOriginOf(host.config, row.id));
    const [, type, token] = page.pathname.split('/');
    assert.equal(type, 'whiteboard');
    const claims = await verifyPageToken(token!, host.config.signingKeys);
    assert.equal(claims?.s, 1);
    assert.equal(claims?.r, 'viewer', 'the owner\'s agent too gets a viewer page');
    assert.equal(claims?.a, row.id);
    assert.equal(claims?.k, 'agent');
    assert.equal(claims!.exp - Math.floor(new Date('2026-06-01T00:00:00.000Z').getTime() / 1000), 300);
    const audit = (await host.catalog.listAudit({ artifactId: row.id })).find((a) => a.action === 'mcp.snapshot_link');
    assert.equal(audit?.actorKind, 'agent');
    assert.equal((audit?.detail as { expiresAt?: string }).expiresAt, '2026-06-01T00:05:00.000Z');
    // Defaults, and sizes out of range.
    const plain = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'snapshot' });
    assert.deepEqual([plain.width, plain.height], [1440, 900]);
    for (const args of [{ width: 100 }, { height: 5000 }, { width: 'wide' }, { tab: 'x' }]) {
      const bad = await host.tool(adaToken, 'Artifact', { action: 'call', url, name: 'snapshot', args });
      assert.equal((bad.error as { code: string }).code, 'invalid_argument', JSON.stringify(args));
    }
    // A viewer may; someone it is not shared with may not, and a token without artifacts.read may not.
    const mine = await host.artifact(bo);
    const hidden = await host.tool(adaToken, 'Artifact', { action: 'call', url: `open-artifact://artifact/${mine.id}`, name: 'snapshot' });
    assert.equal((hidden.error as { code: string }).code, 'not_found');
    await host.catalog.upsertGrant({ artifactId: mine.id, subjectKind: 'user', subject: ada.id, role: 'viewer', createdBy: bo.id });
    const shared = await host.tool(adaToken, 'Artifact', { action: 'call', url: `open-artifact://artifact/${mine.id}`, name: 'snapshot' });
    assert.ok(!shared.error, JSON.stringify(shared));
    const { user: dee, cookie } = await host.person('Dee');
    await host.catalog.upsertGrant({ artifactId: row.id, subjectKind: 'user', subject: dee.id, role: 'editor', createdBy: ada.id });
    const commentsOnly = (await host.connect(cookie, { scope: 'comments' })).access_token;
    const scoped = await host.tool(commentsOnly, 'Artifact', { action: 'call', url, name: 'snapshot' });
    assert.equal((scoped.error as { code: string }).code, 'not_granted', 'a token without artifacts.read gets no page');
  });

  it('opens as a view_url, shows a card, reports sharing read-only, and has no adopt', async () => {
    const row = await host.artifact(ada);
    const url = `open-artifact://artifact/${row.id}`;
    const open = await host.tool(adaToken, 'Artifact', { action: 'open', url, panel: 'share' });
    assert.match(String(open.view_url), new RegExp(`/a/${row.id}\\?`));
    const { body } = await host.rpc(adaToken, 'tools/call', { name: 'ShowArtifact', arguments: { url } });
    assert.equal(((body.result as { structuredContent: { view_url: string } }).structuredContent).view_url, `https://app.example/a/${row.id}`);
    const share = await host.tool(adaToken, 'Artifact', { action: 'share', url });
    assert.equal(share.your_role, 'owner');
    assert.ok(Array.isArray(share.people));
    const change = await host.tool(adaToken, 'Artifact', { action: 'share', url, links: 'on' });
    assert.equal((change.error as { code: string }).code, 'not_granted');
    const adopt = await host.tool(adaToken, 'Artifact', { action: 'adopt', root: '/tmp/x' });
    assert.equal((adopt.error as { code: string }).code, 'unsupported');
  });

  it('reads and writes data through the reserved actions, only on a db type', async () => {
    const row = await host.artifact(ada, {}, { type: 'data', title: 'Dash' });
    const url = `open-artifact://artifact/${row.id}`;
    const set = await host.tool(adaToken, 'ArtifactData', { action: 'set', url, collection: 'dash', doc_id: 'meta', data: { title: 'Dash' } });
    assert.ok(!set.error, JSON.stringify(set));
    const write = host.actions.find((a) => a.name === 'open-artifact.db.write' && a.id === row.id)!;
    assert.equal(write.args.require_if_match, true);
    const got = await host.tool(adaToken, 'ArtifactData', { action: 'get', url, path: 'dash/meta' });
    assert.deepEqual(got.data, { title: 'Dash' });
    const board = await host.artifact(ada);
    const none = await host.tool(adaToken, 'ArtifactData', { action: 'get', url: `open-artifact://artifact/${board.id}`, path: 'x' });
    assert.equal((none.error as { code: string }).code, 'unsupported');
    const outFile = await host.tool(adaToken, 'ArtifactData', { action: 'list', url, out_file: '/tmp/x.json' });
    assert.equal((outFile.error as { code: string }).code, 'unsupported');
  });

  it('reads and answers comments, refusing a duplicate reply', async () => {
    const row = await host.artifact(ada);
    const url = `open-artifact://artifact/${row.id}`;
    host.threads.set(row.id, [{ id: 'th1', agent: true, status: 'open', messages: [{ from: 'Ada', text: 'Make it blue', at: '2026-06-01T00:00:00.000Z' }] }]);
    const read = await host.tool(adaToken, 'ArtifactComments', { action: 'read', url });
    assert.equal((read.threads as unknown[]).length, 1);
    const reply = await host.tool(adaToken, 'ArtifactComments', { action: 'reply', url, thread_id: 'th1', text: 'Done.' });
    assert.equal(reply.replied, true);
    const dup = await host.tool(adaToken, 'ArtifactComments', { action: 'reply', url, thread_id: 'th1', text: 'Done.' });
    assert.equal((dup.error as { code: string }).code, 'duplicate');
    const resolved = await host.tool(adaToken, 'ArtifactComments', { action: 'resolve', url, thread_id: 'th1' });
    assert.equal(resolved.changed, true);
  });

  it('hands a wake to one MCP caller once, and never to a Link that comes after', async () => {
    const row = await host.artifact(ada, undefined, { title: 'Wakeful' });
    const url = `open-artifact://artifact/${row.id}`;
    const thread = { id: 'th9', status: 'open', messages: [{ from: 'Bo', text: 'Bigger title please', at: '2026-06-01T00:00:00.000Z' }] };
    const wake = await host.catalog.appendOutbox({ artifactId: row.id, toUser: ada.id, kind: 'wake', payload: { threads: [thread] } });
    const first = await host.tool(adaToken, 'Artifact', { action: 'read', url });
    assert.equal((first.messages as string[]).length, 1);
    assert.match((first.messages as string[])[0]!, /Bigger title please/);
    assert.match((first.messages as string[])[0]!, /ArtifactComments \{action: "reply"/);
    const second = await host.tool(adaToken, 'Artifact', { action: 'read', url });
    assert.equal(second.messages, undefined);
    // The Link's stream sends only unacknowledged rows: the taken wake is not among them.
    assert.ok(!(await host.catalog.listOutbox(ada.id)).some((r) => r.id === wake.id));

    // A wake the Link already sent is not taken by MCP.
    const linked = await host.catalog.appendOutbox({ artifactId: row.id, toUser: ada.id, kind: 'wake', payload: { threads: [thread] } });
    await host.catalog.markOutboxDelivered([linked.id]);
    const third = await host.tool(adaToken, 'Artifact', { action: 'read', url });
    assert.equal(third.messages, undefined);
    assert.equal(await new McpStore(host.catalog, () => new Date()).claimWake(linked.id, ada.id), false);
    await host.catalog.ackOutbox(ada.id, [linked.id]);
  });

  it('a Link stream and an MCP call racing for one wake: exactly one takes it, by the same atomic claim', async () => {
    const row = await host.artifact(ada, undefined, { title: 'Raced' });
    const store = new McpStore(host.catalog, () => new Date());
    for (let round = 0; round < 20; round++) {
      const wake = await host.catalog.appendOutbox({ artifactId: row.id, toUser: ada.id, kind: 'wake', payload: { requests: [{ id: `r${round}`, text: 'hi' }] } });
      // Started in both orders: whichever UPDATE runs first wins, the other's condition is then false.
      const [link, mcp] = round % 2
        ? await Promise.all([host.catalog.claimOutbox(wake.id, ada.id, 'link'), store.claimWake(wake.id, ada.id)])
        : (await Promise.all([store.claimWake(wake.id, ada.id), host.catalog.claimOutbox(wake.id, ada.id, 'link')])).reverse();
      assert.equal(Number(link) + Number(mcp), 1, `round ${round}: link ${link}, mcp ${mcp}`);
      // A Link that took it may take it again (a reconnect), until it acknowledges; MCP never can after a Link.
      if (link) {
        assert.equal(await host.catalog.claimOutbox(wake.id, ada.id, 'link'), true);
        assert.equal(await store.claimWake(wake.id, ada.id), false);
        await host.catalog.ackOutbox(ada.id, [wake.id]);
        assert.equal(await host.catalog.claimOutbox(wake.id, ada.id, 'link'), false);
      } else {
        assert.equal(await host.catalog.claimOutbox(wake.id, ada.id, 'link'), false);
      }
    }
    // Someone else's row is nobody's to take here.
    const bo = await host.catalog.appendOutbox({ artifactId: row.id, toUser: 'someone-else', kind: 'wake', payload: {} });
    assert.equal(await host.catalog.claimOutbox(bo.id, ada.id, 'link'), false);
    assert.equal(await store.claimWake(bo.id, ada.id), false);
  });

  it('waits for a wake and times out at the cap', async () => {
    const row = await host.artifact(ada, undefined, { title: 'Waiting' });
    const pending = host.tool(adaToken, 'ArtifactComments', { action: 'wait' });
    setTimeout(() => {
      void host.catalog.appendOutbox({ artifactId: row.id, toUser: ada.id, kind: 'wake', payload: { requests: [{ id: 'r1', text: 'Add a legend' }] } }).then(() => host.events.emit('outbox', { userId: ada.id }));
    }, 50);
    const woke = await pending;
    assert.match(String((woke.messages as string[])[0]), /Add a legend/);
    const quiet = await host.tool(adaToken, 'ArtifactComments', { action: 'wait' });
    assert.equal(quiet.timedOut, true);
    // Another person's wakes never reach this token.
    await host.catalog.appendOutbox({ artifactId: row.id, toUser: bo.id, kind: 'wake', payload: { requests: [{ id: 'r2', text: 'Not yours' }] } });
    const still = await host.tool(adaToken, 'ArtifactComments', { action: 'wait' });
    assert.equal(still.timedOut, true);
  });
});

test('OA_TEST_SNAPSHOT_TTL_SECONDS only shortens a snapshot address, within 1 to 300 seconds', async () => {
  const config = parseConfig({ OA_APP_ORIGIN: 'https://app.example', OA_SIGNING_KEYS: 's'.repeat(40) });
  assert.equal(parseMcpConfig({}, config).snapshotTtlSeconds, undefined);
  assert.equal(parseMcpConfig({ OA_TEST_SNAPSHOT_TTL_SECONDS: '2' }, config).snapshotTtlSeconds, 2);
  for (const bad of ['0', '301', 'soon', '1.5']) assert.throws(() => parseMcpConfig({ OA_TEST_SNAPSHOT_TTL_SECONDS: bad }, config), /OA_TEST_SNAPSHOT_TTL_SECONDS/, bad);
  const host = await makeMcpHost({ env: { OA_TEST_SNAPSHOT_TTL_SECONDS: '2' } });
  try {
    const { user, cookie } = await host.person('Ada');
    const token = (await host.connect(cookie)).access_token;
    const row = await host.artifact(user);
    const snap = await host.tool(token, 'Artifact', { action: 'call', url: `open-artifact://artifact/${row.id}`, name: 'snapshot' });
    assert.equal(snap.expires_in, 2);
    assert.equal(snap.expires_at, '2026-06-01T00:00:02.000Z');
  } finally {
    await host.close();
  }
});
