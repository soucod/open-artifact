/**
 * An artifact a newer type release wrote (the daemon's `read_only`, `release-guard.ts`): the type server asks the
 * daemon at each open and serves every page of it as a share-link viewer's, so the page cannot write, whatever the
 * storage model: project files (`_api/publish`), the db store (`_api/db/write`) and structured ops (a doc's
 * `_api/doc/call`). Without a daemon, or once the daemon says otherwise, the owner writes as before.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createTypeServer, type TypeApiLike, type TypeServer } from '../src/index.ts';

describe('read-only artifacts (a newer type release wrote them)', () => {
  let dir: string;
  let server: TypeServer;
  let readOnly = true;
  const asked: string[] = [];
  const daemon = {
    artifact: async (id: string) => {
      asked.push(id);
      return { read_only: readOnly };
    },
    wake: async () => ({ status: 'queued', via: 'inbox' }),
    presence: async () => ({ presence: 'none', canSend: false, canSendSession: false, busy: false, agentName: 'Agent' }),
    touch: async () => ({}),
  } as unknown as TypeApiLike;

  const post = (page: string, route: string, body: unknown): Promise<Response> =>
    fetch(new URL(route, page), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const role = async (page: string): Promise<string> => ((await (await fetch(new URL('_api/session', page))).json()) as { viewer: { role: string } }).viewer.role;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-read-only-'));
    const assets = join(dir, 'assets');
    for (const type of ['design', 'whiteboard', 'docs']) {
      await mkdir(join(assets, 'editors', type), { recursive: true });
      await writeFile(join(assets, 'editors', type, 'index.html'), `<!doctype html><title>${type}</title>`);
    }
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell/index.html'), '<script>window.boot = /*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    server = createTypeServer({ assetsDir: assets, secret: 'test-secret', idleMs: 0, downloadsDir: join(dir, 'downloads'), daemon });
    await server.listen();
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('project files: the owner is a viewer, the Shell boot says so, and a publish is refused', async () => {
    readOnly = true;
    const opened = await server.open({ id: 'art_readonlyfiles', root: join(dir, 'Design'), type: 'design', title: 'Design' });
    assert.ok(asked.includes('art_readonlyfiles'));
    assert.equal(await role(opened.url), 'viewer');
    assert.match(await (await fetch(opened.url)).text(), /"typeServer":\{"role":"viewer"/);
    const refused = await post(opened.url, '_api/publish', { client: 'a', files: { 'project/A.dc.html': { content: '<x-dc></x-dc>', ifMatch: null } } });
    assert.equal(refused.status, 403, await refused.text());

    // Updated (the daemon says writable now): the next open writes again.
    readOnly = false;
    await server.open({ id: 'art_readonlyfiles', root: join(dir, 'Design'), type: 'design', title: 'Design' });
    assert.equal(await role(opened.url), 'owner');
    const ok = await post(opened.url, '_api/publish', { client: 'a', files: { 'project/A.dc.html': { content: '<x-dc></x-dc>', ifMatch: null } } });
    assert.equal(ok.status, 200, await ok.text());
  });

  it('the db store: a write is refused', async () => {
    readOnly = true;
    const opened = await server.open({ id: 'art_readonlydb', root: join(dir, 'Board'), type: 'whiteboard', title: 'Board' });
    assert.equal(await role(opened.url), 'viewer');
    const refused = await post(opened.url, '_api/db/write', { client: 'c1', writes: [{ op: 'set', path: 'elements/n1', data: { type: 'note', text: 'Hi' } }] });
    assert.equal(refused.status, 403, await refused.text());
  });

  it('structured ops: a doc session is not writable and a call is denied', async () => {
    readOnly = true;
    const opened = await server.open({ id: 'art_readonlydoc', root: join(dir, 'Plan'), type: 'docs', title: 'Plan' });
    const session = (await (await post(opened.url, '_api/doc/session', { client: 'page-a' })).json()) as { writable: boolean; sess: string | null; project: { files: Array<{ content: { id: string } }> } };
    assert.equal(session.writable, false);
    assert.equal(session.sess, null);
    const member = { verb: 'update', ref: { object: 'node', id: session.project.files[0]!.content.id }, payload: { ops: [] } };
    const answer = await post(opened.url, '_api/doc/call', { client: 'page-a', sess: 'x', opId: 'op-1', member });
    const body = (await answer.json()) as { verdict?: string; code?: string };
    assert.notEqual(body.verdict, 'allow', JSON.stringify(body));
  });

  it('without a daemon nothing changes', async () => {
    const plain = createTypeServer({ assetsDir: join(dir, 'assets'), secret: 'test-secret', idleMs: 0, downloadsDir: join(dir, 'downloads2') });
    await plain.listen();
    try {
      const opened = await plain.open({ root: join(dir, 'Plain'), type: 'design', title: 'Plain' });
      assert.equal(await role(opened.url), 'owner');
    } finally {
      await plain.stop();
    }
  });
});
