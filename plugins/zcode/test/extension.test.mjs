/**
 * The ZCode extension (extension/index.mjs) against a fake ZCode context and the kit's fake daemon: it connects only
 * once the session list arrives, attaches the listed sessions, hands page messages to `sessions.sendToSession`, asks
 * for the grant when it is missing, and attaches again after the daemon comes back.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { startFakeDaemon } from '@open-artifact/harness-kit/testing';
import { createExtension } from '../extension/index.mjs';

/** A ZCode extension context that records what the extension does. */
function fakeZcode({ grant = true, send = () => ({ admission: 'accepted', delivery: 'started' }) } = {}) {
  const logs = { info: [], warn: [], error: [] };
  const sent = [];
  const list = { onList: null, onError: null, watched: 0, disposed: 0 };
  let grants = 0;
  const ctx = {
    log: { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) },
    grants: {
      request: async () => {
        grants++;
        return { granted: grant };
      },
    },
    sessions: {
      onDidChangeList(onList, onError) {
        list.onList = onList;
        list.onError = onError;
        list.watched++;
        return { dispose: () => list.disposed++ };
      },
      async sendToSession(params) {
        sent.push(params);
        return send(params);
      },
    },
  };
  return { ctx, logs, sent, list, grants: () => grants };
}

const row = (id, status = 'idle') => ({ session: { sessionId: id, workspacePath: `/work/${id}` }, title: `Chat ${id}`, status });

async function until(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((done) => setTimeout(done, 10));
  }
}

const stops = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

/** A fake daemon and an extension pointed at its home. */
async function setUp(zcode = {}) {
  const fake = await startFakeDaemon();
  const extension = createExtension({ home: fake.home, reconnect: { minMs: 20, maxMs: 50 } });
  const z = fakeZcode(zcode);
  stops.push(() => fake.close(), () => extension.deactivate());
  extension.activate(z.ctx);
  return { fake, extension, ...z };
}

const attaches = (fake) => fake.calls.filter((c) => c.method === 'session.attach').map((c) => c.params);

