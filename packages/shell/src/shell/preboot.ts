/**
 * What the Shell page does before its bundle loads. `vite.config.ts` inlines {@link preboot} into `index.html` as a
 * classic script that runs right after the boot object (`window.__OPEN_ARTIFACT_BOOT__`):
 *
 * - the tab gets the artifact's title at once;
 * - a `pending` boot (the daemon answered before the page was open) has its finished boot asked for now, not once the
 *   bundle has loaded and run: the request is {@link PREFETCH_GLOBAL}, which `actions.ts` takes;
 * - a watchdog shows the page's static error block when the bundle or its stylesheet fails to load, or the app has not
 *   taken over after {@link WATCHDOG_MS} of visible time; the app calls {@link takeOver} once it has mounted;
 * - the load phases are `performance` marks, read back from {@link VITALS_GLOBAL}.
 *
 * It runs in every browser that opens a Shell, including a LAN guest's over plain http (no secure context), so it
 * assumes little and never throws. No imports but types: the build bundles this file on its own.
 */

import type { ShellBoot } from '@open-artifact/protocol';

/** Where the daemon (or a type server) puts the boot object. */
export const BOOT_GLOBAL = '__OPEN_ARTIFACT_BOOT__';
/** The finished boot's request, started by the inline script: a {@link BootPrefetch}. */
export const PREFETCH_GLOBAL = '__OPEN_ARTIFACT_BOOT_PREFETCH__';
/** The pre-boot watchdog: a {@link Watchdog}. */
export const WATCHDOG_GLOBAL = '__OPEN_ARTIFACT_WATCHDOG__';
/** The load phases so far, in ms since the navigation started: a read-only {@link Vitals} snapshot. */
export const VITALS_GLOBAL = '__OPEN_ARTIFACT_VITALS__';

/** `LIBRARY_ROUTES.boot` under the Library API (spelled out: this file imports no values). */
export const BOOT_ROUTE = '/api/open-artifact.artifacts.boot';
/** How long the finished boot may take: opening a page can start its type server (up to ~25 s). */
export const BOOT_TIMEOUT_MS = 30_000;
/** How long the page may stay without its app, counting only time the tab is visible. */
export const WATCHDOG_MS = 30_000;
const WATCHDOG_TICK_MS = 1_000;

/** Ids of the static elements in `index.html`. */
export const PREBOOT_IDS = { skeleton: 'oa-preboot', error: 'oa-preboot-error' } as const;
/** Attribute on `<html>` saying how tall the skeleton's bar is (`48`, `40` for Docs, `0` for none). */
export const BAR_ATTRIBUTE = 'data-oa-preboot-bar';

/** The Shell's load phases, in order. */
export const PHASES = ['oa:preboot', 'oa:boot', 'oa:frame-src', 'oa:frame-load', 'oa:frame-ready'] as const;
export type Phase = (typeof PHASES)[number];
export type Vitals = Readonly<Partial<Record<Phase, number>>>;

/** The finished boot's request. */
export interface BootPrefetch {
  url: string;
  res: Promise<Response>;
}

/** The pre-boot watchdog. */
export interface Watchdog {
  /** The app took over: stop watching and hide the error block if it showed. */
  disarm(): void;
  /** The error block shows. */
  readonly failed: boolean;
}

/** The window as this file uses it, with the Shell's globals. */
type PrebootWindow = Window & {
  [BOOT_GLOBAL]?: ShellBoot | null;
  [PREFETCH_GLOBAL]?: BootPrefetch;
  [WATCHDOG_GLOBAL]?: Watchdog;
};

/** The address of the finished boot; `fresh` opens the page again instead of taking the open the page started. */
export function bootAddress(id: string, fresh = false): string {
  return `${BOOT_ROUTE}?${new URLSearchParams(fresh ? { id, fresh: '1' } : { id })}`;
}

/**
 * The skeleton's bar height for a boot, as the Shell draws its bar: none with `?toolbar=0` or in a deck's or
 * dashboard's inline view (`inlineView` in `model.ts`), 40 px for Docs, else 48 px.
 */
export function barHeight(boot: Pick<ShellBoot, 'type'> | null | undefined, href: string, embedded: boolean): number {
  try {
    const url = new URL(href);
    if (url.searchParams.get('toolbar') === '0') return 0;
    if (embedded && (boot?.type === 'slides' || boot?.type === 'data') && url.hash === '#view-inline') return 0;
  } catch {
    /* an address we cannot read: the usual bar */
  }
  return boot?.type === 'docs' ? 40 : 48;
}

/** Records a phase once (the first load is what it measures). */
export function mark(win: Pick<Window, 'performance'>, phase: Phase): void {
  try {
    const perf = win.performance;
    if (perf && typeof perf.mark === 'function' && !perf.getEntriesByName(phase, 'mark').length) perf.mark(phase);
  } catch {
    /* no User Timing */
  }
}

/** The phases recorded so far, in ms since the navigation started. */
export function vitalsOf(perf: Pick<Performance, 'getEntriesByName'> | undefined): Vitals {
  const out: Partial<Record<Phase, number>> = {};
  try {
    for (const phase of PHASES) {
      const entry = perf?.getEntriesByName(phase, 'mark')[0];
      if (entry) out[phase] = Math.round(entry.startTime * 10) / 10;
    }
  } catch {
    /* no User Timing */
  }
  return Object.freeze(out);
}

/** Defines {@link VITALS_GLOBAL} (once): a getter, so every read is a fresh, frozen snapshot. */
export function installVitals(win: Window): void {
  try {
    if (Object.getOwnPropertyDescriptor(win, VITALS_GLOBAL)) return;
    Object.defineProperty(win, VITALS_GLOBAL, { configurable: true, enumerable: false, get: () => vitalsOf(win.performance) });
  } catch {
    /* a frozen window: no vitals */
  }
}

