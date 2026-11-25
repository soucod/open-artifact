import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArtifactView, ShareView, TypeView } from '@open-artifact/protocol';
import {
  addressWithout,
  addressWithoutThread,
  agentNameOf,
  appendSent,
  canOpenSession,
  countText,
  deliveryOf,
  devBoot,
  givenLink,
  isShared,
  isWorking,
  leastRole,
  shownAddresses,
  sortedGuests,
  ownerState,
  pageAddress,
  pageOriginOf,
  panelOf,
  parseSent,
  showsComments,
  switchPool,
  type Owner,
} from '../src/shell/model.ts';
import { defaultCreatable, isCreatable, ownerBadge, sortArtifacts } from '../src/home/model.ts';
import { useShell } from '../src/shell/store.ts';

const owner = (patch: Partial<Owner> = {}): Owner => ({ harness: 'dsh', session: 's1', workspace: null, live: true, status: 'idle', ...patch });

const artifact = (id: string, patch: Partial<ArtifactView> = {}): ArtifactView => ({
  id,
  url: `open-artifact://artifact/${id}`,
  title: id,
  type: 'design',
  typeTitle: 'Design',
  typeMissing: false,
  root: `/tmp/${id}`,
  view_url: '',
  page_url: '',
  owner: null,
  pinned: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  openedAt: null,
  contentAt: null,
  thumbnail: null,
  shared: false,
  open: false,
  ...patch,
});

