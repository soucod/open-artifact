import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShareView, ShellBoot } from '@open-artifact/protocol';
import {
  accessRequest,
  addMembersRequest,
  applyCloudChange,
  cloudAgentBadge,
  cloudAskLine,
  cloudSentLine,
  homeBootOf,
  isCloud,
  isCloudShared,
  mayAsk,
  mayComment,
  mayEdit,
  mayExport,
  memberIdOf,
  memberRoleRequest,
  parseMember,
  parseMembers,
  roleOf,
  settingRequest,
  showsRoleLinks,
  signInHref,
} from '../src/lib/cloud.ts';
import { translate } from '../src/lib/i18n.ts';
import { deliveryOf, isShared } from '../src/shell/model.ts';

const CLOUD = { user: { id: 'u1', name: 'Ada' }, role: 'viewer' as const, appOrigin: 'https://oa.example', signInUrl: '/auth/sign-in', signOutUrl: '/auth/sign-out' };

function view(cloud?: Partial<NonNullable<ShareView['cloud']>>): ShareView {
  return {
    lan: false,
    links: { editor: { on: false }, commenter: { on: true, url: 'https://oa.example/l/c' }, viewer: { on: false } },
    cloud: {
      url: 'https://oa.example/a/art_x',
      access: 'restricted',
      owner: { id: 'u0', name: 'Owner' },
      members: [{ id: 'user:u1', kind: 'user', label: 'Ada', role: 'viewer' }],
      canManage: true,
      settings: { viewersCanExport: false, editorsCanAskAgent: true },
      ...cloud,
    },
  };
}

describe('cloud mode', () => {
  it('is data: a boot with cloud', () => {
    assert.equal(isCloud(null), false);
    assert.equal(isCloud({}), false);
    assert.equal(isCloud({ cloud: CLOUD }), true);
  });

  it('reads the home boot defensively', () => {
    assert.deepEqual(homeBootOf(null), {});
    assert.deepEqual(homeBootOf({ cloud: 'x' }), {});
    assert.deepEqual(homeBootOf({ cloud: { user: null, signInUrl: '/in' } }), {});
    const { role: _role, ...home } = CLOUD;
    assert.deepEqual(homeBootOf({ cloud: home }), { cloud: home });
    assert.deepEqual(homeBootOf({ cloud: { ...home, user: { name: 1 } } }).cloud?.user, null);
  });

  it('builds the sign-in address with return_to', () => {
    assert.equal(signInHref('/auth/sign-in', '/a/art_x?tab=t', 'https://oa.example'), '/auth/sign-in?return_to=%2Fa%2Fart_x%3Ftab%3Dt');
    assert.equal(signInHref('/auth/sign-in?return_to=%2Fa%2Fy', '/a/art_x', 'https://oa.example'), '/auth/sign-in?return_to=%2Fa%2Fy');
    assert.equal(signInHref('https://idp.example/in', '/a/x', 'https://oa.example'), 'https://idp.example/in?return_to=%2Fa%2Fx');
    // Never a protocol-relative return address.
    assert.equal(signInHref('/in', '//evil.example', 'https://oa.example'), '/in');
  });
});

describe('roles', () => {
  const boot = (extra: Partial<ShellBoot>): Pick<ShellBoot, 'typeServer' | 'cloud'> => extra;
  it('comes from the cloud, else the type server, else the owner', () => {
    assert.equal(roleOf(null), 'owner');
    assert.equal(roleOf(boot({})), 'owner');
    assert.equal(roleOf(boot({ typeServer: { role: 'commenter' } })), 'commenter');
    assert.equal(roleOf(boot({ cloud: { ...CLOUD, role: 'editor' }, typeServer: { role: 'viewer' } })), 'editor');
  });

  it('decides what each role may do', () => {
    assert.deepEqual(['owner', 'editor', 'commenter', 'viewer'].map((r) => mayEdit(r as 'owner')), [true, true, false, false]);
    assert.deepEqual(['owner', 'editor', 'commenter', 'viewer'].map((r) => mayComment(r as 'owner')), [true, true, true, false]);
    assert.equal(mayAsk('owner', { editorsCanAskAgent: false }), true);
    assert.equal(mayAsk('editor'), true);
    assert.equal(mayAsk('editor', { editorsCanAskAgent: false }), false);
    assert.equal(mayAsk('commenter'), false);
    assert.equal(mayAsk('viewer'), false);
    assert.equal(mayExport('commenter'), true);
    assert.equal(mayExport('viewer'), false);
    assert.equal(mayExport('viewer', { viewersCanExport: true }), true);
  });
});

