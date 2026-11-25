import type { EditOfAnother, SheetId } from '@open-artifact/sheets-core';
import { listCellsChangedBetween } from './changes-by-agent.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ChangedInTurnOfAgent } from '../state/event-reducer.ts';
import type { BrowserSide } from '../state/controller.ts';
import type { CaughtUpByLoad } from '../store/workbook-sync.ts';
import type { ConnectionListeners } from '../store/sheet-connection.ts';
import type { AgentActivity } from './activity.ts';
/** A run of revisions one after another, from the first to the last. */
export interface RevisionRun {
  first: number;
  last: number;
}
/** An edit of the agent streamed in after its turn ended, and when. */
interface EditAfterTurn {
  revision: number;
  atMs: number;
}
/** Follows the edits of the agent's turn, to tell which cells it changed and which runs of edits would take the turn back. */
export interface TurnChangesTracker extends Pick<ConnectionListeners, 'streamChanged' | 'caughtUpByLoad'> {
  changesMayBeMissed(): void;
  revisionStated(revision: number, isNext: boolean): void;
  editByAgentStreamed(revision: number, isOfThisTurn: boolean): void;
  editsOfOthersMade(edits: EditOfAnother[], workbookBefore: WorkbookReads | null, workbookAfter: WorkbookReads): void;
  changedInTurn(): ChangedInTurnOfAgent | null;
}
export function runsOfConsecutive(indices: number[]): RevisionRun[] {
  let runs: RevisionRun[] = [];
  for (let index of indices) {
    let lastRun = runs.at(-1);
    if (lastRun?.last === index - 1) lastRun.last = index;
    else
      runs.push({
        first: index,
        last: index,
      });
  }
  return runs;
}
export function createTurnChangesTracker(
  turn: Pick<AgentActivity, 'isWorking' | 'isTurnSeenFromItsStart' | 'onChanged'>,
  now: () => number = Date.now,
): TurnChangesTracker {
  let pendingRevisions = new Set<number>();
  let changedCellsBySheet = new Map<SheetId, Map<string, CellId>>();
  let turnRevisions: number[] = [];
  let editsAfterTurn: EditAfterTurn[] = [];
  let lastMissAtMs = Number.NEGATIVE_INFINITY;
  let statedRevision: number | null = null;
  let loadedRevision = 0;
  let turnEndedAtMs: number | null = null;
  let turnSeenFromStart = false;
  let mayHaveMissed = false;
  let hasEdits = false;
  let cellsAreComplete = false;
  let dropCells = () => void (cellsAreComplete = false);
  let isWithinTurn = () => turn.isWorking() || (turnEndedAtMs !== null && isWithinTurnSettle(turnEndedAtMs, now()));
  let noteMissedChanges = () => {
    dropCells();
    lastMissAtMs = now();
    if (isWithinTurn()) mayHaveMissed = true;
  };
  let isTurnSeenWhole = () => (turnEndedAtMs === null ? turn.isTurnSeenFromItsStart() : turnSeenFromStart);
  let areCellsKnown = () => cellsAreComplete && isTurnSeenWhole();
  let wasWorking = turn.isWorking();
  turn.onChanged(() => {
    let isWorking = turn.isWorking();
    let [hasStarted, hasEnded] = [isWorking && !wasWorking, !isWorking && wasWorking];
    wasWorking = isWorking;
    if (hasEnded) {
      turnSeenFromStart = turn.isTurnSeenFromItsStart();
      turnEndedAtMs = now();
    }
    if (!hasStarted) return;
    pendingRevisions.clear();
    changedCellsBySheet.clear();
    turnEndedAtMs = null;
    let editsInSettle = editsAfterTurn.filter(({ atMs }) => isWithinTurnSettle(atMs, now()));
    mayHaveMissed = isWithinTurnSettle(lastMissAtMs, now()) || editsInSettle.length < editsAfterTurn.length;
    turnRevisions = editsInSettle.map(({ revision }) => revision);
    editsAfterTurn = [];
    hasEdits = turnRevisions.length > 0;
    cellsAreComplete = !hasEdits;
  });
  return {
    streamChanged: noteMissedChanges,
    changesMayBeMissed: noteMissedChanges,
    revisionStated(revision, isNext) {
      if (!(isNext ? revision - 1 === statedRevision : revision <= (statedRevision ?? -1))) noteMissedChanges();
      statedRevision = Math.max(statedRevision ?? 0, revision);
    },
    editByAgentStreamed(revision, isOfThisTurn) {
      if (!turn.isWorking()) {
        if (!isOfThisTurn) return;
        if (isWithinTurn()) mayHaveMissed = true;
        editsAfterTurn = editsAfterTurn.filter(({ atMs }, index) => index === 0 || isWithinTurnSettle(atMs, now()));
        if (revision > (editsAfterTurn.at(-1)?.revision ?? 0))
          editsAfterTurn.push({
            revision,
            atMs: now(),
          });
        else noteMissedChanges();
        return;
      }
      hasEdits = true;
      if (!isOfThisTurn) dropCells();
      else if (revision > (turnRevisions.at(-1) ?? 0)) turnRevisions.push(revision);
      else noteMissedChanges();
      if (revision > loadedRevision) pendingRevisions.add(revision);
      else noteMissedChanges();
    },
    editsOfOthersMade(edits, workbookBefore, workbookAfter) {
      let matchedCount = edits.filter(({ revision }) => pendingRevisions.delete(revision)).length;
      if (matchedCount === 0 || !areCellsKnown()) return;
      let changedCells =
        workbookBefore === null || matchedCount < edits.length ? null : listCellsChangedBetween(workbookBefore, workbookAfter);
      if (changedCells === null) dropCells();
      for (let cell of changedCells ?? []) {
        let sheetCells = changedCellsBySheet.get(cell.sheetId) ?? new Map<string, CellId>();
        changedCellsBySheet.set(cell.sheetId, sheetCells.set(`${cell.rowId} ${cell.columnId}`, cell));
      }
    },
    caughtUpByLoad({ revisionBefore, revision }: CaughtUpByLoad) {
      loadedRevision = Math.max(loadedRevision, revision);
      for (let pendingRevision of pendingRevisions) {
        if (pendingRevision <= revisionBefore || pendingRevision > revision) continue;
        pendingRevisions.delete(pendingRevision);
        dropCells();
      }
    },
    changedInTurn() {
      if (!hasEdits) return null;
      let editRuns = runsOfConsecutive(turnRevisions);
      let othersInterleaved = pendingRevisions.size > 0 || loadedRevision > (statedRevision ?? 0);
      let edits =
        !mayHaveMissed && !othersInterleaved && isTurnSeenWhole() && editRuns.length > 0 && editRuns.length <= MAX_TURN_EDIT_RUNS ? editRuns : null;
      if (!areCellsKnown() || othersInterleaved)
        return {
          cellsBySheet: null,
          edits,
        };
      let cellEntries = Array.from(
        changedCellsBySheet,
        ([sheetId, cells]): [SheetId, CellId[]] => [sheetId, Array.from(cells.values())],
      );
      return {
        cellsBySheet: new Map(cellEntries),
        edits,
      };
    },
  };
}
export const MAX_TURN_EDIT_RUNS = 64;
export const TURN_SETTLE_MS = 5000;
export const isWithinTurnSettle = (atMs: number, nowMs: number): boolean => nowMs - atMs <= TURN_SETTLE_MS;
export const withTurnTakeBackGuard = (
  versionHistory: BrowserSide['versionHistory'],
  changedInTurn: () => ChangedInTurnOfAgent | null,
): BrowserSide['versionHistory'] => ({
  ...versionHistory,
  editsThatTakeBack: (request) =>
    request.kind === 'only' && (changedInTurn()?.edits ?? null) === null
      ? Promise.resolve({
          kind: 'notRead',
          why: 'refused',
        })
      : versionHistory.editsThatTakeBack(request),
});
