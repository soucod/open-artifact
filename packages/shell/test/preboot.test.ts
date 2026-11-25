import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LIBRARY_ROUTES, type ShellBoot } from '@open-artifact/protocol';
import {
  BAR_ATTRIBUTE,
  BOOT_ROUTE,
  PREFETCH_GLOBAL,
  VITALS_GLOBAL,
  WATCHDOG_GLOBAL,
  WATCHDOG_MS,
  barHeight,
  bootAddress,
  preboot,
  takeOver,
  takePrefetch,
  type Watchdog,
} from '../src/shell/preboot.ts';

/** A static element of `index.html`. */
interface FakeElement {
  hidden: boolean;
  removed: boolean;
  remove(): void;
  querySelector(selector: string): { textContent: string; onclick?: (() => void) | null } | null;
}

function element(hidden: boolean): FakeElement & { message: { textContent: string }; button: { textContent: string; onclick: (() => void) | null } } {
  const message = { textContent: '' };
  const button = { textContent: '', onclick: null as (() => void) | null };
  return {
    hidden,
    removed: false,
    message,
    button,
    remove() {
      this.removed = true;
    },
    querySelector: (selector) => (selector === 'p' ? message : selector === 'button' ? button : null),
  };
}

/** A window with what the pre-boot script touches, and handles on what it did. */
function fakeWindow(boot: Partial<ShellBoot> | null | undefined, options: { href?: string; language?: string } = {}) {
  const marks: Array<{ name: string; startTime: number }> = [];
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  const listeners = new Map<string, Array<(event: { target: unknown }) => void>>();
  const intervals: Array<{ fn: () => void; cleared: boolean }> = [];
  const attributes = new Map<string, string>();
  const skeleton = element(false);
  const error = element(true);
  let reloads = 0;
  const document = {
    title: 'Artifact',
    visibilityState: 'visible' as DocumentVisibilityState,
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
    getElementById: (id: string) => (id === 'oa-preboot' && !skeleton.removed ? skeleton : id === 'oa-preboot-error' && !error.removed ? error : null),
    addEventListener: () => undefined,
    querySelector: () => null,
  };
  const win = {
    __OPEN_ARTIFACT_BOOT__: boot,
    document,
    location: { href: options.href ?? 'http://127.0.0.1:4800/a/art_1', reload: () => void reloads++ },
    navigator: { language: options.language ?? 'en-US' },
    performance: {
      now: () => 12.34,
      mark: (name: string) => void marks.push({ name, startTime: 12.34 + marks.length }),
      getEntriesByName: (name: string) => marks.filter((m) => m.name === name),
    },
    fetch: (url: string, init?: RequestInit) => {
      fetches.push({ url, init });
      return Promise.resolve(new Response('{}'));
    },
    setTimeout: () => 0,
    setInterval: (fn: () => void) => intervals.push({ fn, cleared: false }) - 1,
    clearInterval: (id: number) => {
      if (intervals[id]) intervals[id]!.cleared = true;
    },
    addEventListener: (type: string, fn: (event: { target: unknown }) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: (event: { target: unknown }) => void) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
  } as Record<string, unknown> & { parent?: unknown };
  win.parent = win;
  const dispatch = (type: string, target: unknown): void => {
    for (const fn of listeners.get(type) ?? []) fn({ target });
  };
  const tick = (times: number): void => {
    for (let i = 0; i < times; i++) for (const interval of intervals) if (!interval.cleared) interval.fn();
  };
  return {
    win: win as unknown as Window,
    raw: win,
    document,
    marks,
    fetches,
    attributes,
    skeleton,
    error,
    dispatch,
    tick,
    reloads: () => reloads,
    watchdog: () => win[WATCHDOG_GLOBAL] as Watchdog,
  };
}

const pendingBoot = { id: 'art_1', title: 'My deck', type: 'slides', pending: true };

