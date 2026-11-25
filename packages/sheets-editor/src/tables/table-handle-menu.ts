import { tableHandles } from '../selection/move-cells.ts';
import { tablesToOutline } from './tables-in-view.ts';
import { ROW_HEADER_WIDTH } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { menuPlaceNear } from '../ui/menu.ts';
import { keyActOf } from '../keys/key-acts.ts';
import { NAVIGATING_MODE } from '../state/transitions.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageContext, PageEvent } from '../state/event-reducer.ts';
import type { KeyPressWithCaret } from '../keys/key-acts.ts';
import type { MovingCellsDrag } from '../selection/move-cells.ts';
import type { GridPoint } from '../grid/geometry.ts';
/** Which item of a table's menu is lit: none, the first, or another. */
export type ItemLitInMenu = 'none' | 'first' | 'other';
/** Who a key pressed in a table's menu goes to: the cells, nobody, or the menu. */
export type KeyTargetAtTableMenu = 'cells' | 'nobody' | 'menu';
export function markDriftFromTableHandle(state: PageState, pointer: GridPoint): PageState {
  let { dragging } = state;
  return dragging?.kind === 'movingCells' &&
    dragging.press.onHandleOfTable !== undefined &&
    dragging.hasDriftedFromHandle !== true &&
    Math.hypot(pointer.x - dragging.press.x, pointer.y - dragging.press.y) >= TABLE_HANDLE_DRIFT_PX / state.zoom
    ? {
        ...state,
        dragging: {
          ...dragging,
          hasDriftedFromHandle: true,
        },
      }
    : state;
}
export function openTableHandleMenu(
  state: PageState,
  tableKey: string,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageState {
  let handle = tableHandles(tablesToOutline(state, reads), state, reads, refusalOfEveryEdit !== null).find(
    ({ table }) => table.key === tableKey,
  );
  if (handle === undefined) return state;
  let place = {
    x: ROW_HEADER_WIDTH + (handle.isOverRowNumbers ? 0 : handle.left),
    y: COLUMN_HEADER_HEIGHT + handle.top - TABLE_HANDLE_MENU_INSET,
  };
  return {
    ...state,
    menu: {
      ...menuPlaceNear(state, place, handle.height + 2 * TABLE_HANDLE_MENU_INSET),
      isAskedByKey: false,
      holds: 'all',
      ofHandleOfTable: tableKey,
    },
  };
}
export function keyTargetAtTableMenu(keyEvent: KeyPressWithCaret, litItem: ItemLitInMenu): KeyTargetAtTableMenu {
  let act = keyActOf(NAVIGATING_MODE, keyEvent, null, 'leaves');
  if (act?.kind === 'startEditing' && act.text !== null && act.text !== ' ') return 'cells';
  return (keyEvent.key === 'ArrowUp' && litItem !== 'other') || (keyEvent.key === 'End' && litItem === 'none') ? 'nobody' : 'menu';
}
export const TABLE_HANDLE_MENU_INSET = 4;
export const TABLE_HANDLE_DRIFT_PX = 5;
export const tableHandleClicked = ({ press, landing, hasDriftedFromHandle }: Pick<MovingCellsDrag, 'press' | 'landing' | 'hasDriftedFromHandle'>): string | null =>
  landing === null && hasDriftedFromHandle !== true ? (press.onHandleOfTable ?? null) : null;
export const doesEventCloseTableHandleMenu = ({ menu }: Pick<PageState, 'menu'>, event: PageEvent): boolean =>
  menu?.ofHandleOfTable !== undefined &&
  menu.holds === 'all' &&
  (event.kind === 'cutChosen' ||
    event.kind === 'pasteChosen' ||
    event.kind === 'chartPasteChosen' ||
    (event.kind === 'editTextChanged' && event.typingIn === 'cell' && (event.text === ' ' || event.text === '　')) ||
    (event.kind === 'keyPressed' && keyTargetAtTableMenu(event, 'none') !== 'cells'));