describe('shell model', () => {
  it('keeps inactive toolbar slots during restoration and clears the old frame report on every boot', t => {
    t.after(() => useShell.setState(useShell.getInitialState(), true));
    const store = useShell.getState();
    const boot = devBoot(artifact('refresh'), { page: 'http://localhost/board', page_url: 'http://localhost/board' }, null);
    const comments = { available: true, on: true, open: true, count: 2, pageButton: false };
    store.setBoot(boot);
    const gen = useShell.getState().bootGen;
    store.setReport({ ready: true, saved: 'saved', history: true, comments });
    store.setPageReady(true);
    store.setFrameLoading();
    store.setReport({ ready: false });
    assert.equal(useShell.getState().pageReady, false);
    assert.deepEqual(useShell.getState().rememberedChrome, { history: true, comments: { ...comments, on: false, open: false } });
    store.setReport({ ready: true, saved: 'saved', comments: { ...comments, pageButton: true } });
    assert.deepEqual(useShell.getState().rememberedChrome, {});
    store.setBoot(boot);
    assert.equal(useShell.getState().bootGen, gen + 1);
    assert.deepEqual(useShell.getState().report, {});
  });

  it('opens the linked slide in the editor frame and scopes slide links to decks', () => {
    const boot = { id: 'deck', page: 'http://localhost:8000/', type: 'slides' };
    const address = 'http://localhost:8100/a/deck';
    for (const hash of ['#slide-~7', '#slide-~intro', '#slide-2']) {
      assert.equal(new URL(pageAddress(boot, address + hash)!).hash, hash);
    }
    assert.equal(new URL(pageAddress(boot, address + '#unknown')!).hash, '');
    assert.equal(new URL(pageAddress({ ...boot, type: 'design' }, address + '#slide-1')!).hash, '');
  });

  it('hands a design its page or a readable place link, and nothing else', () => {
    const boot = { id: 'canvas', page: 'http://localhost:8000/', type: 'design' };
    const address = 'http://localhost:8100/a/canvas';
    for (const hash of ['#page=review', '#page-review', '#artboard-screens-sign-in', '#play-main']) {
      assert.equal(new URL(pageAddress(boot, address + hash)!).hash, hash);
    }
    assert.equal(new URL(pageAddress(boot, address + '#page=review&x=1')!).hash, '#page=review');
    assert.equal(new URL(pageAddress(boot, address + '#artboard-a=b')!).hash, '');
  });

  it('hands a sheet the page of a sheet link, with the cells it points at', () => {
    const boot = { id: 'book', page: 'http://localhost:8000/', type: 'sheets' };
    const address = 'http://localhost:8100/a/book';
    const pageOf = (hash: string) => new URLSearchParams(new URL(pageAddress(boot, address + hash)!).hash.slice(1)).get('page');
    assert.equal(pageOf('#sheet-sht_a.0'), 'sht_a.0');
    assert.equal(pageOf('#sheet-sht_a.0~A2-D2'), 'sht_a.0~A2-D2');
    assert.equal(pageOf('#page=sht_a.0'), 'sht_a.0');
  });
  it('names the agent: host, then boot, then fallback', () => {
    assert.equal(agentNameOf({ origin: 'x', caps: {}, agentName: 'Helper', declared: false, via: 'frame', theme: null, destinations: [] }, { agentName: 'Boot' }, 'Agent'), 'Helper');
    assert.equal(agentNameOf(null, { agentName: 'Boot' }, 'Agent'), 'Boot');
    assert.equal(agentNameOf(null, { agentName: '' }, 'Agent'), 'Agent');
  });

  it('is working when the owner runs, or with no owner when the page says busy', () => {
    assert.equal(isWorking(owner({ status: 'running' }), {}), true);
    assert.equal(isWorking(owner({ status: 'running', live: false }), {}), false);
    assert.equal(isWorking(null, { agent: { available: true, listening: true, busy: true } }), true);
    // A page still saying busy after its type server stopped mid-turn: the owner's idle wins.
    assert.equal(isWorking(owner({ status: 'idle' }), { agent: { available: true, listening: true, busy: true } }), false);
    assert.equal(ownerState(null, {}), 'none');
    assert.equal(ownerState(owner({ live: false }), {}), 'offline');
    assert.equal(ownerState(owner(), {}), 'idle');
  });

  it('opens sessions only with a sessions host and an owner session', () => {
    const host = { origin: 'x', caps: { sessions: true }, agentName: null, declared: false, via: 'frame' as const, theme: null, destinations: [] };
    assert.equal(canOpenSession(host, owner()), true);
    assert.equal(canOpenSession(host, owner({ session: null })), false);
    assert.equal(canOpenSession({ ...host, caps: {} }, owner()), false);
    assert.equal(canOpenSession(null, owner()), false);
  });

  it('shows comments only without a page button, and caps the count', () => {
    const comments = { available: true, on: false, open: false, count: 3, pageButton: false };
    assert.equal(showsComments({ comments }), true);
    assert.equal(showsComments({ comments: { ...comments, pageButton: true } }), false);
    assert.equal(countText(0), '');
    assert.equal(countText(7), '7');
    assert.equal(countText(120), '99+');
  });

  it('switches within the owner session when it has several artifacts', () => {
    const library = [
      artifact('a', { owner: owner(), contentAt: '2026-01-02T00:00:00Z' }),
      artifact('b', { owner: owner(), contentAt: '2026-01-03T00:00:00Z' }),
      artifact('c', { contentAt: '2026-01-04T00:00:00Z' }),
    ];
    const pool = switchPool(library, owner());
    assert.equal(pool.inSession, true);
    assert.deepEqual(pool.list.map((a) => a.id), ['b', 'a']);
    const all = switchPool(library, null);
    assert.equal(all.inSession, false);
    assert.deepEqual(all.list.map((a) => a.id), ['c', 'b', 'a']);
  });

  it('builds the page address with open_artifact_shell, open_artifact_id and the comment thread', () => {
    const src = pageAddress({ page: 'http://art.frame.localhost:4800/index.html?x=1', id: 'art_1' }, 'http://127.0.0.1:4800/a/art_1?comment=t9');
    const url = new URL(src!);
    assert.equal(url.searchParams.get('open_artifact_shell'), 'http://127.0.0.1:4800');
    assert.equal(url.searchParams.get('open_artifact_id'), 'art_1');
    assert.equal(url.searchParams.get('comment'), 't9');
    assert.equal(url.searchParams.get('x'), '1');
    assert.equal(pageAddress({ page: null, id: 'art_1' }, 'http://h/a/art_1'), null);
    assert.equal(addressWithoutThread('http://h/a/art_1?comment=t9&chat=1#z'), '/a/art_1?chat=1#z');
    assert.equal(addressWithoutThread('http://h/a/art_1'), null);
    assert.equal(pageOriginOf('http://p.localhost:9/x', 'http://h/a/1'), 'http://p.localhost:9');
    assert.equal(pageOriginOf(null, 'http://h/a/1'), 'http://h');
  });

  it('reads sharing state and picks the least-rights link', () => {
    const view: ShareView = { lan: true, links: { editor: { on: true }, commenter: { on: true }, viewer: { on: false } } };
    assert.equal(leastRole(view), 'commenter');
    assert.equal(leastRole({ lan: false, links: {} }), null);
    assert.equal(isShared(view, {}, null), true);
    assert.equal(isShared(null, { shareOn: true }, null), true);
    assert.equal(isShared(null, {}, { shared: false }), false);
  });

  it("gives out the least role's network link, not 127.0.0.1, for the title menu's Copy link as for the Export tab's", () => {
    const off: ShareView = {
      lan: false,
      links: {
        editor: { on: true, url: 'http://192.168.1.5:4800/s/e' },
        commenter: { on: true, url: 'http://192.168.1.5:4800/s/c' },
        viewer: { on: false, url: 'http://192.168.1.5:4800/s/v' },
      },
    };
    assert.deepEqual(givenLink(off), { which: 'commenter', url: 'http://192.168.1.5:4800/s/c' });
    // Every link off: none to give, the Shell's own address is left.
    assert.equal(givenLink({ lan: true, links: { editor: { on: false, url: 'http://x/s/e' } } }), null);
    // A link that is on but has no address yet gives nothing either.
    assert.equal(givenLink({ lan: true, links: { viewer: { on: true } } }), null);
    const cloud = { url: 'https://oa.example/a/art_1', access: 'restricted', owner: { id: 'u', name: 'Ada' }, members: [], canManage: true, settings: { viewersCanExport: true, editorsCanAskAgent: true } } as unknown as NonNullable<ShareView['cloud']>;
    assert.deepEqual(givenLink({ lan: false, links: off.links, cloud }), { which: 'cloud', url: 'https://oa.example/a/art_1' });
  });

  it('tracks sent messages', () => {
    assert.equal(deliveryOf('live'), 'delivered');
    assert.equal(deliveryOf('wait'), 'delivered');
    assert.equal(deliveryOf('inbox'), 'inbox');
    assert.equal(deliveryOf('failed'), 'failed');
    let list = appendSent([], { text: 'a', at: '1', delivery: 'delivered' }, 2);
    list = appendSent(list, { text: 'b', at: '2', delivery: 'inbox' }, 2);
    list = appendSent(list, { text: 'c', at: '3', delivery: 'failed' }, 2);
    assert.deepEqual(list.map((m) => m.text), ['b', 'c']);
    assert.deepEqual(parseSent(JSON.stringify(list)), list);
    assert.deepEqual(parseSent('[{"text":1},{"text":"x","at":"t"}]'), [{ text: 'x', at: 't', delivery: 'delivered' }]);
    assert.deepEqual(parseSent('nope'), []);
  });
});

