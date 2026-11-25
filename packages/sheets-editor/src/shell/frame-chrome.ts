import type { ChromeCommand, ChromePeer, ChromeReport, ShellConnection } from '@open-artifact/runtime';
import type { ShellBridge } from '@open-artifact/editor-kit';

export type ExportFormat = 'csv' | 'xlsx';

type ChromeAction = NonNullable<ChromeReport['actions']>[number];
type ChromeFormat = NonNullable<ChromeReport['formats']>[number];
type ChromeSaved = NonNullable<ChromeReport['saved']>;

export type ExportHandler = (request: string, title: string | null) => void;

export type FollowHandler = (tabKey: string | null) => void;

export type LayerCloser = () => void;

export type TopLayer = 'popup' | 'ofPage';

export interface FollowedWorkbook {
  onSavingChanged(listener: () => void): () => void;
  hasUnsavedEdits(): boolean;
  unsavedEditCount(): number;
  refusalOfEveryEdit(): string | null;
}

export interface FrameChrome {
  entryIsChanged(changed: boolean): void;
  saysLeaveLosesWork(): boolean;
  follow(workbook: FollowedWorkbook | null): void;
  offerExport(format: ExportFormat, handler: ExportHandler | null): void;
  declineExport(request: string): void;
  exportIsDone(request: string): void;
  offerFind(handler: (() => void) | null): void;
  offerImport(handler: ((byKey: boolean) => void) | null): void;
  drawsHistory(): boolean;
  offerHistory(handler: (() => void) | null): void;
  offerFollow(handler: FollowHandler | null): void;
  followHandler(): FollowHandler | null;
  /** Who else views the sheet (null: not known), for the Shell's list with Follow. */
  peersHere(peers: ChromePeer[] | null): void;
  /** The tab whose view this page follows now (null: nobody). */
  followsTab(tabKey: string | null): void;
  onFollowOfferChanged(listener: () => void): () => void;
  offerCloseOfTopLayer(layer: TopLayer, close: LayerCloser | null): void;
  cellsHoldSomething(holdsSomething: boolean | null): void;
}

export interface FrameChromeOptions {
  bridge: ShellBridge;
  shell: () => ShellConnection | null;
  window: Window;
  exportLabels: Record<ExportFormat, string>;
}

