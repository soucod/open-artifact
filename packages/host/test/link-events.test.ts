import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINK_API_PREFIX } from '@open-artifact/protocol';
import { queueDataRefresh } from '../src/core/link/outbox.ts';
import { b64, EventReader, makeLinkHost, until, type LinkHost } from './link-fixture.ts';

const open = async (host: LinkHost, token: string, after?: string): Promise<{ reader: EventReader; abort: AbortController }> => {
  const abort = new AbortController();
  const response = await host.fetch(`${LINK_API_PREFIX}events${after ? `?after=${after}` : ''}`, { token, signal: abort.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  return { reader: new EventReader(response), abort };
};

const wake = async (host: LinkHost, artifactId: string, toUser: string, text: string): Promise<number> => {
  const row = await host.catalog.appendOutbox({ artifactId, toUser, kind: 'wake', payload: { threads: [{ id: text, text }] } });
  host.events.emit('outbox', { userId: toUser });
  return row.id;
};

test('events: replay, live wakes, redelivery until ack, after=, two streams', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const { user: bob } = await host.person('Bob');
  const token = await host.token(ada);
  const art = await host.artifact(ada);
  const first = await wake(host, art.id, ada.id, 'one');
  const second = await wake(host, art.id, ada.id, 'two');
  await wake(host, art.id, bob.id, 'not for Ada');

  const a = await open(host, token.access);
  let event = await a.reader.next();
  assert.deepEqual(event, { id: String(first), type: 'wake', artifact: art.id, threads: [{ id: 'one', text: 'one' }] });
  event = await a.reader.next();
  assert.equal(event.id, String(second));
  await a.reader.none();
  assert.ok((await host.catalog.listOutbox(ada.id)).every((row) => row.deliveredAt !== null));

  // A second computer: both hear a new wake.
  const b = await open(host, token.access, String(second));
  await b.reader.none();
  const third = await wake(host, art.id, ada.id, 'three');
  assert.equal((await a.reader.next()).id, String(third));
  assert.equal((await b.reader.next()).id, String(third));

  // Not acknowledged: sent again on the next connection.
  await a.reader.cancel();
  a.abort.abort();
  const c = await open(host, token.access);
  assert.deepEqual([(await c.reader.next()).id, (await c.reader.next()).id, (await c.reader.next()).id], [String(first), String(second), String(third)]);
  await c.reader.cancel();

  // Acknowledged: never again.
  const ack = await host.call('ack', token.access, { ids: [String(first), String(second)] });
  assert.equal(ack.status, 200);
  const d = await open(host, token.access);
  assert.equal((await d.reader.next()).id, String(third));
  await d.reader.none();
  // Another user's ids are left alone.
  const bobRow = (await host.catalog.listOutbox(bob.id))[0]!;
  await host.call('ack', token.access, { ids: [String(bobRow.id)] });
  assert.equal((await host.catalog.listOutbox(bob.id)).length, 1);
  assert.equal((await host.call('ack', token.access, { ids: ['x'] })).status, 400);

  await d.reader.cancel();
  await b.reader.cancel();
});

test('events: a person\'s edit is sent, the Link\'s own push is not; renames and trash', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const art = await host.artifact(ada);
  const { reader } = await open(host, token.access);

  // The Link pushes a file: no event comes back.
  const pushed = await host.call('files', token.access, { id: art.id, writes: [{ path: 'db/elements/n1.json', content: b64('{}') }] });
  assert.equal(pushed.status, 200);
  await reader.none();

  // A person edits through a page: a files event.
  host.events.emit('artifact-touched', { id: art.id, author: 'Bob', paths: ['db/elements/n9.json'] });
  let event = await reader.next();
  assert.equal(event.type, 'files');
  assert.deepEqual(event, { id: event.id, type: 'files', artifact: art.id, author: 'Bob', paths: ['db/elements/n9.json'] });

  // A rename and a trash from the Library.
  await host.catalog.touchArtifact(art.id, { title: 'New name' });
  host.events.emit('artifact-changed', { id: art.id });
  event = await reader.next();
  assert.deepEqual(event, { id: event.id, type: 'artifact', artifact: art.id, title: 'New name' });
  await host.catalog.trashArtifact(art.id);
  host.events.emit('artifact-changed', { id: art.id });
  event = await reader.next();
  assert.deepEqual(event, { id: event.id, type: 'artifact', artifact: art.id, removed: true });

  // The Link's own unpublish is not echoed either.
  const other = await host.artifact(ada);
  await host.call('unpublish', token.access, { id: other.id });
  await reader.none();
  await reader.cancel();
});

