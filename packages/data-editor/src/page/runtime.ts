import { create } from 'zustand';
import type { CalculationReport, DashboardFile, Dataset, DatasetRun, SourceAddress, Table } from '@open-artifact/data-core';
import {
  DASHBOARD_ENTRY_FILENAME,
  MAX_LOOK_CHARTS,
  dashChartToken,
  hasCellAddress,
  isValidDatasetId,
  parseParameters,
  readSourceAddress,
} from '@open-artifact/data-core';
import type { DataEngine, PageDataResult } from '../data/engine.ts';
import { getDatasetLoadKey } from '../data/query-store.ts';
import { applyPageLanguage } from '../platform/color-scheme.ts';
import { isInlineViewLink, showPageLink } from '../platform/inline-view.ts';
import { sessionPageCapabilities, type PageCapabilities } from './capabilities.ts';
import { createMutableD3Namespace, type DashboardD3 } from './d3.ts';
import { createPageDrawings, toDrawSpec, type PageDrawings } from './draw.ts';
import {
  DRAW_ARGUMENTS_MESSAGE,
  LOADER_ARGUMENTS_MESSAGE,
  NO_ENTRY_FILE_MESSAGE,
  ON_DATA_CALLBACK_NAME,
  REMOVED_HELPERS_MESSAGE,
  createPageFaultTracker,
  describeErrorMessage,
  describeMountFailure,
  describePageStop,
  getDashboardSourceUrl,
  type PageFault,
  type PageFaultTracker,
} from './faults.ts';
import { EMPTY_VALUE_PATTERN, MAX_MARK_NUMBER_CHARACTERS, getLocaleCompactMultipliers, truncateRawText } from './numbers.ts';
import {
  isReparseStable,
  matchDraftTwins,
  parseDashboardFilesToPage,
  serializeNodeHtml,
  type PageKeptMarkup,
  type PageScript,
} from './parse.ts';
import { rootPageState, runSourceState, strongestMarkState, type PageSourceState } from './source-state.ts';
import { renderShownPageHtml, isVisibleForExport, isVisibleIgnoringOpacity, type ShownPage } from './shown-page.ts';
import {
  DERIVED_SOURCE_ATTRIBUTE,
  MARK_SOURCE_ATTRIBUTE,
  MAX_REPORTED_MARKS,
  findSourceMarkIssue,
  getMarkedSourceIds,
  getSourceTable,
  getUnderlyingSources,
  type SourceCalculationState,
  type SourceMarkIssue,
} from './sources.ts';
import {
  NO_ONE_WRITER_GUARD,
  createOneWriterGuard,
  derivePageTableSources,
  findLabelFaults,
  findOutputFaults,
  type DrawingFault,
  type OneWriterGuard,
  type OutputFault,
} from './validation.ts';

export const DASHBOARD_ROOT_ID = 'dash-root';
/** The page's language when `dash/meta.lang` is unset. */
export const DASHBOARD_ROOT_LANGUAGE = 'en';
export const SOURCE_STATE_ATTRIBUTE = 'data-dash-source-state';
export const PAGE_STATE_ATTRIBUTE = 'data-dash-state';
export const ONE_WRITER_ATTRIBUTE = 'data-dash-one-writer';
export const FETCH_PRIORITY_ATTRIBUTE = 'data-fetchpriority';
export const LOADING_SPELL_DELAY_MS = 500;

export type { PageSourceState } from './source-state.ts';

/** The sources the page uses: read through `dash.data` or marked, and which of them are only one or the other. */
export interface PageSourceUsage {
  datasets: string[];
  /** Read but not marked anywhere on the page (nor the inputs of a calculation that failed). */
  unmarked: string[];
  /** Marked but never read. */
  unread: string[];
  /** Under `data-fetchpriority="high"` / `"low"`. */
  high?: string[];
  low?: string[];
  /** Marked only under `[hidden]`: loaded after the rest. */
  hidden?: string[];
}

export interface PageMarkInspection {
  first: SourceMarkIssue[];
  total: number;
}

/** What the inspector shows for one source mark: its address, the text shown and whether the runtime derived it. */
export interface PageSourceFocus {
  address: SourceAddress;
  shown: string;
  scaled?: true;
}

export interface DashboardReadyState {
  /** The mounted files array (by identity). */
  page: readonly DashboardFile[] | null;
  /** Mount count; the reads must be the same mount's. */
  pages: number;
  reads: { page: number; datasets: ReadonlySet<string> } | null;
  datasets: readonly Dataset[];
  status(id: string): DatasetRun['status'];
}

/** A one-shot gate: later `begin` calls share the first promise. */
export interface DashboardReadyGate {
  begin(page: DashboardReadyState['page']): Promise<void>;
  check(state: DashboardReadyState): void;
  stop(): void;
}

const AWAITED_KINDS: ReadonlySet<Dataset['source']['kind']> = new Set(['query', 'file', 'store']);

/** The query, file and saved-row sources among the page's reads have all finished. */
export function areRequestedSourcesSettled(state: DashboardReadyState, reads: ReadonlySet<string>): boolean {
  return state.datasets.every((dataset) => {
    if (!reads.has(dataset.id) || !AWAITED_KINDS.has(dataset.source.kind)) return true;
    const status = state.status(dataset.id);
    return status !== 'idle' && status !== 'running';
  });
}

