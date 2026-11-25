import { layoutOfView } from '../grid/layout.ts';
import { mergedAreaOrCellOf, isSameArea, selectionAtCell } from '../selection/model.ts';
import { roomForMoreLines, insertColumnsAtEndEdit, insertRowsAtEndEdit } from '../grid/lines-at-end.ts';
import { markEditByPage } from './unanswered-entries.ts';
import { isSavedEntryUnchanged, commitEntry } from './commit-entry.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageEffect, PageTransition, QueueEditEffect } from '../state/transitions.ts';
import type { EditAnswered, LineAfterEntry, PageContext } from '../state/event-reducer.ts';
import type { KeyMove } from '../selection/keyboard.ts';
import type { LinesAxisName } from '../grid/geometry.ts';
import type { CellId } from '../model/workbook.ts';
export function withLineAddedAfterLastEntry(
  step: PageTransition,
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  move: KeyMove,
): PageTransition {
  let { sheetId, activeCell, tabRun } = state;
  let lineKind: LinesAxisName | null = move.columnDelta === 1 ? 'columns' : move.rowDelta === 1 ? 'rows' : null;
  let { rowCount, columnCount } = layoutOfView(state, workbook);
  let [lastCell, activeArea] = [workbook.cellIdAt(sheetId, rowCount - 1, columnCount - 1), mergedAreaOrCellOf(workbook, activeCell)];
  if (lineKind === null || lastCell === null || activeArea === null) return step;
  let selectedCellOf = (effect: PageEffect): CellId | null => {
    let select = effect.kind === 'queueEdit' ? effect.ifQueued.select : null;
    if (select === null || select === 'placeChanged' || !('activeCell' in select)) return null;
    let area = mergedAreaOrCellOf(workbook, select.activeCell);
    return area !== null && isSameArea(area, activeArea) ? select.activeCell : null;
  };
  let [selectedCell, ...otherSelected] = step.effects.flatMap((effect) => selectedCellOf(effect) ?? []);
  let isAtLastLine =
    lineKind === 'rows'
      ? activeArea.topRowIndex + activeArea.rowCount === rowCount
      : activeArea.leftColumnIndex + activeArea.columnCount === columnCount;
  let canAddLine = roomForMoreLines(lineKind, lineKind === 'rows' ? rowCount : columnCount) >= 1;
  if (selectedCell === undefined || otherSelected.length > 0 || !isAtLastLine || !canAddLine) return step;
  let tabRunStart = tabRun !== null && workbook.positionOfCell(tabRun.from) !== null ? tabRun.from : null;
  let line: LineAfterEntry = {
    ...(lineKind === 'columns'
      ? {
          edit: markEditByPage(insertColumnsAtEndEdit(lastCell, 1)),
          done: {
            what: 'columnsInserted',
          },
          onlyCellOfPlaceChanged: {
            inRowOf: selectedCell,
          },
          carriesTabRunOn: true,
        }
      : {
          edit: markEditByPage(insertRowsAtEndEdit(lastCell, 1)),
          done: {
            what: 'rowsInserted',
          },
          onlyCellOfPlaceChanged: {
            inColumnOf: tabRunStart ?? selectedCell,
          },
        }),
    undoSelects: selectionAtCell(selectedCell),
  };
  let effects = step.effects.map(
    (effect) =>
      effect.kind !== 'queueEdit' || selectedCellOf(effect) === null
        ? effect
        : {
            ...effect,
            ifQueued: {
              ...effect.ifQueued,
              thenLine: line,
            },
          },
  );
  return {
    ...step,
    effects,
  };
}
export function withLineAddedAfterEntry(
  step: PageTransition,
  state: PageState,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
  move: KeyMove,
): PageTransition {
  if (!(step.effects.length === 0 && step.state.mode.kind === 'navigating' && isSavedEntryUnchanged(state, reads)) || refusalOfEveryEdit !== null)
    return withLineAddedAfterLastEntry(step, state, reads, move);
  let committed = commitEntry(state, reads, step.state.activeCell, 'key');
  let withLine = withLineAddedAfterLastEntry(committed, state, reads, move);
  return withLine === committed ? step : withLine;
}
export function lineEditAfterEntry(
  { mode }: Pick<PageState, 'mode'>,
  { edit, outcome, ifQueued }: Pick<EditAnswered, 'edit' | 'outcome' | 'ifQueued'>,
  { refusalOfEveryEdit }: Pick<PageContext, 'refusalOfEveryEdit'>,
): QueueEditEffect | null {
  let { thenLine, ...ifQueuedRest } = ifQueued;
  let isEntryAnswered =
    outcome.kind === 'editQueued' || (outcome.kind === 'nothingToChange' && mode.kind === 'editing' && mode.savedWhileOpen !== undefined);
  if (thenLine === undefined || !isEntryAnswered || refusalOfEveryEdit !== null) return null;
  let { edit: lineEdit, done: lineDone, ...lineRest } = thenLine;
  return {
    kind: 'queueEdit',
    edit: lineEdit,
    ifQueued: {
      ...ifQueuedRest,
      ...lineRest,
      select: 'placeChanged',
      done: ifQueuedRest.done ?? lineDone,
      entryBeforeLine: edit,
      dropsWhatIsHeld: 'ifRefused',
    },
  };
}
