import type { CellWrittenFromAnInteractive, IdRun, InputOfAWidget, Reference, SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellSelection, RangeWalked } from '../selection/model.ts';
import type { PageState, SavedPlace } from './initial-state.ts';
import type { PlaceAreaChanged } from './event-reducer.ts';
import type { PageTransition } from './transitions.ts';
import type { ChartOfView } from '../charts/placed-views.ts';
import { findSheetById } from '../grid/layout.ts';
import { cachedChartOfView } from '../charts/placed-views.ts';
import { withNoEffects } from './transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { leadingRunCount, collapsedIndexRuns } from '../grid/line-runs.ts';
import { selectionAtCell, isSameCell, selectionAreaAndKind } from '../selection/model.ts';
/** Where the page stands on a sheet: the selection and how far the grid is scrolled. */
export interface Place {
  sheetId: SheetId;
  activeCell: CellId;
  selectionCorner: CellId;
  rangeWalked?: RangeWalked | null;
  scrollLeft: number;
  scrollTop: number;
}
/** A place with the whole selection told, as a sheet opens on it. */
export type PlaceAtCell = Place & CellSelection;
/** A place kept as it was left, without the fingerprint of the lines its selection took. */
export type PlaceRestored = Place | Omit<SavedPlace, 'lines'>;
/** How many formulas of other sheets read a sheet, and the names of those sheets. */
export interface FormulasReadingSheet {
  count: number;
  sheetNames: [string, ...string[]];
}
export function formulasReadingSheet(workbook: WorkbookReads, sheetId: SheetId): FormulasReadingSheet | null {
  let readsSheet = (reference: Reference) =>
    reference.sheetId === sheetId &&
    (reference.kind !== 'cell' ||
      (workbook.rowIndexOf(sheetId, reference.cell.r) !== null && workbook.columnIndexOf(sheetId, reference.cell.c) !== null));
  let formulaCount: number = 0;
  let sheetNames: string[] = [];
  for (let { sheetId: otherSheetId, name: otherSheetName } of workbook.listSheets()) {
    if (otherSheetId === sheetId) continue;
    let countBefore = formulaCount;
    for (let row of workbook.cellsHeldByRow(otherSheetId).values())
      for (let { input } of row.values())
        if (input.kind === 'formula' && input.formula.references.some(readsSheet)) formulaCount += 1;
    if (formulaCount > countBefore) sheetNames.push(otherSheetName);
  }
  let [firstName, ...otherNames] = sheetNames;
  return firstName === undefined
    ? null
    : {
        count: formulaCount,
        sheetNames: [firstName, ...otherNames],
      };
}
/** The interactive a sheet shows in place of its cells: its view, the sheet's name, its code, and what it may do. */
export interface InteractiveSheet {
  viewId: string;
  name: string;
  code: ChartOfView;
  doesWrite: boolean;
  canBeReset: boolean;
  hasDefaultsToSave: boolean;
}
/** The edits made to an interactive as a whole: write back the values it keeps, or keep the values it holds now. */
export type EditOfWholeInteractive = 'resetInteractive' | 'saveDefaultsOfInteractive';
/** What was done last to an interactive as a whole. */
export interface InteractiveDone {
  what: 'interactiveReset' | 'interactiveDefaultsSaved';
}
export function interactiveSheetOf(workbook: WorkbookReads, sheetId: SheetId): InteractiveSheet | null {
  let sheet = findSheetById(workbook, sheetId);
  if (sheet === undefined || sheet.interactive === null) return null;
  let view = workbook.viewAsItStands(sheet.interactive);
  return {
    viewId: sheet.interactive,
    name: sheet.name,
    code: cachedChartOfView(view),
    doesWrite: view?.view.elements.some((element) => element.kind === 'interactive' && element.writes.length > 0) === true,
    canBeReset: view?.canBeReset === true,
    hasDefaultsToSave: view?.hasDefaultsToSave === true,
  };
}
export function isAreaReadByInteractive(state: PageState, workbook: WorkbookReads, { sheetId, area }: Partial<PlaceAreaChanged> = {}): boolean {
  let viewId = interactiveOfSheet(workbook, state.sheetId);
  if (viewId === null || area === null) return false;
  return (workbook.viewAsItStands(viewId)?.view.elements.flatMap((element): InputOfAWidget[] => element.inputs) ?? []).some(
    ({ range: { sheetId: inputSheetId, topLeft, bottomRight } }) => {
      let corners = [topLeft, bottomRight];
      // A place with no sheet reads no input, so `sheetId` and `area` are there past the first test.
      return (
        inputSheetId === sheetId &&
        spanReachesIndexes(
          area!.topRowIndex,
          area!.rowCount,
          corners.map(({ r: rowId }) => workbook.rowIndexOf(sheetId!, rowId)),
        ) &&
        spanReachesIndexes(
          area!.leftColumnIndex,
          area!.columnCount,
          corners.map(({ c: columnId }) => workbook.columnIndexOf(sheetId!, columnId)),
        )
      );
    },
  );
}
export function editInteractiveOfSheet(state: PageState, workbook: WorkbookReads, kind: EditOfWholeInteractive): PageTransition {
  let viewId = interactiveOfSheet(workbook, state.sheetId);
  if (viewId === null) return withNoEffects(state);
  return queueEdit(
    state,
    {
      kind,
      viewId,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: kind === 'resetInteractive' ? 'interactiveReset' : 'interactiveDefaultsSaved',
      },
    },
  );
}
export function firstPlaceInSheet(workbook: WorkbookReads, sheetId: SheetId): PlaceAtCell | null {
  let sheet = findSheetById(workbook, sheetId);
  let firstCell = workbook.cellIdAt(
    sheetId,
    leadingRunCount(collapsedIndexRuns(sheet?.rowGroups ?? [])),
    leadingRunCount(collapsedIndexRuns(sheet?.columnGroups ?? [])),
  );
  return firstCell === null
    ? null
    : {
        sheetId,
        ...selectionAtCell(firstCell),
        scrollLeft: 0,
        scrollTop: 0,
      };
}
export function firstPlaceInWorkbook(workbook: WorkbookReads): PlaceAtCell | null {
  for (let { sheetId } of workbook.listSheets()) {
    let place = firstPlaceInSheet(workbook, sheetId);
    if (place !== null) return place;
  }
  return null;
}
export function fingerprintLineRuns(runs: readonly IdRun[]): string {
  let merged: IdRun[] = [];
  for (let run of runs) {
    let lastRun = merged.at(-1);
    if (lastRun !== undefined && lastRun.base === run.base && lastRun.first + lastRun.count === run.first)
      merged[merged.length - 1] = {
        ...lastRun,
        count: lastRun.count + run.count,
      };
    else merged.push(run);
  }
  let [hash, lineCount]: [number, number] = [2166136261, 0];
  for (let { base, first, count } of merged) {
    lineCount += count;
    let key = `${base}.${first}+${count};`;
    for (let index: number = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return `${lineCount}:${(hash >>> 0).toString(36)}`;
}
export function selectionLinesFingerprint(selectionState: Pick<CellSelection, 'activeCell' | 'selectionCorner'>, workbook: WorkbookReads): string | null {
  if (isSameCell(selectionState.activeCell, selectionState.selectionCorner)) return null;
  let area: CellArea | undefined = selectionAreaAndKind(selectionState, workbook)?.area;
  let lines = workbook.linesOf(selectionState.activeCell.sheetId);
  if (area === undefined || lines === null) return null;
  let rowRuns = lines.rows.runsIn({
    firstIndex: area.topRowIndex,
    count: area.rowCount,
  });
  let columnRuns = lines.columns.runsIn({
    firstIndex: area.leftColumnIndex,
    count: area.columnCount,
  });
  return `${fingerprintLineRuns(rowRuns)} ${fingerprintLineRuns(columnRuns)}`;
}
export function restoredPlace(workbook: WorkbookReads, place: SavedPlace | null): PlaceRestored | null {
  if (place === null) return firstPlaceInWorkbook(workbook);
  let { lines, ...placeWithoutLines } = place;
  if (workbook.positionOfCell(placeWithoutLines.activeCell) === null)
    return firstPlaceInSheet(workbook, placeWithoutLines.sheetId) ?? firstPlaceInWorkbook(workbook);
  return lines !== null && lines === selectionLinesFingerprint(placeWithoutLines, workbook)
    ? placeWithoutLines
    : {
        ...placeWithoutLines,
        ...selectionAtCell(placeWithoutLines.activeCell),
      };
}
export const interactiveOfSheet = (workbook: WorkbookReads, sheetId: SheetId): string | null =>
  findSheetById(workbook, sheetId)?.interactive ?? null;
/** Whether the run of `count` lines from `firstIndex` reaches the span between the indexes, when every index is known. */
export const spanReachesIndexes = (firstIndex: number, count: number, indexes: (number | null)[]): boolean =>
  indexes.every((index): index is number => index !== null) &&
  firstIndex <= Math.max(...indexes) &&
  firstIndex + count > Math.min(...indexes);
export const writeFromInteractive = (
  state: PageState,
  workbook: WorkbookReads,
  viewId: string,
  cells: readonly CellWrittenFromAnInteractive[],
): PageTransition =>
  workbook.listSheets().some(({ interactive }) => interactive === viewId)
    ? queueEdit(
        state,
        {
          kind: 'writeFromInteractive',
          viewId,
          cells: [...cells],
        },
        {
          ...IF_QUEUED_DEFAULTS,
          select: null,
          done: null,
        },
      )
    : withNoEffects(state);
