import type { PageState } from './initial-state.ts';
import type { PageTransition } from './transitions.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellFoundBy } from '../grid/geometry.ts';
import type { KeyStep } from '../keys/key-acts.ts';
import { optionIdOfMenuKey } from '../chips/dropdown-options.ts';
import { formulaFromWordsPopup } from '../formulas/from-words/actions.ts';
import { isCellTextUntouched, dropdownCard } from '../chips/dropdowns.ts';
import { doesCellTakeCalendar } from '../chips/calendar.ts';
import { activeAnchorCell } from '../selection/model.ts';
import { openCardAtRow, stepListIndex } from '../ui/list-cards.ts';
import { withNoEffects } from './transitions.ts';
import { peopleListCard } from '../chips/people-list.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function cardBeingShown(state: PageState): CardShown | null {
  let list = listOfCards(state);
  if ((list?.card(state) ?? null) !== null && list?.isCardOfPointerAlone(state) !== true)
    return optionIdOfMenuKey(state.dropdown?.card?.ofRow ?? null) === null ? 'card' : 'cardOfOption';
  if (state.peopleList !== null) return 'peopleList';
  if (state.timeList !== null) return 'timeList';
  if (state.formulaHelp.list !== null) return 'functionList';
  if (state.dropdown === null) return formulaFromWordsPopup(state);
  if (state.dropdown.highlighted === 'startFromSet') return 'listOnRowToCard';
  return optionIdOfMenuKey(state.dropdown.highlighted) !== null && state.dropdown.isWalkedByKeys && isCellTextUntouched(state)
    ? 'listOnOption'
    : 'list';
}
export function popupOverEntry(state: PageState, reads: WorkbookReads): PopupOverEntry | null {
  let card = cardBeingShown(state);
  let { mode } = state;
  if (card !== null || mode.kind !== 'editing' || mode.typingIn !== 'cell') return card;
  return mode.text === mode.textAtStart && doesCellTakeCalendar(reads, activeAnchorCell(state, reads)) ? 'calendar' : null;
}
export function openListCardAtRow(state: PageState, reads: WorkbookReads, rowIndex: string, how: CardOpenedBy): PageState {
  let list = listOfCards(state);
  let isSameRow = how === 'restingPointer' && list?.card(state)?.ofRow === rowIndex;
  let card = openCardAtRow(rowIndex, list?.rowsAt(state, reads, rowIndex) ?? [], how);
  return list === null || card === null || isSameRow ? state : list.withCard(state, card);
}
export function moveInListCard(state: PageState, reads: WorkbookReads, step: KeyStep): PageState {
  let list = listOfCards(state);
  let card = list?.card(state) ?? null;
  let drawn = list?.drawn(state, reads) ?? null;
  if (list === null || card === null || drawn === null) return state;
  let highlightedRow = drawn.highlightedRow;
  let doKeysGoRound = list.doKeysGoRound(state);
  let rowToGoTo = highlightedRow === null && !doKeysGoRound ? 0 : stepListIndex(highlightedRow, step, drawn.rows.length);
  if (highlightedRow !== null && rowToGoTo !== highlightedRow + step && !doKeysGoRound) return state;
  return list.withCard(state, {
    ofRow: card.ofRow,
    wentTo: drawn.rows[rowToGoTo ?? -1]?.key ?? null,
  });
}
export function takeListCardRow(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  rowIndex: string | null,
  how: CellId,
  isByKey: boolean,
): PageTransition {
  let list = listOfCards(state);
  let drawn = list?.drawn(state, reads) ?? null;
  if (list === null || drawn === null) return withNoEffects(state);
  if (rowIndex !== null) return list.take(state, reads, rowIndex, how, 'pointer', false);
  let isLast = isByKey && !list.doKeysGoRound(state);
  let rowToTake = drawn.rows[drawn.highlightedRow ?? (isLast ? 0 : -1)];
  return rowToTake === undefined ? withNoEffects(moveInListCard(state, reads, 1)) : list.take(state, reads, rowToTake.key, how, 'key', isByKey);
}
export const listOfCards = (state: PageState) => {
  if (state.peopleList !== null) return peopleListCard;
  return state.dropdown === null ? null : dropdownCard;
};
export const shutListCard = (state: PageState): PageState => listOfCards(state)?.withCard(state, null) ?? state;
export const goIntoListCard = (state: PageState, reads: WorkbookReads): PageState =>
  listOfCards(state)?.drawn(state, reads)?.highlightedRow === null ? moveInListCard(state, reads, 1) : state;
/** How a list's card was opened: by a key, a pointer pressed, or a pointer resting on its row. */
export type CardOpenedBy = CellFoundBy | 'restingPointer';
/** Which list or card is shown over the cells, if any. */
export type CardShown =
  | 'card'
  | 'cardOfOption'
  | 'peopleList'
  | 'timeList'
  | 'functionList'
  | 'listOnRowToCard'
  | 'listOnOption'
  | 'list'
  | NonNullable<ReturnType<typeof formulaFromWordsPopup>>;
/** What pops up over the entry of a cell: a list or card, or the calendar. */
export type PopupOverEntry = CardShown | 'calendar';