export function createDashboardReadyGate(): DashboardReadyGate {
  let resolve: () => void = () => undefined;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  let requested: DashboardReadyState['page'] = null;
  let seen = false;
  let current: DashboardReadyState | null = null;
  const check = (state: DashboardReadyState): void => {
    current = state;
    if (requested !== null && state.page === requested) seen = true;
    if (seen && state.reads !== null && state.reads.page === state.pages && areRequestedSourcesSettled(state, state.reads.datasets))
      resolve();
  };
  return {
    begin(page) {
      requested = page;
      if (current !== null) check(current);
      return ready;
    },
    check,
    stop: () => resolve(),
  };
}

const dashboardReadyGate = createDashboardReadyGate();

/** Resolves once the page showing `files` has drawn with the sources it read settled (or could not be shown). */
export function waitForDashboardReady(files: readonly DashboardFile[] | null): Promise<void> {
  return dashboardReadyGate.begin(files);
}

/**
 * The page's n-th chart color (1-based): the look's first MAX_LOOK_CHARTS cycle; beyond them, the look's own
 * `--dash-chart-<n>` when it defines one, else the cycled color.
 */
export function getPageChartColor(n: number): string {
  const base = `var(${dashChartToken(((n - 1) % MAX_LOOK_CHARTS) + 1)})`;
  return n <= MAX_LOOK_CHARTS ? base : `var(${dashChartToken(n)}, ${base})`;
}

/** `dash.colors`: as many chart colors as the look has. */
export function getPageChartColors(count: number): string[] {
  return Array.from({ length: count }, (_, index) => getPageChartColor(index + 1));
}

/** The `data-fetchpriority` (trimmed, lower-cased) on the mark or its nearest holder inside `root`, else "". */
export function getMarkFetchPriority(root: Element, element: Element): string {
  const holder = element.closest(`[${FETCH_PRIORITY_ATTRIBUTE}]`);
  return holder !== null && root.contains(holder) ? (holder.getAttribute(FETCH_PRIORITY_ATTRIBUTE) ?? '').trim().toLowerCase() : '';
}

function getElementSelectorPart(element: Element): string {
  const name = element.localName + (element.classList.length > 0 ? `.${String(element.classList[0])}` : '');
  const same = [...(element.parentElement?.children ?? [])].filter((sibling) => sibling.localName === element.localName);
  return same.length > 1 ? `${name}:nth-of-type(${String(same.indexOf(element) + 1)})` : name;
}

/** A short selector for an element under `root`: up to four steps, stopping at an id. */
export function describeElementSelector(element: Element, root: Element): string {
  const parts: string[] = [];
  for (let at: Element | null = element; at !== null && at !== root && parts.length < 4; at = at.parentElement) {
    parts.unshift(at.id !== '' ? `#${at.id}` : getElementSelectorPart(at));
    if (at.id !== '') break;
  }
  return truncateRawText(parts.join(' > '), 96);
}

/** The page's `dash` object. */
export interface DashApi {
  data(id: string): PageDataResult;
  onData(callback: unknown): void;
  draw(name: unknown, spec?: unknown): void;
  calc(id: unknown, spec: unknown): void;
  loader(id: unknown, spec: unknown): void;
  colors: string[];
  refresh(id: unknown): void;
  params(): ReturnType<DataEngine['params']>;
  setParams(values: unknown): void;
  resetParams(): void;
  setLink(fragment: unknown): void;
}

declare global {
  interface Window {
    dash?: DashApi;
    d3?: DashboardD3;
  }
}

const throwRemovedHelper = (): never => {
  throw new Error(REMOVED_HELPERS_MESSAGE);
};
/** Calling it, or reading any property of it (`dash.scale.linear`), throws. */
const REMOVED_HELPER: unknown = new Proxy(throwRemovedHelper, { get: throwRemovedHelper });

function runPageScript(
  script: PageScript,
  dash: DashApi,
  capabilities: PageCapabilities,
  failed: (file: string, error: unknown) => void,
): void {
  const text = `${script.text}\n//# sourceURL=${getDashboardSourceUrl(script.file)}`;
  try {
    // Page scripts are the author's own code, run as plain scripts with `dash` and `openartifact` in scope.
    Function('dash', 'openartifact', `(function () {${text}\n}).call(this);`)(dash, capabilities);
  } catch (error) {
    failed(script.file, error);
  }
}

