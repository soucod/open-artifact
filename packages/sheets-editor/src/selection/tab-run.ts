import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { PageState, TabRun } from '../state/initial-state.ts';
import type { KeyMove } from './keyboard.ts';
import { anchorCellOf, keyMoveOriginOf, mergedAreaOrCellOf, isSameSelection, isSameCell } from './model.ts';
import { cellAfterKeyMove } from './keyboard.ts';
import { shownLineAtOrAfter } from '../model/line-sizes.ts';
import { layoutOfView } from '../grid/layout.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
export function nextTabRun(state: PageState, key: string, move: KeyMove | null, endsRun: boolean, workbook: ReadsWithTextMeasurer): TabRun | null {
  let tabRun = state.tabRun;
  if (key !== 'Tab' || move === null) {
    let isEnterDown = key === 'Enter' && move !== null && move.rowDelta !== 0;
    return endsRun || isEnterDown ? null : tabRun;
  }
  let nextCell = anchorCellOf(workbook, cellAfterKeyMove(state, workbook, move));
  let from = tabRun?.from ?? keyMoveOriginOf(state);
  let [fromPosition, nextArea] = [workbook.positionOfCell(from), mergedAreaOrCellOf(workbook, nextCell)];
  return {
    from: fromPosition !== null && nextArea !== null && nextArea.leftColumnIndex + nextArea.columnCount <= fromPosition.columnIndex ? nextCell : from,
    at: nextCell,
  };
}
export function cellBelowTabRunStart(state: PageState, workbook: ReadsWithTextMeasurer): CellId | null {
  let { tabRun, activeCell, sheetId } = state;
  if (tabRun === null) return null;
  let fromPosition = workbook.positionOfCell(tabRun.from);
  let fromArea = mergedAreaOrCellOf(workbook, tabRun.from);
  let activeArea = mergedAreaOrCellOf(workbook, activeCell);
  if (fromPosition === null || fromArea === null || activeArea === null) return null;
  let nextRowIndex = shownLineAtOrAfter(
    layoutOfView(state, workbook).rowEdges,
    Math.max(fromArea.topRowIndex + fromArea.rowCount, activeArea.topRowIndex + activeArea.rowCount),
  );
  return workbook.cellIdAt(sheetId, nextRowIndex, fromPosition.columnIndex);
}
export function keepTabRun(before: PageState, state: PageState, event: PageEvent): PageState {
  let { tabRun } = state;
  if (tabRun === null || tabRun !== before.tabRun) return state;
  if (event.kind === 'editAnswered' && event.ifQueued.carriesTabRunOn === true && !isSameSelection(before, state))
    return {
      ...state,
      tabRun: {
        ...tabRun,
        at: state.activeCell,
      },
    };
  let isSelectionKept = !(event.kind === 'pointerPressed' && state.mode.kind !== 'editing') && isSameSelection(before, state);
  let isMovedByKeyToRunEnd =
    event.kind === 'editAnswered' &&
    event.ifQueued.foundBy === 'key' &&
    isSameCell(state.activeCell, tabRun.at) &&
    isSameCell(state.selectionCorner, tabRun.at);
  return isSelectionKept || isMovedByKeyToRunEnd
    ? state
    : {
        ...state,
        tabRun: null,
      };
}
