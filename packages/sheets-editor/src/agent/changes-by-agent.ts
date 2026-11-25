import type { CellContents, EditOfAnother, PlaceChanged, SheetId } from '@open-artifact/sheets-core';
import type { StockKind } from '@open-artifact/sheets-core/stock-charts';
import { cachedSelectedArea } from '../presence/selections.ts';
import { unionOfAreas, areaGrownOverMerges, selectedArea, type CellArea, type CellPosition } from '../selection/model.ts';
import { reportErrorSoftly } from '../engine/loader.ts';
import type { CellId, PlacementOnGrid, WorkbookReads } from '../model/workbook.ts';
import type { LineIndex } from '../model/line-ids.ts';
import type { ChangeByAgent, CellsChanged } from '../state/initial-state.ts';
import type { ChangeArrivedFromAgent, PlaceAreaChanged } from '../state/event-reducer.ts';
import type { ConnectionListeners } from '../store/sheet-connection.ts';
import type { CaughtUpByLoad } from '../store/workbook-sync.ts';
import type { AgentActivity } from './activity.ts';
import type { ChartCardOpening } from '../selection/table-select.ts';
/** A change, or a mark of one, by the cells it touched. */
export interface CellsOfChange {
  cells: CellsChanged;
}
/** A place an edit changed, and the cells in it that changed; `changed` is empty when all of them did. */
export interface CellsChangedInPlace {
  place: PlaceChanged | null;
  changed: CellPosition[];
}
/** The cells an edit changed in one sheet, with how many rows of them are filled. */
interface CellsChangedInSheetPlace extends CellsChangedInPlace {
  place: PlaceChanged;
  rowsFilled: number;
}
/** An edit of the agent streamed in, waiting to be matched to the place it changed. */
interface EditStreamed {
  isOfViewer: boolean;
  isOfLayoutAlone: boolean;
  streamedAtMs: number;
}
/** The last change of a run, marked without a fade until the agent stops working or the wait runs out. */
interface ChangeHeld {
  change: ChangeArrivedFromAgent;
  onShowAtMs: number;
}
/** Follows the edits the agent streams in and turns them into changes to mark on the cells. */
export interface ChangesByAgentTracker
  extends Pick<ConnectionListeners, 'streamChanged' | 'editByAgentStreamed' | 'editsOfOthersMade' | 'caughtUpByLoad'> {
  onChanged(listener: (changes: ChangeArrivedFromAgent[]) => void): () => void;
}
/** How the agent's making of a chart came out: the chart added, or why none was. */
export type ChartOutcomeOfAgent =
  | { nodeId: string }
  | 'full'
  | 'codeRefused'
  | 'notMade'
  | 'stopped'
  | 'noAgent'
  | 'tooLarge'
  | 'forChat'
  | 'notChanged';
/** How an ask for a chart ended, as it is counted. */
export type ChartEndWord =
  | 'by_page'
  | 'by_page_late'
  | 'by_agent'
  | 'cant_be_shown'
  | 'refused'
  | 'failed'
  | 'stopped'
  | 'left'
  | 'busy'
  | 'waiting'
  | 'no_cells'
  | 'filter'
  | 'for_chat'
  | 'to_chat'
  | 'chat_no_agent'
  | 'not_to_chat'
  | 'no_agent'
  | 'too_large'
  | 'full';
/** Who made the chart asked for: the page from a stock program, or the agent. */
export type ChartLane = 'page' | 'agent';
/** How a chart was asked for, as it is counted. */
export type ChartAskKindWord = 'typed' | 'quick' | 'suggested' | 'plain_kind';
/** A step of the chart card, as it is counted: opened, an ask pressed, and how the ask ended. */
export type ChartCardCount =
  | { step: 'open'; what: ChartCardOpening }
  | { step: 'press'; what: ChartAskKindWord }
  | { step: 'end'; what: ChartEndWord; lane: ChartLane };
/** The health of an ask for a chart: whether it inserted or generated one, and how that went. */
export type ChartEndHealth =
  | [kind: 'insert' | 'generate', outcome: 'success']
  | [kind: 'insert' | 'generate', outcome: 'failure', reason: 'invalid_content']
  | [kind: 'insert' | 'generate', outcome: 'aborted'];