describe('members', () => {
  it('parses an address or a domain', () => {
    assert.deepEqual(parseMember(' Ada@Example.COM '), { id: 'email:ada@example.com', kind: 'email', label: 'ada@example.com' });
    assert.deepEqual(parseMember('@example.co.uk'), { id: 'domain:example.co.uk', kind: 'domain', label: '@example.co.uk' });
    assert.deepEqual(parseMember('<bo@x.io>'), { id: 'email:bo@x.io', kind: 'email', label: 'bo@x.io' });
    for (const bad of ['', 'ada', 'ada@', '@', '@localhost', 'a@b', 'a b@c.d', '@-x.com', 'example.com']) assert.equal(parseMember(bad), null, bad);
  });

  it('parses a list, once each, and names the rest', () => {
    assert.deepEqual(parseMembers('a@x.io, A@x.io;@x.io  nope'), {
      members: [
        { id: 'email:a@x.io', kind: 'email', label: 'a@x.io' },
        { id: 'domain:x.io', kind: 'domain', label: '@x.io' },
      ],
      invalid: ['nope'],
    });
  });

  it('reads member ids', () => {
    assert.deepEqual(memberIdOf('user:u1'), { kind: 'user', value: 'u1' });
    assert.deepEqual(memberIdOf('email:a@x.io'), { kind: 'email', value: 'a@x.io' });
    assert.deepEqual(memberIdOf('domain:x.io'), { kind: 'domain', value: 'x.io' });
    assert.deepEqual(memberIdOf('group:github:acme/devs'), { kind: 'group', value: 'github:acme/devs' });
    for (const bad of ['user', 'user:', ':u1', 'group:devs', 'group::x', 'link:abc']) assert.equal(memberIdOf(bad), null, bad);
  });
});

describe('share requests', () => {
  it('build the cloud parts of ShareRequest', () => {
    assert.deepEqual(addMembersRequest(parseMembers('a@x.io @y.io').members, 'commenter'), { members: { 'email:a@x.io': 'commenter', 'domain:y.io': 'commenter' } });
    assert.deepEqual(memberRoleRequest('user:u1', 'editor'), { members: { 'user:u1': 'editor' } });
    assert.deepEqual(memberRoleRequest('user:u1', null), { members: { 'user:u1': null } });
    assert.deepEqual(accessRequest('public'), { access: 'public' });
    assert.deepEqual(settingRequest('viewersCanExport', true), { settings: { viewersCanExport: true } });
  });

  it('show role links only past restricted', () => {
    assert.equal(showsRoleLinks('restricted'), false);
    assert.equal(showsRoleLinks('link'), true);
    assert.equal(showsRoleLinks('public'), true);
  });

  it('apply at once: roles, removal, new addresses as pending, access, settings, links', () => {
    const before = view();
    const after = applyCloudChange(before, {
      members: { 'user:u1': 'editor', 'email:b@x.io': 'viewer', 'domain:x.io': 'commenter', 'user:unknown': 'viewer' },
      access: 'link',
      settings: { viewersCanExport: true },
      links: { editor: true },
    });
    assert.deepEqual(after.cloud?.members, [
      { id: 'user:u1', kind: 'user', label: 'Ada', role: 'editor' },
      { id: 'email:b@x.io', kind: 'email', label: 'b@x.io', role: 'viewer', pending: true },
      { id: 'domain:x.io', kind: 'domain', label: '@x.io', role: 'commenter', pending: false },
    ]);
    assert.equal(after.cloud?.access, 'link');
    assert.deepEqual(after.cloud?.settings, { viewersCanExport: true, editorsCanAskAgent: true });
    assert.deepEqual(after.links.editor, { on: true });
    assert.equal(before.cloud?.members.length, 1, 'the old view is untouched');
    assert.deepEqual(applyCloudChange(after, { members: { 'user:u1': null } }).cloud?.members.map((m) => m.id), ['email:b@x.io', 'domain:x.io']);
    const local: ShareView = { lan: false, links: {} };
    assert.equal(applyCloudChange(local, { access: 'public' }), local);
  });

  it('marks the Share button shared once anyone is named or access is open', () => {
    assert.equal(isCloudShared({ access: 'restricted', members: [] }), false);
    assert.equal(isCloudShared({ access: 'link', members: [] }), true);
    assert.equal(isShared(view({ members: [] }), {}, null), false);
    assert.equal(isShared(view(), {}, null), true);
    assert.equal(isShared(view({ members: [], access: 'public' }), {}, { shared: false }), true);
  });
});

