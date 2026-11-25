import { failureOf } from '../store/workbook-node.ts';
import { syncRetryDelayMs } from '../store/workbook-sync.ts';
import {
  editsThatTakeBackRequest,
  readEditsThatTakeBack,
  whyRevisionNotLoaded,
  versionsRequest,
  readVersions,
  cellHistoryRequest,
  readCellHistory,
  rowHistoryRequest,
  readRowHistory,
} from './requests.ts';
import { loadAtRevisionRequest, readLoadedOps, type LoadedOps } from '../store/requests.ts';
import type { StoreCall, StoreOutcome } from '../store/sheet-stream.ts';
import type { OpenedNode, ViewOnlyVersion } from '../store/sheet-connection.ts';
import { reportErrorSoftly } from '../engine/loader.ts';
import type { BrowserSide } from '../state/controller.ts';
import type {
  CellHistoryOutcome,
  EditsThatTakeBackOutcome,
  VersionsReadOutcome,
  WhyVersionNotShown,
} from '../state/event-reducer.ts';
import type { TakeBack } from './requests.ts';

/** An earlier version opened to be looked at, or why it was not. */
export type EarlierVersionOpened = { kind: 'read'; version: ViewOnlyVersion } | { kind: 'notRead'; why: WhyVersionNotShown };

/** The reads of the history the page asks of the store, and the earlier versions it opens. */
export type VersionHistoryReader = BrowserSide['versionHistory'] & {
  workbookOpened(node: OpenedNode): void;
  asItWas(revision: number, isStillWanted: () => boolean): Promise<EarlierVersionOpened>;
};

/** Any read of the history: of the versions, of edits that take back, or of the changes of a cell or row. */
type HistoryRead = VersionsReadOutcome | EditsThatTakeBackOutcome | CellHistoryOutcome;