export function gapBetweenAreas(area: CellArea, other: CellArea): number {
  let rowGap = gapBetweenSpans(area.topRowIndex, area.rowCount, other.topRowIndex, other.rowCount);
  let columnGap = gapBetweenSpans(area.leftColumnIndex, area.columnCount, other.leftColumnIndex, other.columnCount);
  return rowGap > 0 && columnGap > 0 ? 1 / 0 : rowGap + columnGap;
}
export function areaCoveringChanges(changes: readonly CellsOfChange[], workbook: WorkbookReads): CellArea | null {
  return changes.reduce<CellArea | null>((covering, { cells }) => {
    let area = cachedSelectedArea(cells, workbook);
    return covering === null || area === null ? (covering ?? area) : unionOfAreas(covering, area);
  }, null);
}
export function changesSpanWholeLines(changes: readonly CellsOfChange[], workbook: WorkbookReads): boolean {
  let area = areaCoveringChanges(changes, workbook);
  let sheetId = changes[0]?.cells.activeCell.sheetId;
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === sheetId);
  return area !== null && sheet !== undefined && (area.rowCount === sheet.rowCount || area.columnCount === sheet.columnCount);
}
export function collectChangesNear<T>(area: CellArea, candidates: T[], areaOf: (candidate: T) => CellArea | null, maxGap: number): T[] {
  let grownArea = area;
  let near = candidates.filter((candidate) => {
    let candidateArea = areaOf(candidate);
    if (candidateArea === null || gapBetweenAreas(candidateArea, area) > maxGap) return false;
    grownArea = unionOfAreas(grownArea, candidateArea);
    return true;
  });
  if (near.length === 0) return near;
  let rest = candidates.filter((candidate) => !near.includes(candidate));
  return [...near, ...collectChangesNear(grownArea, rest, areaOf, 0)];
}
export function clusterChangedCells(cells: CellPosition[], columnCount: number, maxClusters: number): CellArea[] | null {
  let keyOf = (rowIndex: number, columnIndex: number) => rowIndex * (columnCount + CHANGED_CELL_CLUSTER_GAP) + columnIndex;
  let cellsByKey = new Map(cells.map((cell) => [keyOf(cell.rowIndex, cell.columnIndex), cell]));
  let clusters: CellArea[] = [];
  for (let [key, cell] of cellsByKey) {
    if (clusters.length === maxClusters) return null;
    cellsByKey.delete(key);
    let cluster = [cell];
    let [topRow, leftColumn, bottomRow, rightColumn] = [cell.rowIndex, cell.columnIndex, cell.rowIndex, cell.columnIndex];
    for (let { rowIndex, columnIndex } of cluster) {
      [topRow, leftColumn] = [Math.min(topRow, rowIndex), Math.min(leftColumn, columnIndex)];
      [bottomRow, rightColumn] = [Math.max(bottomRow, rowIndex), Math.max(rightColumn, columnIndex)];
      for (let [rowOffset, columnOffset] of CLUSTER_NEIGHBOUR_OFFSETS) {
        let neighbourKey = keyOf(rowIndex + rowOffset, columnIndex + columnOffset);
        let neighbour = cellsByKey.get(neighbourKey);
        if (neighbour === undefined) continue;
        cellsByKey.delete(neighbourKey);
        cluster.push(neighbour);
      }
    }
    clusters.push({
      topRowIndex: topRow,
      leftColumnIndex: leftColumn,
      rowCount: bottomRow - topRow + 1,
      columnCount: rightColumn - leftColumn + 1,
    });
  }
  return clusters;
}
export function mergeClustersOfChangedCells(clusters: CellArea[], sheetId: SheetId, workbook: WorkbookReads): CellArea[] | null {
  if (clusters.length > MAX_CHANGED_CELL_CLUSTERS) return null;
  let areas: CellArea[] = [];
  for (let cluster of clusters) {
    let area = areaGrownOverMerges(workbook, sheetId, cluster);
    for (;;) {
      let near = collectChangesNear(area, areas, (areaNear) => areaNear, CHANGED_CELL_CLUSTER_GAP);
      if (near.length === 0) break;
      areas = areas.filter((areaKept) => !near.includes(areaKept));
      area = areaGrownOverMerges(workbook, sheetId, near.reduce(unionOfAreas, area));
    }
    areas.push(area);
  }
  areas.sort(
    (a, b) => (a.topRowIndex === b.topRowIndex ? a.leftColumnIndex - b.leftColumnIndex : a.topRowIndex - b.topRowIndex),
  );
  return areas;
}
export function mergeChangedCellAreas(cells: CellPosition[], sheetId: SheetId, workbook: WorkbookReads): CellArea[] | null {
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === sheetId);
  let clusters = sheet === undefined ? null : clusterChangedCells(cells, sheet.columnCount, MAX_CHANGED_CELL_CLUSTERS);
  return clusters === null ? null : mergeClustersOfChangedCells(clusters, sheetId, workbook);
}
export function selectionsApartForChangedCells(cells: CellPosition[], sheetId: SheetId, workbook: WorkbookReads): CellsChanged[] {
  let areas = mergeChangedCellAreas(cells, sheetId, workbook) ?? [];
  if (areas.length < 2 || areas.length > MAX_CHANGE_GROUPS_APART) return [];
  let selections = areas.flatMap(
    ({ topRowIndex, leftColumnIndex, rowCount, columnCount }) => {
      let activeCell = workbook.cellIdAt(sheetId, topRowIndex, leftColumnIndex);
      let selectionCorner = workbook.cellIdAt(sheetId, topRowIndex + rowCount - 1, leftColumnIndex + columnCount - 1);
      return activeCell === null || selectionCorner === null
        ? []
        : [
            {
              activeCell,
              selectionCorner,
            },
          ];
    },
  );
  return selections.length === areas.length ? selections : [];
}
export function mergeChangesByAgent(marks: ChangeByAgent[], changes: ChangeArrivedFromAgent[], workbook: WorkbookReads): ChangeByAgent[] {
  let isRevisionJoined = (revision: number) =>
    marks.some(({ joinedWith }) => joinedWith.some((joined) => joined.revision === revision));
  let addChange = (
    marksSoFar: ChangeByAgent[],
    { revision, fadeBeginsAtMs, isOfLayoutAlone, isOfViewer }: ChangeArrivedFromAgent,
    selections: CellsChanged[],
    groupBase: number,
  ) => {
    let marksAfter = [...marksSoFar];
    for (let [index, selection] of selections.entries()) {
      let sameSheetMarks = marksAfter.filter(
        (mark) => mark.cells.activeCell.sheetId === selection.activeCell.sheetId && !mark.isOfWholeLines,
      );
      let area = areaCoveringChanges(
        [
          {
            cells: selection,
          },
        ],
        workbook,
      );
      let near =
        area === null ||
        changesSpanWholeLines(
          [
            {
              cells: selection,
            },
          ],
          workbook,
        )
          ? []
          : collectChangesNear(
              area,
              sameSheetMarks,
              (mark) => areaCoveringChanges([...mark.joinedWith, mark], workbook),
              CHANGE_JOIN_GAP,
            );
      let joinedWith = near.flatMap(
        (mark) => [
          ...mark.joinedWith,
          {
            revision: mark.revision,
            cells: mark.cells,
          },
        ],
      );
      marksAfter = marksAfter.filter((mark) => !near.includes(mark));
      marksAfter.push({
        revision,
        cells: selection,
        group: groupBase + index,
        fadeBeginsAtMs,
        joinedWith,
        stoodAsOneMark: near.length === 1,
        isOfWholeLines: changesSpanWholeLines(
          [
            ...joinedWith,
            {
              cells: selection,
            },
          ],
          workbook,
        ),
        ...(isOfLayoutAlone === true && {
          isOfLayoutAlone,
        }),
        ...(isOfViewer === true && {
          isOfViewer,
        }),
      });
    }
    return marksAfter;
  };
  let merged: ChangeByAgent[] = [];
  for (let change of changes) {
    let { revision, fadeBeginsAtMs } = change;
    let sameRevision = marks.filter((mark) => mark.revision === revision);
    merged.push(
      ...sameRevision.map(
        (mark) => ({
          ...mark,
          fadeBeginsAtMs,
        }),
      ),
    );
    if (sameRevision.length > 0 || isRevisionJoined(revision)) continue;
    let groupIndex = 0;
    for (let { cells, groupsApart = [cells] } of [...(change.inOtherSheets ?? []), change]) {
      let mergedInto = addChange(merged, change, groupsApart, groupIndex);
      merged = mergedInto.some((mark) => mark.joinedWith.some((joined) => joined.revision === revision))
        ? addChange(merged, change, [cells], groupIndex)
        : mergedInto;
      groupIndex += groupsApart.length;
    }
  }
  return merged;
}
export function linesKeepTheirOrder(before: LineIndex, after: LineIndex): boolean {
  let nextIndex = 0;
  for (let run of before.runsIn({
    firstIndex: 0,
    count: before.count,
  })) {
    let coveredCount = 0;
    for (let { firstIndex, count } of after.stretchesOf(run)) {
      if (firstIndex < nextIndex) return false;
      nextIndex = firstIndex + count;
      coveredCount += count;
    }
    if (coveredCount < run.count) return false;
  }
  return true;
}
export function isSameCellInput(before: CellContents | undefined, after: CellContents | undefined): boolean {
  if (before === undefined || before.input.kind !== after?.input.kind) return false;
  if ('value' in before.input && 'value' in after.input) return before.input.value === after.input.value;
  return JSON.stringify(before.input) === JSON.stringify(after.input) && before.dropdownOption?.label === after.dropdownOption?.label;
}
export function listCellsChangedBetween(before: WorkbookReads, after: WorkbookReads): CellId[] | null {
  let changed: CellId[] = [];
  for (let { sheetId } of before.listSheets()) {
    let [beforeLines, afterLines] = [before.linesOf(sheetId), after.linesOf(sheetId)];
    if (beforeLines === null || afterLines === null) return null;
    if (before.sheetAsItStands(sheetId) === after.sheetAsItStands(sheetId)) continue;
    if (!linesKeepTheirOrder(beforeLines.rows, afterLines.rows)) return null;
    if (!linesKeepTheirOrder(beforeLines.columns, afterLines.columns)) return null;
  }
  for (let { sheetId } of after.listSheets()) {
    let rowsBefore = before.cellsHeldByRow(sheetId);
    let rowsAfter = after.cellsHeldByRow(sheetId);
    if (rowsBefore === rowsAfter) continue;
    for (let [rowId, rowCells] of rowsAfter) {
      let otherRowCells = rowsBefore.get(rowId);
      if (otherRowCells === rowCells) continue;
      let columnIds = otherRowCells === undefined ? rowCells.keys() : rowCells.columnsThatReadOtherwiseIn(otherRowCells);
      for (let columnId of columnIds)
        if (otherRowCells === undefined || !isSameCellInput(otherRowCells.get(columnId), rowCells.get(columnId)))
          changed.push({
            sheetId,
            rowId,
            columnId,
          });
    }
    for (let [rowId, rowCells] of rowsBefore) {
      let otherRowCells = rowsAfter.get(rowId);
      if (rowCells === otherRowCells) continue;
      for (let columnId of rowCells.keys())
        if (otherRowCells?.has(columnId) !== true)
          changed.push({
            sheetId,
            rowId,
            columnId,
          });
    }
  }
  return changed;
}
export function resolvePlaceArea(place: PlaceChanged | null, workbook: WorkbookReads): PlaceAreaChanged | null {
  if (place === null) return null;
  let { sheetId, cells, placementId } = place;
  let placement =
    placementId === undefined
      ? {}
      : {
          placementId,
        };
  let positionOf = ({ r: rowId, c: columnId }: { r: CellId['rowId']; c: CellId['columnId'] }) =>
    workbook.positionOfCell({
      sheetId,
      rowId,
      columnId,
    });
  let [topLeft, bottomRight] = cells === null ? [null, null] : [positionOf(cells.topLeft), positionOf(cells.bottomRight)];
  if (topLeft === null || bottomRight === null)
    return {
      sheetId,
      area: null,
      ...placement,
    };
  return {
    sheetId,
    ...placement,
    area: {
      topRowIndex: topLeft.rowIndex,
      leftColumnIndex: topLeft.columnIndex,
      rowCount: bottomRight.rowIndex - topLeft.rowIndex + 1,
      columnCount: bottomRight.columnIndex - topLeft.columnIndex + 1,
    },
  };
}
export function placeCoveringCells(
  sheetId: SheetId,
  [first, ...rest]: CellPosition[],
  workbook: WorkbookReads,
): { place: PlaceChanged; cellCount: number } | null {
  if (first === undefined) return null;
  let [topRow, leftColumn, bottomRow, rightColumn] = [first.rowIndex, first.columnIndex, first.rowIndex, first.columnIndex];
  for (let { rowIndex, columnIndex } of rest) {
    [topRow, leftColumn] = [Math.min(topRow, rowIndex), Math.min(leftColumn, columnIndex)];
    [bottomRow, rightColumn] = [Math.max(bottomRow, rowIndex), Math.max(rightColumn, columnIndex)];
  }
  let [topLeftCell, bottomRightCell] = [workbook.cellIdAt(sheetId, topRow, leftColumn), workbook.cellIdAt(sheetId, bottomRow, rightColumn)];
  if (topLeftCell === null || bottomRightCell === null) return null;
  return {
    place: {
      sheetId,
      cells: {
        topLeft: {
          r: topLeftCell.rowId,
          c: topLeftCell.columnId,
        },
        bottomRight: {
          r: bottomRightCell.rowId,
          c: bottomRightCell.columnId,
        },
      },
    },
    cellCount: (bottomRow - topRow + 1) * (rightColumn - leftColumn + 1),
  };
}
export function findChangedPlacesBySheet(
  before: WorkbookReads,
  after: WorkbookReads,
  onlyNewSheets: boolean,
): CellsChangedInSheetPlace[] | null {
  let sheetIdsBefore = new Set(before.listSheets().map(({ sheetId }) => sheetId));
  let isChanged = didCellInputChange(before, after);
  let changedCells = onlyNewSheets ? null : listCellsChangedBetween(before, after);
  let sheetsToScan = after.listSheets().filter(({ sheetId }) => !onlyNewSheets || !sheetIdsBefore.has(sheetId));
  let isTooBigToScan = ({ sheetId }: { sheetId: SheetId }) =>
    sheetIdsBefore.has(sheetId) &&
    [...after.cellsHeldByRow(sheetId).values()].reduce((count, rowCells) => count + rowCells.size, 0) >
      MAX_CHANGED_CELLS_LISTED;
  if (changedCells === null && sheetsToScan.some(isTooBigToScan)) return null;
  let changed =
    changedCells?.filter(isChanged) ??
    sheetsToScan.flatMap(({ sheetId, rowCount, columnCount }) => {
      let filled = after.filledCellsIn(sheetId, {
        topRowIndex: 0,
        leftColumnIndex: 0,
        rowCount,
        columnCount,
      });
      return sheetIdsBefore.has(sheetId) ? filled.filter(isChanged) : filled;
    });
  let positionsOf = (cellIds: CellId[]) => cellIds.flatMap((cellId) => after.positionOfCell(cellId) ?? []);
  return after.listSheets().flatMap(({ sheetId }) => {
    let inSheet = changed.filter((cellId) => cellId.sheetId === sheetId);
    let byRow = new Map(inSheet.map((cellId) => [cellId.rowId, cellId]));
    let byColumn = new Map(inSheet.map((cellId) => [cellId.columnId, cellId]));
    let covering = placeCoveringCells(sheetId, positionsOf([...byRow.values(), ...byColumn.values()]), after);
    if (covering === null) return [];
    let isWholePlace = inSheet.length === covering.cellCount || inSheet.length > MAX_CHANGED_CELLS_LISTED;
    let filled = inSheet.filter((cellId) => after.cellOf(cellId) !== null);
    return [
      {
        place: covering.place,
        changed: isWholePlace ? [] : positionsOf(inSheet),
        rowsFilled: new Set(filled.map(({ rowId }) => rowId)).size,
      },
    ];
  });
}
export function areaBeforeByUnmovedLines(
  sheetId: SheetId,
  areaAfter: CellArea,
  before: WorkbookReads,
  after: WorkbookReads,
): CellArea | null {
  let [linesBefore, linesAfter] = [before.linesOf(sheetId), after.linesOf(sheetId)];
  if (linesBefore === null || linesAfter === null) return null;
  let isUnmoved =
    linesKeptUpToLast(linesBefore.rows, linesAfter.rows) &&
    linesKeptUpToLast(linesBefore.columns, linesAfter.columns) &&
    linesBefore.columns.count === linesAfter.columns.count;
  let rowCount = Math.min(areaAfter.rowCount, linesBefore.rows.count - areaAfter.topRowIndex);
  return isUnmoved && rowCount > 0
    ? {
        ...areaAfter,
        rowCount,
      }
    : null;
}
export function findChangedCellsInPlace(place: PlaceChanged | null, before: WorkbookReads, after: WorkbookReads): CellsChangedInPlace {
  let unchanged: CellsChangedInPlace = {
    place,
    changed: [],
  };
  let areaAfter = resolvePlaceArea(place, after)?.area ?? null;
  if (place === null || areaAfter === null) return unchanged;
  let { sheetId } = place;
  let areaBefore = resolvePlaceArea(place, before)?.area ?? areaBeforeByUnmovedLines(sheetId, areaAfter, before, after);
  if (areaBefore === null || areaBefore.rowCount <= 0 || areaBefore.columnCount <= 0) return unchanged;
  let filledAfter = after.filledCellsIn(sheetId, areaAfter);
  let changedCells = [
    ...filledAfter.filter(didCellInputChange(before, after)),
    ...before.filledCellsIn(sheetId, areaBefore).filter((cellId) => after.cellOf(cellId) === null),
  ];
  let positionsWithinArea = (cellIds: CellId[]) =>
    cellIds.flatMap((cellId) => {
      let position = after.positionOfCell(cellId);
      return position !== null &&
        position.rowIndex >= areaAfter.topRowIndex &&
        position.rowIndex < areaAfter.topRowIndex + areaAfter.rowCount &&
        position.columnIndex >= areaAfter.leftColumnIndex &&
        position.columnIndex < areaAfter.leftColumnIndex + areaAfter.columnCount
        ? [position]
        : [];
    });
  let changedPositions = positionsWithinArea(changedCells);
  let sheet = after.listSheets().find((summary) => summary.sheetId === sheetId);
  let coversWholeLines = areaAfter.rowCount === sheet?.rowCount || areaAfter.columnCount === sheet?.columnCount;
  if (changedPositions.length === 0 && coversWholeLines) return unchanged;
  let covering = placeCoveringCells(sheetId, changedPositions.length > 0 ? changedPositions : positionsWithinArea(filledAfter), after);
  if (covering === null) return unchanged;
  return {
    place: covering.place,
    changed: changedPositions.length === covering.cellCount ? [] : changedPositions,
  };
}
export function placesChangedByRevision(
  place: PlaceChanged | null,
  before: WorkbookReads,
  after: WorkbookReads,
  isOfLayoutAlone: boolean,
): CellsChangedInPlace[] {
  let inPlace = findChangedCellsInPlace(place, before, after);
  if (!isOfLayoutAlone && place?.cells !== null) return [inPlace];
  let changedPlaces =
    findChangedPlacesBySheet(before, after, !isOfLayoutAlone) ?? (place?.cells === null ? findChangedPlacesBySheet(before, after, true) : null);
  if (changedPlaces === null) return [inPlace];
  let inSameSheet = changedPlaces.filter((changedPlace) => changedPlace.place?.sheetId === place?.sheetId);
  let candidates = isOfLayoutAlone || inSameSheet.length === 0 ? changedPlaces : inSameSheet;
  let mostRowsFilled = Math.max(...candidates.map(({ rowsFilled }) => rowsFilled));
  let mostFilled = candidates.find(({ rowsFilled }) => rowsFilled === mostRowsFilled);
  let isAllInSameSheet = inSameSheet.length === candidates.length && place?.cells !== null;
  if (mostFilled === undefined) return [inPlace];
  let rowCountOfSheet = (workbook: WorkbookReads) =>
    workbook.listSheets().find(({ sheetId }) => sheetId === place?.sheetId)?.rowCount;
  let addsColumnsToKnownRows = (placeToCheck: PlaceChanged | null) => {
    let linesBefore = placeToCheck === null ? null : before.linesOf(placeToCheck.sheetId);
    if (placeToCheck === null || placeToCheck.cells === null || linesBefore === null) return false;
    let corners = [placeToCheck.cells.topLeft, placeToCheck.cells.bottomRight];
    return (
      corners.every(({ r: rowId }) => linesBefore.rows.indexOf(rowId) !== null) &&
      corners.some(({ c: columnId }) => linesBefore.columns.indexOf(columnId) === null)
    );
  };
  let isOfNewColumns =
    rowCountOfSheet(before) === rowCountOfSheet(after) && addsColumnsToKnownRows(place) && addsColumnsToKnownRows(mostFilled.place);
  if (isAllInSameSheet) return [isOfNewColumns ? mostFilled : inPlace];
  return [
    mostFilled,
    ...candidates.filter((candidate) => candidate !== mostFilled),
    ...(inSameSheet.length > 0 || place?.cells === null ? [] : [inPlace]),
  ];
}
export function findChartPlacedByEdit(
  sheetId: SheetId,
  place: PlaceChanged | null,
  before: WorkbookReads | null,
  after: WorkbookReads,
): PlacementOnGrid | undefined {
  let placements = after.placementsIn(sheetId);
  if (place?.sheetId === sheetId && place.placementId !== undefined)
    return placements.find(({ placementId }) => placementId === place.placementId);
  if (before === null) return;
  let placementIdsBefore = new Set(
    before.placementsIn(sheetId).map(({ placementId }) => placementId),
  );
  return placements.findLast(({ placementId }) => !placementIdsBefore.has(placementId));
}
export function selectionOfPlace(place: PlaceChanged | null): CellsChanged | null {
  if (place === null || place.cells === null) return null;
  let { sheetId, cells } = place;
  return {
    activeCell: {
      sheetId,
      rowId: cells.topLeft.r,
      columnId: cells.topLeft.c,
    },
    selectionCorner: {
      sheetId,
      rowId: cells.bottomRight.r,
      columnId: cells.bottomRight.c,
    },
  };
}
export function createChangesByAgentTracker(
  agentActivity: Pick<AgentActivity, 'isWorking' | 'onChanged'>,
  wait: (delayMs: number) => Promise<void> = (delayMs) => new Promise<void>((resolve) => void setTimeout(resolve, delayMs)),
  nowMs: () => number = () => performance.now(),
): ChangesByAgentTracker {
  let editsStreamed = new Map<number, EditStreamed>();
  let changes: ChangeArrivedFromAgent[] = [];
  let listeners = new Set<(changes: ChangeArrivedFromAgent[]) => void>();
  let notifyListener = (listener: (changes: ChangeArrivedFromAgent[]) => void) => {
    try {
      listener(changes);
    } catch (error) {
      reportErrorSoftly(error, 'changesByAgent');
    }
  };
  let held: ChangeHeld | null = null;
  let holdEndsAtMs = 0;
  let runSince = 0;
  let fadeOutAt = async (fadeBeginsAtMs: number): Promise<void> => {
    await wait(fadeBeginsAtMs + AGENT_CHANGE_FADE_MS - nowMs());
    let hasFaded = (change: ChangeArrivedFromAgent) => change.fadeBeginsAtMs !== null && change.fadeBeginsAtMs <= fadeBeginsAtMs;
    if (!changes.some(hasFaded)) return;
    changes = changes.filter((change) => !hasFaded(change));
    if (held !== null && hasFaded(held.change)) held = null;
    listeners.forEach(notifyListener);
  };
  let startHeldFade = () => {
    if (held === null) return;
    let { change, onShowAtMs } = held;
    held = null;
    let fadeAtMs = Math.max(onShowAtMs, nowMs());
    if (change.fadeBeginsAtMs !== null && change.fadeBeginsAtMs <= fadeAtMs) return;
    let fadingChange = {
      ...change,
      fadeBeginsAtMs: fadeAtMs,
    };
    changes = changes.map((shown) => (shown === change ? fadingChange : shown));
    fadeOutAt(fadeAtMs);
  };
  let showHeld = () => {
    if (held === null) return;
    startHeldFade();
    listeners.forEach(notifyListener);
  };
  let showHeldAfterMaxWait = async (change: ChangeArrivedFromAgent): Promise<void> => {
    await wait(AGENT_CHANGE_MAX_WAIT_MS);
    if (held?.change === change) showHeld();
  };
  agentActivity.onChanged(() => {
    if (!agentActivity.isWorking()) showHeld();
  });
  let tracker: ChangesByAgentTracker = {
    streamChanged: () => editsStreamed.clear(),
    editByAgentStreamed(revision, isOfViewer, isOfLayoutAlone) {
      editsStreamed.set(revision, {
        isOfViewer,
        isOfLayoutAlone,
        streamedAtMs: nowMs(),
      });
      if (!isOfLayoutAlone) showHeld();
    },
    caughtUpByLoad({ revisionBefore, revision, before, after }: CaughtUpByLoad) {
      let streamedInLoad = Array.from(editsStreamed).filter(
        ([streamedRevision]) => streamedRevision > revisionBefore && streamedRevision <= revision,
      );
      if (streamedInLoad.length < revision - revisionBefore) return;
      editsStreamed.set(revision, {
        isOfViewer: streamedInLoad.every(([, { isOfViewer }]) => isOfViewer),
        isOfLayoutAlone: streamedInLoad.every(([, { isOfLayoutAlone }]) => isOfLayoutAlone),
        streamedAtMs: Math.min(...streamedInLoad.map(([, { streamedAtMs }]) => streamedAtMs)),
      });
      tracker.editsOfOthersMade(
        [
          {
            revision,
            placeChanged: null,
          },
        ],
        before,
        after,
      );
      if (held?.change.revision !== revision)
        for (let [streamedRevision, streamed] of streamedInLoad) editsStreamed.set(streamedRevision, streamed);
    },
    editsOfOthersMade(edits: EditOfAnother[], before: WorkbookReads | null, after: WorkbookReads) {
      let madeAtMs = nowMs();
      let newChanges: Omit<ChangeArrivedFromAgent, 'fadeBeginsAtMs'>[] = [];
      let layoutChanges: ChangeArrivedFromAgent[] = [];
      let largestCellCount = 0;
      let hasNewMark: boolean | null = null;
      let areAllStreamed = edits.every(({ revision }) => editsStreamed.has(revision));
      for (let { revision, placeChanged } of edits) {
        let streamed = editsStreamed.get(revision);
        for (let streamedRevision of editsStreamed.keys()) if (streamedRevision <= revision) editsStreamed.delete(streamedRevision);
        if (streamed === undefined) continue;
        if (streamed.isOfLayoutAlone) {
          let cellsOfPlace = selectionOfPlace(placeChanged);
          if (cellsOfPlace !== null)
            layoutChanges.push({
              revision,
              cells: cellsOfPlace,
              ...(streamed.isOfViewer && {
                isOfViewer: true,
              }),
              isOfLayoutAlone: true,
              fadeBeginsAtMs: madeAtMs,
            });
          continue;
        }
        let changedPlaces =
          areAllStreamed && before !== null
            ? placesChangedByRevision(placeChanged, before, after, edits.length === 1)
            : [
                {
                  place: placeChanged,
                  changed: [],
                },
              ];
        let [firstChange, ...inOtherSheets] = changedPlaces.flatMap(({ place, changed }) => {
          let selection = selectionOfPlace(place);
          if (selection === null) return [];
          let groupsApart = selectionsApartForChangedCells(changed, selection.activeCell.sheetId, after);
          return [
            {
              cells: selection,
              ...(groupsApart.length > 0 && {
                groupsApart,
              }),
            },
          ];
        });
        let isInRun = streamed.streamedAtMs < holdEndsAtMs || hasNewMark !== null;
        if (!isInRun) runSince = revision;
        hasNewMark = firstChange !== undefined;
        if (firstChange === undefined) continue;
        for (let groupCells of [firstChange, ...inOtherSheets].flatMap(
          ({ cells, groupsApart }) => groupsApart ?? [cells],
        )) {
          let area = selectedArea(groupCells, after);
          largestCellCount = Math.max(largestCellCount, area === null ? 1 / 0 : area.rowCount * area.columnCount);
        }
        let beforeIfOneEdit = edits.length === 1 ? before : null;
        let chart = findChartPlacedByEdit(firstChange.cells.activeCell.sheetId, placeChanged, beforeIfOneEdit, after);
        newChanges.push({
          revision,
          ...firstChange,
          ...(chart !== undefined && {
            chart,
          }),
          ...(inOtherSheets.length > 0 && {
            inOtherSheets,
          }),
          ...(streamed.isOfViewer && {
            isOfViewer: true,
          }),
          ...(isInRun && {
            inRunSince: runSince,
          }),
        });
      }
      if (hasNewMark === null && layoutChanges.length === 0) return;
      if (layoutChanges.length > 0) fadeOutAt(madeAtMs);
      if (hasNewMark !== null) {
        startHeldFade();
        holdEndsAtMs = Math.max(holdEndsAtMs, madeAtMs + changeHoldMsForCellCount(largestCellCount));
      }
      let fadeAtMs = holdEndsAtMs;
      let lastChange = hasNewMark === true ? newChanges.pop() : undefined;
      let fadingChanges: ChangeArrivedFromAgent[] = [];
      for (let change of newChanges)
        fadingChanges.push({
          ...change,
          fadeBeginsAtMs: fadeAtMs,
        });
      if (fadingChanges.length > 0) fadeOutAt(fadeAtMs);
      changes = [...changes, ...fadingChanges];
      if (lastChange !== undefined && agentActivity.isWorking()) {
        let lastHeld = {
          ...lastChange,
          fadeBeginsAtMs: null,
        };
        held = {
          change: lastHeld,
          onShowAtMs: fadeAtMs,
        };
        changes = [...changes, lastHeld];
        showHeldAfterMaxWait(lastHeld);
      } else if (lastChange !== undefined) {
        let lastHeld = {
          ...lastChange,
          fadeBeginsAtMs: madeAtMs + AGENT_CHANGE_HOLD_MS,
        };
        held = {
          change: lastHeld,
          onShowAtMs: fadeAtMs,
        };
        changes = [...changes, lastHeld];
        fadeOutAt(lastHeld.fadeBeginsAtMs);
      }
      let allChanges = [...changes, ...layoutChanges];
      allChanges.sort((a, b) => a.revision - b.revision);
      changes = allChanges;
      listeners.forEach(notifyListener);
    },
    onChanged(listener) {
      listeners.add(listener);
      if (changes.length > 0) notifyListener(listener);
      return () => void listeners.delete(listener);
    },
  };
  return tracker;
}
export function chartEndWordOfAgent(outcome: ChartOutcomeOfAgent): ChartEndWord {
  if (typeof outcome === 'object') return 'by_agent';
  switch (outcome) {
    case 'full':
    case 'codeRefused':
    case 'notMade':
      return CHART_END_WORDS[outcome];
    case 'stopped':
      return 'stopped';
    case 'noAgent':
      return 'no_agent';
    case 'tooLarge':
      return 'too_large';
    case 'forChat':
      return 'for_chat';
    case 'notChanged':
      return 'failed';
  }
}
export function chartCardActs(card: ChartCardCount): string[] {
  if (card.step === 'open') return [`chart_open_${card.what}`];
  if (card.step === 'press') return ['chart_asked', `chart_asked_${card.what}`];
  return chartEndHealth(card.what, card.lane)[1] === 'success' ? ['chart_added', `chart_end_${card.what}`] : [`chart_end_${card.what}`];
}
export function chartEndHealth(what: ChartEndWord, lane: ChartLane): ChartEndHealth {
  let kind: ChartEndHealth[0] = lane === 'page' ? 'insert' : 'generate';
  switch (what) {
    case 'by_page':
    case 'by_page_late':
    case 'by_agent':
      return [kind, 'success'];
    case 'cant_be_shown':
      return [kind, 'failure', 'invalid_content'];
    case 'refused':
    case 'failed':
    case 'stopped':
    case 'left':
    case 'busy':
    case 'waiting':
    case 'no_cells':
    case 'filter':
    case 'for_chat':
    case 'to_chat':
    case 'chat_no_agent':
    case 'not_to_chat':
    case 'no_agent':
    case 'too_large':
    case 'full':
      return [kind, 'aborted'];
  }
}
export function countChartAsk(
  count: (card: ChartCardCount) => void,
  what: ChartAskKindWord,
): (endWhat: ChartEndWord, lane: ChartLane) => void {
  count({
    step: 'press',
    what,
  });
  let isCounted = false;
  return (endWhat, lane) => {
    if (isCounted) return;
    isCounted = true;
    count({
      step: 'end',
      what: endWhat,
      lane,
    });
  };
}
export const AGENT_CHANGE_HOLD_MS = 3400;
export const AGENT_CHANGE_FADE_MS = 400;
export const AGENT_CHANGE_MAX_WAIT_MS = 300000;
export const CHANGE_HOLD_PER_CELL_MS = 60;
export const CHANGE_HOLD_MAX_GROWTH_MS = 2000;
export const CHANGE_HOLD_TAIL_MS = 200;
export const CHANGE_HOLD_BASE_MS = 100;
export const changeHoldMsForCellCount = (cellCount: number): number =>
  CHANGE_HOLD_BASE_MS + Math.min(CHANGE_HOLD_MAX_GROWTH_MS, cellCount * CHANGE_HOLD_PER_CELL_MS) + CHANGE_HOLD_TAIL_MS;
