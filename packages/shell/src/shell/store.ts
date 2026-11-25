/**
 * The Shell's store: the boot, what the library and the page report, the
 * host, and which of the bar's panels are open. Network calls live in
 * `actions.ts`; postMessage traffic in `bridge.ts`.
 */

import { create } from 'zustand';
import type { ArtifactDetail, ArtifactView, ChromeExportItem, ChromeReport, ShareView, ShellBoot } from '@open-artifact/protocol';
import type { DataPublishInfo } from '../lib/api.ts';
import type { CloudInfo, ConnectStart, RemoteInfo } from '../lib/publish.ts';
import { hasExportTab, normalizeReport, type HostInfo, type SentMessage } from './model.ts';

/** Which tab of the Share panel shows. */
export type ShareTab = 'share' | 'export';

type RememberedChrome = Pick<ChromeReport, 'history' | 'comments'>;

function rememberSlots(report: ChromeReport, previous: RememberedChrome): RememberedChrome {
  const waiting = report.ready === false;
  const history = (report.history ?? (waiting && previous.history)) || undefined;
  const comments = report.comments;
  let slot = waiting && !comments ? previous.comments : undefined;
  if (comments?.available === true && comments.pageButton === false) {
    const count = Number.isFinite(comments.count) ? Math.max(0, Math.floor(comments.count)) : 0;
    slot = previous.comments?.count === count ? previous.comments
      : { available: true, pageButton: false, count, on: false, open: false };
  }
  if (history === previous.history && slot === previous.comments) return previous;
  return { ...(history && { history }), ...(slot && { comments: slot }) };
}

function restoreSlots(id: string): RememberedChrome {
  try {
    return rememberSlots(normalizeReport(JSON.parse(sessionStorage.getItem(`oa-shell-chrome:${id}`) ?? 'null')), {});
  } catch {
    return {};
  }
}

/** The Share panel's data. */
export interface ShareState {
  /** The sharing state, once loaded. */
  view: ShareView | null;
  /** The type cannot share (`409 unsupported`). */
  unsupported: boolean;
  /** The last failure, shown in the panel. */
  error: string;
  /** The page's export items; `null` while loading. */
  exports: ChromeExportItem[] | null;
  /** Which copy button shows "Copied" for a moment. */
  copied: string | null;
}

/** Connecting a site to publish to, step by step (the Share panel's "Connect a site…" form). */
export type ConnectStep =
  | { step: 'closed' }
  | { step: 'form'; host: string; name: string; error: string }
  | { step: 'starting'; host: string; name: string }
  | { step: 'code'; start: ConnectStart }
  | { step: 'done'; host: string; user: string }
  | { step: 'failed'; host: string; name: string; error: string };

/** Publishing to the web: the daemon's sites and what this artifact does there. */
export interface PublishState {
  /** `GET remotes`; `null` until loaded. */
  remotes: RemoteInfo[] | null;
  /** `GET remotes`'s `cloud` (the default site, publishing by itself); `null` until loaded or from an older daemon. */
  cloud: CloudInfo | null;
  /** The daemon has no publishing (an older daemon): the panel leaves the section out. */
  missing: boolean;
  connect: ConnectStep;
  /** What runs now: `publish:<remote>`, `unpublish` or `cloud` (a change of the default site or publishing by itself). */
  busy: string | null;
  /** The last publish or unpublish failure, in plain words. */
  error: string;
  /** A Data dashboard's live data on its site (`artifacts.data`); `null` for other types or until read. */
  data: DataPublishInfo | null;
}

/** State of the Shell. */
export interface ShellState {
  /** What the daemon injected; `null` until known. */
  boot: ShellBoot | null;
  /** Set when no boot could be had. */
  bootError: string | null;
  /** Counts boots set: a new one is a new frame, even at the same address. */
  bootGen: number;
  /** The problem state offers to try again (the boot request failed, or the frame was refused). */
  canRetry: boolean;
  /** The page in the frame said it is ready (or its `load` stands for that): the cover over it goes. */
  pageReady: boolean;
  /** The artifact as the library has it (owner status, pinned, size). */
  artifact: ArtifactDetail | null;
  /** What the page reports (chrome protocol). */
  report: ChromeReport;
  rememberedChrome: RememberedChrome;
  /** The embedding host, once it said hello. */
  host: HostInfo | null;
  /** Every artifact, for Switch artifact; `null` until loaded or after a change. */
  library: ArtifactView[] | null;
  /** The whole bar is hidden (`?toolbar=0`). */
  barHidden: boolean;
  /** The artifact menu is open. */
  menuOpen: boolean;
  /** The Share panel is open. */
  shareOpen: boolean;
  shareTab: ShareTab;
  /**
   * The Export tab was asked for before the page reported its formats: the
   * panel shows it as soon as they come (until it closes or the tab changes).
   */
  exportWanted: boolean;
  share: ShareState;
  publish: PublishState;
  /** The "Ask agent" pane is open. */
  askOpen: boolean;
  /** Messages sent from the ask pane. */
  sent: SentMessage[];
  /** The ask pane's status line. */
  askStatus: string;
  /** The title is being renamed in place. */
  renaming: boolean;
  /** The delete confirmation is open. */
  confirmingDelete: boolean;
}