export function createVersionHistoryReader(deps: { newOpId: () => string; wait: (ms: number) => Promise<void> }): VersionHistoryReader {
  let workbookNode: OpenedNode | null = null;
  // Each queue holds the last read asked for, so the next waits for it; what it came to is not looked at.
  let changesQueue: Promise<CellHistoryOutcome | void> = Promise.resolve();
  let asItWasQueue: Promise<EarlierVersionOpened | void> = Promise.resolve();
  let cachedVersions = new Map<number, LoadedOps>();
  let keepVersion = (revision: number, loaded: LoadedOps): void => {
    cachedVersions.delete(revision);
    cachedVersions.set(revision, loaded);
    for (let oldRevision of [...cachedVersions.keys()].slice(0, -MAX_CACHED_VERSION_BODIES)) cachedVersions.delete(oldRevision);
  };
  let askNode = async <Read extends HistoryRead>(
    requestFor: () => StoreCall,
    readReply: (reply: StoreOutcome) => Read,
    isStillWanted: () => boolean = () => true,
    attempt: number = 0,
  ): Promise<Read> => {
    if (workbookNode === null)
      return readReply({
        kind: 'notSent',
      });
    let { call, noteFailure } = workbookNode;
    let reply = await call(requestFor());
    let answer = readReply(reply);
    let isAnswerFine = answer.kind === 'read' || answer.why === 'changedSince' || answer.why === 'cellIsGone';
    let failure = isAnswerFine && answer.kind === 'notRead' ? null : failureOf(reply, isAnswerFine);
    if (failure !== null)
      noteFailure({
        ...failure,
        action: 'readHistory',
      });
    if (!(answer.kind === 'notRead' && answer.why === 'busy') || attempt + 1 === MAX_HISTORY_READ_TRIES) return answer;
    await deps.wait(syncRetryDelayMs(attempt));
    return isStillWanted() ? askNode(requestFor, readReply, isStillWanted, attempt + 1) : answer;
  };
  let collectEditsThatTakeBack = (takeBack: TakeBack): Promise<EditsThatTakeBackOutcome> =>
    askNode(() => editsThatTakeBackRequest(takeBack), readEditsThatTakeBack);
  let openAsItWas = async (revision: number, isStillWanted: () => boolean): Promise<EarlierVersionOpened> => {
    let node = workbookNode;
    if (node === null)
      return {
        kind: 'notRead',
        why: 'noAnswer',
      };
    if (node.openViewOnly === undefined)
      return {
        kind: 'notRead',
        why: 'notOffered',
      };
    let { call, noteFailure } = node;
    let isStillCurrent = () => isStillWanted() && workbookNode === node;
    let whyNotRead: WhyVersionNotShown = 'notOffered';
    let version = await node.openViewOnly(revision, {
      async loadOps() {
        if (!isStillCurrent()) return null;
        let cached = cachedVersions.get(revision);
        if (cached !== undefined) {
          keepVersion(revision, cached);
          return cached;
        }
        let reply = await call(loadAtRevisionRequest(revision));
        let loaded = readLoadedOps(reply);
        let ops = loaded !== null && typeof loaded === 'object' && 'ops' in loaded && loaded.revision === revision ? loaded : null;
        if (ops === null) whyNotRead = whyRevisionNotLoaded(reply);
        else keepVersion(revision, ops);
        let failure = failureOf(reply, ops !== null);
        if (failure !== null)
          noteFailure({
            ...failure,
            action: 'readHistory',
          });
        return loaded === 'pageOutOfDate' ? loaded : ops;
      },
      save: () =>
        Promise.resolve({
          kind: 'notSent',
        }),
      askRevision: () => Promise.resolve(revision),
    });
    if (!isStillCurrent()) version?.end();
    if (!isStillCurrent())
      return {
        kind: 'notRead',
        why: 'calledOff',
      };
    return version === null
      ? {
          kind: 'notRead',
          why: whyNotRead,
        }
      : {
          kind: 'read',
          version,
        };
  };
  let asItWas = (revision: number, isStillWanted: () => boolean): Promise<EarlierVersionOpened> => {
    let opened: Promise<EarlierVersionOpened> = asItWasQueue
      .then(
        (): Promise<EarlierVersionOpened> | EarlierVersionOpened =>
          isStillWanted()
            ? openAsItWas(revision, isStillWanted)
            : {
                kind: 'notRead',
                why: 'calledOff',
              },
      )
      .catch(
        (error: unknown) => (
          reportErrorSoftly(error, 'versionHistory'),
          {
            kind: 'notRead',
            why: 'refused',
          }
        ),
      );
    asItWasQueue = opened;
    return opened;
  };
  let queueChangesRead = (
    requestFor: () => StoreCall,
    readReply: (reply: StoreOutcome) => CellHistoryOutcome,
    isStillWanted: () => boolean,
  ): Promise<CellHistoryOutcome> => {
    let changesRead = changesQueue.then(
      () =>
        isStillWanted()
          ? askNode(requestFor, readReply, isStillWanted)
          : readReply({
              kind: 'notSent',
            }),
    );
    changesQueue = changesRead;
    return changesRead;
  };
  return {
    workbookOpened(node) {
      workbookNode = node;
      cachedVersions.clear();
    },
    asItWas,
    versions: (before) => askNode(() => versionsRequest(before ?? null), readVersions),
    editsThatTakeBack: (takeBack) => collectEditsThatTakeBack(takeBack),
    changesOfCell: (cell, isStillWanted) =>
      queueChangesRead(
        () => cellHistoryRequest(cell),
        (reply) => readCellHistory(reply, cell.columnId),
        isStillWanted,
      ),
    changesOfRow: (row, isStillWanted) =>
      queueChangesRead(() => rowHistoryRequest(row), readRowHistory, isStillWanted),
  };
}
export const MAX_CACHED_VERSION_BODIES = 4;
export const MAX_HISTORY_READ_TRIES = 3;