describe('home model', () => {
  it('puts pinned first, then the most recent', () => {
    const sorted = sortArtifacts([
      artifact('old', { contentAt: '2026-01-01T00:00:00Z' }),
      artifact('new', { contentAt: '2026-03-01T00:00:00Z' }),
      artifact('pinned', { pinned: true, contentAt: '2025-01-01T00:00:00Z' }),
    ]);
    assert.deepEqual(sorted.map((a) => a.id), ['pinned', 'new', 'old']);
  });

  it('creates usable design and page built-ins and custom types, not the other built-ins', () => {
    const type = (patch: Partial<TypeView>): TypeView => ({
      id: 'design',
      title: 'Design',
      description: '',
      scope: 'builtin',
      root: '/types',
      runtime: 'server',
      entry: null,
      server: null,
      runnable: true,
      enabled: true,
      shadowedBy: null,
      version: null,
      problems: [],
      icon: false,
      ...patch,
    } as TypeView);
    assert.equal(isCreatable(type({})), true);
    assert.equal(isCreatable(type({ id: 'slides' })), false);
    assert.equal(isCreatable(type({ enabled: false })), false);
    assert.equal(isCreatable(type({ shadowedBy: 'project' })), false);
    assert.equal(defaultCreatable([type({ id: 'slides' }), type({})])?.id, 'design');
    assert.equal(defaultCreatable([]), null);
    assert.equal(isCreatable(type({ id: 'page' })), true);
    assert.equal(isCreatable(type({ id: 'notes', scope: 'user', runtime: 'frame' })), true);
    assert.equal(isCreatable(type({ id: 'slides', scope: 'extra', runtime: 'server' })), false, 'a server type outside the built-ins is not offered');
    assert.equal(isCreatable(type({ id: 'notes', scope: 'extra', runtime: 'frame' })), true);
    assert.equal(isCreatable(type({ id: 'notes', scope: 'user', runtime: 'frame', runnable: false })), false);
    assert.equal(isCreatable(type({ id: 'notes', scope: 'user', runtime: 'frame', enabled: false })), false);
    // A project's type is made from a session in that project, and only once the project is trusted.
    assert.equal(isCreatable(type({ id: 'notes', scope: 'project', runtime: 'frame' })), false);
    assert.equal(isCreatable(type({ id: 'page', scope: 'project', trusted: false })), false);
    // "New artifact" is Design while there is one, else the first that can be made.
    assert.equal(defaultCreatable([type({ id: 'page' }), type({})])?.id, 'design');
    assert.equal(defaultCreatable([type({ id: 'slides' }), type({ id: 'notes', scope: 'user', runtime: 'frame' })])?.id, 'notes');
  });

  it('draws owner badges', () => {
    assert.equal(ownerBadge(null), 'none');
    assert.equal(ownerBadge(owner({ live: false })), 'offline');
    assert.equal(ownerBadge(owner({ status: 'running' })), 'working');
    assert.equal(ownerBadge(owner()), 'idle');
  });
});