/** Changes to the Shell's state. */
export interface ShellActions {
  /** Sets the boot (a new frame); `canRetry` offers to try again from its problem state. */
  setBoot(boot: ShellBoot | null, error?: string | null, canRetry?: boolean): void;
  setPageReady(ready: boolean): void;
  setArtifact(artifact: ArtifactDetail | null): void;
  /** Merges a library answer (e.g. after `artifacts.update`) into the artifact. */
  mergeArtifact(patch: Partial<ArtifactDetail>): void;
  setReport(report: ChromeReport): void;
  setFrameLoading(): void;
  setHost(host: HostInfo): void;
  setLibrary(library: ArtifactView[] | null): void;
  setBarHidden(hidden: boolean): void;
  setMenuOpen(open: boolean): void;
  /**
   * Opens the Share panel on a tab (Export only when it has rows: the
   * page's exports, or the folder's zip).
   * With `wait`, an Export tab the page has not reported formats for yet
   * shows once it does.
   */
  openShare(tab: ShareTab, options?: { wait?: boolean }): void;
  closeShare(): void;
  setShareTab(tab: ShareTab): void;
  patchShare(patch: Partial<ShareState>): void;
  patchPublish(patch: Partial<PublishState>): void;
  setAskOpen(open: boolean): void;
  setSent(sent: SentMessage[]): void;
  setAskStatus(status: string): void;
  setRenaming(renaming: boolean): void;
  setConfirmingDelete(open: boolean): void;
  /** Closes every popup (a press went into the page's frame). */
  closePopups(): void;
}

const EMPTY_SHARE: ShareState = { view: null, unsupported: false, error: '', exports: null, copied: null };
const EMPTY_PUBLISH: PublishState = { remotes: null, cloud: null, missing: false, connect: { step: 'closed' }, busy: null, error: '', data: null };

/** The Shell's store. */
export const useShell = create<ShellState & ShellActions>()((set, get) => ({
  boot: null,
  bootError: null,
  bootGen: 0,
  canRetry: false,
  pageReady: false,
  artifact: null,
  report: {},
  rememberedChrome: {},
  host: null,
  library: null,
  barHidden: false,
  menuOpen: false,
  shareOpen: false,
  shareTab: 'share',
  exportWanted: false,
  share: EMPTY_SHARE,
  publish: EMPTY_PUBLISH,
  askOpen: false,
  sent: [],
  askStatus: '',
  renaming: false,
  confirmingDelete: false,

  setBoot: (boot, error = null, canRetry = false) => set((state) => ({
    boot, bootError: error, canRetry, bootGen: state.bootGen + 1,
    pageReady: !boot?.pending && (!boot?.page || !!boot.empty || !!boot.problem),
    report: {}, rememberedChrome: boot && (boot.pending || (boot.page && !boot.empty && !boot.problem)) ? restoreSlots(boot.id) : {},
  })),
  setFrameLoading: () => set({ report: {}, pageReady: false }),
  setPageReady: (pageReady) => set({ pageReady }),
  setArtifact: (artifact) => set({ artifact }),
  mergeArtifact: (patch) => {
    const current = get().artifact;
    if (current) set({ artifact: { ...current, ...patch } });
  },
  setReport: (report) => set((state) => {
    const rememberedChrome = rememberSlots(report, state.rememberedChrome);
    if (state.boot && rememberedChrome !== state.rememberedChrome) {
      try {
        const key = `oa-shell-chrome:${state.boot.id}`;
        if (rememberedChrome.history || rememberedChrome.comments) sessionStorage.setItem(key, JSON.stringify(rememberedChrome));
        else sessionStorage.removeItem(key);
      } catch { /* Storage-restricted tabs keep these slots in memory. */ }
    }
    return {
      report, rememberedChrome,
      ...(state.exportWanted && state.shareOpen && hasExportTab(report) && { shareTab: 'export', exportWanted: false }),
    };
  }),
  setHost: (host) => set({ host }),
  setLibrary: (library) => set({ library }),
  setBarHidden: (barHidden) => set({ barHidden }),
  setMenuOpen: (menuOpen) => set(menuOpen ? { menuOpen, shareOpen: false } : { menuOpen }),
  openShare: (tab, options) =>
    set((state) => {
      const exportNow = tab === 'export' && hasExportTab(state.report);
      return {
        shareOpen: true,
        menuOpen: false,
        shareTab: exportNow ? 'export' : 'share',
        exportWanted: tab === 'export' && !exportNow && !!options?.wait,
        share: state.shareOpen ? state.share : { ...EMPTY_SHARE, view: state.share.view, unsupported: state.share.unsupported },
      };
    }),
  closeShare: () => set({ shareOpen: false, exportWanted: false }),
  setShareTab: (tab) => set((state) => ({ shareTab: tab === 'export' && !hasExportTab(state.report) ? 'share' : tab, exportWanted: false })),
  patchShare: (patch) => set((state) => ({ share: { ...state.share, ...patch } })),
  patchPublish: (patch) => set((state) => ({ publish: { ...state.publish, ...patch } })),
  setAskOpen: (askOpen) => set({ askOpen }),
  setSent: (sent) => set({ sent }),
  setAskStatus: (askStatus) => set({ askStatus }),
  setRenaming: (renaming) => set({ renaming, menuOpen: false }),
  setConfirmingDelete: (confirmingDelete) => set({ confirmingDelete }),
  closePopups: () => set({ menuOpen: false, shareOpen: false, exportWanted: false }),
}));

/** The boot, for components that render only once it is known. */
export function useBoot(): ShellBoot {
  const boot = useShell((state) => state.boot);
  if (!boot) throw new Error('The Shell rendered before its boot.');
  return boot;
}
