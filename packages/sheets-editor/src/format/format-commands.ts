import { toggledFontMark } from '../editor/text-looks.ts';
import {
  toggleListInEntry,
  canChangeEntryLists,
  canSetMarkOnEntrySelection,
  setMarkOnEntrySelection,
  canSetMarkToTypeIn,
  setMarkToTypeIn,
  applyTogglesToEntry,
} from '../editor/entry-looks.ts';
import { textToEditAt, startEntryEditing } from '../editor/start-entry.ts';
import { activeAnchorCell, selectedArea, selectionOfArea, moveActiveCellTo, mergedAreaOrCellOf } from '../selection/model.ts';
import { withNoEffects } from '../state/transitions.ts';
import { actOnEveryRange, refuseWhenSeveralRanges, hasOtherRanges } from '../selection/several-ranges.ts';
import { clearFormattingOfSelection } from './clear-formatting.ts';
import { commitEntryInPlaceIfEditing } from '../editor/commit-entry.ts';
import { removeDropdownOfSelection } from '../selection/cells-seen.ts';
import { refuseIfRowsOutOfViewInTheWay } from '../edits/rows-out-of-view.ts';
import { makeDropdownFromSelection, headerAboveDropdownCells } from '../chips/dropdown-editor.ts';
import { openCustomFormatDialog } from './custom-number-format.ts';
import { sharedFormatOfAllRanges } from '../selection/shared-format.ts';
import { cellBlockOfSelection } from '../model/cell-blocks.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { CHECKBOX_FORMAT } from '../chips/checkboxes.ts';
import { isDateNumberFormat, doesCellTakeCalendar, withCalendarOpen } from '../chips/calendar.ts';
import { isFormulaCell } from '../model/workbook.ts';
import { formatOfToolbarChoice } from './toolbar-choices.ts';
import { isRangeInSight } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import type { FontMark, FormattedDone, PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CaretInEntry, IfQueued } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellId } from '../model/workbook.ts';
import type { CellFormatChoice } from '../i18n/change-labels.ts';
import type { LocalizedDropdownPreset, NamedDropdownPreset } from '../i18n/chip-labels.ts';
import type { ListKind } from '../editor/text-looks.ts';
import type { CellFormat } from '@open-artifact/sheets-core';
import type { NumberFormatOrControlChoice } from './number-format-choices.ts';
import type { DecimalPlaceChange } from './decimal-places.ts';
/** Make the selected cells a dropdown, from a first set of options. */
export interface DropdownCommand {
  dropdown: true;
  firstSet: LocalizedDropdownPreset;
  setsByName?: NamedDropdownPreset[];
  isReadySetPicked?: true;
  replacesFormulas?: true;
  thenOpens?: 'list';
  thenGoesOnTo?: CellId;
}
/** Give the selected cells a date format and open the calendar, or go on to a cell. */
export interface DateToPickCommand {
  dateToPick: true;
  thenGoesOnTo?: CellId;
}
/** Open the custom number format dialog, with what was typed so far. */
export interface PatternToTypeCommand {
  patternToType: true;
  typedSoFar?: string;
}
/** A format command whose kind the selected cells must fit, or that sets a format. */
export type FittedFormatCommand =
  | CellFormatChoice
  | DropdownCommand
  | { checkbox: true }
  | DateToPickCommand
  | { toggle: FontMark }
  | PatternToTypeCommand
  | { stepOfDecimalPlaces: DecimalPlaceChange };