describe('the page report (chrome protocol)', async () => {
  const { CHROME_REQUEST } = await import('@open-artifact/protocol');
  const { MAX_FORMATS, MAX_VARIANTS, exportEntries, exportRequestId, hasExportTab, hasExports, menuActions, normalizeReport, offersArchive, saveIndicator } = await import('../src/shell/model.ts');

  it('keeps v1 reports as they are', () => {
    const v1 = { comments: { available: true, on: false, open: false, count: 2, pageButton: false }, history: true, exports: true };
    assert.deepEqual(normalizeReport(v1), v1);
    assert.deepEqual(normalizeReport(null), {});
    assert.equal(hasExports(normalizeReport(v1)), true);
  });

  it('drops bad entries one at a time and caps the lists', () => {
    const report = normalizeReport({
      saved: 'saving',
      actions: [{ id: 'save_now' }, { id: 'Bad id' }, { id: 'save_now', label: 'again' }, { id: 'zoom', label: ' Zoom\u0007 in ', why: 'nope' }, ...Array.from({ length: 30 }, (_, i) => ({ id: `a${i}` }))],
      formats: [{ format: 'pdf', interactive: true }, { format: 'PDF!' }, { format: 'png', variants: [{ id: 'slide' }, { id: 'all', label: 'Every slide' }, { id: 'X' }] }],
      shareNotice: { text: 'Contains secrets', tone: 'warning' },
      hasContent: true,
    });
    assert.equal(report.saved, 'saving');
    assert.equal(report.actions?.length, 18);
    assert.deepEqual(report.actions?.slice(0, 2), [{ id: 'save_now' }, { id: 'zoom', label: 'Zoom  in' }]);
    assert.deepEqual(report.formats, [
      { format: 'pdf', interactive: true },
      { format: 'png', variants: [{ id: 'slide' }, { id: 'all', label: 'Every slide' }] },
    ]);
    assert.deepEqual(report.shareNotice, { text: 'Contains secrets', tone: 'warning' });
    assert.equal(normalizeReport({ saved: 'lost' }).saved, undefined);
  });

  it('shows save state: read-only always, saving only with save_now, a retry when save_now runs', () => {
    assert.equal(saveIndicator({ saved: 'readonly' }), 'readonly');
    assert.deepEqual(normalizeReport({ ready: false, saved: 'saved' }), { ready: false, saved: 'saved' });
    assert.equal(normalizeReport({ ready: 'later' }).ready, undefined);
    assert.equal(normalizeReport({ saved: 'loading' }).saved, undefined);
    assert.equal(saveIndicator({ saved: 'saving' }), 'none');
    assert.equal(saveIndicator({ saved: 'saving', actions: [{ id: 'save_now' }] }), 'saving');
    assert.equal(saveIndicator({ saved: 'unsaved' }), 'unsaved');
    assert.equal(saveIndicator({ saved: 'unsaved', actions: [{ id: 'save_now' }] }), 'retry');
    assert.equal(saveIndicator({ saved: 'unsaved', actions: [{ id: 'save_now', disabled: true }] }), 'unsaved');
    assert.equal(saveIndicator({ saved: 'saved', actions: [{ id: 'save_now' }] }), 'none');
  });

  it('lists one export row per format or variant', () => {
    const rows = exportEntries({ formats: [{ format: 'pdf', interactive: true }, { format: 'png', variants: [{ id: 'this_slide' }, { id: 'all', label: 'All', disabled: true }] }] });
    assert.deepEqual(
      rows.map((r) => [r.label, r.variant, r.disabled, r.interactive]),
      [
        ['PDF', undefined, false, true],
        ['PNG · This slide', 'this_slide', false, false],
        ['PNG · All', 'all', true, false],
      ],
    );
    assert.ok(exportEntries({ hasContent: false, formats: [{ format: 'pdf' }] }).every((r) => r.disabled));
  });

  it('keeps up to 16 variants (Design has 9 PNG sizes) and drops the rest', () => {
    const variants = Array.from({ length: 20 }, (_, i) => ({ id: `png_${i}`, label: `@${i}x` }));
    const report = normalizeReport({ formats: [{ format: 'png', variants }] });
    assert.equal(report.formats?.[0]?.variants?.length, MAX_VARIANTS);
    const nine = normalizeReport({ formats: [{ format: 'png', variants: variants.slice(0, 9) }] });
    assert.equal(exportEntries(nine).length, 9);
    const many = normalizeReport({ formats: Array.from({ length: 12 }, (_, i) => ({ format: `f${i}` })) });
    assert.equal(many.formats?.length, MAX_FORMATS);
  });

  it('carries the page\'s own disabled reason and the chevron', () => {
    const report = normalizeReport({
      formats: [
        { format: 'pdf', more: true, disabled: true, disabledReason: ' Wait for the  render\u0007 ', why: 'other' },
        { format: 'png', disabledReason: 'x'.repeat(300), variants: [{ id: 'sel', disabled: true, disabledReason: 'Select an artboard first' }, { id: 'all' }] },
        { format: 'html', interactive: true, more: 'yes' },
      ],
    });
    assert.equal(report.formats?.[0]?.disabledReason, 'Wait for the  render');
    assert.equal(report.formats?.[0]?.more, true);
    assert.equal(report.formats?.[1]?.disabledReason?.length, 160);
    assert.equal(report.formats?.[2]?.more, undefined);
    const rows = exportEntries(report);
    assert.deepEqual(
      rows.map((r) => [r.key, r.disabled, r.disabledReason, r.more, r.why]),
      [
        ['pdf', true, 'Wait for the  render', true, 'other'],
        ['png:sel', true, 'Select an artboard first', false, undefined],
        ['png:all', false, undefined, false, undefined],
        ['html', false, undefined, true, undefined],
      ],
    );
  });

  it('offers the folder zip on every page but a read-only one, so the Export tab is nearly always there', () => {
    assert.equal(offersArchive({}), true);
    assert.equal(offersArchive({ saved: 'saving' }), true);
    assert.equal(offersArchive({ saved: 'readonly' }), false);
    assert.equal(hasExportTab({}), true);
    assert.equal(hasExportTab({ saved: 'readonly' }), false);
    assert.equal(hasExportTab({ saved: 'readonly', formats: [{ format: 'pdf' }] }), true);
    assert.equal(hasExportTab({ saved: 'readonly', exports: true }), true);
  });

  it('hides actions the Shell draws itself, and makes request ids the page accepts', () => {
    assert.deepEqual(menuActions({ actions: [{ id: 'chat_toggle' }, { id: 'open_find' }] }).map((a) => a.id), ['open_find']);
    assert.match(exportRequestId(), CHROME_REQUEST);
  });
});

