import { reportErrorSoftly, reportErrorsSoftlyAt, type LoadedSheetsEngine, type SheetsEngineLoad } from '../engine/loader.ts';
import { EMPTY_SHEET_STATE, describeSheet, reduceSheetFrame, canViewerEdit, viewerOf, describeStore, type SheetContent, type SheetState, type StoreDescription, type StoreSnapshot } from './sheet-state.ts';
import { createWorkbookNodeClient, failureOf, type NotedFailure, type WorkbookStore } from './workbook-node.ts';
import {
  FIRST_LOAD_RESTARTED_TOO_OFTEN,
  openSyncedWorkbook,
  syncRetryDelayMs,
  jitterSyncDelay,
  revisionPollDelayMs,
  type Availability,
  type CaughtUpByLoad,
  type EditToSave,
  type SyncFault,
} from './workbook-sync.ts';
import { faultWord, errorKindOf, type ErrorKind } from '../model/refusals.ts';
import { openWorkbookOnWorker, asSameThreadWorkbook, type OpenedWorkbook } from '../engine/worker-workbook.ts';
import type { SheetsUtilities } from '../engine/wasm-bindings.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { EditOfAnother } from '@open-artifact/sheets-core';
import type { AgentActivity } from '../agent/activity.ts';
import type { LoadOutcome, SaveOutcome } from './requests.ts';
import { newIdCode, readLocales } from '../engine/core-reads.ts';
import {
  addSheetRequest,
  readUpdatedRevision,
  readSheetsRequest,
  blankWorkbookRevision,
  setLocaleRequest,
  isRetryableFailure,
  readRetryAfterMs,
  askRevisionRequest,
  answerOf,
  revisionOfAnswer,
} from './requests.ts';
import { isWrittenByAgentAlone, latestVersionsRequest } from '../history/requests.ts';
import type { EarlierVersionOpened } from '../history/history-reader.ts';
import { defaultSheetName } from '../i18n/sheet-names.ts';
import { isSheetJustMade, readClockFrame, readStreamedEdit, type ClockReading, type StreamedEdit } from './frames.ts';
import type { SheetStream, SheetStreamOptions, StoreCall, StoreOutcome, StreamEndReason } from './sheet-stream.ts';

export type Connection = { kind: 'connecting' } | { kind: 'open' } | { kind: 'reconnecting' } | { kind: 'ended'; reason: StreamEndReason };

/** What the page heard of the server's own description of itself. */
export type StoreTold = { kind: 'notAsked' } | { kind: 'asking' } | { kind: 'notStated' } | StoreDescription;

/** What the page tells of the engine's code: still loading, not loaded, or what it said of itself. */
export type SharedCodeTold =
  | { kind: 'loading' }
  | Exclude<SheetsEngineLoad, LoadedSheetsEngine>
  | { kind: 'answered'; newestFormatVersion: number }
  | { kind: 'failed' };

export function describeLoadedSharedCode(sharedCode: SheetsEngineLoad, onFailed: (error: unknown) => void): SharedCodeTold {
  if (sharedCode.kind !== 'loaded') return sharedCode;
  try {
    let answer = sharedCode.utilities.answer({
      kind: 'describeSharedCode',
    });
    if (answer.kind === 'sharedCodeDescription')
      return {
        kind: 'answered',
        newestFormatVersion: answer.newestFormatVersion,
      };
    throw Error(`sheets-core answered describeSharedCode with ${answer.kind}`);
  } catch (error: unknown) {
    reportErrorSoftly(error, 'engine');
    onFailed(error);
    return {
      kind: 'failed',
    };
  }
}

export function loadFaultCause(fault: SyncFault): 'pageBehind' | 'storeBehind' | 'storeFailed' | null {
  if (fault === 'unknownFormatVersion') return 'pageBehind';
  if (fault === 'formatVersionNoLongerTaken') return 'storeBehind';
  return fault === 'unreadableLoad' || fault === 'loadNotUnpacked' ? 'storeFailed' : null;
}

/** What the page tells of a workbook it opened: the calls it makes to the server, and how it opens another version. */
export interface OpenedNode {
  nodeId: string;
  call(call: StoreCall): Promise<StoreOutcome>;
  noteFailure(failure: NotedFailure): void;
  openViewOnly(revision: number, store: WorkbookStore): Promise<ViewOnlyVersion | null>;
}

