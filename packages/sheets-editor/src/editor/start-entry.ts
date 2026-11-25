import {
  activeAnchorCell,
  isPeopleListOnActiveCell,
  keyMoveOriginOf,
  scrollToShowEnlargedEditor,
  moveActiveCellTo,
  isSameCell,
  selectedArea,
  selectionOfArea,
  mergedAreaOrCellOf,
  isSameArea,
} from '../selection/model.ts';
import { dropdownAtCell } from '../chips/dropdown-options.ts';
import { usersOfCell, cellInputText, cellPlainText } from '../model/cell-values.ts';
import { isCheckboxCell } from '../chips/checkboxes.ts';
import { normalizeLineBreaks, flattenEnteredText } from '../format/shown-text.ts';
import { looksOfEntry, isFormulaTypedAfterText, looksOfRichCellText } from './entry-looks.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { doesCellTakeCalendar, emptyCalendar } from '../chips/calendar.ts';
import { openTimeList, isTimeCell } from './time-list.ts';
import { openDropdownList, closeDropdownList } from '../chips/dropdowns.ts';
import { cellBlockOfSelection } from '../model/cell-blocks.ts';
import { withNoEffects, isOneLineEditor } from '../state/transitions.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { textOfUnansweredEntryAt } from './unanswered-entries.ts';
import { areasOfAllRanges } from '../selection/several-ranges.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ClearedWithNoKeyboardOffer, PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { EditingMode, PageTransition } from '../state/transitions.ts';
import type { CellFoundBy } from '../grid/geometry.ts';
import type { ClearHow } from '../selection/cells-seen.ts';
import type { EntryTextChange } from './entry-looks.ts';
export function letArrowsActOnCells(state: PageState, reads: WorkbookReads): PageState {
  if (state.mode.kind !== 'editing') return state;
  let cell = activeAnchorCell(state, reads);
  return dropdownAtCell(reads, cell) !== null || usersOfCell(reads.cellOf(cell)).length > 0
    ? state
    : {
        ...state,
        mode: {
          ...state.mode,
          arrowsActOn: 'cells',
        },
      };
}
export function stopArrowsActingOnCells(state: PageState): PageState {
  if (state.mode.kind !== 'editing' || state.mode.arrowsActOn !== 'cells') return state;
  let { arrowsActOn, ...mode } = state.mode;
  return {
    ...state,
    mode,
  };
}
export function startEntryEditing(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  text: string,
  typingIn: EditingMode['typingIn'],
  how: CellFoundBy = 'key',
  entryOptions: EntryTextChange = {},
): PageState {
  let cell = activeAnchorCell(state, reads);
  let textAtStart = state.mode.kind === 'editing' ? state.mode.textAtStart : textToEditAt(state, reads, cell);
  let isOneLineCell =
    cellHasPicker(reads, cell) || isCheckboxCell(reads, cell) || isPeopleListOnActiveCell(state, reads) || isCellMergedWithOthers(reads, cell);
  let holdsOneLine =
    state.mode.kind === 'editing'
      ? state.mode.holdsOneLine === true
      : isOneLineCell &&
        !textAtStart.includes(`
`);
  let typedText = normalizeLineBreaks(text);
  let isInBoxOfOneLine = state.mode.kind === 'editing' && state.mode.isInBoxOfOneLine === true;
  let entryText = holdsOneLine || isInBoxOfOneLine ? flattenEnteredText(typedText) : typedText;
  let isTypedOverCell =
    state.mode.kind === 'editing' ? state.mode.isTypedOverCell === true : typingIn === 'cell' && entryText !== textAtStart;
  let mayHoldTextOfOthers =
    (state.mode.kind === 'editing'
      ? state.mode.typingIn !== typingIn && state.mode.text !== entryText
      : entryText.length > 1 && entryText !== textAtStart) ||
    (state.mode.kind === 'editing' && state.mode.mayHoldTextOfOthers === true);
  let isNearlyEmpty = entryText.length <= 1;
  let wasEmptied = isNearlyEmpty || (state.mode.kind === 'editing' && state.mode.wasEmptied === true);
  let textOfCellAtStart = isTypedOverCell || textAtStart === '' ? undefined : textAtStart;
  let textOfOthersHeld = state.mode.kind === 'editing' ? state.mode.textOfOthersHeld : textOfCellAtStart;
  let formulaOfAgentBefore = state.mode.kind === 'editing' ? state.mode.formulaOfAgent : undefined;
  let formulaOfAgent = isNearlyEmpty && formulaOfAgentBefore !== undefined ? 'wasHeld' : formulaOfAgentBefore;
  let arrowsActOnBefore = state.mode.kind === 'editing' ? state.mode.arrowsActOn : undefined;
  let arrowsActOn = arrowsActOnBefore === 'cells' && typingIn !== 'cell' ? undefined : arrowsActOnBefore;
  let looksOfEntryNow = looksOfEntry(
    state.mode,
    reads,
    cell,
    {
      text: entryText,
      textAtStart,
      ...(isTypedOverCell
        ? {
            isTypedOverCell,
          }
        : {}),
    },
    entryOptions,
  );
  let wasExpanded = state.mode.kind === 'editing' && state.mode.isExpanded === true;
  let isListText =
    (looksOfEntryNow.looks?.lists[0]?.kind ?? 'none') !== 'none' && !isFormulaTypedAfterText(state.mode, entryText, entryOptions.caretAt);
  let staysExpanded = wasExpanded && typingIn === 'cell' && (!isFormulaText(entryText) || isListText);
  let mode: EditingMode = {
    kind: 'editing',
    text: entryText,
    textAtStart,
    typingIn,
    ...looksOfEntryNow,
    ...(holdsOneLine
      ? {
          holdsOneLine,
        }
      : {}),
    ...(isInBoxOfOneLine
      ? {
          isInBoxOfOneLine,
        }
      : {}),
    ...(isTypedOverCell
      ? {
          isTypedOverCell,
        }
      : {}),
    ...(wasEmptied
      ? {
          wasEmptied,
        }
      : {}),
    ...(mayHoldTextOfOthers
      ? {
          mayHoldTextOfOthers,
        }
      : {}),
    ...(formulaOfAgent === undefined
      ? {}
      : {
          formulaOfAgent,
        }),
    ...(textOfOthersHeld === undefined
      ? {}
      : {
          textOfOthersHeld,
        }),
    ...(state.mode.kind === 'editing' && state.mode.holdsWhatWasNotTyped
      ? {
          holdsWhatWasNotTyped: true,
        }
      : {}),
    ...(arrowsActOn === undefined
      ? {}
      : {
          arrowsActOn,
        }),
    ...(state.mode.kind === 'editing' && state.mode.savedWhileOpen !== undefined
      ? {
          savedWhileOpen: state.mode.savedWhileOpen,
        }
      : {}),
    ...(staysExpanded
      ? {
          isExpanded: true,
        }
      : {}),
    ...(state.mode.kind === 'editing' && state.mode.isSumForSelectedCells
      ? {
          isSumForSelectedCells: true,
        }
      : {}),
    ...(state.mode.kind === 'editing' && state.mode.areSignsLeftAsTyped && entryText !== ''
      ? {
          areSignsLeftAsTyped: true,
        }
      : {}),
    ...(state.mode.kind === 'editing' && state.mode.text === entryText && state.mode.isBegunToListFunctions
      ? {
          isBegunToListFunctions: true,
        }
      : {}),
  };
  let calendar =
    typingIn === 'cell' && !state.isOnPhone && doesCellTakeCalendar(reads, cell) && !isFormulaText(entryText)
      ? (state.calendar ?? emptyCalendar())
      : null;
  let mergedCellsCameTo = keyMoveOriginOf(state);
  let moved = {
    ...scrollToShowEnlargedEditor(
      moveActiveCellTo(
        {
          ...state,
          mode,
          calendar,
          ...(wasExpanded && !staysExpanded
            ? {
                lastDone: {
                  what: 'entryCollapsed',
                },
              }
            : {}),
          scrolledForEntry: state.mode.kind === 'editing' ? state.scrolledForEntry : null,
        },
        reads,
        cell,
        how,
      ),
      reads,
      how,
      how === 'key',
    ),
    cameToMergedCellsAt: isSameCell(mergedCellsCameTo, cell) ? null : mergedCellsCameTo,
  };
  let stateMoved = isSameCell(cell, state.activeCell)
    ? {
        ...moved,
        selectionCorner: state.selectionCorner,
        rangeWalked: state.rangeWalked,
      }
    : moved;
  return openTimeList(typingIn === 'cell' && !isFormulaText(entryText) ? openDropdownList(stateMoved, reads) : closeDropdownList(stateMoved), reads);
}
export function clearSelectedCells(state: PageState, reads: WorkbookReads, how: ClearHow = 'key'): PageTransition {
  let selected = selectedArea(state, reads);
  let clearable = selected === null ? null : selectionOfArea(state, reads, selected);
  let cells = clearable === null ? null : cellBlockOfSelection(state, reads, clearable);
  if (selected === null || cells === null) return withNoEffects(state);
  let undoOffer: ClearedWithNoKeyboardOffer | null =
    how === 'menuWithNoKeyboard'
      ? {
          kind: 'clearedWithNoKeyboard',
          cells: areaToA1AsStored(selected, ownRowOrderOfSheet(reads, state.sheetId)),
          isSaved: false,
        }
      : null;
  return queueEdit(
    state,
    {
      kind: 'clearCells',
      cells,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: how === 'key' ? state : null,
      done: 'cleared',
      undoOffer,
    },
  );
}
export function followEntryCellText(stateBefore: PageState | null, state: PageState, reads: WorkbookReads): PageState {
  if (
    stateBefore !== null &&
    state.workbookChangeCount === stateBefore.workbookChangeCount &&
    state.saving === stateBefore.saving &&
    state.entriesUnanswered === stateBefore.entriesUnanswered &&
    isSameCell(state.activeCell, stateBefore.activeCell)
  )
    return state;
  let cell = activeAnchorCell(state, reads);
  let textToEdit = textToEditAt(state, reads, cell);
  if (textToEdit === state.textToEditOfEntryCell) return state;
  let { mode } = state;
  // isUntouched holds only while editing, so past the return below the mode is an entry.
  let isUntouched =
    mode.kind === 'editing' &&
    mode.savedWhileOpen !== 'typedText' &&
    mode.text === mode.textAtStart &&
    mode.textAtStart === state.textToEditOfEntryCell;
  let isUnanswered = stateBefore !== null && textOfUnansweredEntryAt(stateBefore, cell) !== null;
  if (!isUntouched || isUnanswered)
    return {
      ...state,
      textToEditOfEntryCell: textToEdit,
    };
  let {
    isTypedOverCell,
    wasEmptied,
    arrowsActOn,
    looks,
    selectedInEntry,
    marksToTypeIn,
    savedWhileOpen,
    holdsOneLine,
    ...modeRest
  } = mode as EditingMode;
  let keepsOneLine =
    holdsOneLine === true &&
    !textToEdit.includes(`
`);
  let text = (mode as EditingMode).isInBoxOfOneLine === true ? flattenEnteredText(textToEdit) : textToEdit;
  let looksOfCell = looksOfRichCellText(reads, cell, text);
  return {
    ...state,
    textToEditOfEntryCell: textToEdit,
    mode: {
      ...modeRest,
      ...(keepsOneLine
        ? {
            holdsOneLine,
          }
        : {}),
      ...(looksOfCell === undefined
        ? {}
        : {
            looks: looksOfCell,
          }),
      text,
      textAtStart: text,
      mayHoldTextOfOthers: true,
    },
  };
}
export function isCellMergedWithOthers(reads: WorkbookReads, cell: CellId): boolean {
  let area = mergedAreaOrCellOf(reads, cell);
  return area !== null && area.rowCount * area.columnCount > 1;
}
export function isSelectionMoreThanActiveCell(state: PageState, reads: WorkbookReads): boolean {
  let selectedAreas = areasOfAllRanges(state, reads);
  let [firstArea] = selectedAreas;
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  return firstArea !== undefined && activeArea !== null && (selectedAreas.length > 1 || !isSameArea(firstArea, activeArea));
}
export const editTextOfCell = (reads: WorkbookReads, cell: CellId): string =>
  normalizeLineBreaks(cellInputText(reads.cellOf(cell), reads.decimalSign));
