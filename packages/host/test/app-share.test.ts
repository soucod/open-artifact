/**
 * Sharing on the app origin: the Share panel's view per role, every kind of change and its validation (a change is
 * checked whole before any of it applies), and role links at `/s/<token>` for guests and signed-in people
 * (decisions 16, 18, 20).
 */

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { ArtifactView, ShareView } from '@open-artifact/protocol';
import { cleanGuestName } from '../src/core/app/share.ts';
import { guestCookie } from '../src/core/auth/session.ts';
import type { ArtifactRow, UserRecord } from '../src/core/types.ts';
import { cookiesSet, makeApp, type TestApp } from './app-fixture.ts';

type Person = { user: UserRecord; cookie: string };

const SHARE = '/api/open-artifact.artifact.share';

describe('share view and changes', () => {
  let app: TestApp;
  let ada: Person, eve: Person, vic: Person;
  let board: ArtifactRow;

  beforeEach(async () => {
    app = await makeApp();
    ada = await app.person('Ada');
    eve = await app.person('Eve');
    vic = await app.person('Vic');
    board = await app.artifact(ada.user, { title: 'Retro' });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: eve.user.id, role: 'editor', createdBy: ada.user.id });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: vic.user.id, role: 'viewer', createdBy: ada.user.id });
  });
  afterEach(() => app.close());

  const view = async (as: string): Promise<ShareView> => {
    const response = await app.fetch(`${SHARE}?id=${board.id}`, { cookie: as });
    assert.equal(response.status, 200);
    return (await response.json()) as ShareView;
  };
  const change = (as: string, body: Record<string, unknown>): Promise<Response> => app.fetch(SHARE, { cookie: as, body: { id: board.id, ...body } });

  it("the owner's first look makes the three links, on (the access level is the switch), with their addresses", async () => {
    const v = await view(ada.cookie);
    assert.equal(v.lan, false);
    assert.deepEqual(Object.keys(v.links).sort(), ['commenter', 'editor', 'viewer']);
    for (const link of Object.values(v.links)) {
      assert.equal(link?.on, true);
      assert.match(link?.url ?? '', new RegExp(`^${app.config.appOrigin}/s/[A-Za-z0-9_-]{16,64}$`));
    }
    assert.equal(v.cloud?.canManage, true);
    assert.equal(v.cloud?.access, 'restricted');
    assert.deepEqual(v.cloud?.owner, { id: ada.user.id, name: 'Ada', email: 'ada@example.com' });
    assert.deepEqual(
      v.cloud?.members.map((m) => [m.id, m.role, m.email]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
      [
        [`user:${eve.user.id}`, 'editor', 'eve@example.com'],
        [`user:${vic.user.id}`, 'viewer', 'vic@example.com'],
      ],
    );
    // A second look finds them, not new ones.
    assert.deepEqual((await view(ada.cookie)).links, v.links);
  });

  it('others see only working links up to their own role, and no member emails', async () => {
    await view(ada.cookie);
    assert.equal((await change(ada.cookie, { links: { commenter: false } })).status, 200);
    // Restricted: links do not work, so nobody else sees an address.
    let e = await view(eve.cookie);
    assert.equal(e.cloud?.canManage, false);
    assert.equal(e.links.editor?.on, true);
    assert.equal(e.links.editor?.url, undefined);
    assert.ok(e.cloud?.members.every((m) => m.email === undefined));
    assert.equal((await change(ada.cookie, { access: 'link' })).status, 200);
    e = await view(eve.cookie);
    assert.ok(e.links.editor?.url);
    assert.ok(e.links.viewer?.url);
    assert.equal(e.links.commenter?.url, undefined, 'an off link has no address');
    const v = await view(vic.cookie);
    assert.equal(v.links.editor?.url, undefined, 'a viewer cannot hand out editing');
    assert.ok(v.links.viewer?.url);
  });

  it('access: restricted, link, public; public only where the host allows it', async () => {
    for (const access of ['link', 'public', 'restricted'] as const) {
      const response = await change(ada.cookie, { access });
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as ShareView).cloud?.access, access);
    }
    assert.equal((await change(ada.cookie, { access: 'everyone' })).status, 400);
    const strict = await makeApp({ env: { OA_PUBLIC_ACCESS: 'false' } });
    try {
      const owner = await strict.person('Ann');
      const art = await strict.artifact(owner.user);
      const refused = await strict.fetch(SHARE, { cookie: owner.cookie, body: { id: art.id, access: 'public' } });
      assert.equal(refused.status, 403);
      assert.equal((await strict.catalog.getArtifact(art.id))?.generalAccess, 'restricted');
    } finally {
      await strict.close();
    }
  });

  it('members: a verified address becomes the person, others stay pending; domains, groups, removal', async () => {
    const sam = await app.catalog.createUser({ name: 'Sam', email: 'sam@example.com', emailVerified: true });
    await app.catalog.createUser({ name: 'Unverified', email: 'u@example.com', emailVerified: false });
    const response = await change(ada.cookie, {
      members: {
        'email:Sam@Example.com': 'commenter',
        'email:u@example.com': 'viewer',
        'email:new@example.org': 'editor',
        'domain:@Example.org': 'viewer',
        'group:github:acme/devs': 'commenter',
        [`user:${vic.user.id}`]: null,
      },
    });
    assert.equal(response.status, 200);
    const members = ((await response.json()) as ShareView).cloud!.members;
    const byId = new Map(members.map((m) => [m.id, m]));
    assert.equal(byId.get(`user:${sam.id}`)?.role, 'commenter');
    assert.equal(byId.get('email:u@example.com')?.pending, true);
    assert.equal(byId.get('email:new@example.org')?.role, 'editor');
    assert.equal(byId.get('domain:example.org')?.label, '@example.org');
    assert.equal(byId.get('group:github:acme/devs')?.label, 'acme/devs');
    assert.equal(byId.has(`user:${vic.user.id}`), false);
    assert.ok(app.refreshed.includes(board.id));
    assert.ok(app.heard['access-changed'].some((e) => e.id === board.id));
    const audit = await app.catalog.listAudit({ artifactId: board.id });
    assert.ok(audit.some((a) => a.action === 'share.change' && a.actorId === ada.user.id));
    // Vic lost access at once (the change bumped the grants version).
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: vic.cookie })).status, 404);
  });

  it('refuses a bad change whole: nothing of it applies', async () => {
    const bad: Array<[Record<string, unknown>, number]> = [
      [{ lan: true }, 400],
      [{ lan: 'yes' }, 400],
      [{ members: { 'email:not-an-address': 'viewer' } }, 400],
      [{ members: { 'phone:123': 'viewer' } }, 400],
      [{ members: { [`user:${ada.user.id}`]: 'viewer' } }, 400],
      [{ members: { 'email:ada@example.com': 'viewer' } }, 400],
      [{ members: { 'user:usr_nobody': 'viewer' } }, 400],
      [{ members: { 'email:x@example.com': 'owner' } }, 400],
      [{ members: { 'group:nogroup': 'viewer' } }, 400],
      [{ members: 'eve' }, 400],
      [{ members: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`email:p${i}@example.com`, 'viewer'])) }, 400],
      [{ settings: { viewersCanExport: 'no' } }, 400],
      [{ settings: { somethingElse: true } }, 400],
      [{ links: { owner: true } }, 400],
      [{ links: { editor: 'on' } }, 400],
      [{ reset: 'owner' }, 400],
      [{ guests: { gst_nobody: null } }, 404],
      [{ guests: [] }, 400],
    ];
    for (const [body, code] of bad) {
      const response = await change(ada.cookie, { access: 'link', ...body });
      assert.equal(response.status, code, JSON.stringify(body));
      assert.equal((await app.catalog.getArtifact(board.id))?.generalAccess, 'restricted', `applied part of ${JSON.stringify(body)}`);
    }
    assert.equal((await app.fetch(SHARE, { cookie: ada.cookie, body: ['not', 'an', 'object'] })).status, 400);
    assert.equal((await app.fetch(SHARE, { cookie: ada.cookie, body: '{', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal(app.refreshed.length, 0);
  });

  it('settings, links, reset and guests, and the link cap of the host', async () => {
    let response = await change(ada.cookie, { settings: { viewersCanExport: false, editorsCanAskAgent: true } });
    assert.deepEqual(((await response.json()) as ShareView).cloud?.settings, { viewersCanExport: false, editorsCanAskAgent: true });
    response = await change(ada.cookie, { access: 'link', links: { commenter: true } });
    const before = (await response.json()) as ShareView;
    assert.equal(before.links.commenter?.on, true);
    const { link } = { link: (await app.catalog.listLinks(board.id)).find((l) => l.role === 'commenter')! };
    const { guest } = await app.catalog.joinGuest(link.id, 'Gus');
    response = await change(ada.cookie, { reset: ['commenter'] });
    const afterReset = (await response.json()) as ShareView;
    assert.notEqual(afterReset.links.commenter?.url, before.links.commenter?.url);
    assert.equal(afterReset.guests?.length, 0, 'a reset removes the guests of the link');
    assert.equal(await app.catalog.getGuest(guest.id), undefined);

    const { guest: gia } = await app.catalog.joinGuest(link.id, 'Gia');
    assert.equal((await change(ada.cookie, { links: { editor: false } })).status, 200);
    assert.equal((await change(ada.cookie, { guests: { [gia.id]: 'editor' } })).status, 409, 'the editor link is off');
    response = await change(ada.cookie, { links: { editor: true }, guests: { [gia.id]: 'editor' } });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as ShareView).guests?.find((g) => g.id === gia.id)?.role, 'editor');
    app.online.set(board.id, [{ kind: 'guest', id: gia.id }]);
    assert.equal((await view(ada.cookie)).guests?.find((g) => g.id === gia.id)?.online, true);
    response = await change(ada.cookie, { guests: { [gia.id]: null } });
    assert.equal(((await response.json()) as ShareView).guests?.length, 0);

    const capped = await makeApp({ env: { OA_LINK_MAX_ROLE: 'commenter' } });
    try {
      const owner = await capped.person('Ann');
      const art = await capped.artifact(owner.user);
      const v = (await (await capped.fetch(`${SHARE}?id=${art.id}`, { cookie: owner.cookie })).json()) as ShareView;
      assert.deepEqual(Object.keys(v.links).sort(), ['commenter', 'viewer']);
      assert.equal((await capped.fetch(SHARE, { cookie: owner.cookie, body: { id: art.id, links: { editor: true } } })).status, 403);
      assert.equal((await capped.fetch(SHARE, { cookie: owner.cookie, body: { id: art.id, links: { editor: false } } })).status, 200);
    } finally {
      await capped.close();
    }
  });

  it('an empty change answers the view without bumping anything', async () => {
    const response = await change(ada.cookie, {});
    assert.equal(response.status, 200);
    assert.equal(app.refreshed.length, 0);
  });
});