/** A version of the workbook opened to be looked at, on its own worker. */
export interface ViewOnlyVersion {
  workbook: OpenedWorkbook;
  end(): void;
  onFailed(onFailed: () => void): void;
}

/** What the page hears of the workbook through its connection. */
export interface ConnectionListeners {
  streamChanged(): void;
  editByAgentStreamed(revision: number, isOfViewer: boolean, isOfLayoutAlone: boolean): void;
  editsOfOthersMade(edits: EditOfAnother[], before: WorkbookReads | null, after: WorkbookReads): void;
  revisionStated?(revision: number, isMadeUnderSomeone: boolean): void;
  changesMayBeMissed?(): void;
  caughtUpByLoad(caughtUp: CaughtUpByLoad): void;
}

/** Where the opening of the workbook stands. */
export type WorkbookState =
  | { kind: 'empty' }
  | { kind: 'open'; workbook: OpenedWorkbook }
  | { kind: 'closed' }
  | { kind: 'notOpened' }
  | { kind: 'opening'; partLoaded: number | null }
  | { kind: 'failed'; mayPass: boolean };

/** What the page is told each time the connection changes. */
export interface ConnectionPage {
  connection: Connection;
  workbook: WorkbookState;
  storeTold: StoreTold;
  content: SheetContent;
  isSheetJustMade(): boolean;
  viewer: string | null;
  sharedCode: SharedCodeTold;
}

type OpenState = 'notTried' | 'trying' | 'resting' | 'waiting' | 'failed';

/** What failed in opening: nothing, a load outrun by edits, a failure that stands, or one that may pass. */
type FailureKind = 'nothing' | 'outrun' | 'whatStands' | 'whatMayPass';

export interface StreamListener {
  streamOpened?(stream: { call(call: StoreCall): Promise<StoreOutcome>; noteFailure(failure: NotedFailure): void }): void;
  publishedTimes?(widgetId: string, timesPublished: number): void;
}