test('events: a page\'s capabilities changed on the site reach the Link in an artifact event', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const art = await host.artifact(ada, undefined, { type: 'page' });
  const { reader } = await open(host, token.access);
  host.events.emit('artifact-changed', { id: art.id, author: 'mcp', capabilities: { db: true } });
  const event = await reader.next();
  assert.equal(event.type, 'artifact');
  assert.deepEqual((event as { capabilities?: unknown }).capabilities, { db: true });
  await reader.cancel();
});

test('events: no outbox rows for a user who never linked', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const art = await host.artifact(ada);
  host.events.emit('artifact-touched', { id: art.id, author: 'Bob', paths: ['a.json'] });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await host.catalog.listOutbox(ada.id)).length, 0);
});

test('events: presence is online while any stream is open', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  assert.equal(host.presence.online(ada.id), false);
  const a = await open(host, token.access);
  await a.reader.none(30);
  assert.equal(host.presence.online(ada.id), true);
  const b = await open(host, token.access);
  await a.reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(host.presence.online(ada.id), true);
  b.abort.abort();
  await b.reader.cancel();
  await until(() => !host.presence.online(ada.id));
});

test('events: a wake an MCP call took is not sent; one the stream took is no longer the MCP call\'s', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const art = await host.artifact(ada);
  const taken = await wake(host, art.id, ada.id, 'taken by MCP');
  // What an MCP call does when it hands this wake to its agent (McpStore.claimWake).
  assert.equal(await host.catalog.claimOutbox(taken, ada.id, 'mcp'), true);
  const kept = await wake(host, art.id, ada.id, 'for the Link');

  const a = await open(host, token.access);
  assert.equal((await a.reader.next()).id, String(kept));
  await a.reader.none();
  // The stream claimed the one it sent: an MCP call now finds it gone.
  assert.equal(await host.catalog.claimOutbox(kept, ada.id, 'mcp'), false);
  // A person's edit is not a wake: it is sent without a claim, as before.
  host.events.emit('artifact-touched', { id: art.id, author: 'Bob', paths: ['a.json'] });
  assert.equal((await a.reader.next()).type, 'files');
  await a.reader.cancel();
});

test('events: a page asks for a data refresh; only the owner, or an editor the owner lets ask', async (t) => {
  const host = await makeLinkHost();
  t.after(() => host.close());
  const { user: ada } = await host.person('Ada');
  const token = await host.token(ada);
  const dash = await host.artifact(ada, { 'db/dash/meta.json': '{"title":"Sales"}' }, { type: 'data', title: 'Sales' });
  const board = await host.artifact(ada);
  const { reader } = await open(host, token.access);

  const owner = await queueDataRefresh(host.catalog, dash.id, { name: 'Ada', role: 'owner' }, ['sales', 'bad id!']);
  assert.equal(owner, ada.id);
  host.events.emit('outbox', { userId: owner });
  const event = await reader.next();
  assert.deepEqual({ ...event, id: undefined }, { id: undefined, type: 'data-refresh', artifact: dash.id, queries: ['sales'] });

  await assert.rejects(queueDataRefresh(host.catalog, dash.id, { name: 'Bob', role: 'viewer' }), { status: 403 });
  await assert.rejects(queueDataRefresh(host.catalog, dash.id, { name: 'Bob', role: 'commenter' }), { status: 403 });
  await assert.rejects(queueDataRefresh(host.catalog, dash.id, { name: 'Bob', role: 'editor' }), { status: 403 });
  await assert.rejects(queueDataRefresh(host.catalog, board.id, { name: 'Ada', role: 'owner' }), { code: 'invalid_argument' });
  await host.catalog.setArtifactSettings(dash.id, { editorsCanAskAgent: true });
  await queueDataRefresh(host.catalog, dash.id, { name: 'Bob', role: 'editor' });
  host.events.emit('outbox', { userId: ada.id });
  const asked = await reader.next();
  assert.equal(asked.type, 'data-refresh');
  assert.deepEqual(asked.from, { name: 'Bob', role: 'editor' });
  assert.equal(asked.queries, undefined);
  await reader.cancel();
});
