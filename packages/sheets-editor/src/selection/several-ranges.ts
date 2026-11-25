import type { Edit } from '@open-artifact/sheets-core';
import type { WorkbookReads } from '../model/workbook.ts';
import type { LastDone, OneRangeAct, PageState } from '../state/initial-state.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { PageTransition, QueueEditEffect } from '../state/transitions.ts';
import type { GridHit } from '../grid/geometry.ts';
import type { CellArea, CellSelection, RangeWalked, SelectionKind } from './model.ts';
import { isInSpan } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import {
  selectionKindOf,
  isSameArea,
  selectionBetweenPositions,
  selectedArea,
  selectionOfArea,
  isSameCell,
  selectionAreaAndKind,
  selectionKeepsItsCells,
  unionOfAreas,
} from './model.ts';
import { areaToA1AsStored, areasToA1AsStored } from '../formulas/from-words/where.ts';
import { isQueueEditOfOneAct } from '../history/steps-together.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { areaToA1 } from '../model/a1-references.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A selection's ranges: the one being made, and the others selected with it. */
export interface SeveralRanges extends Pick<CellSelection, 'activeCell' | 'selectionCorner'> {
  rangeWalked?: RangeWalked | null;
  otherRanges: readonly CellSelection[];
}
/** What taking an area out of a range goes by: the page, the range, and where to note a merged area taken out with it. */
export interface TakingOutOfRange {
  state: PageState;
  reads: ReadsWithTextMeasurer;
  range: CellArea;
  alsoOut: (area: CellArea) => void;
}
/** Whether an act was asked of several ranges at once. */
export interface ActOfSeveralRanges {
  isOfSeveralRanges?: boolean;
}
export function coveredLineCount(areas: readonly CellArea[], axis: Exclude<SelectionKind, 'cells'>): number {
  let spans = areas.map(
    (area) =>
      axis === 'rows' ? [area.topRowIndex, area.topRowIndex + area.rowCount] : [area.leftColumnIndex, area.leftColumnIndex + area.columnCount],
  );
  spans.sort(([from], [otherFrom]) => from! - otherFrom!);
  let [total, coveredUpTo] = [0, 0];
  for (let [from, to] of spans as [number, number][]) {
    total += Math.max(0, to - Math.max(from, coveredUpTo));
    coveredUpTo = Math.max(coveredUpTo, to);
  }
  return total;
}
export function coveredCellCount(areas: readonly CellArea[]): number {
  let rowEdges = [
    ...new Set(
      areas.flatMap(({ topRowIndex, rowCount }) => [topRowIndex, topRowIndex + rowCount]),
    ),
  ];
  rowEdges.sort((edge, otherEdge) => edge - otherEdge);
  return rowEdges.reduce((total, edge, edgeIndex) => {
    let bandAreas = areas.filter((area) => isInSpan(edge, area.topRowIndex, area.rowCount));
    return total + ((rowEdges[edgeIndex + 1] ?? edge) - edge) * coveredLineCount(bandAreas, 'columns');
  }, 0);
}
export function isPointerTargetSelected(
  selection: PageState,
  target: GridHit,
  reads: ReadsWithTextMeasurer,
): boolean {
  if (target.kind === 'corner') return false;
  let layout = layoutOfView(selection, reads);
  return areasOfAllRanges(selection, reads).some((area) => {
    let isRowCovered =
      target.kind === 'columnHeader' ? area.rowCount === layout.rowCount : isInSpan(target.rowIndex, area.topRowIndex, area.rowCount);
    let isColumnCovered =
      target.kind === 'rowHeader' ? area.columnCount === layout.columnCount : isInSpan(target.columnIndex, area.leftColumnIndex, area.columnCount);
    return isRowCovered && isColumnCovered;
  });
}
export function splitAreaAround(area: CellArea, cut: CellArea, axis: Exclude<SelectionKind, 'cells'>): CellArea[] {
  let [bottomEnd, rightEnd] = [area.topRowIndex + area.rowCount, area.leftColumnIndex + area.columnCount];
  let cutTop = Math.max(area.topRowIndex, cut.topRowIndex);
  let cutBottom = Math.min(bottomEnd, cut.topRowIndex + cut.rowCount);
  let cutLeft = Math.max(area.leftColumnIndex, cut.leftColumnIndex);
  let cutRight = Math.min(rightEnd, cut.leftColumnIndex + cut.columnCount);
  if (cutTop >= cutBottom || cutLeft >= cutRight) return [area];
  let rowsOfCut = {
    topRowIndex: cutTop,
    rowCount: cutBottom - cutTop,
  };
  let columnsOfCut = {
    leftColumnIndex: cutLeft,
    columnCount: cutRight - cutLeft,
  };
  let [endBand, sideBand]: Partial<CellArea>[] = axis === 'rows' ? [{}, rowsOfCut] : [columnsOfCut, {}];
  return [
    {
      ...area,
      ...endBand,
      rowCount: cutTop - area.topRowIndex,
    },
    {
      ...area,
      ...sideBand,
      columnCount: cutLeft - area.leftColumnIndex,
    },
    {
      ...area,
      ...sideBand,
      leftColumnIndex: cutRight,
      columnCount: rightEnd - cutRight,
    },
    {
      ...area,
      ...endBand,
      topRowIndex: cutBottom,
      rowCount: bottomEnd - cutBottom,
    },
  ].filter(({ rowCount, columnCount }) => rowCount > 0 && columnCount > 0);
}
export function piecesAfterTakingOut(
  { state, reads, range, alsoOut }: TakingOutOfRange,
  area: CellArea,
  cut: CellArea,
): CellArea[] {
  let crossingMergedArea = (piece: CellArea): CellArea | undefined =>
    selectionKindOf(piece, layoutOfView(state, reads)) === 'cells'
      ? reads.mergedAreasIn(state.sheetId, piece).find((merged) => !isAreaWithin(merged, piece))
      : undefined;
  let hasNoCrossingMerge = (piece: CellArea): boolean => crossingMergedArea(piece) === undefined;
  let [rowWisePieces, columnWisePieces] = [splitAreaAround(area, cut, 'rows'), splitAreaAround(area, cut, 'columns')];
  if (rowWisePieces.every(hasNoCrossingMerge)) return rowWisePieces;
  if (columnWisePieces.every(hasNoCrossingMerge)) return columnWisePieces;
  return rowWisePieces.flatMap((piece) => {
    let merged = crossingMergedArea(piece);
    if (merged === undefined) return [piece];
    let innerPieces = piecesAfterTakingOut(
      {
        state,
        reads,
        range,
        alsoOut,
      },
      piece,
      merged,
    );
    if (isAreaWithin(merged, range)) return innerPieces.concat(merged);
    alsoOut(merged);
    return innerPieces;
  });
}
export function takeAreaOutOfSelection(
  selection: PageState,
  reads: ReadsWithTextMeasurer,
  cut: CellArea,
  canCut: (area: CellArea) => boolean = () => true,
): PageState | null {
  let areas = areasOfAllRanges(selection, reads);
  let takenOutNames = new Set<string>([areaToA1AsStored(cut, null)]);
  let noteTakenOut = (area: CellArea): void => void takenOutNames.add(areaToA1AsStored(area, null));
  let pieces = areas.flatMap(
    (area) =>
      canCut(area)
        ? piecesAfterTakingOut(
            {
              state: selection,
              reads,
              range: area,
              alsoOut: noteTakenOut,
            },
            area,
            cut,
          )
        : [area],
  );
  if (pieces.length === areas.length && pieces.every((piece, pieceIndex) => piece === areas[pieceIndex])) return null;
  let keptPieces = pieces.filter(
    (piece, pieceIndex) => !pieces.slice(pieceIndex + 1).some((later) => isSameArea(later, piece)),
  );
  let activePosition = reads.positionOfCell(selection.activeCell);
  let activePieceIndex =
    activePosition === null
      ? -1
      : keptPieces.findLastIndex((piece) => areaHasCell(piece, activePosition.rowIndex, activePosition.columnIndex));
  let activePiece = keptPieces[activePieceIndex];
  let mirrored =
    activePiece === undefined || activePosition === null
      ? null
      : selectionBetweenPositions(selection, reads, activePosition, {
          rowIndex: 2 * activePiece.topRowIndex + activePiece.rowCount - 1 - activePosition.rowIndex,
          columnIndex: 2 * activePiece.leftColumnIndex + activePiece.columnCount - 1 - activePosition.columnIndex,
        });
  let mirroredArea = mirrored === null ? null : selectedArea(mirrored, reads);
  let activeRange =
    activePiece === undefined || (mirroredArea !== null && isSameArea(mirroredArea, activePiece))
      ? mirrored
      : selectionOfArea(selection, reads, activePiece);
  let otherRanges = keptPieces
    .filter((piece, pieceIndex) => activeRange === null || pieceIndex !== activePieceIndex)
    .flatMap((piece) => selectionOfArea(selection, reads, piece) ?? []);
  let nextCurrent = activeRange ?? otherRanges.at(-1);
  if (nextCurrent === undefined) return null;
  return {
    ...selection,
    ...nextCurrent,
    otherRanges: activeRange === null ? otherRanges.slice(0, -1) : otherRanges,
    cameToMergedCellsAt: null,
    lastDone: {
      what: 'takenOutOfSelection',
      cells: [...takenOutNames].join(', '),
    },
  };
}
export function isSameSelectedPlace(before: PageState, after: PageState, reads: WorkbookReads): boolean {
  if (isSameCell(after.activeCell, before.activeCell)) return true;
  let [placeBefore, placeAfter] = [selectionAreaAndKind(before, reads), selectionAreaAndKind(after, reads)];
  return placeBefore !== null && placeAfter !== null && isSameArea(placeBefore.area, placeAfter.area);
}
export function dropStaleTakeOutDrag(selection: PageState, change: PageEvent, reads: WorkbookReads): PageState {
  let takesOut = selection.dragging?.kind === 'selecting' ? selection.dragging.takesOut : undefined;
  if (change.kind !== 'workbookChanged' || takesOut === undefined) return selection;
  return takesOut.ranges.every((range: CellSelection) => selectionKeepsItsCells(range, change.readsBefore, reads))
    ? selection
    : {
        ...selection,
        dragging: null,
      };
}
export function keepOtherRangesFitting(before: PageState, selection: PageState, change: PageEvent, reads: WorkbookReads): PageState {
  let after = dropStaleTakeOutDrag(selection, change, reads);
  if (!hasOtherRanges(after)) return after;
  if (change.kind === 'pointerPressed') {
    let isStillEditingSameCell =
      before.mode.kind === 'editing' && after.mode.kind === 'editing' && isSameCell(after.activeCell, before.activeCell);
    return (before.mode.kind !== 'editing' && after.dragging?.kind !== 'movingCells' && (change.isModifierHeld === true || change.isShiftHeld)) ||
      after.dragging?.kind === 'resizing' ||
      after.dragging?.kind === 'freezing' ||
      isStillEditingSameCell
      ? after
      : withoutOtherRanges(after);
  }
  let isUndoOrRedo = change.kind === 'undoOrRedoAnswered';
  if (after.otherRanges !== before.otherRanges && (after.sheetId === before.sheetId || isUndoOrRedo)) return after;
  if (after.sheetId !== before.sheetId || !isSameSelectedPlace(before, after, reads)) return withoutOtherRanges(after);
  if (change.kind !== 'workbookChanged') return after;
  let keptRanges = after.otherRanges.filter((range) => selectionKeepsItsCells(range, change.readsBefore, reads));
  return keptRanges.length === after.otherRanges.length
    ? after
    : {
        ...after,
        otherRanges: keptRanges,
      };
}
export function withEditsOfOtherRanges(otherEffects: readonly QueueEditEffect[], effect: QueueEditEffect): QueueEditEffect {
  let editsThatGoAlong = [...otherEffects, effect].flatMap((queued) => queued.editsThatGoAlong ?? []);
  return {
    ...effect,
    editsBefore: [
      ...otherEffects.flatMap(
        ({ editsBefore = [], edit }) => [
          ...editsBefore,
          {
            edit,
            isPointedAt: true,
          },
        ],
      ),
      ...(effect.editsBefore ?? []),
    ],
    ...(editsThatGoAlong.length > 0 && {
      editsThatGoAlong,
    }),
  };
}
export function actOnEveryRange(
  selection: PageState,
  act: (state: PageState) => PageTransition,
  ranges: readonly CellSelection[] = selection.otherRanges,
): PageTransition {
  let current = act(selection);
  let otherEffects = ranges
    .flatMap(
      (range) =>
        act({
          ...selection,
          rangeWalked: null,
          ...range,
          otherRanges: NO_OTHER_RANGES,
        }).effects,
    )
    .filter(isQueueEditOfOneAct);
  let lastOtherEffect = otherEffects.at(-1);
  if (lastOtherEffect === undefined) return current;
  let ownEffect = current.effects.find(isQueueEditOfOneAct);
  if (ownEffect !== undefined) {
    let joinedEffect = withEditsOfOtherRanges(otherEffects, ownEffect);
    let effects = current.effects.map((effect) => (effect === ownEffect ? joinedEffect : effect));
    return {
      ...current,
      effects,
    };
  }
  let ifQueued = {
    ...lastOtherEffect.ifQueued,
    select: null,
    leavesEntryOpen: true,
  };
  let joinedEffect = withEditsOfOtherRanges(otherEffects.slice(0, -1), {
    ...lastOtherEffect,
    ifQueued,
  });
  return {
    ...current,
    effects: [...current.effects, joinedEffect],
  };
}
export function keepLastDoneAfterEdit(
  lastDoneBefore: LastDone | null,
  selection: PageState,
  reads: WorkbookReads,
  change: Edit,
  { isOfSeveralRanges }: ActOfSeveralRanges,
): PageState {
  if (isOfSeveralRanges === true && selection.lastDone === null)
    return {
      ...selection,
      lastDone: lastDoneBefore,
    };
  let refreshed = refreshLastDoneCounts(selection, reads, change);
  return hasOtherRanges(selection) &&
    lastDoneBefore !== null &&
    refreshed.lastDone !== lastDoneBefore &&
    JSON.stringify(refreshed.lastDone) === JSON.stringify(lastDoneBefore)
    ? {
        ...refreshed,
        lastDone: lastDoneBefore,
      }
    : refreshed;
}
export function refreshLastDoneCounts(selection: PageState, reads: WorkbookReads, change: Edit): PageState {
  let { lastDone } = selection;
  if (hasOtherRanges(selection) && (lastDone?.what === 'rowsSized' || lastDone?.what === 'columnsSized')) {
    let axis: Exclude<SelectionKind, 'cells'> = lastDone.what === 'rowsSized' ? 'rows' : 'columns';
    let lineCount = selectedLineCountOnAxis(selection, reads, axis);
    let mergedArea = selectedArea(selection, reads);
    return lineCount === (axis === 'rows' ? mergedArea?.rowCount : mergedArea?.columnCount)
      ? selection
      : {
          ...selection,
          lastDone: {
            ...lastDone,
            lineCount,
          },
        };
  }
  let isFormatChange = change.kind === 'formatCells' || change.kind === 'setBorders' || change.kind === 'clearCells';
  if (!hasOtherRanges(selection) || !isFormatChange || lastDone === null) return selection;
  if (
    !(
      lastDone.what === 'formatted' ||
      lastDone.what === 'bordersDrawn' ||
      lastDone.what === 'bordersCleared' ||
      lastDone.what === 'checkboxesMade' ||
      lastDone.what === 'formattingCleared' ||
      lastDone.what === 'dropdownRemoved' ||
      lastDone.what === 'cleared'
    )
  )
    return selection;
  let areas = areasOfAllRanges(selection, reads);
  return {
    ...selection,
    lastDone: {
      ...lastDone,
      cells: areasToA1AsStored(areas, ownRowOrderOfSheet(reads, selection.sheetId)),
      rangeCount: areas.length,
    },
  };
}
export const NO_OTHER_RANGES: CellSelection[] = [];
export const hasOtherRanges = ({ otherRanges }: Pick<SeveralRanges, 'otherRanges'>): boolean => otherRanges.length > 0;
export const allRangesOf = ({
  otherRanges,
  activeCell,
  selectionCorner,
  rangeWalked = null,
}: SeveralRanges): CellSelection[] => [
  ...otherRanges,
  {
    activeCell,
    selectionCorner,
    rangeWalked,
  },
];
export const areasOfAllRanges = (selection: SeveralRanges, reads: WorkbookReads): CellArea[] =>
  allRangesOf(selection).flatMap((range): CellArea | CellArea[] => selectedArea(range, reads) ?? []);
