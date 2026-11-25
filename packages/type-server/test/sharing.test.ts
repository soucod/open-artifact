/**
 * LAN sharing on the type server: the share route the daemon and the Shell
 * call, the `/s/<token>` join flow, each role's limits, resets, and guests in
 * presence. Guests are simulated with an `x-test-guest` header (the server's
 * `isLocal` option); one test listens on a real second address when the
 * machine has IPv6 loopback.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createTypeServer, type TypeServer } from '../src/index.ts';
import { GUEST_ROLES, roleMay } from '../src/sharing.ts';

interface View {
  lan: boolean;
  addresses: string[];
  port: number;
  links: Record<string, { on: boolean; url: string }>;
  guests: { id: string; name: string; role: string; online: boolean; active: boolean }[];
}

describe('LAN sharing', () => {
  let dir: string;
  let root: string;
  let server: TypeServer;
  let page: string;
  let id: string;
  const secret = 'test-secret';

  /** A guest's request: not loopback (by the test header), with their cookie. */
  const guest = (cookie = '', init: RequestInit = {}): RequestInit => ({
    ...init,
    redirect: 'manual',
    headers: { 'x-test-guest': '1', ...(cookie ? { cookie } : {}), ...((init.headers as Record<string, string>) ?? {}) },
  });
  const share = async (body?: Record<string, unknown>): Promise<View> => {
    const res = await fetch(new URL(`/__open-artifact/share${body ? '' : `?id=${id}`}`, page), {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify({ id, ...body }) } : {}),
    });
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()) as View;
  };
  /** Joins through a link as `name`; returns the cookie. */
  const joinAs = async (link: string, name: string): Promise<string> => {
    const form = await fetch(link, guest());
    assert.equal(form.status, 200);
    assert.match(await form.text(), /<form method="post">/);
    const res = await fetch(link, guest('', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `name=${encodeURIComponent(name)}` }));
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get('location')!, page).href, page);
    const cookie = res.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/);
    return cookie.split(';')[0]!;
  };
  const post = (cookie: string, path: string, body: unknown): Promise<Response> =>
    fetch(new URL(path, page), guest(cookie, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const session = async (cookie: string): Promise<{ viewer: { id: string; name: string; role: string }; agent: { available: boolean } }> => {
    const res = await fetch(new URL('_api/session', page), guest(cookie));
    assert.equal(res.status, 200);
    return (await res.json()) as { viewer: { id: string; name: string; role: string }; agent: { available: boolean } };
  };
  const note = { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' };
  const comment = { input: { anchor: '{"element":"n1"}', label: 'Note', text: 'Looks good' } };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-sharing-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><html><head><title>Whiteboard</title></head><body></body></html>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    root = join(dir, 'Retro');
    server = createTypeServer({
      assetsDir: assets,
      secret,
      idleMs: 0,
      viewerName: 'Ada',
      downloadsDir: join(dir, 'downloads'),
      lanAddresses: () => [],
      isLocal: (req) => req.headers['x-test-guest'] === undefined,
    });
    await server.listen();
    const opened = await server.open({ root, type: 'whiteboard', title: 'Retro' });
    page = opened.url;
    id = opened.id;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('answers the share view the daemon and the Shell read', async () => {
    const view = await share();
    assert.equal(view.lan, false);
    assert.deepEqual(view.addresses, []);
    assert.deepEqual(Object.keys(view.links), [...GUEST_ROLES]);
    for (const role of GUEST_ROLES) {
      assert.equal(view.links[role]!.on, true);
      assert.match(view.links[role]!.url, new RegExp(`^http://127\\.0\\.0\\.1:${view.port}/s/[A-Za-z0-9_-]{16,}$`));
    }
    assert.deepEqual(view.guests, []);
    // Only the owner's computer, with the secret.
    assert.equal((await fetch(new URL(`/__open-artifact/share?id=${id}`, page))).status, 401);
    assert.equal((await fetch(new URL(`/__open-artifact/share?id=${id}`, page), guest('', { headers: { authorization: `Bearer ${secret}` } }))).status, 403);
  });

  it('lets nobody in from the network until it is shared', async () => {
    const view = await share();
    assert.equal((await fetch(view.links.viewer!.url, guest())).status, 404);
    assert.equal((await fetch(new URL('_api/session', page), guest())).status, 403);
    const html = await fetch(page, guest('', { headers: { accept: 'text/html' } }));
    assert.equal(html.status, 403);
    assert.match(await html.text(), /not shared with you/);
  });

  it('joins a guest through a link, with their own name and role', async () => {
    const view = await share({ lan: true });
    assert.equal(view.lan, true);
    assert.equal(JSON.parse(await readFile(join(root, '.sharing.json'), 'utf8')).lan, true);
    const cookie = await joinAs(view.links.viewer!.url, 'Ann');
    const me = await session(cookie);
    assert.equal(me.viewer.role, 'viewer');
    assert.equal(me.viewer.name, 'Ann');
    assert.match(me.viewer.id, /^guest-/);
    // Only the owner's page can send to the agent.
    assert.equal(me.agent.available, false);
    // Back again through the same link: straight in.
    const again = await fetch(view.links.viewer!.url, guest(cookie));
    assert.equal(again.status, 303);
    // A guest's page gets the secure-context shim first.
    const html = await (await fetch(page, guest(cookie))).text();
    assert.match(html, /<head><script>if\(window\.crypto&&!crypto\.randomUUID\)/);
    // The owner, here, stays the owner, cookie or not; their own link says so.
    const owner = (await (await fetch(new URL('_api/session', page), { headers: { cookie } })).json()) as { viewer: { role: string } };
    assert.equal(owner.viewer.role, 'owner');
    assert.match(await (await fetch(view.links.viewer!.url)).text(), /on this computer you are its owner/);
    const listed = await share();
    assert.deepEqual(
      listed.guests.map((g) => [g.name, g.role, g.active]),
      [['Ann', 'viewer', true]],
    );
  });

  it('keeps a viewer to looking', async () => {
    const view = await share();
    const cookie = await joinAs(view.links.viewer!.url, 'Vic');
    assert.equal((await fetch(new URL('_api/db/list?collection=elements', page), guest(cookie))).status, 200);
    assert.equal((await fetch(new URL('_api/comments', page), guest(cookie))).status, 200);
    for (const [path, body] of [
      ['_api/db/write', { client: 'v', writes: [{ op: 'set', path: 'elements/v1', data: note }] }],
      ['_api/comments/create', comment],
      ['_api/publish', { files: {} }],
      ['_api/agent/send', { request: { text: 'hi' } }],
    ] as const) {
      const res = await post(cookie, path, body);
      assert.equal(res.status, 403, path);
      assert.equal(((await res.json()) as { code: string }).code, 'not_writer');
    }
    const upload = await fetch(new URL('_api/assets?name=a.png', page), guest(cookie, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) }));
    assert.equal(upload.status, 403);
    // Presence is everyone's, under their own name.
    assert.equal((await post(cookie, '_api/presence', { client: 'vic-page', patch: { cursor: { x: 1, y: 2 } } })).status, 200);
    const { peers } = (await (await fetch(new URL('_api/peers', page))).json()) as { peers: { id: string; name: string }[] };
    assert.equal(peers.find((p) => p.id === 'vic-page')?.name, 'Vic');
  });

  it('lets a commenter comment, under their name, and nothing else', async () => {
    const view = await share();
    const cookie = await joinAs(view.links.commenter!.url, 'Cam');
    const created = await post(cookie, '_api/comments/create', comment);
    assert.equal(created.status, 200);
    const { thread } = (await created.json()) as { thread: { id: string; messages: { author: { name: string } }[] } };
    assert.equal(thread.messages[0]!.author.name, 'Cam');
    assert.equal((await post(cookie, '_api/comments/reply', { threadId: thread.id, text: 'More' })).status, 200);
    assert.equal((await post(cookie, '_api/comments/send', { threadId: thread.id })).status, 403);
    assert.equal((await post(cookie, '_api/comments/remove', { threadId: thread.id })).status, 403);
    assert.equal((await post(cookie, '_api/db/write', { client: 'c', writes: [{ op: 'set', path: 'elements/c1', data: note }] })).status, 403);
  });

  it('lets an editor edit, but not reach the agent or this computer', async () => {
    const view = await share();
    const cookie = await joinAs(view.links.editor!.url, 'Eve');
    assert.equal((await post(cookie, '_api/db/write', { client: 'e', writes: [{ op: 'set', path: 'elements/e1', data: note }] })).status, 200);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'db', 'elements', 'e1.json'), 'utf8')), note);
    assert.equal((await post(cookie, '_api/comments/create', comment)).status, 200);
    assert.equal((await post(cookie, '_api/agent/send', { request: { text: 'hi' } })).status, 403);
    const download = await fetch(new URL('_api/downloads?name=x.txt', page), guest(cookie, { method: 'POST', body: 'x' }));
    assert.equal(download.status, 403);
    // A guest cannot speak for someone else's page.
    assert.equal((await post(cookie, '_api/presence', { client: 'vic-page', patch: { cursor: null } })).status, 403);
  });

  it('holds guests while their link is off, and drops them when it is reset', async () => {
    const view = await share();
    const cookie = await joinAs(view.links.commenter!.url, 'Hal');
    let next = await share({ links: { commenter: false } });
    assert.equal(next.links.commenter!.on, false);
    assert.equal((await fetch(new URL('_api/session', page), guest(cookie))).status, 403);
    assert.equal((await fetch(view.links.commenter!.url, guest())).status, 404);
    next = await share({ links: { commenter: true } });
    assert.equal((await session(cookie)).viewer.name, 'Hal');

    next = await share({ reset: ['commenter'] });
    assert.notEqual(next.links.commenter!.url, view.links.commenter!.url);
    assert.equal((await fetch(new URL('_api/session', page), guest(cookie))).status, 403);
    assert.equal((await fetch(view.links.commenter!.url, guest())).status, 404);
    assert.ok(!next.guests.some((g) => g.name === 'Hal' || g.name === 'Cam'));
    // The new link works.
    const fresh = await joinAs(next.links.commenter!.url, 'Ivy');
    assert.equal((await session(fresh)).viewer.role, 'commenter');
  });

  it("changes a guest's role and removes guests", async () => {
    const view = await share();
    const cookie = await joinAs(view.links.viewer!.url, 'Joe');
    const listed = (await share()).guests.find((g) => g.name === 'Joe')!;
    await share({ guests: { [listed.id]: 'editor' } });
    assert.equal((await session(cookie)).viewer.role, 'editor');
    await share({ guests: { [listed.id]: null } });
    assert.equal((await fetch(new URL('_api/session', page), guest(cookie))).status, 403);
  });

  it('shuts guests out when it stops sharing, and shares again on the next open', async () => {
    const view = await share();
    const cookie = await joinAs(view.links.editor!.url, 'Kim');
    assert.equal((await share({ lan: false })).lan, false);
    assert.equal(JSON.parse(await readFile(join(root, '.sharing.json'), 'utf8')).lan, false);
    assert.equal((await fetch(new URL('_api/session', page), guest(cookie))).status, 403);

    await share({ lan: true });
    assert.equal((await session(cookie)).viewer.name, 'Kim');
    // Closed and opened again (a restart): `.sharing.json` brings it back on the network.
    server.close(id);
    page = (await server.open({ root, type: 'whiteboard' })).url;
    assert.equal((await share()).lan, true);
    assert.equal((await session(cookie)).viewer.name, 'Kim');
  });

  it("zips the artifact's folder for the owner only (the Export tab's last row)", async () => {
    await writeFile(join(root, 'notes.txt'), 'hello zip');
    const auth = { authorization: `Bearer ${secret}` };
    const at = new URL(`/__open-artifact/archive?id=${id}`, page);
    const head = await fetch(at, { method: 'HEAD', headers: auth });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'application/zip');
    assert.match(head.headers.get('content-disposition') ?? '', /^attachment; filename="Retro-[\d-]+\.zip"; filename\*=UTF-8''Retro-[\d-]+\.zip$/);
    assert.equal(head.headers.get('cache-control'), 'no-store');
    const res = await fetch(at, { headers: auth });
    assert.equal(res.status, 200);
    const zip = Buffer.from(await res.arrayBuffer());
    assert.equal(zip.subarray(0, 2).toString(), 'PK');
    assert.ok(zip.includes(Buffer.from('notes.txt')));
    assert.equal((await fetch(at)).status, 401);
    assert.equal((await fetch(at, guest('', { headers: auth }))).status, 403);
    assert.equal((await fetch(new URL('/__open-artifact/archive?id=nope', page), { headers: auth })).status, 404);
    assert.equal((await fetch(at, { method: 'POST', headers: auth })).status, 405);
  });

  it('knows what each role may write', () => {
    assert.equal(roleMay('owner', '_api/agent/send'), true);
    assert.equal(roleMay('editor', '_api/publish'), true);
    assert.equal(roleMay('editor', '_api/agent/send'), false);
    assert.equal(roleMay('commenter', '_api/comments/create'), true);
    assert.equal(roleMay('commenter', '_api/publish'), false);
    assert.equal(roleMay('viewer', '_api/presence'), true);
    assert.equal(roleMay('viewer', '_api/comments/reply'), false);
    assert.equal(roleMay('editor', '_api/something-new'), false);
    // A commenter reaches the store's write route only on a type with documents of their own (it checks each path).
    assert.equal(roleMay('commenter', '_api/db/write'), false);
    assert.equal(roleMay('commenter', '_api/db/write', { commenterWrites: true }), true);
    assert.equal(roleMay('viewer', '_api/db/write', { commenterWrites: true }), false);
    assert.equal(roleMay('commenter', '_api/publish', { commenterWrites: true }), false);
    assert.equal(roleMay('editor', '_api/db/write', { commenterWrites: true }), true);
  });
});

