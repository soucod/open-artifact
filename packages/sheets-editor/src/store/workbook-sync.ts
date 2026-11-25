import type {
  CellAt,
  Edit,
  EditOfAnother,
  EngineRecordedEdit,
  Fault,
  NextStep,
  NothingToChangeAnswer,
  OtherAnswerToAnEdit,
  PlaceChanged,
  ReadXlsxFileRequest,
  AnswerBeforeCalculatingRequest,
  CalculateRequest,
  ReceiveLoadPageRequest,
  ReceiveSendOutcomeRequest,
  ReceiveServerRevisionRequest,
  ReceiveStreamedEditRequest,
  Refused,
  SendEditStep,
  SheetChanges,
  SheetId,
  StepGivenUpAnswer,
  StopReason,
  StreamedEdit,
  SyncState,
  SyncStateAnswer,
  TableOfASheet,
  TableWithColumns,
  TextThatNoCellShows,
  WentAlong,
  XlsxFileAnswer,
  IdRun,
} from '@open-artifact/sheets-core';
import { createOwnRowOrderSession } from '../tables/own-row-order.ts';
import { createPagedLoader } from './paged-load.ts';
import { errorKindOf, type ErrorKind } from '../model/refusals.ts';
import {
  createCoreUtilities,
  createWorkbookReader,
  readTableAtCell,
  readTablesOfSheetFromCore,
  readXlsxFile,
  type CoreRead,
  type WorkbookReader,
} from '../engine/core-reads.ts';
import { rememberLatestCausesOfError, editsOfQueued } from '../engine/cause-of-error-cache.ts';
import { resolvePlaceArea } from '../agent/changes-by-agent.ts';
import type { SessionAnswers, SheetsUtilities } from '../engine/wasm-bindings.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { SavingState } from '../state/initial-state.ts';
import type { PlaceAreaChanged } from '../state/event-reducer.ts';
import type { WorkbookStore } from './workbook-node.ts';
import type { WhyRefused } from './requests.ts';
import type { ClockReading } from './frames.ts';

/** An edit the workbook sends to the server to be saved; `isLastSend` when a refusal for now is not to be tried again. */
export interface EditToSave {
  editId: string;
  actionId: string | null;
  recordedEdit: EngineRecordedEdit;
  isLastSend: boolean;
}

/** What went wrong in syncing, as the workbook reports it. */
export type SyncFault =
  | typeof FIRST_LOAD_RESTARTED_TOO_OFTEN
  | 'saveUnansweredManyTimes'
  | 'saveAnswerNotUnderstood'
  | 'saveRefusedAsOutOfDate'
  | 'loadRefusedAsOutOfDate'
  | 'timeToldNotReadable'
  | 'editsThatTakeBackInUnknownFormatVersion'
  | StopReason
  | Fault;

/** Why the workbook takes no edit at all now. */
export type RefusalOfEveryEdit = 'readOnly' | 'savingStopped' | 'pageOutOfDate' | 'editingPaused';

/** Whether the server takes edits: 'closed' is compared to, though nothing states it. */
export type Availability = 'open' | 'viewOnly' | 'closed';

/** What goes along with an edit queued: texts shown to the person, edits made before it and after it. */
export interface RestOfAct {
  shownToThePerson?: TextThatNoCellShows[];
  editsBefore?: { edit: Edit; isPointedAt: boolean }[];
  editsThatGoAlong?: Edit[];
  /** The sheet whose columns are widened to show the numbers the edit gives a format. */
  makesRoomForNumbersIn?: SheetId;
}

/** Set when the edits of one act went to the server as more than one. */
export interface SentAsSeveralEdits {
  isSentAsSeveralEdits?: true;
}
export interface EditRefusedOutcome extends Refused {
  indexOfEditBefore?: number;
}
export interface EditQueuedOutcome extends SentAsSeveralEdits {
  kind: 'editQueued';
  placeChanged: PlaceAreaChanged | null;
  placesChangedBefore?: PlaceAreaChanged[];
  editsThatWentAlong?: WentAlong[];
  /** The step the edit made, to undo it by; left out of an outcome the page makes up for an edit it never sent. */
  step?: string;
}
/** How the workbook answered an edit the page queued. */
export type EditOutcome = EditRefusedOutcome | NothingToChangeAnswer | OtherAnswerToAnEdit | EditQueuedOutcome;
export interface StepReversedOutcome extends SentAsSeveralEdits {
  kind: 'made';
  changed: PlaceAreaChanged | null;
  changedBefore?: PlaceAreaChanged[];
  stepReversed?: string;
}
/** How the workbook answered an undo or a redo. */
export type UndoOrRedoOutcome = Refused | { kind: 'nothingLeft' } | StepGivenUpAnswer | StepReversedOutcome;
/** How the workbook answered edits that take an earlier version back. */
export type TakeBackOutcome = Refused | NothingToChangeAnswer | { kind: 'builtOnAnotherRevision' } | { kind: 'made'; changed: PlaceAreaChanged | null };

/** Edits of the page's own the server dropped: `isPartKept` when a step was cut short. */
export interface EditsDropped {
  isPartKept: boolean;
  why: WhyRefused;
}

/** A load that brought the workbook past the revision it held, and the reads before and after it. */
export interface CaughtUpByLoad {
  revisionBefore: number;
  revision: number;
  before: WorkbookReads;
  after: WorkbookReads;
}

/** What changed since the workbook was last read. */
export interface PendingChanges {
  isEverything: boolean;
  listed: SheetChanges[];
  views: Set<string>;
  isTimeZoneChanged: boolean;
}

