import type { SheetFrame, SheetWalkthrough, ShellConnection } from '@open-artifact/runtime';
import { hashForPage, pageFromHash, pageLink } from '@open-artifact/editor-kit';
import { isNonNullObject } from '../utils/objects.ts';

export type CopyLinkOutcome = null | 'refused' | 'noAnswer';

/** A sheet and the cells a link marks on it (A1 ranges, `A2:D2`, `B1`); a link to the sheet alone has none. */
export interface PlaceOfLink {
  sheetId: string;
  ranges: string[];
}

export interface SheetLinks {
  /** The place a link opened the page on, the first time this tab sees that link. */
  takePlaceOfNewLink(): PlaceOfLink | null;
  sheetOnShowIs(sheetId: string | null, byTab: boolean): void;
  copyLinkTo(sheetId: string): Promise<CopyLinkOutcome>;
  /** `onPlace` answers whether it could show the place. */
  onPlaceAskedFor(onPlace: ((place: PlaceOfLink) => boolean) | null): void;
}

/** One stop of a walkthrough: the cells it marks and what the page says beside them. */
export interface GuideStop {
  place: PlaceOfLink;
  words: string;
}

/** A walkthrough as the page hears it beside the stream's frames. */
export interface GuideOnStream {
  phase: 'guide';
  guide: SheetWalkthrough;
}

export type HeardOnStream = SheetFrame | GuideOnStream;

export interface GuideFromStream {
  heardOnStream(payload: HeardOnStream): void;
  /** Hands `listener` each walkthrough heard from now on, and first the kept one when it was this viewer's. */
  start(listener: (stops: GuideStop[], isRestored: boolean) => void): () => void;
  discard(): void;
}

export const SHEET_ANCHOR_PREFIX = 'sheet-';
export const ANCHOR_FRAGMENT_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
export const LINK_HANDED_STORAGE_KEY = 'sheets-link-handed';
/** The sheet this tab last put in its address: a reload on it is not a new link, so the kept place wins. */
export const SHEET_SAID_STORAGE_KEY = 'sheets-sheet-said';
export const ANCHOR_REPORT_DELAY_MS = 250;
export const sheetAnchorFragment = (sheetId: string): string => SHEET_ANCHOR_PREFIX + sheetId;
export const MAX_GUIDE_STOPS = 30;
export const MAX_GUIDE_STOP_LENGTH = 600;
export const GUIDE_STORAGE_KEY = 'sheets-guide';

export function placeOfAnchorFragment(fragment: unknown): PlaceOfLink | null {
  if (typeof fragment !== 'string' || !ANCHOR_FRAGMENT_PATTERN.test(fragment))
    return null;
  if (!fragment.startsWith(SHEET_ANCHOR_PREFIX)) return null;
  let [sheetId = '', ...ranges] = fragment.slice(SHEET_ANCHOR_PREFIX.length).split('~');
  return sheetId === ''
    ? null
    : {
        sheetId,
        ranges: ranges.map((range) => range.replaceAll('-', ':')),
      };
}

/**
 * The link in an address, as an anchor fragment: `#sheet-<sheetId>~A2-D2` as it is, and the page parameter
 * (`#page=<sheetId>~A2-D2`) with the prefix put before it.
 */
