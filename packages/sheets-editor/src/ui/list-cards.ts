import type { KeyStep } from '../keys/key-acts.ts';
import type { CardOfList, PageState } from '../state/initial-state.ts';
import type { CardOpenedBy } from '../state/list-cards.ts';
import type { ListCardDrawn, ListCardRow } from '../chips/dropdowns.ts';
import type { WorkbookReads } from '../model/workbook.ts';
/** A list whose rows open cards: how its card is read from the page, drawn, and set. */
export interface ListWithCards {
  card(state: PageState): CardOfList | null;
  drawn(state: PageState, reads: WorkbookReads): ListCardDrawn | null;
  withCard(state: PageState, card: CardOfList | null): PageState;
}
export function stepListIndex(index: number | null, step: KeyStep, count: number): number | null {
  if (count === 0) return null;
  if (index === null) return step === 1 ? 0 : count - 1;
  return (index + step + count) % count;
}
export function openCardAtRow(ofRow: string, rows: readonly ListCardRow[], how: CardOpenedBy): CardOfList | null {
  let [firstRow] = rows;
  if (firstRow === undefined) return null;
  let wentTo = how === 'restingPointer' ? null : (rows.find((row) => row.isChosen) ?? firstRow).key;
  return {
    ofRow,
    wentTo,
  };
}
export function listCardOfRow(
  card: CardOfList | null,
  rowsWithCards: readonly string[],
  rowsOf: (rowKey: string) => ListCardRow[],
): ListCardDrawn | null {
  if (card === null || !rowsWithCards.includes(card.ofRow)) return null;
  let rows = rowsOf(card.ofRow);
  let highlightedIndex = rows.findIndex(({ key }) => key === card.wentTo);
  let { ofRow, isAsOpened } = card;
  return {
    ofRow,
    rows,
    highlightedRow: highlightedIndex === -1 ? null : highlightedIndex,
    ...(isAsOpened && {
      isAsOpened,
    }),
  };
}
export const dropUndrawableCard = (cards: ListWithCards, state: PageState, reads: WorkbookReads): PageState =>
  cards.card(state) !== null && cards.drawn(state, reads) === null ? cards.withCard(state, null) : state;
