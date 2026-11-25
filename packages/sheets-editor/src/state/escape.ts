import type { PageState } from './initial-state.ts';
import { isEditRefusedForSaving } from './queries.ts';
import { hasUnsavedDropdownTyping } from '../chips/dropdown-pane-edits.ts';
export const hasNoticeOrUndoOffer = (state: PageState): boolean =>
  (state.notice !== null && !isEditRefusedForSaving(state.notice)) || state.undoOffer !== null;
export const isTurnUndoOfferFrontmost = (state: PageState): boolean =>
  !hasNoticeOrUndoOffer(state) && state.newsOfLoss === null && state.calendar === null && state.copiedCells?.activeCell.sheetId !== state.sheetId;
export const hasNoticeToDismiss = (state: PageState): boolean =>
  hasNoticeOrUndoOffer(state) || state.undoOfTurnOffered !== null || state.newsOfLoss !== null || state.calendar !== null;
export const isSidePaneShuttable = (state: PageState): boolean => state.sidePane !== null && !hasUnsavedDropdownTyping(state);
export const hasLayerForEscape = (state: PageState): boolean =>
  state.menu !== null ||
  hasNoticeToDismiss(state) ||
  state.dragging !== null ||
  state.find !== null ||
  state.followed !== null ||
  state.cellsLinkedTo !== null ||
  state.copiedCells?.activeCell.sheetId === state.sheetId ||
  isSidePaneShuttable(state) ||
  state.newCommentOn !== null ||
  hasOpenCommentCard(state);
export const hasOpenCommentCard = (state: PageState): boolean =>
  state.comments?.some(({ isOpen }) => isOpen) === true;
export const commentToShutOnEscape = (state: PageState): CommentToShut | null => {
  if (
    hasLayerForEscape({
      ...state,
      comments: null,
      newCommentOn: null,
      copiedCells: null,
    })
  )
    return null;
  if (state.newCommentOn !== null) return 'box';
  return hasOpenCommentCard(state) ? 'card' : null;
};
export const escapeInCellsDoes = (state: PageState): EscapeInCells => {
  if (state.doesCommentModePickCells && state.dragging === null) return 'leaves';
  if (hasLayerForEscape(state)) return 'letsGo';
  return state.isSteppedOutOfCells ? 'leaves' : 'stepsOut';
};
export const stepBackIntoCells = (state: PageState): PageState => ({
  ...state,
  isSteppedOutOfCells: false,
  lastDone: state.lastDone?.what === 'steppedOutOfCells' ? null : state.lastDone,
});
export const MODIFIER_KEYS = new Set<string>(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);
export const doesKeyStepBackIntoCells = (key: string): boolean => key !== 'Escape' && key !== 'Tab' && !MODIFIER_KEYS.has(key);
/** Which comment Escape shuts: the box of a new comment, or an open comment card. */
export type CommentToShut = 'box' | 'card';
/** What Escape does while the cells have the keys: leaves the page's keys, lets go of a layer, or steps out of the cells. */
export type EscapeInCells = 'leaves' | 'letsGo' | 'stepsOut';