const writeOptionalAttribute = (element: Element, name: string, value: string | undefined): void => {
  if (value === undefined) element.removeAttribute(name);
  else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

/** What the mounted page shows and found, for the panels and reports around it. */
export interface PageSnapshot {
  /** Mount count (a remount starts a new page). */
  n: number;
  files: readonly DashboardFile[] | null;
  /** The notes under the page: code that stopped, a missing entry file. */
  stops: readonly string[];
  /** The page's code stopped since it mounted. */
  broke: boolean;
  faults: readonly PageFault[];
  drawingFaults: readonly DrawingFault[];
  marks: readonly SourceMarkIssue[];
  flagged: number;
  usage: PageSourceUsage | null;
  oneWriter: boolean;
}

export interface PageMountOptions {
  files: readonly DashboardFile[];
  engine: DataEngine;
  /** `dash/meta.lang`. */
  lang?: string | null;
  /** How many chart colors `dash.colors` offers (the applied look's). */
  colors?: number;
  /** Edit mode: the stored markup is kept beside the mounted copy and the page is marked `translate="no"`. */
  editing?: boolean;
  /** `dash.setLink(fragment)`. */
  onLink?: (fragment: string) => void;
  /** What `openartifact.use` gives the page's scripts (the session's, narrowed for a page, when left out). */
  capabilities?: PageCapabilities;
}

export interface PageUpdate {
  files?: readonly DashboardFile[];
  lang?: string | null;
  colors?: number;
  editing?: boolean;
  /** New files that are what the mounted page already shows (an edit saved): no remount. */
  adopt?: boolean;
}

export interface PageHandle {
  readonly root: HTMLElement;
  snapshot(): PageSnapshot;
  /** Hears every change of the snapshot or the page's DOM state. */
  subscribe(listener: () => void): () => void;
  update(update: PageUpdate): void;
  /** Runs the `dash.onData` callbacks and drawings again on the next frame. */
  redraw(): void;
  redrawPending(): boolean;
  /** Ends the drawings and the one-writer guard (they start again on the next mount). */
  stopDrawings(): void;
  /** Output faults a reader would see; null while a redraw is due or a source the page read isn't in yet. */
  checkOutput(): OutputFault[] | null;
  /** The page as it shows, for the agent; null while it can't be read. */
  shownPage(): ShownPage | null;
  /** The mark → source lookup the inspector and the "Ask the agent" selection use. */
  inspect(element: Element, dataset?: string): PageSourceFocus | null;
  isKnownSource(id: string): boolean;
  /** Edit mode: the stored markup paired with the mounted page (null when the page can't be edited by hand). */
  kept(): PageKeptMarkup | null;
  /** Edit mode: keeps the stored markup when the mounted page still matches it; false when it has to be mounted again. */
  ensureKept(): boolean;
  /** The stored markup as it would be saved, or null without kept markup. */
  storedHtml(): string | null;
  setEditing(editing: boolean): void;
  dispose(): void;
}

interface MountedPage {
  n: number;
  files: readonly DashboardFile[];
  draws: (() => void)[];
  asked: string[];
  marked: Set<string>;
  unheld: Set<string>;
  stops: string[];
  broke: boolean;
  faults: PageFaultTracker;
  drawings: PageDrawings;
  guard: OneWriterGuard;
  kept: PageKeptMarkup | null;
  colors: number;
  spell: { shown: boolean } | null;
  dash: DashApi;
  d3: DashboardD3;
  current: boolean;
}

/** The mounted page (one at a time) and a version that moves with every change, for components and other modules. */
export interface PageRuntimeState {
  page: PageHandle | null;
  version: number;
}

export const usePageRuntime = create<PageRuntimeState>(() => ({ page: null, version: 0 }));

let mountCount = 0;

/** The mounted page, or null. */
export function currentPage(): PageHandle | null {
  return usePageRuntime.getState().page;
}

/**
 * Mounts the dashboard's files into `root` (`#dash-root`): sanitizes and inserts `index.html`, loads its `files/*.css`
 * and `*.js`, installs `window.dash` and `window.d3`, runs the scripts in order, then keeps the drawings, the source
 * marks' states, the root's state and the source reads in step with the data.
 */
export function mountDashboardPage(root: HTMLElement, options: PageMountOptions): PageHandle {
  const engine = options.engine;
  const capabilities = options.capabilities ?? sessionPageCapabilities((documents) => engine.rereadSaved(documents));
  const listeners = new Set<() => void>();
  const sourceStateElements = new Set<Element>();
  let onLink = options.onLink;
  let colors = options.colors ?? MAX_LOOK_CHARTS;
  let editing = options.editing === true;
  let disposed = false;
  let redrawFrame: number | null = null;
  let checksQueued = false;
  let version = 0;
  let checkedVersion = -1;
  let usageKey = '';
  let reads: DashboardReadyState['reads'] = null;
  let savedTranslate: { translate: string | null } | null = null;
  let snapshot: PageSnapshot = {
    n: 0,
    files: null,
    stops: [],
    broke: false,
    faults: [],
    drawingFaults: [],
    marks: [],
    flagged: 0,
    usage: null,
    oneWriter: false,
  };
  let page: MountedPage | null = null;

  const publish = (next: Partial<PageSnapshot>): void => {
    snapshot = { ...snapshot, ...next };
  };

  const notify = (): void => {
    if (disposed) return;
    version++;
    for (const listener of [...listeners]) listener();
    if (usePageRuntime.getState().page === handle) usePageRuntime.setState((state) => ({ version: state.version + 1 }));
    queueChecks();
  };

  const calcStates = (): Map<string, SourceCalculationState> => {
    const calcs = new Map<string, SourceCalculationState>();
    for (const dataset of engine.datasets())
      if (dataset.source.kind === 'calc')
        calcs.set(dataset.id, { inputs: dataset.source.inputs, status: dataset.source.status, value: dataset.source.result });
    return calcs;
  };
  const baseDataset = (id: string): Dataset | undefined => {
    const dataset = engine.getDataset(id);
    return dataset === undefined || dataset.source.kind === 'calc' ? undefined : dataset;
  };
  const underOf = (id: string): string[] | undefined => getUnderlyingSources(id, calcStates());
  const isKnownSource = (id: string): boolean => engine.getDataset(id) !== undefined;
  const isDataOnlyMark = (address: SourceAddress): boolean => baseDataset(address.source) !== undefined && !hasCellAddress(address);

  const resolutionContext = (): { tables: Map<string, Table | null>; calcs: Map<string, SourceCalculationState> } => {
    const tables = new Map<string, Table | null>();
    for (const dataset of engine.datasets()) if (dataset.source.kind !== 'calc') tables.set(dataset.id, engine.getTable(dataset.id));
    return { tables, calcs: calcStates() };
  };

  const datasetState = (dataset: Dataset): PageSourceState | undefined => {
    if (dataset.source.kind === 'unsupported') return 'error';
    const run = engine.getRun(dataset.id);
    return runSourceState(run, run.status === 'idle' && getDatasetLoadKey(dataset) !== '');
  };
  const underlyingDatasets = (id: string): Dataset[] => (underOf(id) ?? [id]).flatMap((source) => baseDataset(source) ?? []);
  const sourceStates = (id: string): (PageSourceState | undefined)[] => {
    const calc = engine.getDataset(id);
    return [
      calc?.source.kind === 'calc' && calc.source.status === 'error' ? 'error' : undefined,
      ...underlyingDatasets(id).map(datasetState),
    ];
  };
  const markState = (element: Element, ids: string[]): PageSourceState | undefined => {
    const state = strongestMarkState(ids.flatMap(sourceStates));
    if (state !== undefined) return state;
    const text = (element.textContent ?? '').trim();
    return text !== '' && EMPTY_VALUE_PATTERN.test(text) ? 'empty' : undefined;
  };

  /** One-writer pages: a mark under `[hidden]` holds its sources back until it has been seen outside one. */
  const isHeldByHidden = (mounted: MountedPage, element: Element): boolean => {
    if (mounted.guard === NO_ONE_WRITER_GUARD) return false;
    const ids = getMarkedSourceIds(element);
    if (ids.every((id) => mounted.unheld.has(id))) return false;
    if (element.closest(`#${DASHBOARD_ROOT_ID} [hidden]`) !== null) return true;
    for (const id of ids) mounted.unheld.add(id);
    return false;
  };

  const createSpell = (mounted: MountedPage): { shown: boolean } => {
    const spell = { shown: false };
    setTimeout(() => {
      if (mounted.spell !== spell || !mounted.current) return;
      spell.shown = true;
      notify();
    }, LOADING_SPELL_DELAY_MS);
    return spell;
  };

  const updateSourceStates = (mounted: MountedPage): void => {
    const ids = new Set(mounted.asked);
    const current = new Set<Element>();
    for (const element of root.querySelectorAll(`[${MARK_SOURCE_ATTRIBUTE}]`)) {
      if (isHeldByHidden(mounted, element)) continue;
      const marked = getMarkedSourceIds(element);
      for (const id of marked) ids.add(id);
      writeOptionalAttribute(element, SOURCE_STATE_ATTRIBUTE, markState(element, marked));
      writeOptionalAttribute(
        element,
        'aria-busy',
        marked.some((id) => underlyingDatasets(id).some((dataset) => engine.getRun(dataset.id).status === 'running')) ? 'true' : undefined,
      );
      current.add(element);
    }
    for (const element of sourceStateElements)
      if (!current.has(element)) for (const name of [SOURCE_STATE_ATTRIBUTE, 'aria-busy']) element.removeAttribute(name);
    sourceStateElements.clear();
    for (const element of current) sourceStateElements.add(element);
    const states = [...ids].flatMap(sourceStates);
    const loading = [...ids].flatMap((id) => baseDataset(id) ?? []).map(datasetState).includes('loading');
    if (!loading) mounted.spell = null;
    else mounted.spell ??= createSpell(mounted);
    writeOptionalAttribute(
      root,
      PAGE_STATE_ATTRIBUTE,
      rootPageState(states, mounted.spell?.shown === true),
    );
  };

  const collectUsage = (mounted: MountedPage): PageSourceUsage => {
    const markedIds = new Set<string>();
    const priorities = new Map<string, number>();
    const shownMarks = new Set<string>();
    const hiddenMarks = new Set<string>();
    for (const element of root.querySelectorAll(`[${MARK_SOURCE_ATTRIBUTE}]`)) {
      const held = isHeldByHidden(mounted, element);
      const into = held ? mounted.marked : markedIds;
      const rank = ({ high: 0, low: 2 } as Record<string, number>)[getMarkFetchPriority(root, element)] ?? 1;
      const seen = element.closest(`#${DASHBOARD_ROOT_ID} [hidden]`) === null ? shownMarks : hiddenMarks;
      for (const id of getMarkedSourceIds(element)) {
        into.add(id);
        seen.add(id);
        if (!held) priorities.set(id, Math.min(priorities.get(id) ?? 2, rank));
      }
    }
    for (const id of markedIds) mounted.marked.add(id);
    const calcs = calcStates();
    for (const id of calcs.keys()) if (mounted.marked.has(id)) for (const source of getUnderlyingSources(id, calcs) ?? []) mounted.marked.add(source);
    const failedInputs = new Set(
      [...calcs.entries()]
        .filter(([id, calc]) => mounted.asked.includes(id) && calc.status !== 'ok')
        .flatMap(([id]) => getUnderlyingSources(id, calcs) ?? []),
    );
    const datasets = [...new Set([...mounted.asked, ...markedIds])];
    const high = datasets.filter((id) => priorities.get(id) === 0);
    const low = datasets.filter((id) => priorities.get(id) === 2);
    const reach = (ids: Set<string>): Set<string> => new Set([...ids].flatMap((id) => [id, ...(getUnderlyingSources(id, calcs) ?? [])]));
    const shown = reach(shownMarks);
    const concealed = reach(hiddenMarks);
    const hidden = datasets.filter((id) => concealed.has(id) && !shown.has(id));
    return {
      datasets,
      unmarked: mounted.asked.filter((id) => !mounted.marked.has(id) && !failedInputs.has(id)),
      unread: [...markedIds].filter((id) => !mounted.asked.includes(id)),
      ...(high.length > 0 ? { high } : {}),
      ...(low.length > 0 ? { low } : {}),
      ...(hidden.length > 0 ? { hidden } : {}),
    };
  };

  const inspect = (element: Element, dataset?: string): PageSourceFocus | null => {
    const address = readSourceAddress(element, dataset);
    if (isDataOnlyMark(address)) return null;
    const shown = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      address,
      shown: shown.length > MAX_MARK_NUMBER_CHARACTERS ? '' : shown,
      ...(element.hasAttribute(DERIVED_SOURCE_ATTRIBUTE) ? { scaled: true as const } : {}),
    };
  };

  const checkMarks = (): PageMarkInspection => {
    const { tables, calcs } = resolutionContext();
    const multipliers = getLocaleCompactMultipliers();
    const first: SourceMarkIssue[] = [];
    let total = 0;
    // Saved rows start empty: the page's marks for them wait for the first row rather than count as wrong.
    const isEmptyStore = (id: string): boolean => engine.getDataset(id)?.source.kind === 'store' && tables.get(id)?.rows.length === 0;
    for (const element of root.querySelectorAll(`[${MARK_SOURCE_ATTRIBUTE}]`)) {
      const address = readSourceAddress(element);
      if (
        address.source === '' ||
        isDataOnlyMark(address) ||
        isEmptyStore(address.source) ||
        (typeof element.checkVisibility === 'function' && !element.checkVisibility())
      )
        continue;
      const finding = findSourceMarkIssue(
        address,
        element.textContent ?? '',
        tables,
        calcs,
        element.hasAttribute(DERIVED_SOURCE_ATTRIBUTE),
        multipliers,
      );
      if (finding !== null && ++total <= MAX_REPORTED_MARKS) first.push({ mark: describeElementSelector(element, root), ...finding });
    }
    return { first, total };
  };

  const runChecks = (): void => {
    checksQueued = false;
    const mounted = page;
    if (disposed || mounted === null || !mounted.current) return;
    const usage = collectUsage(mounted);
    const key = String(mounted.n) + JSON.stringify(usage);
    if (key !== usageKey) {
      usageKey = key;
      reads = { page: mounted.n, datasets: new Set(usage.datasets) };
      engine.use(usage.datasets);
      engine.setFetchPriority(usage.high ?? [], usage.low ?? [], usage.hidden ?? []);
      publish({ usage });
    }
    dashboardReadyGate.check({
      page: mounted.files,
      pages: mounted.n,
      reads,
      datasets: engine.datasets(),
      status: (id) => engine.getRun(id).status,
    });
    if (redrawFrame !== null || checkedVersion === version) return;
    checkedVersion = version;
    try {
      const { tables, calcs } = resolutionContext();
      derivePageTableSources(root, (id) => getSourceTable(id, tables, calcs));
    } catch {
      // A table the page is still building is checked again on the next pass.
    }
    updateSourceStates(mounted);
    const { first, total } = checkMarks();
    const drawingFaults = mounted.guard.faults(mounted.drawings.names());
    const faults = mounted.faults.list();
    const changed =
      JSON.stringify([first, total]) !== JSON.stringify([snapshot.marks, snapshot.flagged]) ||
      JSON.stringify(drawingFaults) !== JSON.stringify(snapshot.drawingFaults) ||
      faults !== snapshot.faults;
    if (!changed) return;
    publish({ marks: first, flagged: total, drawingFaults, faults });
    for (const listener of [...listeners]) listener();
    if (usePageRuntime.getState().page === handle) usePageRuntime.setState((state) => ({ version: state.version + 1 }));
  };

  function queueChecks(): void {
    if (checksQueued || disposed) return;
    checksQueued = true;
    queueMicrotask(runChecks);
  }

  const scheduleRedraw = (): void => {
    if (redrawFrame !== null || disposed) return;
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = null;
      const mounted = page;
      if (mounted === null || !mounted.current) return;
      for (const draw of mounted.draws) draw();
      mounted.drawings.pass();
      notify();
    });
  };

  const recordFailure = (mounted: MountedPage, label: string, error: unknown, where?: string): void => {
    if (!mounted.current) return;
    const added = mounted.faults.record('stopped', error, mounted.files.find((file) => file.name === label)?.name, where);
    const stop = describePageStop(label, error);
    const newStop = !mounted.stops.includes(stop);
    if (newStop) mounted.stops.push(stop);
    mounted.broke = true;
    publish({ stops: [...mounted.stops], broke: true, faults: mounted.faults.list() });
    if (added || newStop) notify();
  };

  const restoreTranslate = (): void => {
    if (savedTranslate === null) return;
    writeOptionalAttribute(root, 'translate', savedTranslate.translate ?? undefined);
    savedTranslate = null;
  };

  const applyEditing = (): void => {
    if (!editing && page !== null) page.kept = null;
    if (editing && root.getAttribute('translate') !== 'no') {
      savedTranslate ??= { translate: root.getAttribute('translate') };
      root.setAttribute('translate', 'no');
    } else if (!editing) restoreTranslate();
  };

  const stopDrawings = (): void => {
    if (page === null) return;
    page.drawings.stop();
    page.guard.stop();
    restoreTranslate();
  };

  const ensureKept = (): boolean => {
    if (page === null) return false;
    if (page.kept !== null) return true;
    const { body, oneWriter, kept } = parseDashboardFilesToPage(page.files, true);
    if (!oneWriter || kept === null) return true;
    if (!matchDraftTwins(kept.twins, body, root)) return false;
    page.kept = isReparseStable(kept.stored) ? kept : null;
    return true;
  };

  function mount(files: readonly DashboardFile[]): void {
    if (page !== null) {
      page.current = false;
      stopDrawings();
    }
    engine.beginPage();
    const n = ++mountCount;
    const d3 = createMutableD3Namespace();
    window.d3 = d3;
    // A `cue` property on elements (some browsers' media-text cue) would shadow a page's own.
    Reflect.deleteProperty(window.HTMLElement.prototype, 'cue');
    let scriptsRan = false;
    const asked: string[] = [];
    const markRead = (ids: string[]): void => {
      const added = [...new Set(ids)].filter((id) => !asked.includes(id));
      if (added.length === 0 || !mounted.current) return;
      asked.push(...added);
      queueMicrotask(notify);
    };
    const dash: DashApi = {
      data(id) {
        if (!isValidDatasetId(id)) return engine.read(id);
        markRead([id, ...(underOf(id) ?? [])]);
        return engine.read(id);
      },
      onData(callback) {
        if (typeof callback !== 'function' || !mounted.current) return;
        const run = (): void =>
          mounted.guard.during(() => {
            try {
              (callback as () => void)();
            } catch (error) {
              recordFailure(mounted, ON_DATA_CALLBACK_NAME, error);
            }
          });
        mounted.draws.push(run);
        run();
      },
      draw(name, spec) {
        if (!mounted.current) return;
        const drawSpec = spec === undefined ? undefined : toDrawSpec(spec);
        if (typeof name !== 'string' || name === '' || drawSpec === null)
          recordFailure(mounted, 'dash.draw', new Error(DRAW_ARGUMENTS_MESSAGE));
        else if (drawSpec === undefined) {
          mounted.drawings.pass(name);
          notify();
        } else if (mounted.drawings.define(name, drawSpec) && scriptsRan) scheduleRedraw();
      },
      calc(id, spec) {
        if (!mounted.current) return;
        const wasSource = typeof id === 'string' && asked.includes(id) && underOf(id) === undefined;
        engine.registerCalculation(id, spec);
        if (wasSource) scheduleRedraw();
      },
      loader(id, spec) {
        if (!mounted.current) return;
        try {
          engine.registerLoader(id, spec);
        } catch (error) {
          recordFailure(mounted, 'dash.loader', error instanceof TypeError ? new Error(LOADER_ARGUMENTS_MESSAGE) : error);
        }
      },
      colors: getPageChartColors(colors),
      refresh(id) {
        if (typeof id === 'string' && mounted.current) engine.refresh(id);
      },
      params: () => engine.params(),
      setParams(values) {
        if (Object.keys(parseParameters(values)).length > 0 && mounted.current) engine.setParams(values);
      },
      resetParams() {
        if (mounted.current) engine.resetParams();
      },
      setLink(fragment) {
        if (typeof fragment !== 'string' || !mounted.current || isInlineViewLink(fragment)) return;
        showPageLink(fragment);
        onLink?.(fragment);
      },
    };
    const drawings = createPageDrawings(root, {
      run: (fn) => mounted.guard.during(fn),
      threw: (name, error) => recordFailure(mounted, `dash.draw("${name}")`, error, name),
      drawn: notify,
    });
    const mounted: MountedPage = {
      n,
      files,
      draws: [],
      asked,
      marked: new Set(),
      unheld: new Set(),
      stops: [],
      broke: false,
      faults: createPageFaultTracker(),
      drawings,
      guard: NO_ONE_WRITER_GUARD,
      kept: null,
      colors,
      spell: null,
      dash,
      d3,
      current: true,
    };
    page = mounted;
    usageKey = '';
    reads = null;
    checkedVersion = -1;
    window.dash = Object.assign(dash, {
      format: REMOVED_HELPER,
      scale: REMOVED_HELPER,
      ticks: REMOVED_HELPER,
      path: REMOVED_HELPER,
      svg: REMOVED_HELPER,
    });
    publish({ n, files, stops: [], broke: false, faults: mounted.faults.list(), drawingFaults: [], marks: [], flagged: 0, usage: null });
    try {
      const { body, scripts, oneWriter, kept } = parseDashboardFilesToPage(files, editing);
      if (files.length > 0 && !files.some((file) => file.name === DASHBOARD_ENTRY_FILENAME)) mounted.stops.push(NO_ENTRY_FILE_MESSAGE);
      root.replaceChildren(body);
      root.toggleAttribute(ONE_WRITER_ATTRIBUTE, oneWriter);
      if (oneWriter) mounted.guard = createOneWriterGuard(root);
      if (oneWriter && kept !== null && isReparseStable(kept.stored)) mounted.kept = kept;
      publish({ oneWriter });
      if (redrawFrame !== null) cancelAnimationFrame(redrawFrame);
      redrawFrame = null;
      for (const script of scripts)
        mounted.guard.during(() => runPageScript(script, dash, capabilities, (file, error) => recordFailure(mounted, file, error)));
      drawings.pass();
      scriptsRan = true;
      applyEditing();
    } catch (error) {
      mounted.stops.push(describeMountFailure(error));
      mounted.faults.record('stopped', error);
      mounted.broke = true;
      dashboardReadyGate.stop();
    }
    publish({ stops: [...mounted.stops], broke: mounted.broke, faults: mounted.faults.list() });
    notify();
  }

  const onError = (event: ErrorEvent): void => {
    const mounted = page;
    if (mounted === null || !mounted.current) return;
    const file = mounted.files.find((candidate) => getDashboardSourceUrl(candidate.name) === event.filename)?.name;
    // A page that still calls a removed chart helper reports it even when the call came from an inline script.
    if (file === undefined && describeErrorMessage(event.error) !== REMOVED_HELPERS_MESSAGE) return;
    if (mounted.faults.record('error', event.error, file)) notify();
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const mounted = page;
    if (mounted !== null && mounted.current && mounted.faults.record('rejection', event.reason)) notify();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  // A form on the page runs its listeners; the submission itself never navigates the page away.
  const onSubmit = (event: Event): void => event.preventDefault();
  root.addEventListener('submit', onSubmit, true);

  let width = root.clientWidth;
  const resizeObserver = new ResizeObserver(() => {
    if (root.clientWidth === width) return;
    width = root.clientWidth;
    scheduleRedraw();
  });
  resizeObserver.observe(root);

  // Labels measured before the page's fonts arrived would be off: draw again once they have.
  const fonts = root.ownerDocument.fonts as FontFaceSet | undefined;
  const onFontsLoaded = (): void => scheduleRedraw();
  fonts?.addEventListener('loadingdone', onFontsLoaded);

  // A mark shown or hidden changes what the page reads first, and on one-writer pages what it holds back. Setting
  // `hidden` to what it already was (as a draw may on every run) changes neither.
  const holdsMark = ({ target, oldValue }: MutationRecord): boolean =>
    target instanceof Element &&
    (oldValue !== null) !== target.hasAttribute('hidden') &&
    (target.hasAttribute(MARK_SOURCE_ATTRIBUTE) || target.querySelector(`[${MARK_SOURCE_ATTRIBUTE}]`) !== null);
  const hiddenObserver = new MutationObserver((records) => {
    if (page !== null && records.some(holdsMark)) notify();
  });
  hiddenObserver.observe(root, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });

  const stopData = engine.subscribe(scheduleRedraw);
  let reports: ReadonlyMap<string, CalculationReport> = engine.store.getState().reports;
  const stopStore = engine.store.subscribe((state) => {
    const changed =
      state.reports.size !== reports.size || [...state.reports].some(([id, report]) => reports.get(id) !== report);
    reports = state.reports;
    if (changed) scheduleRedraw();
    else notify();
  });

  const checkOutput = (): OutputFault[] | null => {
    const mounted = page;
    if (mounted === null || !root.isConnected || redrawFrame !== null) return null;
    const calcs = calcStates();
    const isPending = (id: string): boolean =>
      baseDataset(id) !== undefined ? engine.getTable(id) === null : calcs.has(id) && calcs.get(id)?.status !== 'ok';
    if (mounted.asked.some(isPending)) return null;
    const context = resolutionContext();
    const rowCount = (id: string): number | null => {
      const table = getSourceTable(id, context.tables, context.calcs);
      return table === undefined ? null : (table?.rows.length ?? 0);
    };
    const isNaNValue = (value: unknown): boolean => value === 'NaN' || (typeof value === 'number' && Number.isNaN(value));
    const box = (element: Element): DOMRect => element.getBoundingClientRect();
    const isPainted = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return (style.fill !== 'none' && style.fillOpacity !== '0') || (style.stroke !== 'none' && style.strokeOpacity !== '0');
    };
    const outputFaults = findOutputFaults(root, {
      shown: isVisibleForExport,
      box,
      dataHasNaN: () =>
        [...context.tables.values()].some(
          (table) => table !== null && table.rows.slice(0, 2000).some((row) => Object.values(row).some(isNaNValue)),
        ),
      rows(element) {
        const mark = element.closest(`[${MARK_SOURCE_ATTRIBUTE}]`);
        const ids = mark === null ? mounted.asked : getMarkedSourceIds(mark);
        let fewest: number | null = null;
        for (const id of ids) {
          const count = rowCount(id);
          if (count === null) return null;
          fewest = fewest === null ? count : Math.min(fewest, count);
        }
        return fewest;
      },
    });
    const labelFaults = findLabelFaults(root, {
      shown: (element) => isVisibleForExport(element) && (element.localName !== 'text' || isPainted(element)),
      placed: (element) => isVisibleIgnoringOpacity(element) && (element.localName !== 'text' || isPainted(element)),
      box,
      clips: (element) => getComputedStyle(element).overflow !== 'visible',
      style: (element) => getComputedStyle(element),
      words(node) {
        const range = root.ownerDocument.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      },
      turned(element) {
        const matrix = element instanceof SVGGraphicsElement ? element.getScreenCTM() : null;
        return matrix !== null && (Math.abs(matrix.b) > 0.000001 || Math.abs(matrix.c) > 0.000001);
      },
    });
    return [...outputFaults, ...labelFaults];
  };

  const handle: PageHandle = {
    root,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    update(next) {
      if (disposed) return;
      if (next.lang !== undefined) applyPageLanguage(next.lang ?? DASHBOARD_ROOT_LANGUAGE, root);
      if (next.editing !== undefined) editing = next.editing;
      const nextColors = next.colors ?? colors;
      const files = next.files ?? page?.files ?? [];
      const colorsMatch = page?.colors === nextColors || editing;
      colors = nextColors;
      if (page !== null && colorsMatch && (files === page.files ? !editing || ensureKept() : !editing && next.adopt === true)) {
        page.files = files;
        publish({ files });
        applyEditing();
        notify();
        return;
      }
      mount(files);
    },
    redraw: scheduleRedraw,
    redrawPending: () => redrawFrame !== null,
    stopDrawings() {
      stopDrawings();
      notify();
    },
    checkOutput,
    shownPage() {
      if (page === null || !root.isConnected || redrawFrame !== null || root.ownerDocument.hidden) return null;
      try {
        const html = renderShownPageHtml(root);
        return html === null ? null : { html, width: root.ownerDocument.defaultView?.innerWidth ?? 0 };
      } catch {
        return null;
      }
    },
    inspect,
    isKnownSource,
    kept: () => page?.kept ?? null,
    ensureKept,
    storedHtml() {
      const kept = page?.kept ?? null;
      return kept === null ? null : serializeNodeHtml(kept.stored);
    },
    setEditing(next) {
      editing = next;
      applyEditing();
      notify();
    },
    dispose() {
      if (disposed) return;
      stopDrawings();
      if (page !== null) page.current = false;
      disposed = true;
      if (redrawFrame !== null) cancelAnimationFrame(redrawFrame);
      redrawFrame = null;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      root.removeEventListener('submit', onSubmit, true);
      resizeObserver.disconnect();
      fonts?.removeEventListener('loadingdone', onFontsLoaded);
      hiddenObserver.disconnect();
      stopData();
      stopStore();
      if (page !== null && window.dash === page.dash) delete window.dash;
      if (page !== null && window.d3 === page.d3) delete window.d3;
      listeners.clear();
      if (usePageRuntime.getState().page === handle) usePageRuntime.setState((state) => ({ page: null, version: state.version + 1 }));
    },
  };

  usePageRuntime.getState().page?.dispose();
  usePageRuntime.setState((state) => ({ page: handle, version: state.version + 1 }));
  applyPageLanguage(options.lang ?? DASHBOARD_ROOT_LANGUAGE, root);
  mount(options.files);
  return handle;
}

