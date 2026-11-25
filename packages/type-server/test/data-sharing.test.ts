/**
 * A Data dashboard shared on the LAN: a commenter writes their own folder,
 * `data/users/<their id>/…` (saved rows, reports), and nothing else in the
 * store; a viewer writes nothing; an editor writes as before. Guests are
 * simulated with an `x-test-guest` header, as in the sharing tests.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createTypeServer, type TypeServer } from '../src/index.ts';

describe('Data sharing: what each guest may write', () => {
  let dir: string;
  let server: TypeServer;
  let page: string;
  let id: string;
  const secret = 'test-secret';
  let links: Record<string, { url: string }>;

  const guest = (cookie = '', init: RequestInit = {}): RequestInit => ({
    ...init,
    redirect: 'manual',
    headers: { 'x-test-guest': '1', ...(cookie ? { cookie } : {}), ...((init.headers as Record<string, string>) ?? {}) },
  });
  const joinAs = async (link: string, name: string): Promise<{ cookie: string; id: string }> => {
    const res = await fetch(link, guest('', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `name=${encodeURIComponent(name)}` }));
    assert.equal(res.status, 303);
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    const me = (await (await fetch(new URL('_api/session', page), guest(cookie))).json()) as { viewer: { id: string } };
    return { cookie, id: me.viewer.id };
  };
  const write = (cookie: string, ...paths: string[]): Promise<Response> =>
    fetch(
      new URL('_api/db/write', page),
      guest(cookie, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: 'guest-page', writes: paths.map((path) => ({ op: 'set', path, data: { title: 'Mine' } })) }),
      }),
    );
  const read = async (path: string): Promise<unknown> => {
    const res = await fetch(new URL(`_api/db/get?path=${encodeURIComponent(path)}`, page));
    return ((await res.json()) as { data?: unknown }).data ?? null;
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-data-sharing-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'data'), { recursive: true });
    await writeFile(join(assets, 'editors', 'data', 'index.html'), '<!doctype html><html><head><title>Data</title></head><body></body></html>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    server = createTypeServer({ assetsDir: assets, secret, idleMs: 0, viewerName: 'Ada', lanAddresses: () => [], isLocal: (req) => req.headers['x-test-guest'] === undefined });
    await server.listen();
    const opened = await server.open({ root: join(dir, 'Sales'), type: 'data', title: 'Sales' });
    page = opened.url;
    id = opened.id;
    const res = await fetch(new URL('/__open-artifact/share', page), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, lan: true }),
    });
    links = ((await res.json()) as { links: Record<string, { url: string }> }).links;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('lets a commenter write their own folder, and only that', async () => {
    const cam = await joinAs(links.commenter!.url, 'Cam');
    const other = await joinAs(links.commenter!.url, 'Cora');
    assert.match(cam.id, /^guest-/);
    const own = `data/users/${cam.id}/q3`;
    const first = await write(cam.cookie, own);
    assert.equal(first.status, 200, await first.clone().text());
    assert.deepEqual(await read(own), { title: 'Mine' });
    assert.equal((await write(cam.cookie, `data/users/${cam.id}/runs`, `data/users/${cam.id}/notes/items/1`)).status, 200);
    // Someone else's folder, the shared data, the page itself: refused, with nothing written.
    for (const path of [`data/users/${other.id}/q3`, 'datasets/x', 'dash/meta', 'files/index.html']) {
      const res = await write(cam.cookie, path);
      assert.equal(res.status, 403, path);
      assert.equal(((await res.json()) as { code?: string }).code, 'not_writer');
      assert.notDeepEqual(await read(path), { title: 'Mine' }, path);
    }
    // A batch that isn't a list is refused too, with nothing written.
    const bare = await fetch(
      new URL('_api/db/write', page),
      guest(cam.cookie, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: 'c', writes: { op: 'set', path: 'datasets/x', data: {} } }) }),
    );
    assert.notEqual(bare.status, 200);
    assert.equal(await read('datasets/x'), null);
    // A batch with one write outside their folder is refused whole.
    assert.equal((await write(cam.cookie, `data/users/${cam.id}/q4`, 'datasets/y')).status, 403);
    assert.equal(await read(`data/users/${cam.id}/q4`), null);
  });

  it('keeps a viewer read-only, their own folder too', async () => {
    const vic = await joinAs(links.viewer!.url, 'Vic');
    assert.equal((await write(vic.cookie, `data/users/${vic.id}/q3`)).status, 403);
    assert.equal(await read(`data/users/${vic.id}/q3`), null);
    assert.equal((await fetch(new URL('_api/db/list?collection=datasets', page), guest(vic.cookie))).status, 200);
  });

  it('leaves an editor writing what they wrote before', async () => {
    const eve = await joinAs(links.editor!.url, 'Eve');
    assert.equal((await write(eve.cookie, 'datasets/sales')).status, 200);
    assert.deepEqual(await read('datasets/sales'), { title: 'Mine' });
  });
});