describe('the panel an address asks for', () => {
  it('reads ?panel=share|export and drops it from the address', () => {
    assert.equal(panelOf('http://h/a/art_1?panel=share'), 'share');
    assert.equal(panelOf('http://h/a/art_1?chat=1&panel=export'), 'export');
    assert.equal(panelOf('http://h/a/art_1?panel=comments'), null);
    assert.equal(panelOf('http://h/a/art_1'), null);
    assert.equal(addressWithout('http://h/a/art_1?panel=share&chat=1#z', 'panel'), '/a/art_1?chat=1#z');
    assert.equal(addressWithout('http://h/a/art_1?chat=1', 'panel'), null);
  });

  it('an Export tab asked for before the page reports formats shows once they come', () => {
    // A read-only version page has no folder zip, so its Export tab waits for formats.
    const store = useShell.getState();
    store.setReport({ saved: 'readonly' });
    store.openShare('export', { wait: true });
    assert.equal(useShell.getState().shareTab, 'share');
    assert.equal(useShell.getState().exportWanted, true);
    store.setReport({ saved: 'readonly', formats: [{ format: 'pdf' }] });
    assert.equal(useShell.getState().shareTab, 'export');
    assert.equal(useShell.getState().exportWanted, false);

    store.closeShare();
    store.setReport({ saved: 'readonly' });
    store.openShare('export');
    assert.equal(useShell.getState().exportWanted, false, 'only with wait');
    store.openShare('export', { wait: true });
    store.closeShare();
    store.setReport({ saved: 'readonly', formats: [{ format: 'pdf' }] });
    assert.equal(useShell.getState().shareTab, 'share', 'a closed panel forgets it');
    store.closeShare();
  });

  it('opens the Export tab at once on a page with no formats: the folder zip is always there', () => {
    const store = useShell.getState();
    store.setReport({});
    store.openShare('export', { wait: true });
    assert.equal(useShell.getState().shareTab, 'export');
    assert.equal(useShell.getState().exportWanted, false);
    store.closeShare();
  });
});

