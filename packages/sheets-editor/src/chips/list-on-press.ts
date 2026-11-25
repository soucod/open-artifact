import { cellExplained, linkAddressesAt } from '../state/explained-under-cell.ts';
import { isSameCell, anchorCellOf, isAnchorOfActiveCell } from '../selection/model.ts';
import { doesCellTakeCalendar } from './calendar.ts';
import { dropdownAtCell } from './dropdown-options.ts';
import { isPeopleCell, refreshPeopleList } from './people-list.ts';
import { commentAtActiveCell, isActiveCellInOpenComment, doesCommentModePick } from '../comments/comment-state.ts';
import { asOneCellSelection, editEndsOnAnotherCell } from '../editor/commit-moves.ts';
import { hitTestGrid } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { withNoEffects, type PageEffect, type PageTransition } from '../state/transitions.ts';
import { textToEditAt, startEntryEditing } from '../editor/start-entry.ts';
import { toggleableCheckboxValue } from './checkbox-presses.ts';
import { fixAtCell } from '../formulas/fix/fixes-on-cells.ts';
import { isFormulaText } from './dropdown-pane-edits.ts';
import { openDropdownList } from './dropdowns.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageContext, PointerPressed, SelectAfterEdit } from '../state/event-reducer.ts';
export function isLinkCardOfCellShown(state: PageState, reads: WorkbookReads, cellId: CellId): boolean {
  let card = cellExplained(state, reads);
  if (card === null || linkAddressesAt(state, reads, card.cellId).length === 0) return false;
  return card.isByPress || isSameCell(card.cellId, cellId);
}
export function doesCellOpenItsOwnOnPress(state: PageState, reads: WorkbookReads, cell: CellId): boolean {
  let anchorCell = anchorCellOf(reads, cell);
  return (
    (state.isOnPhone && doesCellTakeCalendar(reads, anchorCell)) ||
    dropdownAtCell(reads, anchorCell) !== null ||
    isPeopleCell(reads, anchorCell) ||
    commentAtActiveCell(state, reads) !== null ||
    isActiveCellInOpenComment(state, reads, cell) ||
    isLinkCardOfCellShown(state, reads, anchorCell)
  );
}
export function openListOfPressedActiveCell(state: PageState, reads: WorkbookReads, select: SelectAfterEdit): PageState {
  let oneCell = asOneCellSelection(select);
  return oneCell !== null && isAnchorOfActiveCell(state, reads, oneCell.activeCell) ? openListOfActiveCell(state, reads) : state;
}
export function openListOnPress(
  before: PageState,
  step: PageTransition,
  event: PointerPressed,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  if (refusalOfEveryEdit !== null || !editEndsOnAnotherCell(before, step, event.isShiftHeld)) return step;
  if (hitTestGrid(event, before, layoutOfView(before, reads))?.kind !== 'cell') return step;
  let { state, effects } = step;
  return effects.length > 0
    ? {
        state,
        effects: effects.map(opensListOfPressedCell),
      }
    : withNoEffects(openListOfActiveCell(state, reads));
}
export function openEntryOfActiveCell(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let anchorCell = anchorCellOf(reads, state.activeCell),
    text = textToEditAt(state, reads, state.activeCell);
  return state.mode.kind !== 'navigating' ||
    toggleableCheckboxValue(reads, anchorCell) !== null ||
    doesCommentModePick(state) ||
    doesCellOpenItsOwnOnPress(state, reads, state.activeCell) ||
    fixAtCell(state, anchorCell) !== null ||
    text !== '' ||
    reads.spilledCellOf(anchorCell) !== null
    ? state
    : startEntryEditing(state, reads, text, 'cell', 'pointer');
}
export function openEntryOfPressedActiveCell(state: PageState, reads: ReadsWithTextMeasurer, select: SelectAfterEdit): PageState {
  let oneCell = asOneCellSelection(select);
  return oneCell !== null && isAnchorOfActiveCell(state, reads, oneCell.activeCell) ? openEntryOfActiveCell(state, reads) : state;
}
export function openEntryOnPress(
  before: PageState,
  step: PageTransition,
  event: PointerPressed,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  if (
    !event.isByFinger ||
    !before.isOnPhone ||
    refusalOfEveryEdit !== null ||
    before.mode.kind !== 'editing' ||
    before.mode.typingIn !== 'cell' ||
    isFormulaText(before.mode.text) ||
    event.caretInEntry?.isComposing === true ||
    !editEndsOnAnotherCell(before, step, event.isShiftHeld)
  )
    return step;
  if (hitTestGrid(event, before, layoutOfView(before, reads))?.kind !== 'cell') return step;
  let { state, effects } = step;
  return effects.length > 0
    ? {
        state,
        effects: effects.map(opensEntryOfPressedCell),
      }
    : withNoEffects(openEntryOfActiveCell(state, reads));
}
export const openListOfActiveCell = (state: PageState, reads: WorkbookReads): PageState => refreshPeopleList(openDropdownList(state, reads), reads);
export const opensListOfPressedCell = (effect: PageEffect): PageEffect =>
  effect.kind === 'queueEdit' && asOneCellSelection(effect.ifQueued.select) !== null
    ? {
        ...effect,
        ifQueued: {
          ...effect.ifQueued,
          thenListOfPressedCell: 'opens',
        },
      }
    : effect;
export const opensEntryOfPressedCell = (effect: PageEffect): PageEffect =>
  effect.kind === 'queueEdit' && asOneCellSelection(effect.ifQueued.select) !== null
    ? {
        ...effect,
        ifQueued: {
          ...effect.ifQueued,
          thenEntryOfPressedCell: 'opens',
        },
      }
    : effect;
export const withoutEntryOfPressedCell = (effect: PageEffect): PageEffect => {
  if (effect.kind !== 'queueEdit' || effect.ifQueued.thenEntryOfPressedCell === undefined) return effect;
  let { thenEntryOfPressedCell: _thenEntryOfPressedCell, ...ifQueued } = effect.ifQueued;
  return {
    ...effect,
    ifQueued,
  };
};