describe('zcode extension', () => {
  it('connects only once the session list arrives, with wake caps, and attaches the listed sessions', async () => {
    const { fake, list } = await setUp();
    await new Promise((done) => setTimeout(done, 50));
    assert.equal(fake.hellos.length, 0);
    list.onList({ kind: 'snapshot', sessions: [row('s1'), row('s2', 'running')] });
    await until(() => attaches(fake).length === 2);
    assert.equal(fake.hellos[0].harness, 'zcode');
    assert.deepEqual(fake.hellos[0].caps, { wake: {} });
    assert.deepEqual(attaches(fake), [
      { session: 's1', workspace: '/work/s1', title: 'Chat s1', status: 'idle' },
      { session: 's2', workspace: '/work/s2', title: 'Chat s2', status: 'running' },
    ]);
  });

  it("hands a page message to the session as its prompt, and says when the session refused it", async () => {
    let admission = 'accepted';
    const { fake, list, sent } = await setUp({ send: () => ({ admission, delivery: 'started' }) });
    list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => attaches(fake).length === 1);
    assert.deepEqual(await fake.wake({ session: 's1', text: '[Open Artifact]\nBigger, please' }), { status: 'delivered' });
    assert.deepEqual(sent, [{ sessionId: 's1', prompt: '[Open Artifact]\nBigger, please' }]);
    admission = 'rejected';
    assert.deepEqual(await fake.wake({ session: 's1', text: 'again' }), { status: 'failed' });
  });

  it('detaches a session that is gone', async () => {
    const { fake, list } = await setUp({
      send: () => {
        throw Object.assign(new Error('gone'), { code: 'forbidden' });
      },
    });
    list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => attaches(fake).length === 1);
    assert.deepEqual(await fake.wake({ session: 's1', text: 'hi' }), { status: 'failed' });
    await until(() => fake.calls.some((c) => c.method === 'session.detach'));
  });

  it('asks for the grant once when a delivery is not granted, and delivers when it is', async () => {
    let tries = 0;
    const { fake, list, grants } = await setUp({
      send: () => {
        if (tries++ === 0) throw Object.assign(new Error('no'), { code: 'not-granted' });
        return { admission: 'accepted' };
      },
    });
    list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => attaches(fake).length === 1);
    assert.deepEqual(await fake.wake({ session: 's1', text: 'hi' }), { status: 'delivered' });
    assert.equal(grants(), 1);
  });

  it('drops the connection for the activation when the grant is refused', async () => {
    const { fake, list, logs } = await setUp({
      grant: false,
      send: () => {
        throw Object.assign(new Error('no'), { code: 'not-granted' });
      },
    });
    list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => attaches(fake).length === 1);
    // The refusal closes the connection before the answer can go: the daemon keeps the message, as for a failure.
    await assert.rejects(fake.wake({ session: 's1', text: 'hi' }), /went away/);
    await until(() => !fake.connected);
    assert.ok(logs.warn.some((m) => /does not stand/.test(m)));
    // It stays down: no reconnect for this activation.
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(fake.hellos.length, 1);
  });

  it("delivers what waited in a session's inbox when it attaches, and logs what it could not with its text", async () => {
    let admission = 'accepted';
    const fake = await startFakeDaemon();
    const extension = createExtension({ home: fake.home, reconnect: { minMs: 20, maxMs: 50 } });
    const z = fakeZcode({ send: () => ({ admission }) });
    stops.push(() => fake.close(), () => extension.deactivate());
    fake.queueInbox('s1', { text: 'Waited', artifactId: 'a1', source: { kind: 'open-artifact.event', artifactId: 'a1', url: 'open-artifact://artifact/a1', title: 'Deck', root: '', viewUrl: '', threads: [], requests: [], summary: 'Waited' } });
    fake.queueInbox('s2', { text: 'Lost', artifactId: 'a2', source: { kind: 'open-artifact.event', artifactId: 'a2', url: 'open-artifact://artifact/a2', title: 'Deck', root: '', viewUrl: '', threads: [], requests: [], summary: 'Lost' } });
    extension.activate(z.ctx);
    z.list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => z.sent.length === 1);
    assert.deepEqual(z.sent[0], { sessionId: 's1', prompt: 'Waited' });
    admission = 'rejected';
    z.list.onList({ kind: 'delta', removed: [], upserted: [row('s2')] });
    await until(() => z.logs.error.length === 1);
    assert.match(z.logs.error[0], /s2's inbox was not delivered \(a2\): Lost/);
  });

  it('follows the list: a status change is passed on, a removed session is detached', async () => {
    const { fake, list } = await setUp();
    list.onList({ kind: 'snapshot', sessions: [row('s1'), row('s2')] });
    await until(() => attaches(fake).length === 2);
    list.onList({ kind: 'delta', removed: [{ sessionId: 's2' }], upserted: [row('s1', 'running')] });
    const status = await fake.waitFor('session.status');
    assert.deepEqual(status.params, { session: 's1', status: 'running' });
    const detach = await fake.waitFor('session.detach');
    assert.deepEqual(detach.params, { session: 's2' });
    // A snapshot without a session detaches it too.
    list.onList({ kind: 'snapshot', sessions: [] });
    assert.deepEqual((await fake.waitFor('session.detach')).params, { session: 's1' });
  });

  it('attaches every session again after the daemon comes back', async () => {
    const { fake, list, logs } = await setUp();
    list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => attaches(fake).length === 1);
    fake.drop();
    await until(() => attaches(fake).length === 2);
    assert.equal(fake.calls.filter((c) => c.method === 'session.attach').at(-1).connection, 2);
    await until(() => logs.warn.some((m) => /lost the daemon/.test(m)));
  });

  it('offers the grant when the list cannot start without it, and starts the list over once granted', async () => {
    const { list, grants } = await setUp();
    list.onError({ code: 'not-granted' });
    await until(() => list.watched === 2);
    assert.equal(grants(), 1);
  });

  it('closes on deactivate, and a new activation connects once', async () => {
    const { fake, extension, list } = await setUp();
    list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => fake.connected);
    extension.deactivate();
    assert.equal(list.disposed, 1);
    await until(() => !fake.connected);
    const again = fakeZcode();
    extension.activate(again.ctx);
    again.list.onList({ kind: 'snapshot', sessions: [row('s1')] });
    await until(() => fake.hellos.length === 2 && fake.connected);
    await new Promise((done) => setTimeout(done, 50));
    assert.equal(fake.hellos.length, 2);
  });
});