describe('the Share tab', () => {
  const guest = (id: string, patch: Partial<NonNullable<ShareView['guests']>[number]> = {}) => ({
    id,
    name: id,
    role: 'viewer' as const,
    joined: '2026-01-01T00:00:00Z',
    online: false,
    active: true,
    ...patch,
  });

  it('lists the people who joined online first, then the most recently seen', () => {
    const view: ShareView = {
      lan: true,
      links: {},
      guests: [
        guest('old', { seen: '2026-01-02T00:00:00Z' }),
        guest('never'),
        guest('here', { online: true, seen: '2026-01-01T00:00:00Z' }),
        guest('new', { seen: '2026-01-05T00:00:00Z' }),
      ],
    };
    assert.deepEqual(sortedGuests(view).map((g) => g.id), ['here', 'new', 'old', 'never']);
    assert.deepEqual(sortedGuests({ lan: false, links: {} }), []);
    assert.equal(view.guests?.[0]?.id, 'old', 'leaves the view alone');
  });

  it('names the network addresses with the port, the Tailscale one on its own line', () => {
    const view: ShareView = { lan: true, links: {}, port: 4801, addresses: ['192.168.1.5', '100.64.0.7', 'fe80::1'], tailnet: { address: '100.64.0.7', links: {} } };
    assert.deepEqual(shownAddresses(view), ['192.168.1.5:4801', '[fe80::1]:4801']);
    assert.deepEqual(shownAddresses({ lan: true, links: {}, addresses: ['10.0.0.2'] }), ['10.0.0.2']);
    assert.deepEqual(shownAddresses({ lan: true, links: {}, port: 80, addresses: ['100.64.0.7'], tailnet: { address: '100.64.0.7', links: {} } }), ['100.64.0.7:80']);
  });
});

