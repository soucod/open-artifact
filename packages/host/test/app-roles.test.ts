/**
 * The app origin by role: what each principal may call on one artifact (owner, editor, commenter, viewer, a link
 * guest, an anonymous visitor of a public artifact, a stranger), and the Shell and home boots each one gets.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ArtifactView, HomeBoot, ShellBoot } from '@open-artifact/protocol';
import { guestCookie } from '../src/core/auth/session.ts';
import type { ArtifactRow, UserRecord } from '../src/core/types.ts';
import { bootOf, makeApp, type TestApp } from './app-fixture.ts';

describe('app roles', () => {
  let app: TestApp;
  let ada: { user: UserRecord; cookie: string };
  let eve: { user: UserRecord; cookie: string };
  let cam: { user: UserRecord; cookie: string };
  let vic: { user: UserRecord; cookie: string };
  let sam: { user: UserRecord; cookie: string };
  let guestCookieHeader: string;
  let agentBearer: string;
  /** Ada's board: link access, Eve edits, Cam comments (by email), Vic views, a commenter-link guest. */
  let board: ArtifactRow;
  /** Ada's public board. */
  let open: ArtifactRow;
  /** Ada's restricted board. */
  let shut: ArtifactRow;

  before(async () => {
    app = await makeApp();
    ada = await app.person('Ada');
    eve = await app.person('Eve');
    cam = await app.person('Cam');
    vic = await app.person('Vic');
    sam = await app.person('Sam');
    board = await app.artifact(ada.user, { title: 'Retro', generalAccess: 'link' });
    open = await app.artifact(ada.user, { title: 'Open', generalAccess: 'public' });
    shut = await app.artifact(ada.user, { title: 'Shut' });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: eve.user.id, role: 'editor', createdBy: ada.user.id });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'email', subject: 'cam@example.com', role: 'commenter', createdBy: ada.user.id });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: vic.user.id, role: 'viewer', createdBy: ada.user.id });
    const { link } = await app.catalog.createLink(board.id, 'commenter');
    const { secret } = await app.catalog.joinGuest(link.id, 'Gus');
    guestCookieHeader = `${guestCookie(app.config, board.id).name}=${secret}`;
    agentBearer = (await app.catalog.issueAgentToken({ userId: ada.user.id, label: "Ada's Claude", scopes: [], accessTtlMs: 3600_000 })).accessToken;
  });
  after(() => app.close());

  const status = async (path: string, as: string | undefined, body?: unknown): Promise<number> => (await app.fetch(path, { ...(as ? { cookie: as } : {}), ...(body === undefined ? {} : { body }) })).status;

  it('reads: everyone with a role may; a stranger gets 404 and an anonymous visitor 401, the same as for no artifact', async () => {
    for (const as of [ada.cookie, eve.cookie, cam.cookie, vic.cookie, guestCookieHeader]) {
      assert.equal(await status(`/api/open-artifact.artifact?id=${board.id}`, as), 200);
      assert.equal(await status(`/api/open-artifact.artifact.share?id=${board.id}`, as), 200);
      assert.equal(await status(`/api/open-artifact.artifacts.boot?id=${board.id}`, as), 200);
    }
    assert.equal(await status(`/api/open-artifact.artifact?id=${board.id}`, sam.cookie), 404);
    assert.equal(await status(`/api/open-artifact.artifact?id=art_0nosuchthing00`, sam.cookie), 404);
    assert.equal(await status(`/api/open-artifact.artifact?id=${board.id}`, undefined), 401);
    assert.equal(await status(`/api/open-artifact.artifact?id=${open.id}`, undefined), 200);
    assert.equal(await status(`/api/open-artifact.artifact?id=${open.id}`, sam.cookie), 200);
    assert.equal(await status(`/api/open-artifact.artifact?id=${shut.id}`, eve.cookie), 404);
    // The guest cookie of one artifact opens nothing else.
    assert.equal(await status(`/api/open-artifact.artifact?id=${shut.id}`, guestCookieHeader), 401);
  });

  it('each role sees its own role in the detail and the boot', async () => {
    const expected: Array<[string, string]> = [
      [ada.cookie, 'owner'],
      [eve.cookie, 'editor'],
      [cam.cookie, 'commenter'],
      [vic.cookie, 'viewer'],
      [guestCookieHeader, 'commenter'],
    ];
    for (const [as, role] of expected) {
      const view = (await (await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: as })).json()) as ArtifactView & { bytes: number };
      assert.equal(view.role, role);
      assert.equal(view.bytes, 0);
      const boot = (await (await app.fetch(`/api/open-artifact.artifacts.boot?id=${board.id}`, { cookie: as })).json()) as ShellBoot;
      assert.equal(boot.cloud?.role, role);
    }
    const anon = (await (await app.fetch(`/api/open-artifact.artifact?id=${open.id}`)).json()) as ArtifactView;
    assert.equal(anon.role, 'viewer');
  });

  it('rename: owner and editors only', async () => {
    const rename = (as: string, title: string): Promise<number> => status('/api/open-artifact.artifacts.update', as, { id: board.id, title });
    assert.equal(await rename(ada.cookie, 'Retro 2'), 200);
    assert.equal(await rename(eve.cookie, 'Retro 3'), 200);
    for (const as of [cam.cookie, vic.cookie, guestCookieHeader]) assert.equal(await rename(as, 'Mine now'), 403);
    assert.equal(await rename(sam.cookie, 'Mine now'), 404);
    assert.equal((await app.catalog.getArtifact(board.id))?.title, 'Retro 3');
    assert.equal(await rename(ada.cookie, '   '), 400);
    assert.equal(await status('/api/open-artifact.artifacts.update', ada.cookie, { id: board.id, title: 7 }), 400);
    assert.equal(await status('/api/open-artifact.artifacts.update', ada.cookie, { title: 'no id' }), 400);
    assert.ok(app.heard['artifact-changed'].some((e) => e.id === board.id));
  });

  it('pins are per person: any signed-in role may pin, a guest may not, and nobody sees another person\'s pin', async () => {
    const pin = (as: string, pinned: unknown): Promise<Response> => app.fetch('/api/open-artifact.artifacts.update', { cookie: as, body: { id: board.id, pinned } });
    assert.equal((await pin(vic.cookie, true)).status, 200);
    assert.equal(((await (await pin(cam.cookie, false)).json()) as ArtifactView).pinned, false);
    assert.equal((await pin(guestCookieHeader, true)).status, 403);
    assert.equal((await pin(vic.cookie, 'yes')).status, 400);
    const listOf = async (as: string): Promise<ArtifactView[]> => ((await (await app.fetch('/api/open-artifact.artifacts', { cookie: as })).json()) as { artifacts: ArtifactView[] }).artifacts;
    assert.equal((await listOf(vic.cookie)).find((a) => a.id === board.id)?.pinned, true);
    assert.equal((await listOf(ada.cookie)).find((a) => a.id === board.id)?.pinned, false);
    assert.equal((await listOf(eve.cookie)).find((a) => a.id === board.id)?.pinned, false);
    assert.equal((await pin(vic.cookie, false)).status, 200);
    assert.equal((await listOf(vic.cookie)).find((a) => a.id === board.id)?.pinned, false);
  });

  it('lists each person\'s artifacts with their role; a guest or anonymous visitor has no list', async () => {
    const listOf = async (as: string): Promise<Map<string, string | undefined>> =>
      new Map(((await (await app.fetch('/api/open-artifact.artifacts', { cookie: as })).json()) as { artifacts: ArtifactView[] }).artifacts.map((a) => [a.id, a.role]));
    assert.deepEqual(await listOf(ada.cookie), new Map([[board.id, 'owner'], [open.id, 'owner'], [shut.id, 'owner']]));
    assert.deepEqual(await listOf(eve.cookie), new Map([[board.id, 'editor']]));
    assert.deepEqual(await listOf(cam.cookie), new Map([[board.id, 'commenter']]));
    assert.deepEqual(await listOf(sam.cookie), new Map());
    assert.equal(await status('/api/open-artifact.artifacts', guestCookieHeader), 401);
    assert.equal(await status('/api/open-artifact.artifacts', undefined), 401);
  });

  it('download: everyone but a viewer, and a viewer when the owner allows it (the default)', async () => {
    assert.equal(await status(`/api/open-artifact.artifact.archive?id=${board.id}`, vic.cookie), 200);
    await app.catalog.setArtifactSettings(board.id, { viewersCanExport: false });
    await app.catalog.setArtifactSettings(open.id, { viewersCanExport: false });
    app.ctx.access.invalidate();
    for (const as of [ada.cookie, eve.cookie, cam.cookie, guestCookieHeader]) assert.equal(await status(`/api/open-artifact.artifact.archive?id=${board.id}`, as), 200);
    assert.equal(await status(`/api/open-artifact.artifact.archive?id=${board.id}`, vic.cookie), 403);
    assert.equal(await status(`/api/open-artifact.artifact.archive?id=${open.id}`, undefined), 403);
    await app.catalog.setArtifactSettings(board.id, { viewersCanExport: true });
    app.ctx.access.invalidate(board.id);
    const zip = await app.fetch(`/api/open-artifact.artifact.archive?id=${board.id}`, { cookie: vic.cookie });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.equal(await zip.text(), 'PK-fake');
    const head = await app.fetch(`/api/open-artifact.artifact.archive?id=${board.id}`, { cookie: vic.cookie, method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    await app.catalog.setArtifactSettings(board.id, { viewersCanExport: false });
    app.ctx.access.invalidate(board.id);
  });

  it('ask: the owner, an editor when allowed; it lands in the owner\'s outbox', async () => {
    const ask = (as: string, text = 'Tidy it'): Promise<number> => status('/api/open-artifact.artifacts.ask', as, { id: board.id, text });
    assert.equal(await ask(ada.cookie), 200);
    assert.equal(await ask(eve.cookie), 403);
    for (const as of [cam.cookie, vic.cookie, guestCookieHeader]) assert.equal(await ask(as), 403);
    await app.catalog.setArtifactSettings(board.id, { editorsCanAskAgent: true });
    app.ctx.access.invalidate(board.id);
    assert.equal(await ask(eve.cookie, 'Please add a column'), 200);
    assert.equal(await ask(ada.cookie, '  '), 400);
    const outbox = await app.catalog.listOutbox(ada.user.id);
    assert.equal(outbox.length, 2);
    const last = outbox.at(-1)!.payload as { requests: Array<{ text: string }>; from: { name: string; role: string } };
    assert.equal(last.requests[0]!.text, 'Please add a column');
    assert.deepEqual(last.from, { name: 'Eve', role: 'editor' });
    assert.ok(app.heard.outbox.some((e) => e.userId === ada.user.id));
    await app.catalog.setArtifactSettings(board.id, { editorsCanAskAgent: false });
    app.ctx.access.invalidate(board.id);
  });

  it("says what becomes of a request: the owner's computer online or away, else a recent MCP client, else none", async () => {
    const agentOf = async (id: string, as: string): Promise<{ boot: unknown; detail: unknown }> => {
      const boot = (await (await app.fetch(`/api/open-artifact.artifacts.boot?id=${id}`, { cookie: as })).json()) as ShellBoot;
      const detail = (await (await app.fetch(`/api/open-artifact.artifact?id=${id}`, { cookie: as })).json()) as ArtifactView;
      return { boot: boot.cloud?.agent, detail: detail.agent };
    };
    const asked = async (): Promise<unknown> => (await app.fetch('/api/open-artifact.artifacts.ask', { cookie: ada.cookie, body: { id: board.id, text: 'Tidy it' } })).json();
    // Ada linked a computer (her agent token), not connected now: it gets a request when it is back.
    const away = { state: 'offline', name: "Ada's Claude" };
    assert.deepEqual(await agentOf(board.id, ada.cookie), { boot: away, detail: away });
    assert.deepEqual(await agentOf(board.id, eve.cookie), { boot: away, detail: away }, 'an editor reads the owner\'s agent');
    assert.deepEqual(await asked(), { via: 'link', status: 'inbox' });
    app.setLinkOnline(ada.user.id, true);
    const here = { state: 'online', name: "Ada's Claude" };
    assert.deepEqual(await agentOf(board.id, ada.cookie), { boot: here, detail: here });
    assert.deepEqual(await asked(), { via: 'link', status: 'delivered' });
    app.setLinkOnline(ada.user.id, false);
    assert.deepEqual(await asked(), { via: 'link', status: 'inbox' });
    // Sam: nothing linked, then an MCP client used just now.
    const solo = await app.artifact(sam.user, { title: 'Solo' });
    const none = { state: 'none', name: 'Agent' };
    assert.deepEqual(await agentOf(solo.id, sam.cookie), { boot: none, detail: none });
    const mcp = await app.catalog.issueAgentToken({ userId: sam.user.id, label: 'ChatGPT', harness: 'mcp', scopes: [], accessTtlMs: 3600_000 });
    assert.deepEqual(await agentOf(solo.id, sam.cookie), { boot: none, detail: none }, 'an MCP client never used is not there');
    await app.catalog.markAgentTokenUsed(mcp.token.id);
    const recent = { state: 'mcp', name: 'ChatGPT' };
    assert.deepEqual(await agentOf(solo.id, sam.cookie), { boot: recent, detail: recent });
    // The list does not ask (one presence lookup per artifact would grow with the list).
    const listed = ((await (await app.fetch('/api/open-artifact.artifacts', { cookie: sam.cookie })).json()) as { artifacts: ArtifactView[] }).artifacts;
    assert.ok(listed.every((a) => a.agent === undefined));
  });

  it('sharing changes: only the owner signed in as a person (not their agent, not an editor)', async () => {
    const change = { id: board.id, settings: { viewersCanExport: false } };
    assert.equal(await status('/api/open-artifact.artifact.share', ada.cookie, change), 200);
    for (const as of [eve.cookie, cam.cookie, vic.cookie, guestCookieHeader]) assert.equal(await status('/api/open-artifact.artifact.share', as, change), 403);
    // An agent token is not a browser's credential: refused before any role is looked at (see app-bearer.test.ts).
    const agent = await app.fetch('/api/open-artifact.artifact.share', { body: change, origin: null, headers: { authorization: `Bearer ${agentBearer}` } });
    assert.equal(agent.status, 401);
    const read = await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { headers: { authorization: `Bearer ${agentBearer}` } });
    assert.equal(read.status, 401);
    const bad = await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { headers: { authorization: 'Bearer nope' }, cookie: ada.cookie });
    assert.equal(bad.status, 401);
  });

  it('trash and restore: the owner only; a trashed artifact is gone for everyone else', async () => {
    const victim = await app.artifact(ada.user, { title: 'Victim', generalAccess: 'link' });
    await app.catalog.upsertGrant({ artifactId: victim.id, subjectKind: 'user', subject: eve.user.id, role: 'editor', createdBy: ada.user.id });
    assert.equal(await status('/api/open-artifact.artifacts.delete', eve.cookie, { id: victim.id }), 403);
    const done = await app.fetch('/api/open-artifact.artifacts.delete', { cookie: ada.cookie, body: { id: victim.id } });
    assert.deepEqual(await done.json(), { deleted: victim.id, folderKept: '' });
    assert.ok(app.refreshed.includes(victim.id));
    assert.ok(app.heard['access-changed'].some((e) => e.id === victim.id));
    assert.equal(await status(`/api/open-artifact.artifact?id=${victim.id}`, eve.cookie), 404);
    assert.equal(await status(`/api/open-artifact.artifact?id=${victim.id}`, ada.cookie), 404);
    const trash = ((await (await app.fetch('/api/open-artifact.artifacts?trashed=1', { cookie: ada.cookie })).json()) as { artifacts: ArtifactView[] }).artifacts;
    const trashedView = trash.find((a) => a.id === victim.id);
    assert.ok(trashedView);
    // The trash list says when each one went (the page counts the days left from it).
    assert.equal(typeof trashedView.trashedAt, 'string');
    assert.equal(trashedView.trashedAt, (await app.catalog.getArtifact(victim.id))?.trashedAt);
    assert.ok(!((await (await app.fetch('/api/open-artifact.artifacts', { cookie: ada.cookie })).json()) as { artifacts: ArtifactView[] }).artifacts.some((a) => a.id === victim.id));
    assert.ok(!((await (await app.fetch('/api/open-artifact.artifacts', { cookie: ada.cookie })).json()) as { artifacts: ArtifactView[] }).artifacts.some((a) => 'trashedAt' in a));
    assert.equal(await status('/api/open-artifact.artifacts.restore', eve.cookie, { id: victim.id }), 404);
    assert.equal(await status('/api/open-artifact.artifacts.restore', ada.cookie, { id: victim.id }), 200);
    assert.equal(await status(`/api/open-artifact.artifact?id=${victim.id}`, eve.cookie), 200);
  });

  describe('boots', () => {
    const shell = async (id: string, as?: string): Promise<{ response: Response; boot: ShellBoot }> => {
      const response = await app.fetch(`/a/${id}`, as ? { cookie: as } : {});
      assert.equal(response.status, 200);
      return { response, boot: bootOf(await response.text()) as ShellBoot };
    };

    it('owner: the full boot with the account, the role, the settings and a page on the content origin', async () => {
      const { response, boot } = await shell(board.id, ada.cookie);
      assert.equal(boot.id, board.id);
      assert.equal(boot.url, `${app.config.appOrigin}/a/${board.id}`);
      assert.equal(boot.pageKind, 'server');
      assert.equal(boot.problem, null);
      assert.equal(boot.typeTitle, 'Whiteboard');
      assert.equal(boot.agentName, "Ada's Claude");
      assert.equal(boot.userName, 'Ada');
      assert.equal(boot.typeServer, undefined);
      assert.ok(boot.page?.startsWith(`http://${board.id.replace('_', '-')}.content.localhost:4900/whiteboard/`), boot.page ?? '');
      assert.ok(boot.page?.endsWith(`?open_artifact_shell=${encodeURIComponent(app.config.appOrigin)}`));
      assert.deepEqual(boot.cloud, {
        user: { id: ada.user.id, name: 'Ada', email: 'ada@example.com' },
        appOrigin: app.config.appOrigin,
        signInUrl: `${app.config.appOrigin}/auth/sign-in?return_to=%2Fa%2F${board.id}`,
        signOutUrl: `${app.config.appOrigin}/auth/sign-out`,
        role: 'owner',
        settings: { viewersCanExport: false, editorsCanAskAgent: false },
        // Ada's agent token stands for a computer she linked, not connected in this test.
        agent: { state: 'offline', name: "Ada's Claude" },
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });

    it('editor, commenter, viewer: their own role and user', async () => {
      for (const [who, role] of [[eve, 'editor'], [cam, 'commenter'], [vic, 'viewer']] as const) {
        const { boot } = await shell(board.id, who.cookie);
        assert.equal(boot.cloud?.role, role);
        assert.equal(boot.cloud?.user?.id, who.user.id);
        assert.ok(boot.page?.includes(`.user.${role}/`), boot.page ?? '');
      }
    });

    it('link guest: their link role, no user', async () => {
      const { boot } = await shell(board.id, guestCookieHeader);
      assert.equal(boot.cloud?.role, 'commenter');
      assert.equal(boot.cloud?.user, null);
      assert.ok(boot.page?.includes('.guest.commenter/'));
    });

    it('anonymous on a public artifact: viewer, no user', async () => {
      const { boot } = await shell(open.id);
      assert.equal(boot.cloud?.role, 'viewer');
      assert.equal(boot.cloud?.user, null);
      assert.ok(boot.page?.includes('.anonymous.viewer/'));
    });

    it('no access: anonymous goes to sign-in; a stranger gets the same 403 page for a real and a made-up id', async () => {
      const anon = await app.fetch(`/a/${shut.id}`);
      assert.equal(anon.status, 303);
      assert.equal(anon.headers.get('location'), `/auth/sign-in?return_to=%2Fa%2F${shut.id}`);
      const real = await app.fetch(`/a/${shut.id}`, { cookie: sam.cookie });
      const fake = await app.fetch('/a/art_0nosuchthing00', { cookie: sam.cookie });
      assert.equal(real.status, 403);
      assert.equal(fake.status, 403);
      const text = await real.text();
      assert.ok(text.includes('Switch account'));
      assert.ok(text.includes('sam@example.com'));
      assert.ok(!text.includes('Ada'), 'the owner is not named');
      assert.ok(!text.includes('Shut'), 'the title is not shown');
      assert.equal((await fake.text()).replace(/art_0nosuchthing00/g, shut.id), text);
      const zh = await app.fetch(`/a/${shut.id}`, { cookie: sam.cookie, headers: { 'accept-language': 'zh-CN' } });
      assert.ok((await zh.text()).includes('切换账号'));
      // A path that is not an artifact id at all.
      assert.equal((await app.fetch('/a/..%2Fetc', { cookie: sam.cookie })).status, 403);
    });

    it('a missing type still boots, with the problem said', async () => {
      const odd = await app.artifact(ada.user, { type: 'sheets', title: 'Sheet' });
      const { boot } = await shell(odd.id, ada.cookie);
      assert.equal(boot.problem, 'The sheets type is not installed on this host.');
      const view = (await (await app.fetch(`/api/open-artifact.artifact?id=${odd.id}`, { cookie: ada.cookie })).json()) as ArtifactView;
      assert.equal(view.typeMissing, true);
    });

    it('home: the account part only; anonymous and guests go to sign-in', async () => {
      const home = await app.fetch('/', { cookie: eve.cookie });
      assert.equal(home.status, 200);
      const boot = bootOf(await home.text(), '__OPEN_ARTIFACT_HOME__') as HomeBoot;
      // The platform's own numbers (the Node host's, the Worker's) are checked by each platform's tests.
      const { trashDays, limits, ...account } = boot.cloud ?? {};
      assert.deepEqual(account, {
        user: { id: eve.user.id, name: 'Eve', email: 'eve@example.com' },
        appOrigin: app.config.appOrigin,
        signInUrl: `${app.config.appOrigin}/auth/sign-in?return_to=%2F`,
        signOutUrl: `${app.config.appOrigin}/auth/sign-out`,
      });
      assert.ok(trashDays === undefined || Number.isInteger(trashDays));
      assert.ok(limits && limits.importBytes > 0);
      for (const as of [undefined, guestCookieHeader]) {
        const out = await app.fetch('/', as ? { cookie: as } : {});
        assert.equal(out.status, 303);
        assert.equal(out.headers.get('location'), '/auth/sign-in?return_to=%2F');
      }
    });
  });
});