describe('share links', () => {
  let app: TestApp;
  let ada: Person, eve: Person, sam: Person;
  let board: ArtifactRow;
  let tokens: Record<'editor' | 'commenter' | 'viewer', string>;

  before(async () => {
    app = await makeApp();
    ada = await app.person('Ada');
    eve = await app.person('Eve');
    sam = await app.person('Sam');
  });
  after(() => app.close());

  beforeEach(async () => {
    board = await app.artifact(ada.user, { title: 'Retro', generalAccess: 'link' });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: eve.user.id, role: 'editor', createdBy: ada.user.id });
    tokens = {} as typeof tokens;
    for (const role of ['editor', 'commenter', 'viewer'] as const) tokens[role] = (await app.catalog.createLink(board.id, role, { enabled: role !== 'editor' })).token;
  });

  const join = async (token: string, name: string, origin?: string | null): Promise<Response> =>
    app.fetch(`/s/${token}`, { body: new URLSearchParams({ name }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, ...(origin === undefined ? {} : { origin }) });

  it('a guest: the name form, then a cookie for this artifact only and the Shell as a commenter', async () => {
    const form = await app.fetch(`/s/${tokens.commenter}`);
    assert.equal(form.status, 200);
    const html = await form.text();
    assert.ok(html.includes('comment on'));
    assert.ok(html.includes('Retro'));
    assert.ok(html.includes('/auth/sign-in?return_to='));
    assert.equal(form.headers.get('x-frame-options'), 'DENY');

    const joined = await join(tokens.commenter, '  <b>Gus</b>\n the guest ');
    assert.equal(joined.status, 303);
    assert.equal(joined.headers.get('location'), `/a/${board.id}`);
    const name = guestCookie(app.config, board.id).name;
    const secret = cookiesSet(joined)[name];
    assert.ok(secret);
    const line = joined.headers.getSetCookie()[0]!;
    assert.match(line, /HttpOnly/);
    assert.match(line, /SameSite=Lax/);
    assert.match(line, /Path=\//);
    const cookie = `${name}=${secret}`;
    const guests = await app.catalog.listGuests(board.id);
    assert.equal(guests.length, 1);
    assert.equal(guests[0]!.name, 'bGus/b the guest');
    assert.equal((await (await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie })).json() as ArtifactView).role, 'commenter');
    // Back through the link: straight in.
    const again = await app.fetch(`/s/${tokens.commenter}`, { cookie });
    assert.equal(again.status, 303);
    // Through another link: the form (a different role is a different join).
    assert.equal((await app.fetch(`/s/${tokens.viewer}`, { cookie })).status, 200);
    const other = await app.artifact(ada.user, { generalAccess: 'link' });
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${other.id}`, { cookie })).status, 401);
  });

  it('a signed-in person joins without a form or cookie, once, and the artifact is in their list', async () => {
    const response = await app.fetch(`/s/${tokens.commenter}`, { cookie: sam.cookie });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/a/${board.id}`);
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.equal((await app.fetch(`/s/${tokens.commenter}`, { cookie: sam.cookie })).status, 303);
    assert.equal((await app.catalog.listUserGuests(sam.user.id, board.id)).length, 1);
    const list = ((await (await app.fetch('/api/open-artifact.artifacts', { cookie: sam.cookie })).json()) as { artifacts: ArtifactView[] }).artifacts;
    assert.equal(list.find((a) => a.id === board.id)?.role, 'commenter');
    assert.ok(app.heard['access-changed'].some((e) => e.id === board.id));
    // The share panel shows them as a guest with their user ref.
    app.online.set(board.id, [{ kind: 'user', id: sam.user.id }]);
    const v = (await (await app.fetch(`${SHARE}?id=${board.id}`, { cookie: ada.cookie })).json()) as ShareView;
    assert.equal(v.guests?.find((g) => g.name === 'Sam')?.online, true);
    // A higher link raises them; a POST from a signed-in person also joins as them, not as a cookie guest.
    await app.catalog.setLinkEnabled((await app.catalog.listLinks(board.id)).find((l) => l.role === 'editor')!.id, true);
    const up = await join(tokens.editor, 'ignored');
    assert.equal(up.status, 303);
  });

  it('someone who already has the role gets no guest row', async () => {
    assert.equal((await app.fetch(`/s/${tokens.commenter}`, { cookie: eve.cookie })).status, 303);
    assert.equal((await app.catalog.listUserGuests(eve.user.id, board.id)).length, 0);
    assert.equal((await app.fetch(`/s/${tokens.commenter}`, { cookie: ada.cookie })).status, 303);
    assert.equal((await app.catalog.listGuests(board.id)).length, 0);
  });

  it('dead links: off, made up, malformed, over the host maximum, restricted, trashed — all the same page', async () => {
    const dead = async (path: string, as?: string): Promise<void> => {
      const response = await app.fetch(path, as ? { cookie: as } : {});
      assert.equal(response.status, 404, path);
      assert.ok((await response.text()).includes('This link does not work'));
    };
    await dead(`/s/${tokens.editor}`);
    await dead(`/s/${tokens.editor}`, sam.cookie);
    await dead('/s/AAAAAAAAAAAAAAAAAAAAAAAA');
    await dead('/s/short');
    await dead('/s/%3Cscript%3E');
    assert.equal((await join(tokens.editor, 'Gus')).status, 404);
    assert.equal((await app.catalog.listGuests(board.id)).length, 0);

    await app.catalog.setGeneralAccess(board.id, 'restricted');
    await dead(`/s/${tokens.commenter}`);
    await dead(`/s/${tokens.commenter}`, sam.cookie);
    await app.catalog.setGeneralAccess(board.id, 'link');
    await app.catalog.trashArtifact(board.id);
    await dead(`/s/${tokens.commenter}`);
    await app.catalog.restoreArtifact(board.id);

    const capped = await makeApp({ env: { OA_LINK_MAX_ROLE: 'viewer' } });
    try {
      const owner = await capped.person('Ann');
      const art = await capped.artifact(owner.user, { generalAccess: 'link' });
      const { token } = await capped.catalog.createLink(art.id, 'commenter');
      assert.equal((await capped.fetch(`/s/${token}`)).status, 404);
    } finally {
      await capped.close();
    }
  });

  it('restricting the artifact turns off what link guests and link members had', async () => {
    const joined = await join(tokens.commenter, 'Gus');
    const cookie = Object.entries(cookiesSet(joined)).map(([k, v]) => `${k}=${v}`).join('; ');
    await app.fetch(`/s/${tokens.commenter}`, { cookie: sam.cookie });
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie })).status, 200);
    assert.equal((await app.fetch(SHARE, { cookie: ada.cookie, body: { id: board.id, access: 'restricted' } })).status, 200);
    // The guest still is who they were (their row stays), but they reach nothing.
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie })).status, 404);
    assert.equal((await app.fetch(`/a/${board.id}`, { cookie })).status, 403);
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: sam.cookie })).status, 404);
    const list = ((await (await app.fetch('/api/open-artifact.artifacts', { cookie: sam.cookie })).json()) as { artifacts: ArtifactView[] }).artifacts;
    assert.ok(!list.some((a) => a.id === board.id));
    assert.equal((await app.fetch(SHARE, { cookie: ada.cookie, body: { id: board.id, access: 'link' } })).status, 200);
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: sam.cookie })).status, 200);
  });

  it('a reset drops both kinds of guest at once', async () => {
    const joined = await join(tokens.commenter, 'Gus');
    const cookie = Object.entries(cookiesSet(joined)).map(([k, v]) => `${k}=${v}`).join('; ');
    await app.fetch(`/s/${tokens.commenter}`, { cookie: sam.cookie });
    assert.equal((await app.fetch(SHARE, { cookie: ada.cookie, body: { id: board.id, reset: 'commenter' } })).status, 200);
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie })).status, 401);
    assert.equal((await app.fetch(`/a/${board.id}`, { cookie })).status, 303);
    assert.equal((await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: sam.cookie })).status, 404);
    assert.equal((await app.fetch(`/s/${tokens.commenter}`)).status, 404, 'the old address is dead');
  });

  it('a join from another site is refused and joins nobody', async () => {
    assert.equal((await join(tokens.commenter, 'Mallory', 'https://evil.example')).status, 403);
    const crossSite = await app.fetch(`/s/${tokens.commenter}`, {
      body: 'name=Mallory',
      origin: null,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);
    assert.equal((await app.catalog.listGuests(board.id)).length, 0);
  });

  it('joins from the form exactly as a browser posts it, and refuses a cross-site one with a page', async () => {
    // The join page is `Referrer-Policy: same-origin`; under the old `no-referrer` Chromium sent `Origin: null`.
    const form = await app.fetch(`/s/${tokens.commenter}`);
    assert.equal(form.headers.get('referrer-policy'), 'same-origin');
    const browser = { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html,application/xhtml+xml' };
    const fromNullOrigin = await app.fetch(`/s/${tokens.commenter}`, { body: 'name=Gus', origin: 'null', headers: { ...browser, 'sec-fetch-site': 'same-origin' } });
    assert.equal(fromNullOrigin.status, 303);
    assert.equal(fromNullOrigin.headers.get('location'), `/a/${board.id}`);
    const evil = await app.fetch(`/s/${tokens.commenter}`, { body: 'name=Mallory', origin: 'https://evil.example', headers: { ...browser, 'sec-fetch-site': 'cross-site', 'accept-language': 'zh-CN' } });
    assert.equal(evil.status, 403);
    assert.match(evil.headers.get('content-type') ?? '', /^text\/html/);
    const page = await evil.text();
    assert.ok(page.includes('不允许这样做'), page);
    assert.ok(!page.trimStart().startsWith('{'));
    assert.deepEqual((await app.catalog.listGuests(board.id)).map((g) => g.name), ['Gus']);
  });

  it('a Docs link passes its tab and comment on, and nothing else', async () => {
    const docs = await app.artifact(ada.user, { type: 'docs', generalAccess: 'link' });
    const { token } = await app.catalog.createLink(docs.id, 'viewer');
    const response = await app.fetch(`/s/${token}?tab=t_1&comment=c-2&evil=1`, { cookie: sam.cookie });
    assert.equal(response.headers.get('location'), `/a/${docs.id}?tab=t_1&comment=c-2`);
    const odd = await app.fetch(`/s/${token}?tab=${encodeURIComponent('//evil.example')}`, { cookie: sam.cookie });
    assert.equal(odd.headers.get('location'), `/a/${docs.id}`);
    const board2 = await app.fetch(`/s/${tokens.viewer}?tab=t_1`, { cookie: sam.cookie });
    assert.equal(board2.headers.get('location'), `/a/${board.id}`);
  });
});

it('guest names are cleaned', () => {
  assert.equal(cleanGuestName('  Ada \n Lovelace '), 'Ada Lovelace');
  assert.equal(cleanGuestName('<script>"x"</script>'), 'scriptx/script');
  assert.equal(cleanGuestName('x'.repeat(100)).length, 40);
  assert.equal(cleanGuestName(7), '');
});