describe('peers and following', async () => {
  const { MAX_CHROME_PEERS } = await import('@open-artifact/protocol');
  const { followedPeer, inkOnColor, normalizeReport, offersFollow, peerColorOf, peerInitials } = await import('../src/shell/model.ts');

  it('keeps valid peers once each, and following as a key or null', () => {
    const report = normalizeReport({
      peers: [
        { key: 'p1', name: '  Ada Lovelace ', color: '#DC3C3D', self: true, followsYou: true },
        { key: 'p1', name: 'Again' },
        { key: 'bad key', name: 'Spaces' },
        { key: 'p2', name: '' },
        { key: 'p3', name: 'Grace', color: 'red', self: 'yes' },
      ],
      following: 'p3',
    });
    assert.deepEqual(report.peers, [
      { key: 'p1', name: 'Ada Lovelace', color: '#dc3c3d', self: true, followsYou: true },
      { key: 'p3', name: 'Grace' },
    ]);
    assert.equal(report.following, 'p3');
    assert.equal(offersFollow(report), true);
    assert.equal(followedPeer(report)?.name, 'Grace');
    assert.equal(normalizeReport({ following: null }).following, null);
    assert.equal(offersFollow(normalizeReport({ following: null })), true);
    assert.equal(offersFollow(normalizeReport({ following: 'no way' })), false);
    assert.equal(followedPeer(normalizeReport({ peers: [], following: 'gone' })), null);
  });

  it('lists at most MAX_CHROME_PEERS', () => {
    const peers = Array.from({ length: MAX_CHROME_PEERS + 5 }, (_, i) => ({ key: `p${i}`, name: `P ${i}` }));
    assert.equal(normalizeReport({ peers }).peers?.length, MAX_CHROME_PEERS);
  });

  it('draws avatars from names and colours', () => {
    assert.equal(peerInitials('ada lovelace byron'), 'AL');
    assert.equal(peerInitials('宝玉'), '宝');
    assert.equal(peerInitials('  '), '?');
    assert.equal(peerColorOf({ key: 'x', color: '#123456' }), '#123456');
    assert.equal(peerColorOf({ key: 'x' }), peerColorOf({ key: 'x' }));
    assert.equal(inkOnColor('#fbb315'), '#0b0b0b');
    assert.equal(inkOnColor('#257de0'), '#ffffff');
  });
});