export const textToEditAt = (state: Pick<PageState, 'entriesUnanswered'>, reads: WorkbookReads, cell: CellId): string =>
  textOfUnansweredEntryAt(state, cell) ?? editTextOfCell(reads, cell);
export const cellHasPicker = (reads: WorkbookReads, cell: CellId): boolean =>
  dropdownAtCell(reads, cell) !== null || usersOfCell(reads.cellOf(cell)).length > 0 || doesCellTakeCalendar(reads, cell) || isTimeCell(reads, cell);
export const canCellEntryExpand = (reads: WorkbookReads, cell: CellId): boolean =>
  !cellHasPicker(reads, cell) &&
  !isCheckboxCell(reads, cell) &&
  (!isCellMergedWithOthers(reads, cell) ||
    cellPlainText(reads.cellOf(cell))?.includes(`
`) === true);
export const doesCellReadMarkSigns = (reads: WorkbookReads, cell: CellId): boolean =>
  !cellHasPicker(reads, cell) && !isCheckboxCell(reads, cell) && reads.formatOf(cell).numberFormat.kind !== 'text';
export const doesEntryReadSigns = (state: PageState, reads: WorkbookReads): boolean =>
  (state.mode.kind !== 'editing' || state.mode.isInBoxOfOneLine !== true) &&
  doesCellReadMarkSigns(reads, activeAnchorCell(state, reads)) &&
  !isPeopleListOnActiveCell(state, reads);
export const doesEntryTakeLineBreaks = (state: PageState, reads: WorkbookReads): boolean =>
  state.mode.kind === 'editing' && !isOneLineEditor(state.mode) && !isPeopleListOnActiveCell(state, reads);