export const rangesForLineAxis = (selection: SeveralRanges, reads: WorkbookReads, axis: Exclude<SelectionKind, 'cells'>): CellSelection[] =>
  allRangesOf(selection).filter((range, rangeIndex, ranges) => {
    let rangeKind = selectionAreaAndKind(range, reads)?.kind;
    return rangeIndex === ranges.length - 1 || rangeKind === 'cells' || rangeKind === axis;
  });
export const selectedLineCountOnAxis = (selection: SeveralRanges, reads: WorkbookReads, axis: Exclude<SelectionKind, 'cells'>): number =>
  coveredLineCount(
    rangesForLineAxis(selection, reads, axis).flatMap((range): CellArea | CellArea[] => selectedArea(range, reads) ?? []),
    axis,
  );
export const namesOfAreas = (areas: readonly CellArea[]): string => areas.map(areaToA1).join(', ');
export const areaHasCell = (area: CellArea, rowIndex: number, columnIndex: number): boolean =>
  rowIndex >= area.topRowIndex &&
  rowIndex < area.topRowIndex + area.rowCount &&
  columnIndex >= area.leftColumnIndex &&
  columnIndex < area.leftColumnIndex + area.columnCount;
export const someAreaHasCell = (areas: readonly CellArea[], rowIndex: number, columnIndex: number): boolean =>
  areas.some((area) => areaHasCell(area, rowIndex, columnIndex));