/** What the synced workbook is given. */
export interface SyncedWorkbookOptions {
  store: WorkbookStore;
  newCore(): Promise<SessionAnswers>;
  utilities: SheetsUtilities;
  revision: number;
  canWrite: boolean;
  newEditId(): string;
  newIdCode(): string;
  timeZoneOfTheBrowser: string | null;
  wait(ms: number): Promise<void>;
  nowMs(): number;
  calculateLater(calculate: () => void): void;
  reportFault(fault: SyncFault): void;
  noteCoreThrew(what: ErrorKind, error: unknown): void;
  noteCalculationTookTooLong(): void;
  noteRevisionHeld?(revision: number | null): void;
  noteReading?(read: CoreRead): void;
}

/** A workbook in step with the server: its reads, its edits and where saving stands. */
export interface SyncedWorkbook {
  reads(): WorkbookReads;
  /** Some rows (some columns of them) read into a workbook of their own; `null` when they cannot be read. */
  readsWithCellsIn: WorkbookReader['readWithCellsIn'];
  queueEdit(edit: Edit, restOfAct?: RestOfAct): EditOutcome;
  refusalOfEveryEdit(): RefusalOfEveryEdit | null;
  undoOrRedo(which: 'undo' | 'redo'): UndoOrRedoOutcome;
  queueEditsThatTakeBack(builtOnRevision: number, edits: Iterable<EngineRecordedEdit>): TakeBackOutcome;
  seeRowsInOwnOrder(sheetId: SheetId, rows: readonly IdRun[] | null): void;
  tableAt(cell: CellId): TableWithColumns | null;
  tablesOf(sheetId: SheetId): TableOfASheet[] | null;
  xlsxFile(request: Omit<ReadXlsxFileRequest, 'kind'>): XlsxFileAnswer | null;
  onChanged(listener: (isOfCalculation: boolean) => void): () => void;
  saving(): SavingState;
  hasUnsavedEdits(): boolean;
  unsavedEditCount(): number;
  onSavingChanged(listener: () => void): () => void;
  areFormulasLeft(): boolean;
  onFormulasLeftChanged(listener: () => void): () => void;
  workOutFormulasLeft(): void;
  revisionHeld(): number | null;
  onEditsDropped(listener: (dropped: EditsDropped) => void): () => void;
  onEditsOfOthersMade(listener: (edits: EditOfAnother[], before: WorkbookReads | null, after: WorkbookReads) => void): () => void;
  onLoaded(listener: (caughtUp: CaughtUpByLoad | null) => void): () => void;
  editStreamed(revision: number, applied: StreamedEdit): void;
  storeRevisionReported(revision: number): void;
  timeTold(clockReading: ClockReading): void;
  availabilityStated(availability: Availability): void;
  storeReconnected(): void;
  storeClosed(): void;
  tabVisibilityChanged(isHidden: boolean): void;
}

/** The core with the rows of a table seen in an order of their own (made by tables/own-row-order.ts). */
interface CoreInOwnRowOrder extends SessionAnswers {
  seeRowsInOwnOrder(sheetId: SheetId, rows: readonly IdRun[] | null): void;
}

/** The requests of syncing that the core answers with where syncing stands. */
type SyncStateRequest =
  | AnswerBeforeCalculatingRequest
  | CalculateRequest
  | ReceiveServerRevisionRequest
  | ReceiveLoadPageRequest
  | ReceiveStreamedEditRequest
  | ReceiveSendOutcomeRequest;

/** Where syncing stands, with two fields read here that the engine does not send. */
interface SyncStateAsRead extends SyncState {
  droppedEditsWereNoSteps?: boolean;
  isAStepCutShort?: boolean;
}