describe('preboot', () => {
  it('asks for the finished boot of a pending boot at once, and hands the request over once', async () => {
    const f = fakeWindow(pendingBoot);
    preboot(f.win);
    assert.equal(f.document.title, 'My deck');
    assert.equal(f.fetches.length, 1);
    assert.equal(f.fetches[0]!.url, '/api/open-artifact.artifacts.boot?id=art_1');
    assert.equal(f.fetches[0]!.init?.cache, 'no-store');
    assert.equal(f.fetches[0]!.init?.priority, 'high');
    assert.ok(f.fetches[0]!.init?.signal, 'it gives up after a while');
    assert.equal(takePrefetch(f.win, 'art_2'), null, 'not for another artifact');
    assert.equal(f.raw[PREFETCH_GLOBAL], undefined, 'and gone once looked at');
  });

  it('hands the request to the app that asks for the same artifact', async () => {
    const f = fakeWindow(pendingBoot);
    preboot(f.win);
    const taken = takePrefetch(f.win, 'art_1');
    assert.equal(taken?.url, bootAddress('art_1'));
    assert.ok(await taken!.res);
    assert.equal(takePrefetch(f.win, 'art_1'), null, 'once');
  });

  it('asks for nothing when the boot is finished or missing, and still names the tab and arms the watchdog', () => {
    const done = fakeWindow({ id: 'art_1', title: 'Done', type: 'design' });
    preboot(done.win);
    assert.equal(done.fetches.length, 0);
    assert.equal(done.document.title, 'Done');
    assert.equal(typeof done.watchdog().disarm, 'function');

    const none = fakeWindow(null);
    preboot(none.win);
    assert.equal(none.fetches.length, 0);
    assert.equal(none.document.title, 'Artifact');
    assert.equal(none.attributes.get(BAR_ATTRIBUTE), '48');
    assert.equal(typeof none.watchdog().disarm, 'function');
  });

  it('never throws', () => {
    assert.doesNotThrow(() => preboot({} as Window));
    assert.doesNotThrow(() => takeOver({} as Window));
  });

  it('records the first phase and exposes the phases as a read-only snapshot', () => {
    const f = fakeWindow(pendingBoot);
    preboot(f.win);
    preboot(f.win);
    assert.deepEqual(f.marks.map((m) => m.name), ['oa:preboot'], 'each phase once');
    const vitals = f.raw[VITALS_GLOBAL] as Record<string, number>;
    assert.deepEqual(vitals, { 'oa:preboot': 12.3 });
    assert.ok(Object.isFrozen(vitals));
    assert.notEqual(f.raw[VITALS_GLOBAL], vitals, 'a fresh snapshot on every read');
  });

  it('shows the error block when the bundle or its stylesheet fails to load, and disarm undoes it', () => {
    const f = fakeWindow(pendingBoot, { language: 'zh-CN' });
    preboot(f.win);
    f.dispatch('error', { tagName: 'IMG' });
    f.dispatch('error', { tagName: 'LINK', rel: 'icon' });
    assert.equal(f.error.hidden, true, 'an image or an icon is not the app');
    f.dispatch('error', { tagName: 'LINK', rel: 'stylesheet' });
    assert.equal(f.error.hidden, false);
    assert.equal(f.skeleton.hidden, true);
    assert.equal(f.watchdog().failed, true);
    assert.equal(f.error.message.textContent, '页面没能加载。');
    assert.equal(f.error.button.textContent, '重试');
    f.error.button.onclick!();
    assert.equal(f.reloads(), 1, 'Try again loads the page again');

    f.watchdog().disarm();
    assert.equal(f.error.hidden, true);
    assert.equal(f.skeleton.hidden, false);
    assert.equal(f.watchdog().failed, false);
    f.dispatch('error', { tagName: 'SCRIPT' });
    assert.equal(f.error.hidden, true, 'disarmed: it no longer listens');
  });

  it('shows the error block after the visible time runs out, not counting hidden time', () => {
    const f = fakeWindow(pendingBoot);
    preboot(f.win);
    f.document.visibilityState = 'hidden';
    f.tick(WATCHDOG_MS / 1000 + 5);
    assert.equal(f.error.hidden, true, 'a background tab waits');
    f.document.visibilityState = 'visible';
    f.tick(WATCHDOG_MS / 1000 - 1);
    assert.equal(f.error.hidden, true);
    f.tick(1);
    assert.equal(f.error.hidden, false);
    assert.equal(f.error.message.textContent, 'This page could not load.');
  });

  it('takeOver disarms the watchdog and removes the skeleton and the error block', () => {
    const f = fakeWindow(pendingBoot);
    preboot(f.win);
    assert.equal(f.attributes.get(BAR_ATTRIBUTE), '48');
    takeOver(f.win);
    assert.equal(f.skeleton.removed, true);
    assert.equal(f.error.removed, true);
    assert.equal(f.attributes.has(BAR_ATTRIBUTE), false);
    f.tick(WATCHDOG_MS / 1000);
    assert.equal(f.error.hidden, true, 'the watchdog stopped');
  });
});

describe('preboot helpers', () => {
  it('asks the Library API route artifacts.boot', () => {
    assert.equal(BOOT_ROUTE, `/api/open-artifact.${LIBRARY_ROUTES.boot}`);
    assert.equal(bootAddress('art_1'), '/api/open-artifact.artifacts.boot?id=art_1');
    assert.equal(bootAddress('art_1', true), '/api/open-artifact.artifacts.boot?id=art_1&fresh=1');
  });

  it("draws the skeleton's bar as the Shell draws its bar", () => {
    const at = 'http://127.0.0.1:4800/a/art_1';
    assert.equal(barHeight({ type: 'design' }, at, false), 48);
    assert.equal(barHeight({ type: 'docs' }, at, false), 40);
    assert.equal(barHeight(null, at, false), 48);
    assert.equal(barHeight({ type: 'design' }, `${at}?toolbar=0`, false), 0);
    assert.equal(barHeight({ type: 'slides' }, `${at}#view-inline`, true), 0);
    assert.equal(barHeight({ type: 'data' }, `${at}#view-inline`, true), 0);
    assert.equal(barHeight({ type: 'slides' }, `${at}#view-inline`, false), 48, 'inline only when framed');
    assert.equal(barHeight({ type: 'design' }, `${at}#view-inline`, true), 48);
  });

  it('keeps the boot placeholder in index.html exactly once, and out of the inlined script', () => {
    const placeholder = '/*__OPEN_ARTIFACT_BOOT__*/null';
    const html = readFileSync(new URL('../src/shell/index.html', import.meta.url), 'utf8');
    assert.equal(html.split(placeholder).length, 2);
    assert.ok(html.indexOf('<!--open-artifact:preboot-->') > html.indexOf(placeholder), 'the script runs after the boot is set');
    assert.ok(html.includes('id="oa-preboot"') && html.includes('id="oa-preboot-error"'));
    assert.ok(!readFileSync(new URL('../src/shell/preboot.ts', import.meta.url), 'utf8').includes(placeholder));
  });
});
