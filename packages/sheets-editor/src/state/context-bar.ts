import type { RowId } from '@open-artifact/sheets-core';
import type { PageState } from './initial-state.ts';
import type { PageEvent } from './event-reducer.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import { isSameSelection, selectsSameArea } from '../selection/model.ts';
import { cancelMovingCells } from '../selection/move-cells.ts';
import { withoutFillDrag } from '../selection/fill-handle.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function nextContextBarMenu(menu: string | null, toggled: string, isOpening: boolean): string | null {
  if (isOpening) return toggled;
  return menu === toggled ? null : menu;
}
export function contextBarMenuAfterEvent(state: PageState, stateBefore: PageState, event: PageEvent, reads: WorkbookReads): string | null {
  let contextBarMenu = stateBefore.contextBarMenu;
  if (contextBarMenu === null || contextBarMenu !== state.contextBarMenu) return contextBarMenu;
  if (event.kind === 'rowsAskedForActedOn' || event.kind === 'agentRepliedWhichRowsAreAskedFor') return contextBarMenu;
  let isMenuGone = event.kind === 'editTextChanged' && event.typingIn === 'cell' && state.mode.kind !== 'editing';
  let isEditing = event.kind === 'keyPressed' || isMenuGone || isPointerOrMenuEvent(event);
  return !(isSameSelection(state, stateBefore) || isMergeAnswered(event) || (!isEditing && selectsSameArea(state, stateBefore, reads))) ||
    (!isSomethingOverContextBar(state) && isSomethingOverContextBar(stateBefore))
    ? null
    : contextBarMenu;
}
export function dropDragIfRowsOutOfViewChanged(stateBefore: PageState, state: PageState, reads: ReadsWithTextMeasurer): PageState {
  if (rowsOutOfViewOfSheet(stateBefore) === rowsOutOfViewOfSheet(state)) return state;
  if (state.dragging?.kind === 'movingCells') return cancelMovingCells(state, state.dragging, reads);
  return withoutFillDrag(state);
}
export const isPaneMenuOfContextBar = (menu: string | null): boolean => menu === 'chart' || menu === 'conditionalFormatting' || menu === 'sort';
export const isSomethingOverContextBar = (state: PageState): boolean =>
  state.mode.kind === 'editing' ||
  (state.menu !== null && !(state.menu.isOfContextBar === true && state.menu.holds === 'all')) ||
  state.customNumberFormat?.typedIn === 'dialog' ||
  state.pasteThatWaits !== null ||
  state.pickForWorkbook !== null ||
  state.importOfAFile !== null ||
  state.fileAwaited !== null ||
  state.xlsxFileReady !== null ||
  state.calendar !== null ||
  state.dropdown !== null ||
  state.peopleList !== null ||
  state.timeList !== null;
export const isPointerOrMenuEvent = (event: PageEvent): boolean =>
  event.kind === 'pointerPressed' ||
  event.kind === 'pointerDragged' ||
  event.kind === 'pointerReleased' ||
  (event.kind === 'menuAsked' && event.at !== null) ||
  (event.kind === 'editAnswered' && event.ifQueued.foundBy !== 'key');
export const isMergeAnswered = (event: PageEvent): boolean =>
  event.kind === 'editAnswered' && (event.edit.kind === 'mergeCells' || event.edit.kind === 'unmergeCells');
export const rowsOutOfViewOfSheet = ({
  rowsOutOfViewByOwnFilters,
  sheetId,
}: Pick<PageState, 'rowsOutOfViewByOwnFilters' | 'sheetId'>): Set<RowId> | undefined =>
  rowsOutOfViewByOwnFilters.get(sheetId);