export function mergeChangedSheetLists(changedSheets: readonly SheetChanges[]): SheetChanges[] {
  let bySheet = new Map<SheetId, { cells: Map<string, CellAt>; isLayoutChanged: boolean; areFormatsGivenChanged: boolean }>();
  for (let {
    sheetId,
    cells,
    isLayoutChanged,
    areFormatsGivenChanged,
  } of changedSheets) {
    let merged = bySheet.get(sheetId) ?? {
      cells: new Map<string, CellAt>(),
      isLayoutChanged: false,
      areFormatsGivenChanged: false,
    };
    for (let cell of cells) merged.cells.set(`${cell.r} ${cell.c}`, cell);
    merged.isLayoutChanged ||= isLayoutChanged;
    merged.areFormatsGivenChanged ||= areFormatsGivenChanged === true;
    bySheet.set(sheetId, merged);
  }
  return [...bySheet].map(
    ([sheetId, { cells, isLayoutChanged, areFormatsGivenChanged }]) => {
      let changed: SheetChanges = {
        sheetId,
        cells: [...cells.values()],
        isLayoutChanged,
      };
      if (areFormatsGivenChanged) changed.areFormatsGivenChanged = true;
      return changed;
    },
  );
}
export async function openSyncedWorkbook(host: SyncedWorkbookOptions): Promise<SyncedWorkbook | null> {
  let core: CoreInOwnRowOrder = createOwnRowOrderSession(await host.newCore());
  let { utilities } = host;
  let nextStep: NextStep = null;
  let isLoaded = false;
  let unacknowledgedCount = 0;
  let unconfirmedCount = 0;
  let isStoreCallOpen = false;
  let pendingWait: { isForBusyStore: boolean } | null = null;
  let retryCount = 0;
  let isRetrying = false;
  let isReconnectRetried = false;
  let unansweredSaves = {
    opId: '',
    count: 0,
  };
  let refusedForNowSends = {
    opId: '',
    count: 0,
  };
  let isRefusedForNow = false;
  let lastResendAtMs = Number.NEGATIVE_INFINITY;
  let isLastSendNotSent = false;
  let sendsTimeZone = true;
  let loadRestartWait: { hasElapsed: boolean } | null = null;
  let loadRestartTries = 0;
  let isStartingOver = false;
  let firstLoadStartCount = 0;
  let pagedLoader = createPagedLoader({
    store: host.store,
    isWanted: () => !isStopped && nextStep !== null && nextStep.kind !== 'stop',
    noteLoaded() {
      resetRetries();
      reportSavingChanged();
    },
    letOthersRun: () =>
      isTabHidden ? Promise.resolve() : new Promise<void>((resolve) => host.calculateLater(resolve)),
  });
  let firstLoadWaitedMs = 0;
  let isStopped = false;
  let lastStoreContactAtMs = host.nowMs();
  let storeContactCount = 0;
  let revisionPollFailures = 0;
  let isTabHidden = false;
  let revisionPollToken: object | null = null;
  let stopReason: 'stoppedOutOfDate' | 'stoppedOutOfDateWithUnsavedEdits' | null = null;
  let availability: Availability = 'open';
  let resolveLoaded: ((isLoadedNow: boolean) => void) | null = null;
  let loaded = new Promise<boolean>((resolve) => void (resolveLoaded = resolve));
  let changeListeners = new Set<(isOfCalculation: boolean) => void>();
  let savingListeners = new Set<() => void>();
  let formulasLeftListeners = new Set<() => void>();
  let areFormulasLeft = false;
  let areFormulasLeftReported = false;
  let isCalculationScheduled = false;
  let hasToldTime = false;
  let pendingChanges: PendingChanges = noChangesYet();
  let droppedListeners = new Set<(dropped: EditsDropped) => void>();
  let editsOfOthersListeners = new Set<(edits: EditOfAnother[], before: WorkbookReads | null, after: WorkbookReads) => void>();
  let loadedListeners = new Set<(caughtUp: CaughtUpByLoad | null) => void>();
  let confirmedRevision = 0;
  let revisionHeld = () => (isStopped || unconfirmedCount > 0 ? null : confirmedRevision);
  let revisionHeldReported: number | null = null;
  let reportRevisionHeld = () => {
    if (revisionHeld() === revisionHeldReported) return;
    revisionHeldReported = revisionHeld();
    host.noteRevisionHeld?.(revisionHeldReported);
  };
  let saving = (): SavingState => {
    if (isStopped) return stopReason ?? 'stopped';
    if (unacknowledgedCount === 0) return 'allSaved';
    return isRetrying ? 'retrying' : 'saving';
  };
  let savingReported = saving();
  let unacknowledgedCountReported = unacknowledgedCount;
  let refusalReported = refusalOfEveryEdit();
  let reportSavingChanged = () => {
    if (saving() === savingReported && unacknowledgedCount === unacknowledgedCountReported && refusalOfEveryEdit() === refusalReported) return;
    savingReported = saving();
    unacknowledgedCountReported = unacknowledgedCount;
    refusalReported = refusalOfEveryEdit();
    callSyncListeners(savingListeners);
  };
  let stop = () => {
    isStopped = true;
    reportRevisionHeld();
    resolveLoaded?.(false);
    reportSavingChanged();
  };
  let stopAsOutOfDate = (fault: SyncFault) => {
    if (isStopped) return;
    stopReason = unconfirmedCount > 0 ? 'stoppedOutOfDateWithUnsavedEdits' : 'stoppedOutOfDate';
    stop();
    host.reportFault(fault);
  };
  let refusalWhenStopped = () => (stopReason === null ? 'savingStopped' : 'pageOutOfDate');
  let isBroken = false;
  let callCore = <T>(read: () => T): T => {
    try {
      return read();
    } catch (error: unknown) {
      throw (
        (isBroken = true),
        (areFormulasLeft = false),
        stop(),
        reportFormulasLeftChanged(),
        host.noteCoreThrew?.(errorKindOf(error), error),
        error
      );
    }
  };
  let unlessBroken =
    <A extends unknown[], R>(read: (...args: A) => R) =>
    (...args: A): R | null =>
      isBroken ? null : callCore(() => read(...args));
  let coreUtilities = createCoreUtilities(core, utilities, host.newIdCode, host.nowMs);
  let workbookReader = createWorkbookReader(
    core,
    utilities,
    {
      dayTypedInLocaleAs: unlessBroken(coreUtilities.dayTypedInLocaleAs),
      cellsToCopy: unlessBroken(coreUtilities.cellsToCopy),
      shownInLocaleWithRoomForAll: unlessBroken(coreUtilities.shownInLocaleWithRoomForAll),
      patternReadInLocale: unlessBroken(coreUtilities.patternReadInLocale),
      formulaInLocale: unlessBroken(coreUtilities.formulaInLocale),
      patternsOfLocale: unlessBroken(coreUtilities.patternsOfLocale),
      dropdownOptionsToOffer: unlessBroken(coreUtilities.dropdownOptionsToOffer),
      cellsThatADropdownWouldClear: unlessBroken(coreUtilities.cellsThatADropdownWouldClear),
      cellsOfTheDropdownAt: unlessBroken(coreUtilities.cellsOfTheDropdownAt),
      whatATableChanges: unlessBroken(coreUtilities.whatATableChanges),
      fitOfColumnReadingsInLocale: unlessBroken(coreUtilities.fitOfColumnReadingsInLocale),
      textsUnderAColumnReadingInLocale: unlessBroken(coreUtilities.textsUnderAColumnReadingInLocale),
      labelsOfADropdownColumn: unlessBroken(coreUtilities.labelsOfADropdownColumn),
      listLinesAsKept: unlessBroken(coreUtilities.listLinesAsKept),
      timeZones: unlessBroken(coreUtilities.timeZones),
      timeZoneNamed: unlessBroken(coreUtilities.timeZoneNamed),
      locales: unlessBroken(coreUtilities.locales),
      formatsGivenAsIf: unlessBroken(coreUtilities.formatsGivenAsIf),
      conditionalFormatSuggestions: unlessBroken(coreUtilities.conditionalFormatSuggestions),
      tableAtCell: unlessBroken(coreUtilities.tableAtCell),
      cellTableAt: unlessBroken(coreUtilities.cellTableAt),
      cellTables: unlessBroken(coreUtilities.cellTables),
      cellTableDeclaredAs: unlessBroken(coreUtilities.cellTableDeclaredAs),
      conditionalFormatsAsAgentIsTold: unlessBroken(coreUtilities.conditionalFormatsAsAgentIsTold),
      conditionalFormatsInIds: unlessBroken(coreUtilities.conditionalFormatsInIds),
      conditionalFormatsByAddress: unlessBroken(coreUtilities.conditionalFormatsByAddress),
      proposedFormulaValue: unlessBroken(coreUtilities.proposedFormulaValue),
      filteredRows: unlessBroken(coreUtilities.filteredRows),
      valuesOfFilteredColumn: unlessBroken(coreUtilities.valuesOfFilteredColumn),
      rowsInSortedOrder: unlessBroken(coreUtilities.rowsInSortedOrder),
      tablesOfSheet: unlessBroken(coreUtilities.tablesOfSheet),
      pivotTableAt: unlessBroken(coreUtilities.pivotTableAt),
      valuesToFilterPivotTableBy: unlessBroken(coreUtilities.valuesToFilterPivotTableBy),
      causeOfError: rememberLatestCausesOfError((cell: CellId, cellNow: string) => {
        if (isBroken) return 'neverToCome';
        if (areFormulasLeft) return 'yetToCome';
        return callCore(() => coreUtilities.causeOfError(cell, cellNow))?.said ?? 'neverToCome';
      }),
    },
    host.noteReading,
  );
  let readEverything = () => {
    let read = callCore(() => workbookReader.readEverything());
    if (read.calculationTookTooLong) host.noteCalculationTookTooLong();
    return read;
  };
  let reads: WorkbookReads = readEverything();
  let askSyncState = (request: SyncStateRequest): SyncStateAsRead =>
    callCore(() => {
      let answer = core.answer(request);
      if (answer.kind === 'syncState') return answer;
      throw Error(`sheets-core answered ${request.kind} with ${answer.kind}`);
    });
  function applyRequest(request: SyncStateRequest, why: WhyRefused = null, load: { revisionBefore: number | null } | null = null) {
    if (!isStopped) applySyncState(askSyncState(request), why, load);
  }
  function takeSyncState(syncState: SyncState) {
    nextStep = syncState.nextStep;
    ({ isLoaded } = syncState);
    unacknowledgedCount = syncState.unacknowledgedCount;
    unconfirmedCount = syncState.unconfirmedCount;
    ({ confirmedRevision } = syncState);
    reportRevisionHeld();
    if (syncState.changes.kind === 'inSheets') {
      pendingChanges.isTimeZoneChanged ||= syncState.changes.isTimeZoneChanged === true;
      pendingChanges.listed.push(...syncState.changes.sheets);
      for (let viewId of syncState.changes.views ?? []) pendingChanges.views.add(viewId);
    } else if (syncState.changes.kind !== 'nothing') pendingChanges.isEverything = true;
    areFormulasLeft = syncState.calculation === 'unfinished';
    if (syncState.fault !== undefined) host.reportFault(syncState.fault);
  }
  function readPendingChanges() {
    let { isEverything, listed, views, isTimeZoneChanged } = pendingChanges;
    pendingChanges = noChangesYet();
    let isAnyListed = listed.length > 0 || views.size > 0 || isTimeZoneChanged;
    if (isEverything) reads = readEverything();
    else if (isAnyListed) reads = callCore(() => workbookReader.readChanged(mergeChangedSheetLists(listed), [...views], isTimeZoneChanged));
    return isEverything || isAnyListed;
  }
  function reportFormulasLeftChanged() {
    if (areFormulasLeft === areFormulasLeftReported) return;
    areFormulasLeftReported = areFormulasLeft;
    callSyncListeners(formulasLeftListeners);
  }
  let calculateOneStep = () =>
    takeSyncState(
      askSyncState({
        kind: 'calculate',
      }),
    );
  let isCalculationUnfinished = () => areFormulasLeft;
  function calculateAll() {
    while (isCalculationUnfinished()) calculateOneStep();
  }
  function notifyChanged(isChanged: boolean, isOfCalculation: boolean) {
    try {
      if (isChanged) callSyncListeners(changeListeners, isOfCalculation);
    } finally {
      if (areFormulasLeft) scheduleCalculation();
      reportFormulasLeftChanged();
    }
  }
  function workOutFormulas(howMany: 'one' | 'allThatAreLeft') {
    if (!areFormulasLeft) return;
    if (howMany === 'one') calculateOneStep();
    else calculateAll();
    let isChanged = !isCalculationUnfinished() && readPendingChanges();
    takeNextStep();
    notifyChanged(isChanged, true);
  }
  function scheduleCalculation() {
    if (isCalculationScheduled) return;
    isCalculationScheduled = true;
    host.calculateLater(() => {
      isCalculationScheduled = false;
      workOutFormulas('one');
    });
  }
  function applySyncState(syncState: SyncStateAsRead, why: WhyRefused = null, load: { revisionBefore: number | null } | null = null) {
    let hasChanges = syncState.changes.kind !== 'nothing';
    let wasUnfinished = areFormulasLeft;
    takeSyncState(syncState);
    if (areFormulasLeft && (hasChanges || !wasUnfinished)) calculateOneStep();
    if (isTabHidden) calculateAll();
    let readsBefore = reads;
    let isChanged = (hasChanges || !areFormulasLeft) && readPendingChanges();
    let readsAfter = reads;
    if (syncState.droppedOpIds.length > 0 && syncState.droppedEditsWereNoSteps !== true)
      callSyncListeners(droppedListeners, {
        isPartKept: syncState.isAStepCutShort === true,
        why,
      });
    takeNextStep();
    if (isLoaded) resolveLoaded?.(true);
    notifyChanged(isChanged, !hasChanges);
    if (load !== null) {
      let [revisionBefore, revisionNow] = [load.revisionBefore, revisionHeld()];
      let isCaughtUp = revisionBefore !== null && revisionNow !== null && revisionNow > revisionBefore;
      callSyncListeners(
        loadedListeners,
        isCaughtUp
          ? {
              revisionBefore: revisionBefore!,
              revision: revisionNow!,
              before: readsBefore,
              after: readsAfter,
            }
          : null,
      );
    }
    let { editsOfOthers = [] } = syncState;
    let isBeforeUnknown = syncState.droppedOpIds.length > 0 || load !== null;
    if (editsOfOthers.length > 0) callSyncListeners(editsOfOthersListeners, editsOfOthers, isBeforeUnknown ? null : readsBefore, readsAfter);
  }
  let noteStoreContact = () => {
    lastStoreContactAtMs = host.nowMs();
    storeContactCount += 1;
  };
  let resetRetries = () => {
    retryCount = 0;
    isRetrying = false;
    isReconnectRetried = false;
    noteStoreContact();
  };
  let waitBeforeNextStep = async (delayMs: number, isForBusyStore: boolean): Promise<void> => {
    let wait = {
      isForBusyStore,
    };
    pendingWait = wait;
    await host.wait(delayMs);
    if (pendingWait !== wait) return;
    pendingWait = null;
    takeNextStep();
  };
  let retryLater = async (busyForMs: number | null = null): Promise<void> => {
    let isWithinFirstLoadWait = busyForMs !== null && firstLoadWaitedMs < MAX_FIRST_LOAD_WAIT_MS;
    if (!isLoaded && !isWithinFirstLoadWait) return stop();
    isRetrying = true;
    retryCount += 1;
    let busyDelayMs = isLoaded ? 0 : Math.min(busyForMs ?? 0, MAX_BUSY_FIRST_LOAD_WAIT_MS);
    let delayMs = Math.max(busyDelayMs, syncRetryDelayMs(retryCount - 1));
    if (!isLoaded) firstLoadWaitedMs += delayMs;
    await waitBeforeNextStep(delayMs, false);
  };
  function endWaitWhenReopened() {
    isRetrying = false;
    if (pendingWait === null || pendingWait.isForBusyStore) return;
    pendingWait = null;
    takeNextStep();
  }
  async function sendEdit(step: SendEditStep): Promise<void> {
    let { opId, actionId = null, recordedEdit } = step;
    pagedLoader.drop();
    if (refusedForNowSends.opId !== opId)
      refusedForNowSends = {
        opId,
        count: 0,
      };
    let isLastSend = refusedForNowSends.count + 1 >= (isRefusedForNow ? 1 : MAX_SENDS_WHEN_REFUSED_FOR_NOW);
    isStoreCallOpen = true;
    let outcome = await host.store.save({
      editId: opId,
      actionId,
      recordedEdit,
      isLastSend,
    });
    isStoreCallOpen = false;
    isLastSendNotSent = outcome.kind === 'notSent';
    if (unansweredSaves.opId !== opId)
      unansweredSaves = {
        opId,
        count: 0,
      };
    if (outcome.kind === 'mayNotHaveArrived' && !outcome.wasAnswered) {
      unansweredSaves.count += 1;
      if (unansweredSaves.count === SAVE_UNANSWERED_REPORT_COUNT) host.reportFault('saveUnansweredManyTimes');
    }
    if (outcome.kind === 'answerNotUnderstood') {
      host.reportFault('saveAnswerNotUnderstood');
      return stop();
    }
    if (outcome.kind === 'pageOutOfDate') return stopAsOutOfDate('saveRefusedAsOutOfDate');
    if (outcome.kind === 'notSent' || outcome.kind === 'mayNotHaveArrived') {
      retryLater();
      return takeNextStep();
    }
    resetRetries();
    if (outcome.kind === 'saved') isRefusedForNow = false;
    if (outcome.kind === 'refusedForNow' && !isLastSend) {
      refusedForNowSends.count += 1;
      let busyMs = Math.min(outcome.busyForMs, MAX_BUSY_WAIT_MS);
      waitBeforeNextStep(Math.max(busyMs, syncRetryDelayMs(refusedForNowSends.count)), true);
      return takeNextStep();
    }
    if (outcome.kind === 'refused' || outcome.kind === 'refusedForNow') {
      if (outcome.kind === 'refusedForNow') isRefusedForNow = true;
      else if (outcome.why !== 'editingPaused') sendsTimeZone = false;
      return applyRequest(
        {
          kind: 'receiveSendOutcome',
          opId,
          outcome: {
            kind: 'refused',
          },
        },
        outcome.why,
      );
    }
    applyRequest({
      kind: 'receiveSendOutcome',
      opId,
      outcome,
    });
  }
  async function fetchLoadPage({ from }: { from: number }): Promise<void> {
    if (!isLoaded && from === 0 && retryCount === 0) firstLoadStartCount += 1;
    if (firstLoadStartCount > MAX_FIRST_LOAD_RESTARTS) {
      host.reportFault(FIRST_LOAD_RESTARTED_TOO_OFTEN);
      return stop();
    }
    isStoreCallOpen = true;
    let page = await pagedLoader.loadPage(from);
    isStoreCallOpen = false;
    if (page === 'calledOff') return takeNextStep();
    if (page === 'startOver') {
      resetRetries();
      loadRestartWait = null;
      isStartingOver = true;
      return takeNextStep();
    }
    if (page === 'pageOutOfDate') return stopAsOutOfDate('loadRefusedAsOutOfDate');
    if (page === null || 'busyForMs' in page) {
      retryLater(page?.busyForMs);
      return takeNextStep();
    }
    loadRestartWait = null;
    isStartingOver = false;
    resetRetries();
    let revisionBefore = isLoaded && page.next === null ? revisionHeld() : null;
    applyRequest(
      {
        kind: 'receiveLoadPage',
        from,
        ...page,
      },
      null,
      {
        revisionBefore,
      },
    );
  }
  async function waitBeforeLoadRestart(): Promise<void> {
    let wait = {
      hasElapsed: false,
    };
    loadRestartWait = wait;
    loadRestartTries += 1;
    await host.wait(syncRetryDelayMs(loadRestartTries - 1));
    if (loadRestartWait !== wait) return;
    wait.hasElapsed = true;
    takeNextStep();
  }
  function takeNextStep() {
    if (nextStep?.kind === 'stop' && !isStopped)
      if (nextStep.reason === 'unknownFormatVersion') stopAsOutOfDate(nextStep.reason);
      else {
        host.reportFault(nextStep.reason);
        stop();
      }
    if (nextStep === null) {
      loadRestartWait = null;
      isStartingOver = false;
      pagedLoader.drop();
    }
    if (nextStep !== null && !isStoreCallOpen && pendingWait === null && !isStopped)
      switch (nextStep.kind) {
        case 'sendEdit':
          sendEdit(nextStep);
          break;
        case 'fetchLoadPage': {
          let isRepeat = nextStep.isRepeat || isStartingOver;
          if (nextStep.from === 0 && !isRepeat) loadRestartTries = 0;
          if (!isRepeat || nextStep.from > 0 || loadRestartWait?.hasElapsed === true) fetchLoadPage(nextStep);
          else if (loadRestartWait === null) waitBeforeLoadRestart();
          break;
        }
        case 'stop':
          break;
      }
    reportSavingChanged();
  }
  function refusalOfEveryEdit(): RefusalOfEveryEdit | null {
    if (!host.canWrite) return 'readOnly';
    if (isStopped) return refusalWhenStopped();
    return availability === 'open' ? null : 'editingPaused';
  }
  let resolvePlaceAreas = (places: readonly PlaceChanged[]): PlaceAreaChanged[] => places.flatMap((place) => resolvePlaceArea(place, reads) ?? []);
  function queueEdit(edit: Edit, restOfAct: RestOfAct = {}): EditOutcome {
    let refusal = refusalOfEveryEdit();
    if (refusal !== null)
      return {
        kind: 'refused',
        refusal,
      };
    let request = {
      opId: host.newEditId(),
      newIdCode: host.newIdCode(),
      ...(sendsTimeZone && {
        timeZoneOfTheBrowser: host.timeZoneOfTheBrowser,
      }),
    };
    let {
      shownToThePerson,
      editsBefore,
      editsThatGoAlong,
      makesRoomForNumbersIn,
    } = restOfAct;
    let unconfirmedBefore = unconfirmedCount;
    let answer = callCore(
      () =>
        core.answer({
          kind: 'queueEdit',
          ...request,
          edit,
          shownToThePerson: shownToThePerson ?? [],
          ...(editsBefore !== undefined && {
            editsBefore: editsBefore.map(
              (before) => ({
                edit: before.edit,
                isPointedAt: before.isPointedAt,
                newIdCode: host.newIdCode(),
              }),
            ),
          }),
          ...(editsThatGoAlong !== undefined && {
            editsThatGoAlong: editsThatGoAlong.map(
              (alongEdit) => ({
                edit: alongEdit,
                newIdCode: host.newIdCode(),
              }),
            ),
          }),
          ...(makesRoomForNumbersIn !== undefined && {
            makesRoomForNumbersIn,
          }),
        }),
    );
    if (answer.kind === 'editBeforeRefused')
      return {
        kind: 'refused',
        refusal: answer.refusal,
        indexOfEditBefore: answer.index,
      };
    if (answer.kind === 'refused' || answer.kind === 'nothingToChange' || answer.kind === 'toBeShownFirst') return answer;
    if (answer.kind !== 'editQueued') throw (stop(), Error(`sheets-core answered an edit with ${(answer as { kind: string }).kind}`));
    let editCount = editsOfQueued({
      edit,
      ...restOfAct,
    }).length;
    let note = sentAsSeveralEditsNote(answer.syncState, unconfirmedBefore, editCount);
    applySyncState(answer.syncState);
    return {
      kind: 'editQueued',
      placeChanged: resolvePlaceArea(answer.placeChanged, reads),
      ...(answer.placesChangedBefore !== undefined && {
        placesChangedBefore: resolvePlaceAreas(answer.placesChangedBefore),
      }),
      ...(answer.editsThatWentAlong !== undefined && {
        editsThatWentAlong: answer.editsThatWentAlong,
      }),
      step: request.opId,
      ...note,
    };
  }
  function undoOrRedo(which: 'undo' | 'redo'): UndoOrRedoOutcome {
    let refusal = refusalOfEveryEdit();
    if (refusal !== null)
      return {
        kind: 'refused',
        refusal,
      };
    let requestKind: 'queueNextUndo' | 'queueNextRedo' = which === 'undo' ? 'queueNextUndo' : 'queueNextRedo';
    let unconfirmedBefore = unconfirmedCount;
    let answer = callCore(
      () =>
        core.answer({
          kind: requestKind,
          opId: host.newEditId(),
        }),
    );
    if (answer.kind === 'nothingToReverse')
      return {
        kind: 'nothingLeft',
      };
    if (answer.kind === 'refused' || answer.kind === 'stepGivenUp') return answer;
    if (answer.kind !== 'editQueued') throw (stop(), Error(`sheets-core answered ${requestKind} with ${(answer as { kind: string }).kind}`));
    let note = sentAsSeveralEditsNote(answer.syncState, unconfirmedBefore);
    applySyncState(answer.syncState);
    let { placeChanged, placesChangedBefore, stepReversed } = answer;
    return {
      kind: 'made',
      changed: resolvePlaceArea(placeChanged, reads),
      ...(placesChangedBefore !== undefined && {
        changedBefore: resolvePlaceAreas(placesChangedBefore),
      }),
      ...(stepReversed !== undefined && {
        stepReversed,
      }),
      ...note,
    };
  }
  function queueEditsThatTakeBack(builtOnRevision: number, edits: Iterable<EngineRecordedEdit>): TakeBackOutcome {
    let refusal = refusalOfEveryEdit();
    if (refusal !== null)
      return {
        kind: 'refused',
        refusal,
      };
    let answer = callCore(
      () =>
        core.answer({
          kind: 'queueEditsThatTakeBack',
          opId: host.newEditId(),
          builtOnRevision,
          edits: [...edits],
        }),
    );
    if (answer.kind === 'nothingToChange') return answer;
    if (answer.kind === 'refused' && answer.refusal === 'builtOnAnotherRevision')
      return {
        kind: 'builtOnAnotherRevision',
      };
    if (answer.kind === 'refused' && answer.refusal === 'unknownFormatVersion') {
      stopAsOutOfDate('editsThatTakeBackInUnknownFormatVersion');
      return {
        kind: 'refused',
        refusal: refusalWhenStopped(),
      };
    }
    if (answer.kind === 'refused') return answer;
    if (answer.kind !== 'editQueued') throw (stop(), Error(`sheets-core answered queueEditsThatTakeBack with ${(answer as { kind: string }).kind}`));
    applySyncState(answer.syncState);
    return {
      kind: 'made',
      changed: resolvePlaceArea(answer.placeChanged, reads),
    };
  }
  applyRequest({
    kind: 'answerBeforeCalculating',
  });
  applyRequest({
    kind: 'receiveServerRevision',
    revision: host.revision,
  });
  let revisionPollDelay = () => revisionPollDelayMs(isTabHidden, revisionPollFailures);
  async function pollRevision(): Promise<void> {
    if (isStopped || host.nowMs() - lastStoreContactAtMs < revisionPollDelay()) return;
    noteStoreContact();
    if (isStoreCallOpen || pendingWait !== null) return;
    let contactCount = storeContactCount;
    let revision = await host.store.askRevision();
    if (revision === 'notSent' || storeContactCount !== contactCount) return;
    if (revision === null) {
      revisionPollFailures += 1;
      return;
    }
    revisionPollFailures = 0;
    applyRequest({
      kind: 'receiveServerRevision',
      revision,
    });
  }
  async function keepPollingRevision(): Promise<void> {
    let token: object = {};
    revisionPollToken = token;
    await host.wait(jitterSyncDelay(Math.max(0, lastStoreContactAtMs + revisionPollDelay() - host.nowMs())));
    if (isStopped || revisionPollToken !== token) return;
    await pollRevision();
    if (revisionPollToken === token) keepPollingRevision();
  }
  function resendIfWaiting() {
    if (pendingWait === null || pendingWait.isForBusyStore || isLastSendNotSent) return;
    if (host.nowMs() - lastResendAtMs < MIN_RESEND_GAP_MS) return;
    lastResendAtMs = host.nowMs();
    pendingWait = null;
    takeNextStep();
  }
  if (!(await loaded)) return null;
  keepPollingRevision();
  return {
    reads: () => reads,
    readsWithCellsIn: unlessBroken(workbookReader.readWithCellsIn),
    queueEdit,
    refusalOfEveryEdit,
    undoOrRedo,
    queueEditsThatTakeBack,
    seeRowsInOwnOrder(sheetId: SheetId, rows: readonly IdRun[] | null) {
      if (isBroken) return;
      callCore(() => core.seeRowsInOwnOrder(sheetId, rows));
      if (reads.linesOf(sheetId) === null) return;
      pendingChanges.listed.push({
        sheetId,
        cells: [],
        isLayoutChanged: true,
        areFormatsGivenChanged: true,
      });
      notifyChanged(readPendingChanges(), false);
    },
    tableAt: unlessBroken((cell: CellId) => {
      let read = readTableAtCell(core, cell);
      return read === 'nowhere' ? null : read;
    }),
    tablesOf: unlessBroken((sheetId: SheetId) => readTablesOfSheetFromCore(core, sheetId)),
    xlsxFile: unlessBroken((request: Omit<ReadXlsxFileRequest, 'kind'>) => readXlsxFile(core, request)),
    onChanged: syncListenerAdder(changeListeners),
    saving,
    hasUnsavedEdits: () => unacknowledgedCount > 0 || saving() === 'stoppedOutOfDateWithUnsavedEdits',
    unsavedEditCount: () => unacknowledgedCount,
    onSavingChanged: syncListenerAdder(savingListeners),
    areFormulasLeft: () => areFormulasLeft,
    onFormulasLeftChanged: syncListenerAdder(formulasLeftListeners),
    workOutFormulasLeft: () => workOutFormulas('allThatAreLeft'),
    revisionHeld,
    onEditsDropped: syncListenerAdder(droppedListeners),
    onEditsOfOthersMade: syncListenerAdder(editsOfOthersListeners),
    onLoaded: syncListenerAdder(loadedListeners),
    editStreamed(revision: number, applied: StreamedEdit) {
      noteStoreContact();
      applyRequest({
        kind: 'receiveStreamedEdit',
        revision,
        applied,
      });
    },
    storeRevisionReported(revision: number) {
      noteStoreContact();
      applyRequest({
        kind: 'receiveServerRevision',
        revision,
      });
    },
    timeTold(clockReading: ClockReading) {
      if (isStopped) return;
      let answer = callCore(
        () =>
          core.answer({
            kind: 'receiveClockReading',
            ...clockReading,
          }),
      );
      if (answer.kind === 'refused') {
        host.reportFault('timeToldNotReadable');
        return;
      }
      if (answer.kind !== 'syncState') throw (stop(), Error(`sheets-core answered a clock reading with ${(answer as { kind: string }).kind}`));
      applySyncState(answer);
      if (!hasToldTime) workOutFormulas('allThatAreLeft');
      hasToldTime = true;
    },
    availabilityStated(stated: Availability) {
      let isReopened = availability === 'closed' && stated !== 'closed';
      availability = stated;
      if (isReopened) endWaitWhenReopened();
      reportSavingChanged();
    },
    storeReconnected() {
      isLastSendNotSent = false;
      if (pendingWait === null || pendingWait.isForBusyStore || isReconnectRetried) return;
      isReconnectRetried = true;
      pendingWait = null;
      retryCount = 0;
      takeNextStep();
    },
    storeClosed: stop,
    tabVisibilityChanged(isHidden: boolean) {
      isTabHidden = isHidden;
      if (isHidden) workOutFormulas('allThatAreLeft');
      if (!isHidden) {
        resendIfWaiting();
        pollRevision();
      }
      keepPollingRevision();
    },
  };
}
export const SYNC_RETRY_BASE_MS = 1000;
export const SYNC_RETRY_MAX_MS = 30000;
export const syncRetryDelayMs = (tryIndex: number) =>
  Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * 2 ** tryIndex) * (1 + Math.random() / 2);