export function anchorFragmentOfHash(hash: string): string | null {
  const fragment = hash.replace(/^#/, '');
  if (fragment.startsWith(SHEET_ANCHOR_PREFIX) && fragment.length > SHEET_ANCHOR_PREFIX.length && !fragment.includes('='))
    return fragment;
  const page = pageFromHash(hash);
  return page === null ? null : sheetAnchorFragment(page);
}

export function createSheetAnchorLinks(win: Window, storage: () => Storage, shell: ShellConnection | null = null): SheetLinks {
  let showPlace: ((place: PlaceOfLink) => boolean) | null = null;
  let wasLinkHanded = false;
  let reportTimer: number | undefined;
  let copying = false;
  shell?.onCommand(command => {
    if (command.cmd !== 'goto_sheet') return;
    let place = placeOfAnchorFragment(sheetAnchorFragment(command.page));
    if (place === null || showPlace === null) return;
    showPlace(place);
    if (place.ranges.length > 0) shell?.currentSheetPage(command.page);
  });
  const readStored = (key: string): string | null => {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  };
  const writeStored = (key: string, value: string): void => {
    try {
      storage().setItem(key, value);
    } catch {}
  };
  const writeHash = (sheetId: string | null): void => {
    const hash = hashForPage(win.location.hash, sheetId);
    if (hash === win.location.hash || (hash === '' && win.location.hash === '')) return;
    try {
      win.history.replaceState(win.history.state, '', `${win.location.pathname}${win.location.search}${hash}`);
    } catch {}
  };
  win.addEventListener('hashchange', () => {
    let fragment = anchorFragmentOfHash(win.location.hash);
    if (fragment === null || !ANCHOR_FRAGMENT_PATTERN.test(fragment)) return;
    let place = placeOfAnchorFragment(fragment);
    let isShown = place !== null && showPlace?.(place) === true;
    wasLinkHanded = true;
    writeStored(LINK_HANDED_STORAGE_KEY, isShown ? fragment : '');
  });
  return {
    takePlaceOfNewLink() {
      if (wasLinkHanded) return null;
      const hashFragment = anchorFragmentOfHash(win.location.hash) ?? '';
      const fragment = ANCHOR_FRAGMENT_PATTERN.test(hashFragment) ? hashFragment : '';
      const wasSeenBefore = [LINK_HANDED_STORAGE_KEY, SHEET_SAID_STORAGE_KEY].some((key) => readStored(key) === fragment);
      writeStored(LINK_HANDED_STORAGE_KEY, fragment);
      return wasSeenBefore ? null : placeOfAnchorFragment(fragment);
    },
    sheetOnShowIs(sheetId) {
      win.clearTimeout(reportTimer);
      reportTimer = win.setTimeout(() => {
        if (sheetId !== null) writeStored(SHEET_SAID_STORAGE_KEY, sheetAnchorFragment(sheetId));
        writeHash(sheetId);
        shell?.currentSheetPage(sheetId);
      }, ANCHOR_REPORT_DELAY_MS);
    },
    async copyLinkTo(sheetId) {
      if (copying) return null;
      copying = true;
      try {
        if (shell) { shell.copySheetLink(sheetId); return null; }
        await win.navigator.clipboard.writeText(pageLink(win.location.href, sheetId));
        return null;
      } catch {
        return 'refused';
      } finally {
        copying = false;
      }
    },
    onPlaceAskedFor(onPlace) {
      showPlace = onPlace;
    },
  };
}

export function guideStopsOf(guide: unknown): GuideStop[] | null {
  let stops = isNonNullObject(guide)
    ? guide.stops
    : null;
  let parsed = (Array.isArray(stops) ? stops : [])
    .slice(0, MAX_GUIDE_STOPS)
    .flatMap((stop: unknown): GuideStop[] => {
      if (!isNonNullObject(stop)) return [];
      let { at, say } = stop;
      let place =
        typeof at === 'string'
          ? placeOfAnchorFragment(at.replace(/^#/, ''))
          : null;
      return place === null ||
        place.ranges.length === 0 ||
        typeof say !== 'string' ||
        say.trim() === ''
        ? []
        : [
            {
              place,
              words: Array.from(say.trim())
                .slice(0, MAX_GUIDE_STOP_LENGTH)
                .join(''),
            },
          ];
    });
  return parsed.length === 0 ? null : parsed;
}

export function createGuideFromStream(getStorage: () => Storage): GuideFromStream {
  let withStorage = <T>(act: (storage: Storage) => T): T | null => {
    try {
      return act(getStorage());
    } catch {
      return null;
    }
  };
  let viewer: string | null = null;
  let onGuide: ((stops: GuideStop[], isRestored: boolean) => void) | null = null;
  let heardOnStream = (payload: HeardOnStream): void => {
    viewer = (payload.phase === 'snapshot' ? payload.viewer.personId : null) ?? viewer;
    if (
      payload.phase !== 'guide'
    )
      return;
    let { guide } = payload;
    let stops = guideStopsOf(guide);
    if (stops === null) return;
    withStorage((storage) =>
      storage.setItem(
        GUIDE_STORAGE_KEY,
        JSON.stringify({
          viewer,
          guide,
        }),
      ),
    );
    onGuide?.(stops, false);
  };
  return {
    heardOnStream,
    start(listener) {
      onGuide = listener;
      let stored: unknown = withStorage((storage) =>
        JSON.parse(storage.getItem(GUIDE_STORAGE_KEY) ?? 'null'),
      );
      let stops =
        isNonNullObject(stored) &&
        viewer !== null &&
        stored.viewer === viewer
          ? guideStopsOf(stored.guide)
          : null;
      if (stops !== null) listener(stops, true);
      return () => {
        onGuide = null;
      };
    },
    discard() {
      withStorage((storage) =>
        storage.removeItem(GUIDE_STORAGE_KEY),
      );
    },
  };
}