export function openSheetConnection(
  openStream: (options: SheetStreamOptions) => SheetStream,
  loadSharedCode: () => Promise<SheetsEngineLoad>,
  onPageChanged: (page: ConnectionPage) => void,
  watchTabVisibility: (onVisibility: (isHidden: boolean) => void) => () => void,
  listeners: ConnectionListeners,
  timeZoneOfTheBrowser: string | null,
  localesWanted: () => string[] | null,
  wait: (ms: number) => Promise<void> = (ms) => new Promise<void>((resolve) => void setTimeout(resolve, ms)),
  streamListener?: StreamListener,
  workbookListener?: { workbookOpened(node: OpenedNode): void; asItWas?(revision: number, isStillWanted: () => boolean): Promise<EarlierVersionOpened> },
  nowMs: () => number = () => performance.now(),
  wallNowMs: () => number = () => Date.now(),
  agentRest?: AgentActivity['rest'],
): () => void {
  let isEnded = false;
  let hasEnded = (): boolean => isEnded;
  let storeState: SheetState = EMPTY_SHEET_STATE;
  let connection: Connection = {
    kind: 'connecting',
  };
  let viewer: string | null = null;
  let storeTold: StoreTold = {
    kind: 'notAsked',
  };
  let storeAsk: Promise<unknown> = Promise.resolve();
  let hasAskedStore = false;
  let isFirstLoadDone = false;
  let storeAskFailures = 0;
  let availability: Availability | null = null;
  let availabilityWatch: object | null = null;
  let sharedCode: SharedCodeTold = {
    kind: 'loading',
  };
  let openState: OpenState = 'notTried';
  let openTries = 0;
  let openRetries = 0;
  let retryToken: object | null = null;
  let mayTryOpen = (): boolean => openTries < MAX_OPEN_TRIES && openRetries < MAX_OPEN_RETRIES;
  let partLoaded: number | null = null;
  let failureKind: FailureKind = 'nothing';
  let wasOutrun = (): boolean => failureKind === 'outrun';
  let causeOfFailure: string | null = null;
  let noteCauseOfFailure = (cause: string): void => {
    if (causeOfFailure !== 'alreadyTold') causeOfFailure = cause;
  };
  let clearFailure = (): void => {
    failureKind = 'nothing';
    causeOfFailure = null;
  };
  let opened: { workbook: OpenedWorkbook; nodeId: string } | null = null;
  let endWorker: (() => void) | null = null;
  let hasWorkerFailed = false;
  let loadedSharedCode: SheetsEngineLoad | null = null;
  let earlyFirstSave: { nodeId: string; sent: Promise<StoreOutcome> } | null = null;
  let isTabHidden = false;
  let isRevisionUnreported = false;
  let streamedBeforeOpen: { nodeId: string; edits: StreamedEdit[] } | null = null;
  let timeTold: ClockReading | null = null;
  let isBringingLocale = false;
  let localeTriesLeft = LOCALE_TRIES;
  let revisionOfLocaleNotBrought = 0;
  let timeToldAt = 0;
  let workbookState = (): WorkbookState => {
    if (opened !== null)
      return opened.workbook.reads().listSheets().length === 0
        ? {
            kind: 'empty',
          }
        : {
            kind: 'open',
            workbook: opened.workbook,
          };
    if (isClosedBeforeOpen())
      return {
        kind: 'closed',
      };
    if (openState === 'notTried')
      return {
        kind: 'notOpened',
      };
    if (openState !== 'failed')
      return {
        kind: 'opening',
        partLoaded,
      };
    return {
      kind: 'failed',
      mayPass: failureKind === 'whatMayPass',
    };
  };
  let callQueue: { call: StoreCall; isUnasked: boolean; settle(outcome: StoreOutcome): void }[] = [];
  let isCallingNow = false;
  let callNextQueued = async (): Promise<void> => {
    let queued = isCallingNow ? undefined : callQueue.shift();
    if (queued === undefined) return;
    isCallingNow = true;
    try {
      let outcome = await stream.call(queued.call);
      queued.settle(outcome);
    } catch (error: unknown) {
      reportErrorSoftly(error, 'stream');
      queued.settle({
        kind: 'notSent',
      });
    }
    isCallingNow = false;
    callNextQueued();
  };
  /** Calls the server, one call at a time; a call the page did not ask for gives way to one it did. */
  let call = (request: StoreCall, isUnasked = false): Promise<StoreOutcome> =>
    new Promise<StoreOutcome>((settle) => {
      let isAsked = !isUnasked && request.route !== 'read';
      let givesWay = (queued: (typeof callQueue)[number]): boolean => queued.isUnasked && isAsked;
      for (let queued of callQueue)
        if (givesWay(queued))
          queued.settle({
            kind: 'notSent',
          });
      callQueue = callQueue.filter((queued) => !givesWay(queued));
      callQueue.push({
        call: request,
        isUnasked,
        settle,
      });
      callNextQueued();
    });
  let noteFailure = (failure: NotedFailure): void => {
    if (failure.cause !== 'noAnswer' && failure.cause !== 'storeFailed') {
      failureKind = 'whatStands';
      noteCauseOfFailure('alreadyTold');
    } else if (failureKind === 'nothing') failureKind = 'whatMayPass';
  };
  let noteWhatOthersFailed = (): void => undefined;
  let notePartLoaded = (fractionLoaded: number): void => {
    if (openState !== 'trying' || (fractionLoaded === 1 && partLoaded === null)) return;
    partLoaded = Math.max(partLoaded ?? 0, fractionLoaded);
    tellPageChanged();
  };
  let clearPassingFailure = (): void => {
    if (failureKind === 'whatMayPass') failureKind = 'nothing';
  };
  let tryOpen = async (): Promise<void> => {
    let content = describeSheet(storeState);
    if (isEnded) return;
    if (opened !== null || openState === 'trying' || openState === 'resting' || !mayTryOpen()) return;
    if (isClosedBeforeOpen()) return;
    if (content.kind !== 'workbook' || loadedSharedCode?.kind !== 'loaded') return;
    openState = 'trying';
    retryToken = null;
    openTries += 1;
    clearFailure();
    partLoaded = null;
    let { nodeId } = content;
    let { utilities, newCore, startWorkbookWorker } = loadedSharedCode;
    let canWrite = canViewerEdit(storeState);
    streamedBeforeOpen = {
      nodeId,
      edits: [],
    };
    let isCalledOff = async (): Promise<boolean> => {
      if (opened !== null) return false;
      await storeAsk;
      return isClosedBeforeOpen();
    };
    let openWorkbook = async (revision: number): Promise<OpenedWorkbook | null> => {
      let storeClient = createWorkbookNodeClient(call, noteFailure);
      let workbookOptions = {
        store: {
          ...storeClient,
          async save(edit: EditToSave): Promise<SaveOutcome> {
            await storeAsk;
            return storeClient.save(edit);
          },
          async loadOps(): Promise<LoadOutcome> {
            if (await isCalledOff()) return null;
            let loaded = await storeClient.loadOps();
            if (loaded !== null && typeof loaded === 'object' && 'ops' in loaded) {
              clearPassingFailure();
              queueMicrotask(() => notePartLoaded(1));
              noteFirstLoadDone();
            }
            return loaded;
          },
        },
        revision,
        canWrite,
        timeZoneOfTheBrowser,
        reportFault(fault: SyncFault): void {
          if (fault === FIRST_LOAD_RESTARTED_TOO_OFTEN) {
            if (failureKind !== 'whatStands') failureKind = 'outrun';
            return;
          }
          failureKind = 'whatStands';
          reportErrorSoftly(Error(`workbook sync fault: ${fault}`), null);
          let cause = loadFaultCause(fault);
          noteCauseOfFailure(cause === null ? faultWord(fault) : 'alreadyTold');
        },
        noteCoreThrew(what: ErrorKind): void {
          noteCauseOfFailure(`opening_${what}`);
        },
        noteCalculationTookTooLong: noteWhatOthersFailed,
      };
      let worker = hasWorkerFailed ? null : await startWorkbookWorker();
      if (worker !== null) {
        endWorker = worker.end;
        let workbookOnWorker = await openWorkbookOnWorker({
          ...workbookOptions,
          timeTold,
          line: worker.line,
          onWorkerEnded: (onEnded: () => void) =>
            worker.onEnded(() => {
              hasWorkerFailed = true;
              onEnded();
            }),
          utilities,
          reportThrown(error: unknown): void {
            hasWorkerFailed = true;
            reportErrorSoftly(error, 'worker');
          },
        });
        if (workbookOnWorker !== null || !hasWorkerFailed) return workbookOnWorker;
        worker.end();
        endWorker = null;
      }
      let workbookOnThread = await openSyncedWorkbook({
        ...workbookOptions,
        newCore,
        utilities,
        newEditId: () => crypto.randomUUID(),
        newIdCode,
        wait,
        nowMs: () => performance.now(),
        calculateLater: (calculate: () => void) => void setTimeout(calculate),
      });
      return workbookOnThread === null ? null : asSameThreadWorkbook(workbookOnThread);
    };
    let earlySave: Promise<StoreOutcome> | undefined = earlyFirstSave?.nodeId === nodeId ? earlyFirstSave.sent : undefined;
    earlyFirstSave = null;
    try {
      if (content.revision <= NEW_WORKBOOK_REVISION) await storeAsk;
      let revision: number | null =
        content.revision === 0 && canWrite && !isClosedBeforeOpen() ? await makeFirstSave(0, earlySave) : content.revision;
      let revisionInLocale: number | null =
        revision !== null && localeTriesLeft === LOCALE_TRIES && !isClosedBeforeOpen() ? await bringLocaleOfNewWorkbook(revision, utilities) : revision;
      if (revisionInLocale !== null) clearFailure();
      let workbook = revisionInLocale === null || isClosedBeforeOpen() ? null : await openWorkbook(revisionInLocale);
      opened =
        workbook === null
          ? null
          : {
              workbook,
              nodeId,
            };
    } catch (error: unknown) {
      failureKind = 'whatStands';
      reportErrorSoftly(error, null);
      noteCauseOfFailure(`opening_${errorKindOf(error)}`);
    }
    if (opened === null || hasEnded()) endWorker?.();
    if (isClosedBeforeOpen()) {
      openState = 'notTried';
      openTries -= 1;
    } else openState = 'failed';
    if (openState === 'failed' && opened === null && wasOutrun() && !hasEnded()) retryOpenLater();
    if (opened === null) streamedBeforeOpen = null;
    else {
      hearWorkbook(opened.workbook);
      workbookListener?.workbookOpened({
        nodeId,
        call,
        noteFailure: noteWhatOthersFailed,
        async openViewOnly(revision: number, store: WorkbookStore): Promise<ViewOnlyVersion | null> {
          if (hasWorkerFailed) return null;
          let worker = await startWorkbookWorker();
          if (worker === null) return null;
          let onFailed: (() => void) | null = null;
          let workbook = await openWorkbookOnWorker({
            store,
            revision,
            canWrite: false,
            timeZoneOfTheBrowser,
            reportFault: (fault: SyncFault) => reportErrorSoftly(Error(`earlier version fault: ${fault}`), null),
            noteCalculationTookTooLong: noteWhatOthersFailed,
            timeTold,
            goesByTimeToldInAnyTimeZone: true,
            line: worker.line,
            onWorkerEnded: (onEnded: () => void) =>
              worker.onEnded(() => {
                onEnded();
                onFailed?.();
              }),
            utilities,
            reportThrown: reportErrorsSoftlyAt('versionHistory'),
          });
          if (workbook === null) worker.end();
          return workbook === null
            ? null
            : {
                workbook,
                end: worker.end,
                onFailed: (whenFailed: () => void) => void (onFailed = whenFailed),
              };
        },
      });
    }
    noteFirstLoadDone();
    tellPageChanged();
    bringLocaleIfDue();
  };
  let retryOpenLater = (): void => {
    failureKind = 'whatMayPass';
    partLoaded = null;
    openTries -= 1;
    openRetries += 1;
    if (!mayTryOpen()) return;
    openState = openRetries <= RETRIES_BEFORE_RESTING ? 'waiting' : 'resting';
    waitThenRetry(openRetryDelayMs(openRetries));
  };
  let waitThenRetry = async (delayMs: number): Promise<void> => {
    let token: object = {};
    retryToken = token;
    await wait(delayMs);
    if (hasEnded() || retryToken !== token) return;
    openState = 'waiting';
    if (connection.kind === 'open') tryOpen();
  };
  let sendFirstSave = (): Promise<StoreOutcome> => call(addSheetRequest(`${defaultSheetName()}1`, crypto.randomUUID()));
  let makeFirstSave = async (attempt = 0, sentEarly?: Promise<StoreOutcome>): Promise<number | null> => {
    let earlyAnswer = await sentEarly;
    let answer = earlyAnswer === undefined || earlyAnswer.kind === 'notSent' ? await sendFirstSave() : earlyAnswer;
    let revision = readUpdatedRevision(answer);
    let failure = revision !== null && revision > 0 ? null : failureOf(answer, false);
    if (failure !== null)
      noteFailure({
        ...failure,
        action: 'save',
      });
    if (revision !== null || attempt + 1 === MAX_FIRST_SAVE_TRIES) return revision;
    await wait(syncRetryDelayMs(attempt));
    return makeFirstSave(attempt + 1);
  };
  let sendFirstSaveEarly = async (): Promise<StoreOutcome> => {
    await storeAsk;
    return isClosedBeforeOpen() ? { kind: 'notSent' } : sendFirstSave();
  };
  let startFirstSaveEarly = (content: ReturnType<typeof describeSheet>): void => {
    if (isEnded || earlyFirstSave !== null || loadedSharedCode !== null) return;
    if (content.kind !== 'workbook' || content.revision !== 0 || !canViewerEdit(storeState)) return;
    earlyFirstSave = {
      nodeId: content.nodeId,
      sent: sendFirstSaveEarly(),
    };
  };
  let bringLocaleOfNewWorkbook = async (revision: number, utilities: SheetsUtilities): Promise<number> => {
    if (isBringingLocale || localeTriesLeft === 0 || isViewOnlyOrClosed()) return revision;
    if (!canViewerEdit(storeState) || isEnded) return revision;
    if (revision === revisionOfLocaleNotBrought) return revision;
    // A workbook only the agent has written in, still in the locale of a new workbook, is brought to the person's
    // locale too.
    let isNew = revision === NEW_WORKBOOK_REVISION;
    if (!isNew && !isLocaleAsNew(utilities)) return revision;
    let wanted = localesWanted();
    if (wanted === null) return revision;
    let { locales, localeOfANewWorkbook } = readLocales(utilities);
    let wantedLocale: string | undefined = wanted.flatMap((wantedOne) => locales.filter((locale) => locale === wantedOne))[0];
    if (wantedLocale === undefined || wantedLocale === localeOfANewWorkbook) {
      localeTriesLeft = 0;
      return revision;
    }
    isBringingLocale = true;
    localeTriesLeft -= 1;
    let sheetsAnswer = await call(isNew ? readSheetsRequest() : latestVersionsRequest(), true);
    let isStillBlank = isNew
      ? blankWorkbookRevision(localeOfANewWorkbook, sheetsAnswer) === revision
      : isWrittenByAgentAlone(sheetsAnswer) && (await isFirstVersionAsNew());
    let maySetLocale =
      isStillBlank &&
      !hasEnded() &&
      !isViewOnlyOrClosed() &&
      localesWanted() !== null &&
      revisionToBringLocaleTo() === revision &&
      (isNew || isLocaleAsNew(utilities));
    let answer = maySetLocale ? await call(setLocaleRequest(revision, wantedLocale, crypto.randomUUID()), true) : sheetsAnswer;
    let revisionSet = maySetLocale ? (readUpdatedRevision(answer) ?? 0) : 0;
    let isHeldBack = isStillBlank && !maySetLocale;
    let isNotToBringAgain = maySetLocale ? revisionSet > 0 && failureOf(answer, true) !== null : isNew && revisionOfAnswer(sheetsAnswer) > revision;
    if (isNotToBringAgain) revisionOfLocaleNotBrought = revision;
    if (answer.kind === 'notSent') localeTriesLeft += 1;
    else if (!isRetryableFailure(answer) && !isHeldBack && !isNotToBringAgain && !isViewOnlyOrClosed()) localeTriesLeft = 0;
    let failure = answer.kind === 'notSent' || revisionSet > 0 || revisionToBringLocaleTo() === null ? null : failureOf(answer, true);
    if (failure === null || localeTriesLeft === 0) isBringingLocale = false;
    else {
      let backoffMs = syncRetryDelayMs(LOCALE_TRIES - localeTriesLeft - 1);
      let askedWaitMs = Math.min(readRetryAfterMs(answer), MAX_LOCALE_RETRY_WAIT_MS);
      wait(Math.max(askedWaitMs, backoffMs)).then(retryLocaleNow);
    }
    if ((isHeldBack || isNotToBringAgain) && revisionToBringLocaleTo() !== revision) bringLocaleIfDue();
    return Math.max(revision, revisionSet);
  };
  let isFirstVersionAsNew = async (): Promise<boolean> => {
    let read = await workbookListener?.asItWas?.(NEW_WORKBOOK_REVISION, () => !hasEnded());
    if (read?.kind !== 'read') return false;
    let reads = read.version.workbook.reads();
    let isAsNew = reads.listSheets().every(({ sheetId }) => reads.isSheetAsNew(sheetId));
    return (read.version.end(), isAsNew);
  };
  let isLocaleAsNew = (utilities: SheetsUtilities): boolean => {
    if (opened === null || revisionToBringLocaleTo() === null || agentRest?.isKnown() !== true) return false;
    return opened.workbook.reads().locale === readLocales(utilities).localeOfANewWorkbook;
  };
  let retryLocaleNow = (): void => {
    isBringingLocale = false;
    bringLocaleIfDue();
  };
  let isViewOnlyOrClosed = (): boolean => availability === 'viewOnly' || availability === 'closed';
  let revisionToBringLocaleTo = (): number | null => {
    if (opened === null) return NEW_WORKBOOK_REVISION;
    return opened.workbook.hasUnsavedEdits() ? null : opened.workbook.revisionHeld();
  };
  let bringLocaleIfDue = (): void => {
    let revision = revisionToBringLocaleTo();
    if (opened !== null && revision !== null && loadedSharedCode?.kind === 'loaded') bringLocaleOfNewWorkbook(revision, loadedSharedCode.utilities);
  };
  let hearWorkbook = (workbook: OpenedWorkbook): void => {
    listeners.changesMayBeMissed?.();
    workbook.onEditsOfOthersMade(listeners.editsOfOthersMade);
    workbook.onEditsDropped(() => listeners.changesMayBeMissed?.());
    workbook.onLoaded((caughtUp) => {
      if (caughtUp !== null) listeners.caughtUpByLoad(caughtUp);
    });
    if (connection.kind === 'ended') workbook.storeClosed();
    workbook.tabVisibilityChanged(isTabHidden);
    if (timeTold !== null) workbook.timeTold(timeTold);
    setAvailability(availability);
    for (let { revision, applied } of streamedBeforeOpen?.edits ?? []) workbook.editStreamed(revision, applied);
    streamedBeforeOpen = null;
    reportStoreRevision();
    let kind: WorkbookState['kind'] = workbookState().kind;
    workbook.onChanged(() => {
      bringLocaleIfDue();
      if (workbookState().kind === kind) return;
      kind = workbookState().kind;
      tellPageChanged();
    });
  };
  let reportStoreRevision = (): void => {
    let content = describeSheet(storeState);
    if (!isRevisionUnreported || content.kind !== 'workbook' || content.nodeId !== opened?.nodeId) return;
    isRevisionUnreported = false;
    if (connection.kind === 'open') listeners.revisionStated?.(content.revision, false);
    opened.workbook.storeRevisionReported(content.revision);
  };
  let tellPageChanged = (): void => {
    if (isEnded) return;
    onPageChanged({
      connection,
      workbook: workbookState(),
      storeTold,
      content: describeSheet(storeState),
      isSheetJustMade: (): boolean => isSheetJustMade(storeState, timeTold, nowMs() - timeToldAt, wallNowMs()),
      viewer,
      sharedCode,
    });
  };
  let loadSharedCodeNow = async (): Promise<void> => {
    loadedSharedCode = await loadSharedCode();
    if (isEnded) return;
    sharedCode = describeLoadedSharedCode(loadedSharedCode, noteWhatOthersFailed);
    tryOpen();
    tellPageChanged();
  };
  let isAvailabilityLimited = (): boolean => {
    let refusal = opened?.workbook.refusalOfEveryEdit();
    return (availability === 'viewOnly' || availability === 'closed') && (refusal === null || refusal === 'editingPaused');
  };
  let isClosedBeforeOpen = (): boolean => opened === null && availability === 'closed' && (openState !== 'failed' || mayTryOpen());
  let shouldWatchAvailability = (): boolean => isAvailabilityLimited() || isClosedBeforeOpen();
  let setAvailability = (next: Availability | null): void => {
    let wasLimited = isAvailabilityLimited();
    let wasClosedBeforeOpen = isClosedBeforeOpen();
    availability = next;
    if (shouldWatchAvailability() && availabilityWatch === null) watchAvailability();
    if (wasClosedBeforeOpen && !isClosedBeforeOpen()) tryOpen();
    if (wasLimited && !isAvailabilityLimited() && opened !== null && workbookState().kind === 'empty') makeFirstSave();
    opened?.workbook.availabilityStated(next ?? 'open');
    if (wasLimited && !isAvailabilityLimited()) bringLocaleIfDue();
  };
  let watchAvailability = async (isNow = false): Promise<void> => {
    let token: object = {};
    availabilityWatch = token;
    if (!isNow) await wait(jitterSyncDelay(revisionPollDelayMs(isTabHidden, storeAskFailures)));
    let isStillWatched = (): boolean => !isEnded && availabilityWatch === token && shouldWatchAvailability();
    if (isStillWatched() && connection.kind === 'open' && storeTold.kind !== 'asking') {
      storeTold = {
        kind: 'notAsked',
      };
      askStoreIfDue();
      await storeAsk;
    }
    if (availabilityWatch !== token) return;
    let watchAgain = isStillWatched();
    availabilityWatch = null;
    if (watchAgain) watchAvailability();
  };
  let mayAskStore = (): boolean => storeAskFailures < MAX_STORE_ASKS;
  let askStore = async (): Promise<void> => {
    storeTold = {
      kind: 'asking',
    };
    hasAskedStore = true;
    let answer = await call(askRevisionRequest());
    let failure = failureOf(answer, true);
    let wasUnanswered = failure?.cause === 'noAnswer' || failure?.cause === 'storeFailed';
    storeAskFailures = wasUnanswered ? storeAskFailures + 1 : 0;
    let askAgain = wasUnanswered && mayAskStore();
    let snapshot = answerOf(answer);
    storeTold = askAgain
      ? {
          kind: 'notAsked',
        }
      : snapshot?.phase === 'snapshot'
        ? describeStore(snapshot as StoreSnapshot)
        : { kind: 'notStated' };
    if (storeTold.kind === 'stated') setAvailability(storeTold.availability);
    tellPageChanged();
  };
  let askStoreIfDue = (): void => {
    let content = describeSheet(storeState);
    if (isEnded || content.kind !== 'workbook' || storeTold.kind !== 'notAsked') return;
    let mayOpenSoon = opened === null && availability !== 'closed' && mayTryOpen() && (loadedSharedCode === null || loadedSharedCode.kind === 'loaded');
    if (!hasAskedStore && !isFirstLoadDone && loadedSharedCode?.kind === 'loaded' && content.revision > NEW_WORKBOOK_REVISION) return;
    if (hasAskedStore && (openState === 'trying' || mayOpenSoon)) return;
    storeAsk = askStore().catch(reportErrorsSoftlyAt('stream'));
  };
  let noteFirstLoadDone = (): void => {
    isFirstLoadDone = true;
    if (connection.kind === 'open') askStoreIfDue();
  };
  let hearFrame = (frame: Parameters<typeof reduceSheetFrame>[1]): void => {
    let { revision, timesPublished } = storeState;
    storeState = reduceSheetFrame(storeState, frame);
    if (storeState.revision !== revision) isRevisionUnreported = true;
    if (storeState.timesPublished !== timesPublished)
      for (let [widgetId, publishedAt] of storeState.timesPublished) streamListener?.publishedTimes?.(widgetId, publishedAt);
    let content = describeSheet(storeState);
    if (frame.phase === 'snapshot') {
      viewer = viewerOf(storeState);
      storeTold = describeStore(frame);
      setAvailability(storeTold.availability);
    }
    startFirstSaveEarly(content);
    let timeNow = frame.phase === 'clock' ? readClockFrame(frame) : null;
    if (timeNow !== null) {
      timeTold = timeNow;
      timeToldAt = nowMs();
      opened?.workbook.timeTold(timeNow);
    }
    let nodeId: string | undefined = opened?.nodeId ?? streamedBeforeOpen?.nodeId;
    let streamedEdit = nodeId === undefined || frame.phase !== 'edit' ? null : readStreamedEdit(frame, nodeId);
    if (streamedEdit !== null) {
      listeners.revisionStated?.(streamedEdit.revision, streamedEdit.madeUnder !== null);
      if (streamedEdit.isByAgent)
        listeners.editByAgentStreamed(streamedEdit.revision, viewer !== null && streamedEdit.madeUnder === viewer, streamedEdit.isOfLayoutAlone);
    }
    if (streamedEdit === null) reportStoreRevision();
    else if (opened === null) streamedBeforeOpen?.edits.push(streamedEdit);
    else {
      isRevisionUnreported = false;
      opened.workbook.editStreamed(streamedEdit.revision, streamedEdit.applied);
    }
    tryOpen();
    bringLocaleIfDue();
  };
  let stream = openStream({
    onEvent(event) {
      if (event.kind !== 'frame') listeners.streamChanged();
      switch (event.kind) {
        case 'opened':
          storeState = EMPTY_SHEET_STATE;
          isRevisionUnreported = false;
          connection = {
            kind: 'open',
          };
          opened?.workbook.storeReconnected();
          streamListener?.streamOpened?.({
            call,
            noteFailure: noteWhatOthersFailed,
          });
          break;
        case 'frame':
          hearFrame(event.frame);
          break;
        case 'reconnecting':
          if (connection.kind !== 'reconnecting')
            connection = {
              kind: 'reconnecting',
            };
          break;
        case 'ended':
          connection = {
            kind: 'ended',
            reason: event.reason,
          };
          opened?.workbook.storeClosed();
          break;
      }
      tellPageChanged();
    },
  });
  let stopWatchingTabs = watchTabVisibility((isHidden: boolean): void => {
    let wasHidden = isTabHidden;
    isTabHidden = isHidden;
    opened?.workbook.tabVisibilityChanged(isHidden);
    if (!isHidden) stream.retryNow();
    if (wasHidden && !isHidden && availabilityWatch !== null) watchAvailability(true);
  });
  let stopHearingRest = agentRest?.onKnown(bringLocaleIfDue);
  tellPageChanged();
  loadSharedCodeNow();
  return (): void => {
    isEnded = true;
    stopWatchingTabs();
    stopHearingRest?.();
    stream.close();
    endWorker?.();
  };
}

export const MAX_OPEN_TRIES = 3;
export const MAX_OPEN_RETRIES = 5;
export const RETRIES_BEFORE_RESTING = 2;
export const openRetryDelayMs = (retryCount: number): number => 1e4 * Math.max(1, retryCount - RETRIES_BEFORE_RESTING) * (1 + Math.random() / 2);
export const MAX_FIRST_SAVE_TRIES = 3;
export const LOCALE_TRIES = 3;
export const MAX_LOCALE_RETRY_WAIT_MS = 1e4;
export const NEW_WORKBOOK_REVISION = 1;
export const MAX_STORE_ASKS = 3;