/** What a format chosen in the toolbar, a menu or by a key does to the selected cells or the entry. */
export type FormatCommand = FittedFormatCommand | { list: ListKind } | { clearsFormatting: true } | { removesDropdown: true };
/** What a format command tells once its edit is queued on a range, given the heading rows it leaves out. */
type IfQueuedOfRange = (rangeState: PageState, headingRowCount: number) => Pick<IfQueued, 'select' | 'done'> & Partial<IfQueued>;
export function fitKindOfFormatCommand(command: FittedFormatCommand): NumberFormatOrControlChoice | null {
  if ('dropdown' in command) return 'dropdown';
  if ('checkbox' in command) return 'checkbox';
  if ('dateToPick' in command) return 'date';
  return 'toggle' in command || 'patternToType' in command || 'stepOfDecimalPlaces' in command ? null : (command.numberFormatChoice ?? null);
}
export function formatOfFormatCommand(
  { formatOfSelection }: Pick<PageState, 'formatOfSelection'>,
  command: CellFormatChoice | { toggle: FontMark } | { stepOfDecimalPlaces: DecimalPlaceChange },
): CellFormatChoice | null {
  if ('toggle' in command) return toggledFontMark(command.toggle, formatOfSelection.shared);
  if (!('stepOfDecimalPlaces' in command)) return command;
  let decimalPlaces = formatOfSelection.decimalPlaces[command.stepOfDecimalPlaces];
  return decimalPlaces === null
    ? null
    : {
        decimalPlaces,
      };
}
export function toggleListInCellOrEntry(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  list: ListKind,
  caretInEntry: CaretInEntry | undefined,
): PageState {
  if (state.mode.kind === 'editing') return toggleListInEntry(state, workbook, list, caretInEntry);
  let text = textToEditAt(state, workbook, activeAnchorCell(state, workbook));
  let started = startEntryEditing(state, workbook, text, 'cell');
  let caret: CaretInEntry = {
    text,
    start: 0,
    end: text.length,
    isComposing: false,
  };
  if (started.mode.kind !== 'editing' || !canChangeEntryLists(started.mode, caret)) return state;
  let toggled = toggleListInEntry(started, workbook, list, caret);
  if (toggled.mode.kind !== 'editing') return state;
  let caretAtEnd = {
    start: text.length,
    end: text.length,
  };
  return {
    ...toggled,
    mode: {
      ...toggled.mode,
      selectedInEntry: caretAtEnd,
    },
  };
}
export function applyFormatCommand(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  command: FormatCommand,
  caretInEntry?: CaretInEntry,
): PageTransition {
  if ('toggle' in command && canSetMarkOnEntrySelection(state, caretInEntry))
    return withNoEffects(setMarkOnEntrySelection(state, workbook, command.toggle, caretInEntry));
  if ('toggle' in command && canSetMarkToTypeIn(state, workbook, caretInEntry))
    return withNoEffects(setMarkToTypeIn(state, workbook, command.toggle, caretInEntry));
  if ('list' in command) return withNoEffects(toggleListInCellOrEntry(state, workbook, command.list, caretInEntry));
  if ('clearsFormatting' in command) {
    let outcome = actOnEveryRange(state, (rangeState) => clearFormattingOfSelection(rangeState, workbook));
    return {
      ...outcome,
      state: applyTogglesToEntry(outcome.state, CLEARED_FONT_MARKS),
    };
  }
  if ('removesDropdown' in command) return commitEntryInPlaceIfEditing(state, workbook) ?? removeDropdownOfSelection(state, workbook);
  let fitKind = fitKindOfFormatCommand(command);
  let replacesWithDropdown = 'dropdown' in command && command.replacesFormulas === true && state.formatOfSelection.takesDropdownFromInsert;
  if (fitKind !== null && !replacesWithDropdown && !state.formatOfSelection.formatsThatFit.includes(fitKind)) return withNoEffects(state);
  if ('dropdown' in command)
    return (
      commitEntryInPlaceIfEditing(state, workbook) ??
      refuseWhenSeveralRanges(state, 'dropdown') ??
      refuseIfRowsOutOfViewInTheWay(state, workbook, 'dropdown') ??
      makeDropdownFromSelection(state, workbook, command)
    );
  if ('patternToType' in command)
    return commitEntryInPlaceIfEditing(state, workbook) ?? openCustomFormatDialog(state, workbook, command.typedSoFar ?? null);
  if (sharedFormatOfAllRanges(state, workbook) === null) return withNoEffects(state);
  let { shared: sharedFormat } = state.formatOfSelection;
  let formatSelection = (
    cellFormat: CellFormat,
    ifQueuedOfRange: IfQueuedOfRange,
    { leavesHeadingOut }: { leavesHeadingOut: boolean } = {
      leavesHeadingOut: false,
    },
  ) =>
    actOnEveryRange(state, (rangeState) => {
      let area = selectedArea(rangeState, workbook);
      let header = area === null || !leavesHeadingOut || hasOtherRanges(state) ? null : headerAboveDropdownCells(rangeState, workbook, area);
      let corners = header?.corners ?? (area === null ? null : selectionOfArea(rangeState, workbook, area));
      let cells = corners === null ? null : cellBlockOfSelection(rangeState, workbook, corners);
      if (cells === null) return withNoEffects(rangeState);
      return queueEdit(
        rangeState,
        {
          kind: 'formatCells',
          cells,
          format: cellFormat,
        },
        {
          ...IF_QUEUED_DEFAULTS,
          ...ifQueuedOfRange(rangeState, header?.top ?? 0),
        },
        cellFormat.numberFormat === undefined
          ? {}
          : {
              makesRoomForNumbersIn: state.sheetId,
            },
      );
    });
  if ('checkbox' in command)
    return (
      commitEntryInPlaceIfEditing(state, workbook) ??
      formatSelection(
        CHECKBOX_FORMAT,
        (rangeState, headingRowCount) => ({
          select: null,
          done: {
            what: 'checkboxesMade',
            headingRowCount,
          },
        }),
        {
          leavesHeadingOut: true,
        },
      )
    );
  if ('dateToPick' in command) {
    let outcome = commitEntryInPlaceIfEditing(state, workbook);
    if (outcome !== null) return outcome;
    let { thenGoesOnTo } = command;
    let activeCell = activeAnchorCell(state, workbook);
    if (
      sharedFormat.numberFormat !== null &&
      isDateNumberFormat(sharedFormat.numberFormat) &&
      sharedFormat.cellControl?.kind === 'none' &&
      doesCellTakeCalendar(workbook, activeCell)
    ) {
      let stateWithoutNotice = {
        ...state,
        notice: null,
        lastDone: null,
      };
      return withNoEffects(
        thenGoesOnTo === undefined ? withCalendarOpen(stateWithoutNotice, workbook) : moveActiveCellTo(stateWithoutNotice, workbook, thenGoesOnTo),
      );
    }
    let opensCalendar = !isFormulaCell(workbook, activeCell);
    return formatSelection(
      formatOfToolbarChoice(DATE_NUMBER_FORMAT_CHOICE, workbook),
      (rangeState) => ({
        select: null,
        done: {
          what: 'formatted',
          format: DATE_NUMBER_FORMAT_CHOICE,
        },
        ...(rangeState === state &&
          thenGoesOnTo !== undefined && {
            thenGoesOnTo,
          }),
        ...(rangeState === state &&
          thenGoesOnTo === undefined &&
          opensCalendar && {
            thenCalendar: 'opens',
          }),
      }),
    );
  }
  let format = formatOfFormatCommand(state, command);
  if (format === null) return withNoEffects(state);
  let done: Omit<FormattedDone, 'cells'> = {
    what: 'formatted',
    format,
  };
  let cellArea =
    format.fontSizeInPoints !== undefined || format.wrapText === true || format.bold !== undefined || format.italic !== undefined
      ? mergedAreaOrCellOf(workbook, state.activeCell)
      : null;
  let isCellInSight = cellArea !== null && isRangeInSight(cellArea, state, layoutOfView(state, workbook), state);
  let formatted = formatSelection(
    formatOfToolbarChoice(format, workbook),
    (rangeState) => ({
      select: isCellInSight ? rangeState : null,
      done,
      leavesEntryOpen: true,
    }),
  );
  return {
    ...formatted,
    state: applyTogglesToEntry(formatted.state, format),
  };
}
export const DATE_NUMBER_FORMAT_CHOICE: CellFormatChoice = {
  numberFormatChoice: 'date',
};
export const CLEARED_FONT_MARKS: Pick<CellFormatChoice, FontMark> = {
  bold: false,
  italic: false,
  underline: 'none',
  strikethrough: false,
};