/** The source mark under an element, and what the inspector shows for it, on the mounted page. */
export function markOf(element: Element): { element: Element; focus: PageSourceFocus | null } | null {
  const page = currentPage();
  const mark = element.closest(`[${MARK_SOURCE_ATTRIBUTE}]`);
  if (page === null || mark === null || !page.root.contains(mark)) return null;
  const known = getMarkedSourceIds(mark).find(page.isKnownSource);
  return known === undefined ? null : { element: mark, focus: page.inspect(mark, known) };
}

/** What the exports need of the mounted page: its root, files, stops and whether it is drawn. */
export function pageExportSnapshot(): { root: HTMLElement; snapshot: PageSnapshot; drawn: boolean } | null {
  const page = currentPage();
  return page === null || !page.root.isConnected ? null : { root: page.root, snapshot: page.snapshot(), drawn: !page.redrawPending() };
}

/** The mounted page as the viewer sees it, for the agent. */
export function readShownPage(): ShownPage | null {
  return currentPage()?.shownPage() ?? null;
}

/** Calls `listener` once the page showing `files` has drawn with its sources settled. */
export function onPageSettled(files: readonly DashboardFile[] | null, listener: () => void): () => void {
  let live = true;
  void waitForDashboardReady(files).then(() => {
    if (live) listener();
  });
  return () => {
    live = false;
  };
}