describe('LAN sharing on a real second address', () => {
  it('listens on the LAN address and lets a guest in there only', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'open-artifact-sharing-lan-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'slides'), { recursive: true });
    await writeFile(join(assets, 'editors', 'slides', 'index.html'), '<!doctype html><html><head><title>Slides</title></head></html>');
    await writeFile(join(assets, 'support.js'), '');
    // `::1` stands in for a LAN address: a different address, the same port.
    const server = createTypeServer({ assetsDir: assets, secret: 's', idleMs: 0, lanAddresses: () => ['::1'], isLocal: (req) => req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::ffff:127.0.0.1' });
    try {
      await server.listen();
      const opened = await server.open({ root: join(dir, 'Deck'), type: 'slides' });
      const call = async (body: Record<string, unknown>): Promise<View> =>
        (await (
          await fetch(new URL('/__open-artifact/share', opened.url), {
            method: 'POST',
            headers: { authorization: 'Bearer s', 'content-type': 'application/json' },
            body: JSON.stringify({ id: opened.id, ...body }),
          })
        ).json()) as View;
      const view = await call({ lan: true });
      if (!view.addresses.includes('::1')) return t.skip('no IPv6 loopback to listen on');
      const link = view.links.commenter!.url;
      assert.equal(link, `http://[::1]:${view.port}${new URL(link).pathname}`);
      const joined = await fetch(link, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Lee' });
      assert.equal(joined.status, 303);
      const cookie = joined.headers.get('set-cookie')!.split(';')[0]!;
      const pageThere = new URL(joined.headers.get('location')!, link);
      const me = (await (await fetch(new URL('_api/session', pageThere), { headers: { cookie } })).json()) as { viewer: { role: string; name: string } };
      assert.deepEqual([me.viewer.role, me.viewer.name], ['commenter', 'Lee']);
      // The daemon's routes stay on this computer.
      assert.equal((await fetch(`http://[::1]:${view.port}/__open-artifact/health`, { headers: { authorization: 'Bearer s' } })).status, 403);
      // Off: the listener closes.
      await call({ lan: false });
      await assert.rejects(fetch(new URL('_api/session', pageThere), { headers: { cookie } }));
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