/**
 * Runs a spinner's CSS animation on the document's clock, so the skeleton's, the stage's and the frame cover's
 * spinners turn as one when one replaces the other.
 */
export function alignSpin(element: Element | null): void {
  try {
    for (const animation of element?.getAnimations?.() ?? []) animation.startTime = 0;
  } catch {
    /* no Web Animations: each spinner starts on its own */
  }
}

/** Asks for the finished boot now; the app takes the request ({@link takePrefetch}). */
function prefetch(win: PrebootWindow, id: string): void {
  if (typeof win.fetch !== 'function') return;
  const url = bootAddress(id);
  const init: RequestInit = { cache: 'no-store', credentials: 'same-origin', priority: 'high' };
  if (typeof AbortController === 'function') {
    const abort = new AbortController();
    win.setTimeout(() => abort.abort(), BOOT_TIMEOUT_MS);
    init.signal = abort.signal;
  }
  const res = win.fetch(url, init);
  // Taken by the app, which asks again when this failed; never an unhandled rejection meanwhile.
  res.catch(() => undefined);
  win[PREFETCH_GLOBAL] = { url, res };
}

/** The finished boot's request the inline script started for `id`, once; `null` when there is none. */
export function takePrefetch(win: Window, id: string): BootPrefetch | null {
  const w = win as PrebootWindow;
  const have = w[PREFETCH_GLOBAL];
  if (!have) return null;
  delete w[PREFETCH_GLOBAL];
  return have.url === bootAddress(id) && have.res && typeof have.res.then === 'function' ? have : null;
}

/** What failed to load is the app itself: a script, its stylesheet or a preloaded module. */
function isAppAsset(target: EventTarget | null): boolean {
  const element = target as { tagName?: unknown; rel?: unknown } | null;
  const tag = typeof element?.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'SCRIPT') return true;
  return tag === 'LINK' && /(^|\s)(stylesheet|modulepreload)(\s|$)/i.test(String(element?.rel ?? ''));
}

const ERROR_TEXT = {
  en: { message: 'This page could not load.', retry: 'Try again' },
  zh: { message: '页面没能加载。', retry: '重试' },
};

/** Shows the static error block in place of the skeleton. */
function showError(win: Window): void {
  const doc = win.document;
  const skeleton = doc.getElementById(PREBOOT_IDS.skeleton);
  const block = doc.getElementById(PREBOOT_IDS.error);
  if (!block) return;
  const text = /^zh\b/i.test(String(win.navigator?.language ?? '')) ? ERROR_TEXT.zh : ERROR_TEXT.en;
  const message = block.querySelector('p');
  const button = block.querySelector('button');
  if (message) message.textContent = text.message;
  if (button) {
    button.textContent = text.retry;
    button.onclick = () => win.location.reload();
  }
  if (skeleton) skeleton.hidden = true;
  block.hidden = false;
}

/** Arms the watchdog ({@link WATCHDOG_GLOBAL}). */
function arm(win: PrebootWindow): void {
  let failed = false;
  let done = false;
  let visibleMs = 0;
  const fail = (): void => {
    if (done || failed) return;
    failed = true;
    showError(win);
  };
  const onError = (event: Event): void => {
    if (isAppAsset(event.target)) fail();
  };
  win.addEventListener('error', onError, true);
  const timer = win.setInterval(() => {
    if (win.document.visibilityState === 'hidden') return;
    visibleMs += WATCHDOG_TICK_MS;
    if (visibleMs >= WATCHDOG_MS) fail();
  }, WATCHDOG_TICK_MS);
  win[WATCHDOG_GLOBAL] = {
    get failed() {
      return failed;
    },
    disarm() {
      if (done) return;
      done = true;
      win.removeEventListener('error', onError, true);
      win.clearInterval(timer);
      if (!failed) return;
      failed = false;
      const block = win.document.getElementById(PREBOOT_IDS.error);
      if (block) block.hidden = true;
      const skeleton = win.document.getElementById(PREBOOT_IDS.skeleton);
      if (skeleton) skeleton.hidden = false;
    },
  };
}

/** The inline script: title, the finished boot's request, the watchdog, the first mark. Never throws. */
export function preboot(win: Window): void {
  const w = win as PrebootWindow;
  try {
    mark(w, 'oa:preboot');
    installVitals(w);
    const boot = w[BOOT_GLOBAL] ?? null;
    if (boot && typeof boot.title === 'string' && boot.title) w.document.title = boot.title;
    let embedded = false;
    try {
      embedded = w.parent !== w;
    } catch {
      embedded = true;
    }
    w.document.documentElement?.setAttribute(BAR_ATTRIBUTE, String(barHeight(boot, w.location.href, embedded)));
    if (boot?.pending && typeof boot.id === 'string') prefetch(w, boot.id);
    arm(w);
    w.document.addEventListener('DOMContentLoaded', () => alignSpin(w.document.querySelector(`#${PREBOOT_IDS.skeleton} svg`)));
  } catch {
    /* the app starts without it */
  }
}

/** The app has mounted: disarms the watchdog and removes the skeleton and the error block. */
export function takeOver(win: Window): void {
  try {
    (win as PrebootWindow)[WATCHDOG_GLOBAL]?.disarm();
    for (const id of Object.values(PREBOOT_IDS)) win.document.getElementById(id)?.remove();
    win.document.documentElement?.removeAttribute(BAR_ATTRIBUTE);
  } catch {
    /* nothing to take over */
  }
}
