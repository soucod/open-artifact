import { cellIdUnderPointer } from '../selection/pointer.ts';
import { anchorCellOf, mergedAreaOrCellOf, isSameCell, selectedArea, activeAnchorCell } from '../selection/model.ts';
import { layoutOfView, hiddenByBorderAtFoot } from '../grid/layout.ts';
import { boxOfCellRange, rangeSpansOnScreen, layoutForNarrowTouch, cellsAreaWidth, cellsAreaHeight, clampBetween } from '../grid/geometry.ts';
import { ROW_HEADER_WIDTH } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT, compactOneLineRowHeight } from '../grid/cell-metrics.ts';
import { editEndsOnAnotherCell } from '../editor/commit-moves.ts';
import { isPlainCellClick } from './dropdown-sync.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { areasToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { withNoEffects } from '../state/transitions.ts';
import { makeIsCellFilteredOut } from '../tables/filtered-rows.ts';
import { areasOfAllRanges } from '../selection/several-ranges.ts';
import { isFormulaCell } from '../model/workbook.ts';
import { isCheckboxFormat, booleanOfValue } from './checkboxes.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import type { CheckboxesToSet, PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellArea } from '../selection/model.ts';
import type { GridPoint, SpanOnScreen } from '../grid/geometry.ts';
import type { SelectingDrag } from '../selection/pointer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { PageContext, PointerPressed } from '../state/event-reducer.ts';
/** The pointer pressed on a checkbox: where, whether by a finger, and whether it extends the selection. */
export type PointerOnCheckbox = Pick<PointerPressed, 'x' | 'y' | 'isByFinger' | 'isShiftHeld'>;
/** What set checkboxes: a key, the pointer, or a tool. */
export type CheckboxesSetBy = 'key' | 'pointer' | 'tool';
export function checkboxUnderPointer(state: PageState, reads: ReadsWithTextMeasurer, pointer: PointerOnCheckbox): CellId | null {
  let cellId = cellIdUnderPointer(state, reads, pointer);
  if (cellId === null) return null;
  let anchor = anchorCellOf(reads, cellId);
  let area = toggleableCheckboxValue(reads, anchor) === null ? null : mergedAreaOrCellOf(reads, anchor);
  if (area === null) return null;
  let layout = layoutOfView(state, reads);
  let { left, top, right, bottom } = boxOfCellRange(area, layout);
  let centre = checkboxCentreInCell(right - left, bottom - top, hiddenByBorderAtFoot(state, reads, layout, area));
  let { across, down } = rangeSpansOnScreen(area, state, layout, state);
  let [x, y] = [across.start + centre.x, down.start + centre.y];
  let narrowLayout = layoutForNarrowTouch(state);
  let slop =
    pointer.isByFinger && isWithinShownSpan(x, across, cellsAreaWidth(narrowLayout)) && isWithinShownSpan(y, down, cellsAreaHeight(narrowLayout))
      ? CHECKBOX_FINGER_HIT_SLOP / state.zoom
      : CHECKBOX_HIT_SLOP;
  return Math.abs(pointer.x - (ROW_HEADER_WIDTH + x)) <= slop && Math.abs(pointer.y - (COLUMN_HEADER_HEIGHT + y)) <= slop ? anchor : null;
}
export function notePressedCheckbox(
  before: PageState,
  pressed: PageTransition,
  pointer: PointerOnCheckbox,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  let { notice } = pressed.state;
  let hasNewNotice = notice !== null && notice !== before.notice;
  let checkbox =
    ((editEndsOnAnotherCell(before, pressed, pointer.isShiftHeld) && !hasNewNotice) || isPlainCellClick(pressed, pointer.isShiftHeld)) &&
    refusalOfEveryEdit === null
      ? checkboxUnderPointer(before, reads, pointer)
      : null;
  if (checkbox === null) return pressed;
  let { dragging } = pressed.state;
  let selecting: SelectingDrag = {
    ...(dragging?.kind === 'selecting'
      ? dragging
      : {
          kind: 'selecting',
          what: 'cells',
          holdsBoxAlone: true,
        }),
    pressedCheckbox: checkbox,
  };
  return {
    ...pressed,
    state: {
      ...pressed.state,
      dragging: selecting,
    },
  };
}
export function dropPressedCheckbox(state: PageState): PageState {
  let { dragging } = state;
  if (dragging?.kind !== 'selecting' || dragging.pressedCheckbox === undefined) return state;
  let selecting: SelectingDrag = {
    kind: 'selecting',
    what: dragging.what,
  };
  return {
    ...state,
    dragging: dragging.holdsBoxAlone === true ? null : selecting,
  };
}
export function dropCheckboxIfPointerLeft(state: PageState, reads: ReadsWithTextMeasurer, pointer: GridPoint): PageState {
  let pressed = pressedCheckbox(state);
  if (pressed === null) return state;
  let cellId = cellIdUnderPointer(state, reads, pointer);
  return cellId !== null && isSameCell(anchorCellOf(reads, cellId), pressed) ? state : dropPressedCheckbox(state);
}
export function areaAroundCells(reads: WorkbookReads, cellIds: readonly CellId[]): CellArea {
  let [topRowIndex, leftColumnIndex, bottomRowIndex, rightColumnIndex] = [1 / 0, 1 / 0, 0, 0];
  for (let cellId of cellIds) {
    let position = reads.positionOfCell(cellId);
    if (position === null) continue;
    [topRowIndex, leftColumnIndex] = [Math.min(topRowIndex, position.rowIndex), Math.min(leftColumnIndex, position.columnIndex)];
    [bottomRowIndex, rightColumnIndex] = [Math.max(bottomRowIndex, position.rowIndex), Math.max(rightColumnIndex, position.columnIndex)];
  }
  return {
    topRowIndex,
    leftColumnIndex,
    rowCount: bottomRowIndex - topRowIndex + 1,
    columnCount: rightColumnIndex - leftColumnIndex + 1,
  };
}
export function setCheckboxesEdit(
  state: PageState,
  reads: WorkbookReads,
  cellGroups: readonly (readonly CellId[])[],
  isChecked: boolean,
  how: CheckboxesSetBy,
): PageTransition {
  let text = isChecked ? 'TRUE' : 'FALSE';
  return queueEdit(
    state,
    {
      kind: 'pasteTexts',
      sheetId: state.sheetId,
      cells: cellGroups.flat().map(
        ({ rowId, columnId }) => ({
          r: rowId,
          c: columnId,
          text,
        }),
      ),
      pastedTextIs: 'asTyped',
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: how === 'key' ? state : null,
      done: {
        what: isChecked ? 'checked' : 'unchecked',
        cells: areasToA1AsStored(
          cellGroups.flatMap((cellIds) => (cellIds.length > 0 ? areaAroundCells(reads, cellIds) : [])),
          ownRowOrderOfSheet(reads, state.sheetId),
        ),
      },
    },
  );
}
export function toggleCheckboxOnRelease(
  state: PageState,
  released: PageState,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition | null {
  let checkbox = state.mode.kind === 'navigating' ? pressedCheckbox(state) : null;
  let isChecked = checkbox?.sheetId === state.sheetId ? toggleableCheckboxValue(reads, checkbox) : null;
  if (checkbox === null || isChecked === null) return null;
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...released,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'otherEdit',
      },
    });
  return setCheckboxesEdit(released, reads, [[checkbox]], !isChecked, 'pointer');
}
export function checkboxCellsInArea(state: PageState, reads: WorkbookReads, area: CellArea): CellId[] {
  let isFilteredOut = makeIsCellFilteredOut(state, reads);
  return reads
    .filledCellsIn(state.sheetId, area)
    .filter((cellId) => toggleableCheckboxValue(reads, cellId) !== null && !isFilteredOut(cellId));
}
export function checkboxCellsInSelection(state: PageState, reads: WorkbookReads): CellId[] {
  let area = selectedArea(state, reads);
  if (area === null) return [];
  let checkboxes = checkboxCellsInArea(state, reads, area).flatMap((cellId) => {
    let position = reads.positionOfCell(cellId);
    return position === null
      ? []
      : [
          {
            id: cellId,
            at: position,
          },
        ];
  });
  checkboxes.sort(
    (one, other) =>
      one.at.rowIndex === other.at.rowIndex ? one.at.columnIndex - other.at.columnIndex : one.at.rowIndex - other.at.rowIndex,
  );
  return checkboxes.map(({ id }) => id);
}
export function toggleCheckboxesByKey(state: PageState, key: 'enter' | 'space', reads: WorkbookReads): PageTransition | null {
  let activeCell = activeAnchorCell(state, reads);
  let activeValue = toggleableCheckboxValue(reads, activeCell);
  if (key === 'enter' && activeValue === null) return null;
  let inSelection = checkboxCellsInSelection(state, reads);
  let cells =
    activeValue !== null && !inSelection.some((cellId) => isSameCell(cellId, activeCell))
      ? [activeCell, ...inSelection]
      : inSelection;
  let [firstCell] = cells;
  let isChecked = activeValue ?? (firstCell === undefined ? null : toggleableCheckboxValue(reads, firstCell));
  if (isChecked !== null) return setCheckboxesEdit(state, reads, [cells], !isChecked, 'key');
  return checkboxValueOfCell(reads, activeCell) === null ? null : withNoEffects(state);
}
export function checkboxesOfSelection(state: PageState, reads: WorkbookReads): CheckboxesToSet {
  let isFilteredOut = makeIsCellFilteredOut(state, reads);
  let found = {
    ...NO_CHECKBOXES_TO_TOGGLE,
  };
  for (let area of areasOfAllRanges(state, reads))
    for (let cellId of reads.filledCellsIn(state.sheetId, area)) {
      let isChecked = isFilteredOut(cellId) ? null : checkboxValueOfCell(reads, cellId);
      if (isChecked === null) continue;
      if (isFormulaCell(reads, cellId)) found[isChecked ? 'isAnyCheckedByFormula' : 'isAnyUncheckedByFormula'] = true;
      else found[isChecked ? 'isAnyToUncheck' : 'isAnyToCheck'] = true;
      if (found.isAnyToCheck && found.isAnyToUncheck)
        return {
          ...NO_CHECKBOXES_TO_TOGGLE,
          isAnyToCheck: true,
          isAnyToUncheck: true,
        };
    }
  return found;
}
export function setCheckboxesOfSelection(state: PageState, reads: WorkbookReads, isChecked: boolean): PageTransition {
  let { isAnyToCheck, isAnyToUncheck } = checkboxesOfSelection(state, reads);
  return (isChecked ? isAnyToCheck : isAnyToUncheck)
    ? setCheckboxesEdit(
        {
          ...state,
          lastDone: null,
          notice: null,
        },
        reads,
        checkboxCellsInRanges(state, reads),
        isChecked,
        'tool',
      )
    : withNoEffects(state);
}
export const checkboxValueOfCell = (reads: WorkbookReads, cellId: CellId): boolean | null =>
  isCheckboxFormat(reads.formatOf(cellId)) ? booleanOfValue(cellValueOf(reads.cellOnShowIn(cellId))) : null;
