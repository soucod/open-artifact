import { dropdownEditorOfPane } from '../state/queries.ts';
import { EMPTY_TYPED_OPTION, readySetKeyOf, DROPDOWN_SCROLL_SLOP } from './dropdown-pane-edits.ts';
import { withDropdownPane, dropdownAtActiveCell, dropdownCard, closeSidePane, closeDropdownList, openDropdownList } from './dropdowns.ts';
import { activeAnchorCell, mergedAreaOrCellOf, isSameSelection, isSameCell } from '../selection/model.ts';
import { colorOfOptionIn } from './dropdown-editor.ts';
import { colorsEqual } from '../model/colors.ts';
import { isRangeInSight } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { dropUndrawableCard } from '../ui/list-cards.ts';
import { withNoEffects } from '../state/transitions.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { IfQueued } from '../state/event-reducer.ts';
import type { GridScroll } from '../grid/geometry.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { DropdownEditor } from './dropdown-pane-edits.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
export function refreshDropdownEditor(
  state: PageState,
  reads: WorkbookReads,
  thenInEditor: NonNullable<IfQueued['thenInDropdownEditor']>,
): PageState {
  let editor = dropdownEditorOfPane(state);
  if (editor === null) return state;
  let typed = thenInEditor === 'goesOn' ? editor.typed : thenInEditor === 'startsOption' ? EMPTY_TYPED_OPTION : null;
  return withDropdownPane(
    state,
    dropdownEditorForEntryCell(
      state,
      reads,
      {
        ...editor,
        typed,
        isCustom: false,
      },
      true,
    ),
  );
}
export function dropdownEditorForEntryCell(
  state: PageState,
  reads: WorkbookReads,
  previousEditor: DropdownEditor | null,
  keepsTyping: boolean,
): DropdownEditor | null {
  let entryCell = activeAnchorCell(state, reads);
  let dropdown = reads.dropdownOf(entryCell);
  let cellsOfDropdown = dropdown === null ? null : reads.cellsOfTheDropdownAt(entryCell);
  if (dropdown === null || cellsOfDropdown === null) return keepsTyping && previousEditor?.dropdownId === null ? previousEditor : null;
  let typed = keepsTyping ? (previousEditor?.typed ?? null) : null;
  let isTypedStillThere =
    typed === null || typed.optionId === null || dropdown.options.some(({ optionId }) => optionId === typed.optionId);
  return {
    dropdownId: dropdown.dropdownId,
    options: dropdown.options,
    stretches: cellsOfDropdown.stretches,
    indexOfOwnStretch: cellsOfDropdown.indexOfTheStretchWithTheCell,
    reach: previousEditor?.dropdownId === dropdown.dropdownId ? previousEditor.reach : 'everyCell',
    ...(previousEditor?.lastInColor !== undefined &&
      previousEditor.dropdownId === dropdown.dropdownId &&
      dropdown.options.every((option) => {
        let colorLastIn = colorOfOptionIn(previousEditor.lastInColor, option);
        return option.color.kind === 'none' || (colorLastIn !== undefined && colorsEqual(option.color, colorLastIn));
      }) && {
        lastInColor: previousEditor.lastInColor,
      }),
    typed: isTypedStillThere ? typed : null,
    ...(keepsTyping &&
    previousEditor !== null &&
    cellsOfDropdown.stretches.length === 1 &&
    previousEditor.dropdownId === dropdown.dropdownId &&
    previousEditor.stretches[previousEditor.indexOfOwnStretch]?.range ===
      cellsOfDropdown.stretches[cellsOfDropdown.indexOfTheStretchWithTheCell]?.range
      ? {
          ...(previousEditor.cellsTyped !== undefined && {
            cellsTyped: previousEditor.cellsTyped,
          }),
          ...(previousEditor.cellsRefused !== undefined &&
            previousEditor.cellsRefused.why !== 'headingIsNoOption' && {
              cellsRefused: previousEditor.cellsRefused,
            }),
        }
      : {}),
    isCustom:
      keepsTyping && previousEditor?.isCustom === true && readySetKeyOf(state, dropdown.options) === readySetKeyOf(state, previousEditor.options),
  };
}
export function isDropdownListOutOfPlace(state: PageState, reads: ReadsWithTextMeasurer, scrollAsItOpened: GridScroll): boolean {
  let merge = mergedAreaOrCellOf(reads, activeAnchorCell(state, reads));
  return (
    merge === null ||
    !isRangeInSight(merge, state, layoutOfView(state, reads), state) ||
    Math.hypot(state.scrollLeft - scrollAsItOpened.scrollLeft, state.scrollTop - scrollAsItOpened.scrollTop) > DROPDOWN_SCROLL_SLOP / state.zoom
  );
}
export function reconcileDropdownList(previousState: PageState, state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let dropdown = state.dropdown;
  if (dropdown === null) return state;
  if (
    !(
      (previousState.dropdown !== dropdown || isSameSelection(previousState, state)) &&
      dropdownAtActiveCell(state, reads) !== null &&
      !isDropdownListOutOfPlace(state, reads, dropdown.scrollAsItOpened) &&
      state.menu === null
    )
  )
    return {
      ...state,
      dropdown: null,
    };
  let isPointerCardStale = dropdown.isCardOfPointerAlone && previousState.dropdown?.highlighted !== dropdown.highlighted;
  return dropUndrawableCard(dropdownCard, isPointerCardStale ? dropdownCard.withCard(state, null) : state, reads);
}
export function reconcileDropdownPane(previousState: PageState, state: PageState, reads: WorkbookReads): PageState {
  if (state.sidePane?.kind !== 'dropdown') return state;
  let isSelectionSame = isSameSelection(previousState, state);
  let isSameWorkbook = state.workbookChangeCount === previousState.workbookChangeCount;
  let isUnchanged = previousState.sidePane?.kind === 'dropdown' && isSelectionSame && isSameWorkbook;
  let hasEditorGone = state.sidePane.editor !== null && dropdownEditorOfPane(previousState) === null;
  if (isUnchanged || hasEditorGone) return state;
  let editor = dropdownEditorForEntryCell(state, reads, state.sidePane.editor, isSelectionSame);
  if (editor === null && !isSelectionSame && isSameWorkbook) return closeSidePane(state);
  return editor === state.sidePane.editor ? state : withDropdownPane(state, editor);
}
export function toggleDropdownListOnClick(
  previousState: PageState,
  { state, effects }: PageTransition,
  isSelectionExtended: boolean,
  reads: WorkbookReads,
): PageTransition {
  if (
    !isPlainCellClick(
      {
        state,
        effects,
      },
      isSelectionExtended,
    )
  )
    return {
      state,
      effects,
    };
  let isOnOpenCell = previousState.dropdown !== null && isSameCell(state.activeCell, previousState.activeCell);
  return withNoEffects(isOnOpenCell ? closeDropdownList(state) : openDropdownList(state, reads));
}
export const hasLeftDropdownPane = (previousState: PageState, state: PageState): boolean =>
  state.sidePane?.kind !== 'dropdown' || state.sheetId !== previousState.sheetId || !isSameSelection(previousState, state);
export const reconcileDropdownState = (previousState: PageState, state: PageState, reads: ReadsWithTextMeasurer): PageState =>
  reconcileDropdownPane(previousState, reconcileDropdownList(previousState, state, reads), reads);
export const isPlainCellClick = ({ state, effects }: PageTransition, isNotPlainClick: boolean): boolean =>
  !isNotPlainClick &&
  effects.length === 0 &&
  state.mode.kind === 'navigating' &&
  state.dragging?.kind === 'selecting' &&
  state.dragging.what === 'cells';