export const MAX_CHANGE_GROUPS_APART = 8;
export const gapBetweenSpans = (start: number, length: number, otherStart: number, otherLength: number): number =>
  Math.max(start - (otherStart + otherLength - 1), otherStart - (start + length - 1), 0);
export const CHANGE_JOIN_GAP = 1;
export const CHANGED_CELL_CLUSTER_GAP = 2;
export const CLUSTER_NEIGHBOUR_OFFSETS: [rowOffset: number, columnOffset: number][] = Array.from(
  {
    length: CHANGED_CELL_CLUSTER_GAP,
  },
  (_, index) => index + 1,
).flatMap(
  (distance): [number, number][] => [
    [-distance, 0],
    [distance, 0],
    [0, -distance],
    [0, distance],
  ],
);
export const MAX_CHANGED_CELL_CLUSTERS = 64;
export const didCellInputChange =
  (before: WorkbookReads, after: WorkbookReads) =>
  (cellId: CellId): boolean => {
    let [cellBefore, cellAfter] = [before.cellOf(cellId), after.cellOf(cellId)];
    return cellBefore !== cellAfter && JSON.stringify(cellBefore?.input) !== JSON.stringify(cellAfter?.input);
  };
export const MAX_CHANGED_CELLS_LISTED = 1e4;
export const linesKeptUpToLast = (before: LineIndex, after: LineIndex): boolean =>
  linesKeepTheirOrder(before, after) && after.idAt(before.count - 1) === before.idAt(before.count - 1);
export const chartAskKindWord = (chartKind: StockKind | 'any', isTyped: boolean, hasSuggestions: boolean): ChartAskKindWord =>
  isTyped ? 'typed' : chartKind === 'any' ? 'quick' : hasSuggestions ? 'suggested' : 'plain_kind';
export const CHART_END_WORDS: Record<'full' | 'codeRefused' | 'notMade', ChartEndWord> = {
  full: 'full',
  codeRefused: 'cant_be_shown',
  notMade: 'refused',
};