export const toggleableCheckboxValue = (reads: WorkbookReads, cellId: CellId): boolean | null =>
  isFormulaCell(reads, cellId) ? null : checkboxValueOfCell(reads, cellId);
export const CHECKBOX_BASELINE_NUDGE = 1;
export const checkboxCentreInCell = (width: number, height: number, hiddenAtFoot: number): GridPoint => {
  let room = height - compactOneLineRowHeight(DEFAULT_CELL_FORMAT.font.size);
  let footOffset = clampBetween(hiddenAtFoot, 0, room);
  return {
    x: width / 2,
    y: Math.ceil((height - CHECKBOX_BASELINE_NUDGE - footOffset) / 2),
  };
};
export const CHECKBOX_HIT_SLOP = 10;
export const CHECKBOX_FINGER_HIT_SLOP = 20;
export const isWithinShownSpan = (position: number, { end, showFrom }: Pick<SpanOnScreen, 'end' | 'showFrom'>, limit: number): boolean =>
  position >= showFrom && position <= Math.min(end, limit);
export const pressedCheckbox = ({ dragging }: Pick<PageState, 'dragging'>): CellId | null =>
  dragging?.kind === 'selecting' ? (dragging.pressedCheckbox ?? null) : null;
export const checkboxCellsInRanges = (state: PageState, reads: WorkbookReads): CellId[][] =>
  areasOfAllRanges(state, reads).map((area) => checkboxCellsInArea(state, reads, area));
export const NO_CHECKBOXES_TO_TOGGLE: CheckboxesToSet = {
  isAnyToCheck: false,
  isAnyToUncheck: false,
  isAnyUncheckedByFormula: false,
  isAnyCheckedByFormula: false,
};