export const SAVE_UNANSWERED_REPORT_COUNT = 6;
export const MAX_SENDS_WHEN_REFUSED_FOR_NOW = 3;
export const MAX_BUSY_WAIT_MS = 1e4;
export const MIN_RESEND_GAP_MS = 1000;
export const MAX_FIRST_LOAD_RESTARTS = 3;
export const FIRST_LOAD_RESTARTED_TOO_OFTEN = 'firstLoadStartedOverTooOften';
export const MAX_FIRST_LOAD_WAIT_MS = 180000;
export const MAX_BUSY_FIRST_LOAD_WAIT_MS = 60000;
export const REVISION_POLL_MS = 30000;
export const HIDDEN_TAB_REVISION_POLL_MS = 300000;
export const revisionPollDelayMs = (isTabHidden: boolean, failureCount: number) =>
  Math.min(HIDDEN_TAB_REVISION_POLL_MS, (isTabHidden ? HIDDEN_TAB_REVISION_POLL_MS : REVISION_POLL_MS) * 2 ** failureCount);
export const jitterSyncDelay = (delayMs: number) => delayMs * (1 + Math.random() / 3);
export const callSyncListeners = <A extends unknown[]>(listeners: Iterable<(...args: A) => void>, ...args: A) => {
  for (let listener of listeners) listener(...args);
};
export const syncListenerAdder =
  <L>(listeners: Set<L>) =>
  (listener: L) => (listeners.add(listener), () => void listeners.delete(listener));
export const noChangesYet = (): PendingChanges => ({
  isEverything: false,
  listed: [],
  views: new Set<string>(),
  isTimeZoneChanged: false,
});
export const sentAsSeveralEditsNote = (
  { unconfirmedCount, confirmedOpIds, droppedOpIds }: Pick<SyncState, 'unconfirmedCount' | 'confirmedOpIds' | 'droppedOpIds'>,
  unconfirmedBefore: number,
  editCount = 1,
): SentAsSeveralEdits =>
  unconfirmedCount + confirmedOpIds.length + droppedOpIds.length - unconfirmedBefore > editCount
    ? {
        isSentAsSeveralEdits: true,
      }
    : {};
