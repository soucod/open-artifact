import { isSameCell } from '../selection/model.ts';
import type { CellSelection, SelectionToRead } from '../selection/model.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { SelectAfterEdit } from '../state/event-reducer.ts';
export function editEndsOnAnotherCell(state: PageState, next: PageTransition, isShiftHeld: boolean) {
  if (state.mode.kind !== 'editing' || isShiftHeld) return false;
  let { state: nextState, effects } = next;
  if (effects.length > 0)
    return effects.some((effect) => effect.kind === 'queueEdit' && asOneCellSelection(effect.ifQueued.select) !== null);
  return isOneCellSelection(nextState) && !isSameCell(nextState.activeCell, state.activeCell);
}
export const isOneCellSelection = ({ activeCell, selectionCorner }: Pick<CellSelection, 'activeCell' | 'selectionCorner'>): boolean =>
  isSameCell(activeCell, selectionCorner);
export const asOneCellSelection = (select: SelectAfterEdit): SelectionToRead | null =>
  typeof select === 'object' && select !== null && 'activeCell' in select && isOneCellSelection(select) ? select : null;