export const withCurrentRangeAmongOthers = <S extends SeveralRanges>(selection: S) => ({
  ...selection,
  otherRanges: allRangesOf(selection),
});
export const withoutOtherRanges = <S extends Pick<SeveralRanges, 'otherRanges'>>(selection: S): S =>
  hasOtherRanges(selection)
    ? {
        ...selection,
        otherRanges: NO_OTHER_RANGES,
      }
    : selection;
export const isAreaWithin = (area: CellArea, outer: CellArea): boolean => isSameArea(unionOfAreas(area, outer), outer);
export const isEditRefusedForSeveralRanges = ({ notice }: Pick<PageState, 'notice'>, { isOfSeveralRanges }: ActOfSeveralRanges): boolean =>
  isOfSeveralRanges === true && notice?.kind === 'editRefused';
export const ONE_RANGE_ACT_BY_COMMAND = {
  insertRowAbove: 'insertRows',
  insertRowBelow: 'insertRows',
  insertColumnLeft: 'insertColumns',
  insertColumnRight: 'insertColumns',
  moveRowsUp: 'moveRows',
  moveRowsDown: 'moveRows',
  moveColumnsLeft: 'moveColumns',
  moveColumnsRight: 'moveColumns',
  deleteRows: 'deleteRows',
  deleteColumns: 'deleteColumns',
  resizeRows: null,
  resizeColumns: null,
  clearCells: null,
  sortAscending: null,
  sortDescending: null,
  sortRangeAscending: 'sortCells',
  sortRangeDescending: 'sortCells',
  mergeCells: 'mergeCells',
  unmergeCells: 'unmergeCells',
  convertTexts: null,
  groupRows: null,
  groupColumns: null,
  ungroupRows: null,
  ungroupColumns: null,
  collapseRows: null,
  collapseColumns: null,
  expandRows: null,
  expandColumns: null,
} satisfies Record<string, OneRangeAct | null>;
/** A command that some act of it can take only one range. */
export type CommandOfOneRange = keyof typeof ONE_RANGE_ACT_BY_COMMAND;
export const oneRangeActOfCommand = (command: CommandOfOneRange) => ONE_RANGE_ACT_BY_COMMAND[command];
export const refuseWhenSeveralRanges = (selection: PageState, act: OneRangeAct): PageTransition | null =>
  hasOtherRanges(selection)
    ? {
        state: {
          ...selection,
          lastDone: null,
          notice: {
            kind: 'oneRangeNeeded',
            act,
          },
        },
        effects: [],
      }
    : null;