describe("the Ask pane on a cloud host", () => {
  const words = (said: { key: Parameters<typeof translate>[1]; vars?: Record<string, string | number> }, lang: 'en' | 'zh-CN' = 'en') => translate(lang, said.key, said.vars);

  it("says whether the owner's agent gets a request now, later, or not until one is connected", () => {
    assert.equal(words(cloudAskLine({ state: 'online', name: 'MacBook' }, true)), 'MacBook is connected: it gets this now.');
    assert.equal(words(cloudAskLine({ state: 'offline', name: 'MacBook' }, false)), 'MacBook will get this when its computer is back online.');
    assert.equal(words(cloudAskLine({ state: 'mcp', name: 'Claude' }, true)), 'Claude will see this the next time it works on the artifact.');
    assert.equal(words(cloudAskLine({ state: 'none', name: 'Agent' }, true)), 'No agent is connected to this site for you. Connect a computer or an MCP client; the request waits until then.');
    // An editor asks the owner's agent: "for you" is not theirs to fix.
    assert.equal(words(cloudAskLine({ state: 'none', name: 'Agent' }, false)), 'The owner has no agent connected to this site. The request waits until they connect one.');
    assert.equal(words(cloudAskLine({ state: 'online', name: 'MacBook' }, true), 'zh-CN'), 'MacBook 已连接：它现在就会收到。');
  });

  it("follows the host's answer once sent: delivered when the computer is connected, else waiting", () => {
    assert.equal(deliveryOf('link', 'delivered'), 'delivered');
    assert.equal(deliveryOf('link', 'inbox'), 'inbox');
    assert.equal(deliveryOf('link'), 'inbox');
    assert.equal(words(cloudSentLine('delivered', { state: 'online', name: 'MacBook' })), 'Delivered: MacBook has it now.');
    // The computer went away between the pane's last word and the send: the answer wins.
    assert.equal(words(cloudSentLine('inbox', { state: 'online', name: 'MacBook' })), 'Sent. MacBook will get it when its computer is back online.');
    assert.equal(words(cloudSentLine('inbox', { state: 'mcp', name: 'Claude' })), 'Sent. Claude will see it the next time it works on the artifact.');
    assert.equal(words(cloudSentLine('inbox', { state: 'none', name: 'Agent' })), 'Sent. It waits until an agent is connected.');
  });

  it('draws the dot from the agent', () => {
    assert.equal(cloudAgentBadge({ state: 'online', name: 'a' }), 'idle');
    assert.equal(cloudAgentBadge({ state: 'offline', name: 'a' }), 'offline');
    assert.equal(cloudAgentBadge({ state: 'mcp', name: 'a' }), 'offline');
    assert.equal(cloudAgentBadge({ state: 'none', name: 'a' }), 'none');
    assert.equal(cloudAgentBadge(null), 'none');
  });

  it('has every word in English and Chinese', () => {
    const keys = ['askCloudOnline', 'askCloudOffline', 'askCloudMcp', 'askCloudNone', 'askCloudNoneOther', 'sentCloudDelivered', 'sentCloudOffline', 'sentCloudMcp', 'sentCloudNone', 'viaWaitingAgent', 'statusConnected', 'statusNoAgent'] as const;
    for (const key of keys) assert.notEqual(translate('zh-CN', key, { agent: 'A' }), translate('en', key, { agent: 'A' }), key);
  });
});