export function createFrameChrome({ bridge, shell, window: win, exportLabels }: FrameChromeOptions): FrameChrome {
  let entryChanged = false;
  let followed: { workbook: FollowedWorkbook; stop: () => void } | null = null;
  let isReadOnly = false;
  let showsSaving = false;
  let leaveLosesWork = false;
  let savingTimers: { left: number; timer: number }[] = [];
  let unsavedCountTimed = 0;
  let findHandler: (() => void) | null = null;
  let importHandler: ((byKey: boolean) => void) | null = null;
  let historyHandler: (() => void) | null = null;
  let followHandler: FollowHandler | null = null;
  let peers: ChromePeer[] | null = null;
  let followedTab: string | null = null;
  let cellsHoldSomething: boolean | null = null;
  const followOfferListeners = new Set<() => void>();
  const exportHandlers = new Map<ExportFormat, ExportHandler>();
  const exportFormats: ExportFormat[] = [];
  const layerClosers: Record<TopLayer, LayerCloser | null> = { popup: null, ofPage: null };

  const holdLeave = (event: BeforeUnloadEvent): void => event.preventDefault();

  const savedState = (): ChromeSaved | undefined => {
    if (followed === null) return undefined;
    if (isReadOnly) return 'readonly';
    return showsSaving ? 'saving' : 'saved';
  };

  const actions = (): ChromeAction[] | undefined => {
    const list: ChromeAction[] = [];
    if (findHandler !== null) list.push({ id: OPEN_FIND_ACTION });
    if (importHandler !== null) list.push({ id: IMPORT_FILE_ACTION, label: 'Import a file' });
    return list.length === 0 ? undefined : list;
  };

  const formats = (): ChromeFormat[] | undefined =>
    exportFormats.length === 0 ? undefined : exportFormats.map((format) => ({ format, label: exportLabels[format] }));

  const report = (): void => {
    const part: Partial<ChromeReport> = {
      saved: savedState(),
      leaveLosesWork: leaveLosesWork || undefined,
      actions: actions(),
      formats: formats(),
      exports: false,
      history: historyHandler === null ? undefined : true,
      hasContent: cellsHoldSomething ?? undefined,
      peers: peers ?? undefined,
      following: followHandler === null ? undefined : followedTab,
    };
    bridge.setShellReport(part);
  };

  const stopSavingTimers = (): void => {
    for (const { timer } of savingTimers) win.clearTimeout(timer);
    savingTimers = [];
    unsavedCountTimed = 0;
  };

  const timeUnsavedEdits = (count: number): void => {
    let saved = unsavedCountTimed - count;
    for (let first = savingTimers[0]; saved > 0 && first !== undefined; [first] = savingTimers) {
      const taken = Math.min(saved, first.left);
      first.left -= taken;
      saved -= taken;
      if (first.left > 0) break;
      win.clearTimeout(first.timer);
      savingTimers.shift();
    }
    if (count > unsavedCountTimed) {
      const timer = win.setTimeout(() => {
        stopSavingTimers();
        showsSaving = true;
        report();
      }, SAVING_SHOWN_AFTER_MS);
      savingTimers.push({ left: count - unsavedCountTimed, timer });
    }
    unsavedCountTimed = count;
  };

  const updateSavingState = (): void => {
    const workbook = followed?.workbook ?? null;
    isReadOnly = workbook !== null && workbook.refusalOfEveryEdit() !== null;
    const unsavedCount = workbook?.unsavedEditCount() ?? 0;
    const isUnsaved = unsavedCount > 0 || (showsSaving && workbook?.hasUnsavedEdits() === true);
    if (isReadOnly || !isUnsaved) {
      stopSavingTimers();
      showsSaving = false;
    } else if (!showsSaving) timeUnsavedEdits(unsavedCount);
    const atRisk = entryChanged || (workbook?.hasUnsavedEdits() ?? false);
    if (atRisk !== leaveLosesWork) {
      leaveLosesWork = atRisk;
      if (atRisk) win.addEventListener('beforeunload', holdLeave);
      else win.removeEventListener('beforeunload', holdLeave);
    }
    report();
  };

  const exportState = (request: string, state: 'done' | 'declined' | 'started'): void => shell()?.exportState(request, state);

  const onCommand = (command: ChromeCommand): void => {
    if (command.cmd === 'action') {
      if (command.id === OPEN_FIND_ACTION) findHandler?.();
      if (command.id === IMPORT_FILE_ACTION) importHandler?.(false);
      return;
    }
    if (command.cmd === 'history') {
      historyHandler?.();
      return;
    }
    if (command.cmd === 'follow') {
      const key = typeof command.key === 'string' ? command.key : null;
      if (key === null || peers?.some((peer) => peer.key === key)) followHandler?.(key);
      return;
    }
    if (command.cmd !== 'export_format') return;
    const handler = exportHandlers.get(command.format as ExportFormat);
    if (handler === undefined) {
      shell()?.exportState(command.request, 'unsupported');
      return;
    }
    exportState(command.request, 'started');
    handler(command.request, null);
  };
  bridge.onShellCommand(onCommand);

  return {
    entryIsChanged(changed) {
      if (changed === entryChanged) return;
      entryChanged = changed;
      updateSavingState();
    },
    saysLeaveLosesWork: () => leaveLosesWork,
    follow(workbook) {
      if (workbook === (followed?.workbook ?? null)) return;
      followed?.stop();
      followed = workbook === null ? null : { workbook, stop: workbook.onSavingChanged(updateSavingState) };
      updateSavingState();
    },
    offerExport(format, handler) {
      const had = exportHandlers.has(format);
      if (handler === null) exportHandlers.delete(format);
      else exportHandlers.set(format, handler);
      if (had === (handler !== null)) return;
      if (had) exportFormats.splice(exportFormats.indexOf(format), 1);
      else exportFormats.push(format);
      report();
    },
    declineExport: (request) => exportState(request, 'declined'),
    exportIsDone: (request) => exportState(request, 'done'),
    offerFind(handler) {
      findHandler = handler;
      report();
    },
    offerImport(handler) {
      importHandler = handler;
      report();
    },
    drawsHistory: () => shell() !== null,
    offerHistory(handler) {
      if ((handler === null) === (historyHandler === null)) {
        historyHandler = handler;
        return;
      }
      historyHandler = handler;
      report();
    },
    offerFollow(handler) {
      const changed = (handler === null) !== (followHandler === null);
      followHandler = handler;
      if (handler === null) followedTab = null;
      for (const listener of followOfferListeners) listener();
      if (changed) report();
    },
    peersHere(next) {
      peers = next;
      report();
    },
    followsTab(tabKey) {
      if (tabKey === followedTab) return;
      followedTab = tabKey;
      report();
    },
    followHandler: () => followHandler,
    onFollowOfferChanged(listener) {
      followOfferListeners.add(listener);
      return () => void followOfferListeners.delete(listener);
    },
    offerCloseOfTopLayer(layer, close) {
      layerClosers[layer] = close;
    },
    cellsHoldSomething(holdsSomething) {
      if (holdsSomething === cellsHoldSomething) return;
      cellsHoldSomething = holdsSomething;
      report();
    },
  };
}

export const OPEN_FIND_ACTION = 'open_find';
export const IMPORT_FILE_ACTION = 'import_file';
export const SAVING_SHOWN_AFTER_MS = 500;
