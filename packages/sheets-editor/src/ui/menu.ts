import { scrollToShowSelection } from '../selection/model.ts';
import { cellEndCornerOnScreen, hitTestGrid } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { withNoEffects } from '../state/transitions.ts';
import { endEntryOnPointerPress } from '../editor/commit-entry.ts';
import { selectionAtPointer, pressOnGrid } from '../selection/pointer.ts';
import { isPointerTargetSelected, withoutOtherRanges } from '../selection/several-ranges.ts';
import { sortColumnsPointedAtOf } from './sort-menu.ts';
import { dropdownSelectionSummary } from '../chips/dropdown-editor.ts';
import type { Menu, PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { GridHit } from '../grid/geometry.ts';
/** How the context bar asks for its menu: the bar's height, and whether a key asked. */
export interface ContextBarMenuAsk {
  height: number;
  isByKey: boolean;
}
/** A menu to open: what it holds, and any other parts to set on it. */
export type MenuToOpen = Pick<Menu, 'holds'> & Partial<Menu>;
export function openContextBarMenu(state: PageState, workbook: ReadsWithTextMeasurer, point: PagePoint, { height, isByKey }: ContextBarMenuAsk): PageState {
  if (state.mode.kind === 'editing') return state;
  let activeCellPosition = workbook.positionOfCell(state.activeCell);
  let shownState = activeCellPosition === null ? state : scrollToShowSelection(state, workbook);
  let pointAbove = {
    x: point.x,
    y: point.y - MENU_POINTER_GAP,
  };
  let place =
    activeCellPosition === null
      ? menuPlaceNear(state, pointAbove, height + 2 * MENU_POINTER_GAP)
      : {
          at: cellEndCornerOnScreen(activeCellPosition, shownState, layoutOfView(shownState, workbook), shownState),
          side: null,
        };
  return {
    ...shownState,
    contextBarMenu: null,
    menu: {
      ...place,
      isAskedByKey: isByKey,
      holds: 'all',
      isOfContextBar: true,
    },
  };
}
export function openMenuAtActiveCell(state: PageState, workbook: ReadsWithTextMeasurer, menu: MenuToOpen): PageState {
  let activeCellPosition = workbook.positionOfCell(state.activeCell);
  if (activeCellPosition === null) return state;
  let shownState = scrollToShowSelection(state, workbook);
  let cornerOnScreen = cellEndCornerOnScreen(activeCellPosition, shownState, layoutOfView(shownState, workbook), shownState);
  return {
    ...shownState,
    contextBarMenu: null,
    menu: {
      at: cornerOnScreen,
      side: null,
      isAskedByKey: false,
      isOfContextBar: true,
      ...menu,
    },
  };
}
export function openContextMenu(state: PageState, point: PagePoint | null, workbook: ReadsWithTextMeasurer, isToSearch: boolean = false): PageTransition {
  let isEditing = state.mode.kind === 'editing';
  let stateWithoutDragging = {
    ...state,
    dragging: null,
  };
  if (point === null) {
    let activeCellPosition = workbook.positionOfCell(state.activeCell);
    if (activeCellPosition === null || isEditing) return withNoEffects(state);
    let shownState = scrollToShowSelection(stateWithoutDragging, workbook);
    return withNoEffects({
      ...shownState,
      menu: {
        at: cellEndCornerOnScreen(activeCellPosition, shownState, layoutOfView(shownState, workbook), shownState),
        side: null,
        isAskedByKey: !isToSearch,
        holds: 'all',
        ...(isToSearch && {
          isToSearch,
        }),
      },
    });
  }
  let pointedAt = hitTestGrid(point, state, layoutOfView(state, workbook));
  if (pointedAt === null) return withNoEffects(state);
  if (isEditing) return endEntryOnPointerPress(state, workbook, selectionAtPointer(state, workbook, point));
  let menu: Menu = {
    at: point,
    side: null,
    isAskedByKey: false,
    holds: 'all',
  };
  if (isPointerTargetSelected(state, pointedAt, workbook)) {
    let sortColumnsPointedAt = sortColumnsPointedAtOf(state, workbook, pointedAt);
    return withNoEffects({
      ...stateWithoutDragging,
      menu: {
        ...menu,
        sortColumnsPointedAt,
      },
    });
  }
  let { state: pressedState, effects } = pressOnGrid(
    withoutOtherRanges(state),
    {
      ...point,
      isShiftHeld: false,
    },
    workbook,
  );
  return {
    state: {
      ...pressedState,
      dragging: null,
      menu,
    },
    effects,
  };
}
export const menuPlaceNear = ({ gridHeight }: Pick<PageState, 'gridHeight'>, point: PagePoint, height: number): Pick<Menu, 'at' | 'side'> =>
  point.y > gridHeight / 2
    ? {
        at: point,
        side: 'top',
      }
    : {
        at: {
          x: point.x,
          y: point.y + height,
        },
        side: 'bottom',
      };
export const withSetMeetsInMenu = (state: PageState, workbook: ReadsWithTextMeasurer): PageState =>
  state.menu?.holds !== 'all' || state.menu.setMeets !== undefined
    ? state
    : {
        ...state,
        menu: {
          ...state.menu,
          setMeets: dropdownSelectionSummary(state, workbook),
        },
      };
export const MENU_POINTER_GAP = 6;
export const openMenuWith = (state: PageState, workbook: ReadsWithTextMeasurer, menu: Menu | null, menuChange: MenuToOpen): PageState =>
  menu === null
    ? openMenuAtActiveCell(state, workbook, menuChange)
    : {
        ...state,
        menu: {
          ...menu,
          ...menuChange,
        },
      };
