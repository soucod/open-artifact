import type { NumberFormatChoice } from '../format/number-format-choices.ts';
import type { Color, HorizontalAlignment, NumberFormat, Underline, VerticalAlignment, Wrap } from '@open-artifact/sheets-core';
import type {
  DropdownClearedCellsOffer,
  DropdownOptionDeletedOffer,
  FontMark,
  LinesDeletedOffer,
  LinesDone,
  OptionsGoneClearedCellsOffer,
  ResultsChanged,
  UndoOffer,
} from '../state/initial-state.ts';
import type { FormulasReadingSheet } from '../state/places.ts';
import type { ThemeMode } from '../kit/theme.tsx';
import type { ChangesByAgent } from './agent-turn-labels.ts';
import type { ColorProperty } from './format-labels.ts';
import { translateMessage } from './messages.ts';
import { cellColorName, currencyName } from './format-labels.ts';
import { PHONE_NUMBER_FORMAT, isCurrencyCodeOffered } from '../format/number-format-choices.ts';
import { wrappingOfWrapText } from '../grid/text-overflow.ts';
import { namedViewDeletedLabels } from '../tables/named-view-messages.ts';
import {
  truncateGraphemes,
  SHEET_NAME_IN_NOTICE_MAX_CHARACTERS,
  PLACED_VIEW_NAME_IN_NOTICE_MAX_CHARACTERS,
  DROPDOWN_OPTION_IN_NOTICE_MAX_CHARACTERS,
} from './grid-action-labels.ts';
import { versionRestoredToast } from '../history/version-text.ts';
import { matchesNotReplacedText } from './notice-labels.ts';
import { placedViewDeletedNotice } from '../messages/charts.ts';
import { importDoneWords } from '../messages/import.ts';
import { agentUpdatedCellsText } from './agent-turn-labels.ts';
/** A format chosen for cells, one property at a time. */
export interface CellFormatChoice {
  bold?: boolean;
  italic?: boolean;
  underline?: Underline;
  strikethrough?: boolean;
  fontSizeInPoints?: number;
  fillColor?: Color;
  textColor?: Color;
  customNumberFormat?: NumberFormat;
  decimalPlaces?: { pattern: string; count: number };
  numberFormatChoice?: NumberFormatChoice;
  verticalAlignment?: VerticalAlignment;
  wrapText?: Wrap;
  horizontalAlignment?: HorizontalAlignment;
}
/** The words of a toast that offers to undo a change. */
export interface UndoOfferWords {
  title: string;
  description?: string;
  undoLabel: string;
}
/** The words of the notice that the sheet now follows the user's theme. */
export interface ThemeFollowedNoticeWords {
  title: string;
  whereToChange: string;
  keepOther: string;
  said: string;
}
export function markToTypeText(mark: FontMark, isOn: boolean): string {
  switch (mark) {
    case 'bold':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Bold on for what you type next} other {Bold off for what you type next}}',
          id: 'RxHFexUHcl',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'italic':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Italic on for what you type next} other {Italic off for what you type next}}',
          id: 'gh/RkdNIeK',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'underline':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Underline on for what you type next} other {Underline off for what you type next}}',
          id: 'yEfdqq69nO',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'strikethrough':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Strikethrough on for what you type next} other {Strikethrough off for what you type next}}',
          id: 'qeMRa/cx+L',
        },
        {
          isOn: String(isOn),
        },
      );
  }
}
export function markInEntryText(mark: FontMark, isOn: boolean): string {
  switch (mark) {
    case 'bold':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Bold on for the selected text} other {Bold off for the selected text}}',
          id: 'nQnqO3/OnF',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'italic':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Italic on for the selected text} other {Italic off for the selected text}}',
          id: 'xB7tJmEkPe',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'underline':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Underline on for the selected text} other {Underline off for the selected text}}',
          id: 'YXXTm780Cx',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'strikethrough':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Strikethrough on for the selected text} other {Strikethrough off for the selected text}}',
          id: 'avTyWzlckx',
        },
        {
          isOn: String(isOn),
        },
      );
  }
}
export function cellFormatChangeText(format: CellFormatChoice, cells: string): string {
  if (format.bold !== undefined)
    return translateMessage(
      {
        defaultMessage: '{isOn, select, true {Bold on for {cells}} other {Bold off for {cells}}}',
        id: 'vJ74paP0NW',
      },
      {
        isOn: String(format.bold),
        cells,
      },
    );
  if (format.italic !== undefined)
    return translateMessage(
      {
        defaultMessage: '{isOn, select, true {Italic on for {cells}} other {Italic off for {cells}}}',
        id: 'EOBDhsjiAI',
      },
      {
        isOn: String(format.italic),
        cells,
      },
    );
  if (format.underline !== undefined)
    return translateMessage(
      {
        defaultMessage: '{isOn, select, true {Underline on for {cells}} other {Underline off for {cells}}}',
        id: 'GNpA0MImo+',
      },
      {
        isOn: String(format.underline !== 'none'),
        cells,
      },
    );
  if (format.strikethrough !== undefined)
    return translateMessage(
      {
        defaultMessage: '{isOn, select, true {Strikethrough on for {cells}} other {Strikethrough off for {cells}}}',
        id: 'V81uLaCguE',
      },
      {
        isOn: String(format.strikethrough),
        cells,
      },
    );
  if (format.fontSizeInPoints !== undefined)
    return translateMessage(
      {
        defaultMessage: 'Font size {size} for {cells}',
        id: 'iqyW/q6dMZ',
      },
      {
        size: format.fontSizeInPoints,
        cells,
      },
    );
  if (format.fillColor !== undefined || format.textColor !== undefined) {
    // Without a fill color, the check above leaves a text color.
    let [property, color]: [ColorProperty, Color] =
      format.fillColor !== undefined ? ['fillColor', format.fillColor] : ['textColor', format.textColor!];
    let isNone = color.kind === 'none';
    return translateMessage(
      {
        defaultMessage:
          '{what, select, noFill {No cell color for {cells}} automaticText {Automatic text color for {cells}} fill {{color} cell color for {cells}} other {{color} text color for {cells}}}',
        id: 'aTBsS5xEQW',
      },
      {
        what: property === 'fillColor' ? (isNone ? 'noFill' : 'fill') : isNone ? 'automaticText' : 'text',
        color: cellColorName(property, color),
        cells,
      },
    );
  }
  if (format.customNumberFormat !== undefined)
    return translateMessage(
      {
        defaultMessage: '{isPhoneNumber, select, true {US phone number format for {cells}} other {Custom format for {cells}}}',
        id: 'sj8iKxKHZe',
      },
      {
        isPhoneNumber: String(format.customNumberFormat.pattern === PHONE_NUMBER_FORMAT.pattern),
        cells,
      },
    );
  if (format.decimalPlaces !== undefined)
    return translateMessage(
      {
        defaultMessage: '{count, plural, =0 {No decimal places for {cells}} one {# decimal place for {cells}} other {# decimal places for {cells}}}',
        id: 'vWkO+rj+3K',
      },
      {
        count: format.decimalPlaces.count,
        cells,
      },
    );
  if (format.numberFormatChoice !== undefined && isCurrencyCodeOffered(format.numberFormatChoice))
    return translateMessage(
      {
        defaultMessage: '{currency} format for {cells}',
        id: 'Gp32k/AU3+',
      },
      {
        currency: currencyName(format.numberFormatChoice),
        cells,
      },
    );
  if (format.numberFormatChoice !== undefined)
    return translateMessage(
      {
        defaultMessage:
          '{choice, select, general {Automatic format for {cells}} text {Plain text format for {cells}} number {Number format for {cells}} roundedNumber {Number (rounded) format for {cells}} numberInParentheses {Number (parentheses) format for {cells}} currency {Currency format for {cells}} roundedCurrency {Currency (rounded) format for {cells}} percent {Percent format for {cells}} roundedPercent {Percent (rounded) format for {cells}} scientific {Scientific format for {cells}} date {Date format for {cells}} mediumDate {Date (short month) format for {cells}} longDate {Date (full month) format for {cells}} monthAndDay {Month and day format for {cells}} monthAndYear {Month and year format for {cells}} time {Time format for {cells}} dateAndTime {Date and time format for {cells}} other {Duration format for {cells}}}',
        id: '/WYZrwcsN4',
      },
      {
        choice: format.numberFormatChoice,
        cells,
      },
    );
  if (format.verticalAlignment !== undefined)
    return translateMessage(
      {
        defaultMessage:
          '{verticalAlignment, select, top {Top alignment for {cells}} center {Middle alignment for {cells}} other {Bottom alignment for {cells}}}',
        id: '0IK56BqPu2',
      },
      {
        verticalAlignment: format.verticalAlignment,
        cells,
      },
    );
  if (format.wrapText !== undefined)
    return translateMessage(
      {
        defaultMessage: '{wrapping, select, wrap {Wrap text on for {cells}} clip {Clipped text for {cells}} other {Overflowing text for {cells}}}',
        id: '6RfxDTuS+1',
      },
      {
        wrapping: wrappingOfWrapText(format.wrapText),
        cells,
      },
    );
  return translateMessage(
    {
      defaultMessage:
        '{horizontalAlignment, select, left {Left alignment for {cells}} center {Center alignment for {cells}} right {Right alignment for {cells}} other {Automatic alignment for {cells}}}',
      id: 'WTEKGXgmAt',
    },
    {
      horizontalAlignment: format.horizontalAlignment,
      cells,
    },
  );
}
export function deletedRowsOrColumnsTitle({
  kind,
  first,
  last,
  isSaved,
  countInView,
}: LinesDeletedOffer & { countInView?: number }): string {
  if (countInView !== undefined)
    return isSaved
      ? translateMessage(
          {
            defaultMessage: '{count, plural, one {Deleted # row} other {Deleted # rows}}',
            id: 'jnnd27JXBC',
          },
          {
            count: countInView,
          },
        )
      : translateMessage(
          {
            defaultMessage: '{count, plural, one {Deleting # row…} other {Deleting # rows…}}',
            id: 'Z0YyJBiojv',
          },
          {
            count: countInView,
          },
        );
  if (kind === 'rowsDeleted') {
    if (first === last)
      return isSaved
        ? translateMessage(
            {
              defaultMessage: 'Deleted row {row}',
              id: 'IxS9YBZo8b',
            },
            {
              row: first,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Deleting row {row}…',
              id: 'WBaji+gGEn',
            },
            {
              row: first,
            },
          );
    return isSaved
      ? translateMessage(
          {
            defaultMessage: 'Deleted rows {first} to {last}',
            id: 'Thdo29tfj1',
          },
          {
            first,
            last,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Deleting rows {first} to {last}…',
            id: '4jjzkLRWrC',
          },
          {
            first,
            last,
          },
        );
  }
  if (first === last)
    return isSaved
      ? translateMessage(
          {
            defaultMessage: 'Deleted column {column}',
            id: 'isSbPhXHxI',
          },
          {
            column: first,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Deleting column {column}…',
            id: 'qwdNbXXEMD',
          },
          {
            column: first,
          },
        );
  return isSaved
    ? translateMessage(
        {
          defaultMessage: 'Deleted columns {first} to {last}',
          id: 'diXZDcTu1n',
        },
        {
          first,
          last,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Deleting columns {first} to {last}…',
          id: 'QYMTn2ib/L',
        },
        {
          first,
          last,
        },
      );
}
export function dropdownClearedCellsOffer({
  cells,
  isOneCell,
  formulaCount,
  otherCount,
  isSaved,
}: DropdownClearedCellsOffer): UndoOfferWords {
  return {
    title: isSaved
      ? translateMessage(
          {
            defaultMessage: 'Dropdown added to {cells}',
            id: 'wtUnstj58D',
          },
          {
            cells,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Adding a dropdown to {cells}…',
            id: 'smFuhkw9x5',
          },
          {
            cells,
          },
        ),
    description:
      otherCount > 0
        ? translateMessage(
            {
              defaultMessage:
                '{count, plural, one {This clears # cell that doesn’t match an option.} other {This clears # cells that don’t match an option.}}',
              id: 'iwUv3/LOTj',
            },
            {
              count: otherCount + formulaCount,
            },
          )
        : isOneCell
          ? translateMessage({
              defaultMessage: 'This removes the cell’s formula.',
              id: 'lx5/EgCsHF',
            })
          : translateMessage(
              {
                defaultMessage: '{count, plural, one {This removes # formula.} other {This removes # formulas.}}',
                id: 'a17CU8c2un',
              },
              {
                count: formulaCount,
              },
            ),
    undoLabel: translateMessage({
      defaultMessage: 'Undo dropdown',
      id: '550fzHwbiV',
    }),
  };
}
export function optionsGoneClearedCellsOffer({ count, isSaved }: OptionsGoneClearedCellsOffer): UndoOfferWords {
  return {
    title: isSaved
      ? translateMessage(
          {
            defaultMessage: '{count, plural, one {# cell cleared} other {# cells cleared}}',
            id: 'Q7wjV+HFRr',
          },
          {
            count,
          },
        )
      : translateMessage(
          {
            defaultMessage: '{count, plural, one {Clearing # cell…} other {Clearing # cells…}}',
            id: 'obwmvczgTn',
          },
          {
            count,
          },
        ),
    description: translateMessage({
      defaultMessage: 'Dropdown cells can only have one of their options.',
      id: 'MwTKzI9Uef',
    }),
    undoLabel: translateMessage({
      defaultMessage: 'Undo change to options',
      id: '7wru39oSoq',
    }),
  };
}
export function dropdownOptionDeletedTitle(
  { isSaved, onlyIn, ...offer }: DropdownOptionDeletedOffer,
  maxLabelLength: number,
): string {
  let label = truncateGraphemes(offer.label, maxLabelLength);
  if (onlyIn !== null)
    return isSaved
      ? translateMessage(
          {
            defaultMessage: 'Removed “{label}” from {cells}',
            id: 'yV9oBiRiUN',
          },
          {
            label,
            cells: onlyIn,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Removing “{label}” from {cells}…',
            id: 'h6z10u/jmS',
          },
          {
            label,
            cells: onlyIn,
          },
        );
  return isSaved
    ? translateMessage(
        {
          defaultMessage: 'Deleted “{label}”',
          id: 'EsZNf0WCEy',
        },
        {
          label,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Deleting “{label}”…',
          id: 'bmXYoKa3hm',
        },
        {
          label,
        },
      );
}
export function sheetThemeFollowedNotice(theme: ThemeMode): ThemeFollowedNoticeWords {
  return {
    title:
      theme === 'dark'
        ? translateMessage({
            defaultMessage: 'This Sheet now follows your dark theme',
            id: 'pTRkjiN8Xi',
          })
        : translateMessage({
            defaultMessage: 'This Sheet now follows your light theme',
            id: 'qKL6WksWeq',
          }),
    whereToChange: translateMessage({
      defaultMessage: 'You can change this here, under Sheet theme.',
      id: 'l0VCOzXMHK',
    }),
    keepOther:
      theme === 'dark'
        ? translateMessage({
            defaultMessage: 'Keep light',
            id: 'M5vS78rFrB',
          })
        : translateMessage({
            defaultMessage: 'Keep dark',
            id: 'K00Kzs3dnT',
          }),
    said:
      theme === 'dark'
        ? translateMessage({
            defaultMessage: 'This Sheet now follows your dark theme. You can change this under Sheet theme in the zoom menu.',
            id: 'm20i3u1sEz',
          })
        : translateMessage({
            defaultMessage: 'This Sheet now follows your light theme. You can change this under Sheet theme in the zoom menu.',
            id: 'AZfH4mOUi3',
          }),
  };
}
export function changedResultsText({ count, errorCount, firstCell }: ResultsChanged): string {
  let othersCount = count - 1;
  if (errorCount === 0)
    return translateMessage(
      {
        defaultMessage:
          '{others, plural, =0 {The formula in {cell} now shows a different result.} one {The formulas in {cell} and # other cell now show different results.} other {The formulas in {cell} and # other cells now show different results.}}',
        id: 'e2jKNIUYLA',
      },
      {
        cell: firstCell,
        others: othersCount,
      },
    );
  return errorCount < count
    ? translateMessage(
        {
          defaultMessage:
            '{others, plural, one {The formulas in {cell} and # other cell now show errors or different results.} other {The formulas in {cell} and # other cells now show errors or different results.}}',
          id: 'ckDpieZa0l',
        },
        {
          cell: firstCell,
          others: othersCount,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{others, plural, =0 {The formula in {cell} now shows an error.} one {The formulas in {cell} and # other cell now show errors.} other {The formulas in {cell} and # other cells now show errors.}}',
          id: 'RsoM7SBY5h',
        },
        {
          cell: firstCell,
          others: othersCount,
        },
      );
}
export function columnsMovedResultsText({ count, errorCount, firstCell }: ResultsChanged): string {
  let othersCount = count - 1;
  if (errorCount === 0)
    return translateMessage(
      {
        defaultMessage:
          '{others, plural, =0 {The formula in {cell} now shows a different result.} one {The formulas in {cell} and # other cell now show different results.} other {The formulas in {cell} and # other cells now show different results.}}',
        id: '4VepQsRSBu',
      },
      {
        cell: firstCell,
        others: othersCount,
      },
    );
  return errorCount < count
    ? translateMessage(
        {
          defaultMessage:
            '{others, plural, one {The formulas in {cell} and # other cell now show errors or different results.} other {The formulas in {cell} and # other cells now show errors or different results.}}',
          id: 'CUDlvO/FaC',
        },
        {
          cell: firstCell,
          others: othersCount,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{others, plural, =0 {The formula in {cell} now shows an error.} one {The formulas in {cell} and # other cell now show errors.} other {The formulas in {cell} and # other cells now show errors.}}',
          id: 'X3ZceYxcJE',
        },
        {
          cell: firstCell,
          others: othersCount,
        },
      );
}
export function describeUndoOffer(offer: UndoOffer): UndoOfferWords {
  if (offer.kind === 'versionRestored') return versionRestoredToast(offer, Date.now());
  if (offer.kind === 'sheetDeleted') {
    let sheetName = truncateGraphemes(offer.name, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS);
    return {
      title: offer.isSaved
        ? translateMessage(
            {
              defaultMessage: 'Deleted “{name}”',
              id: '2y+kjg7BmR',
            },
            {
              name: sheetName,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Deleting “{name}”…',
              id: 'Ue6Lr8bRWE',
            },
            {
              name: sheetName,
            },
          ),
      ...(offer.readBy !== undefined && {
        description: formulasAffectedText(offer.readBy),
      }),
      undoLabel: translateMessage({
        defaultMessage: 'Undo delete',
        id: 'sgv4QsegdD',
      }),
    };
  }
  if (offer.kind === 'dropdownOptionDeleted') return dropdownOptionDeletedOffer(offer);
  if (offer.kind === 'replacedInCells')
    return {
      title: translateMessage(
        {
          defaultMessage: '{count, plural, one {Replaced in # cell} other {Replaced in # cells}}',
          id: 'UwW7kuGpaA',
        },
        {
          count: offer.count,
        },
      ),
      ...(offer.leftCount > 0 && {
        description: matchesNotReplacedText(offer.leftCount),
      }),
      undoLabel: translateMessage({
        defaultMessage: 'Undo replace',
        id: 'XUhlpwJoV9',
      }),
    };
  if (offer.kind === 'textsConverted')
    return {
      title: translateMessage(
        {
          defaultMessage: '{count, plural, one {Converted # cell from text} other {Converted # cells from text}}',
          id: 'xUZZT0UEWz',
        },
        {
          count: offer.count,
        },
      ),
      ...(offer.leftCount > 0 && {
        description: translateMessage(
          {
            defaultMessage:
              '{count, plural, one {# cell in a filtered-out row was left as it is.} other {# cells in filtered-out rows were left as they are.}}',
            id: 'YJ3NRqe88Z',
          },
          {
            count: offer.leftCount,
          },
        ),
      }),
      undoLabel: translateMessage({
        defaultMessage: 'Undo convert',
        id: '6XuB1edHYt',
      }),
    };
  if (offer.kind === 'placedViewDeleted')
    return placedViewDeletedNotice({
      ...offer,
      name: truncateGraphemes(offer.name, PLACED_VIEW_NAME_IN_NOTICE_MAX_CHARACTERS),
    });
  if (offer.kind === 'namedViewDeleted')
    return namedViewDeletedLabels({
      ...offer,
      name: truncateGraphemes(offer.name, PLACED_VIEW_NAME_IN_NOTICE_MAX_CHARACTERS),
    });
  if (offer.kind === 'tableImportedIntoSheet')
    return {
      title: importDoneWords({
        ...offer,
        sheetName: truncateGraphemes(offer.sheetName, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS),
      }),
      undoLabel: translateMessage({
        defaultMessage: 'Undo import',
        id: '4xK1LPI7Xl',
      }),
    };
  if (offer.kind === 'tableImportedAsNewSheet')
    return {
      title: translateMessage(
        {
          defaultMessage: '{count, plural, one {Imported # row as “{sheetName}”} other {Imported # rows as “{sheetName}”}}',
          id: 'Ym5l4O/oCT',
        },
        {
          count: offer.rowCount,
          sheetName: truncateGraphemes(offer.sheetName, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS),
        },
      ),
      undoLabel: translateMessage({
        defaultMessage: 'Undo import',
        id: '4xK1LPI7Xl',
      }),
    };
  if (offer.kind === 'moveReplacedCells')
    return {
      title: translateMessage(
        {
          defaultMessage: '{count, plural, one {# cell replaced} other {# cells replaced}}',
          id: 'IUL93DL1VX',
        },
        {
          count: offer.count,
        },
      ),
      undoLabel: translateMessage({
        defaultMessage: 'Undo move',
        id: 'DKsPpGRLzw',
      }),
    };
  if (offer.kind === 'filledByFinger')
    return {
      title: translateMessage(
        {
          defaultMessage: 'Filled {cells}',
          id: '5FU/elKzat',
        },
        {
          cells: offer.cells,
        },
      ),
      undoLabel: translateMessage({
        defaultMessage: 'Undo fill',
        id: 'c9yu7bwq9z',
      }),
    };
  if (offer.kind === 'clearedWithNoKeyboard')
    return {
      title: offer.isSaved
        ? translateMessage(
            {
              defaultMessage: 'Cleared {cells}',
              id: '9NLiXycPBz',
            },
            {
              cells: offer.cells,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Clearing {cells}…',
              id: 'peAd70TSJW',
            },
            {
              cells: offer.cells,
            },
          ),
      undoLabel: translateMessage({
        defaultMessage: 'Undo clear',
        id: 'kzkTLLxqaG',
      }),
    };
  if (offer.kind === 'sortedWithNoKeyboard' || offer.kind === 'sortChangedResults')
    return {
      title: offer.isSaved
        ? translateMessage(
            {
              defaultMessage: 'Sorted by column {column}',
              id: 'ns9qbOJv1p',
            },
            {
              column: offer.column,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Sorting by column {column}…',
              id: 'SwiGDcz/xE',
            },
            {
              column: offer.column,
            },
          ),
      ...(offer.kind === 'sortChangedResults' && {
        description: changedResultsText(offer.results),
      }),
      undoLabel: translateMessage({
        defaultMessage: 'Undo sort',
        id: 'yiEIZy4GtC',
      }),
    };
  if (offer.kind === 'moveOfColumnsChangedResults')
    return {
      title: translateMessage(
        {
          defaultMessage: '{count, plural, one {Column moved} other {Columns moved}}',
          id: 'Kfw/at/SIz',
        },
        {
          count: offer.count,
        },
      ),
      description: columnsMovedResultsText(offer.results),
      undoLabel: translateMessage({
        defaultMessage: 'Undo move',
        id: 'bENYD0ZfXS',
      }),
    };
  if (offer.kind === 'dropdownClearedCells') return dropdownClearedCellsOffer(offer);
  if (offer.kind === 'optionsGoneClearedCells') return optionsGoneClearedCellsOffer(offer);
  if (offer.kind !== 'mergeClearedCells')
    return {
      // The kinds handled above leave only deleted rows or columns.
      title: deletedRowsOrColumnsTitle(offer as LinesDeletedOffer),
      undoLabel: translateMessage({
        defaultMessage: 'Undo delete',
        id: 'BCG/htqIVD',
      }),
    };
  let { cells, keptCell } = offer;
  return {
    title: translateMessage(
      {
        defaultMessage: 'Merged {cells}',
        id: 'ig0AgQHdd8',
      },
      {
        cells,
      },
    ),
    description: translateMessage(
      {
        defaultMessage: 'Only the content from {cell} was kept.',
        id: 'oC2rgdyjm1',
      },
      {
        cell: keptCell,
      },
    ),
    undoLabel: translateMessage({
      defaultMessage: 'Undo merge',
      id: 'Xt73Tlz6P8',
    }),
  };
}
export function insertedRowsOrColumnsText({ what, first, last }: LinesDone): string {
  if (what === 'rowsInserted')
    return first === last
      ? translateMessage(
          {
            defaultMessage: 'Inserted row {row}',
            id: 'AwD6IE3rJF',
          },
          {
            row: first,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Inserted rows {first} to {last}',
            id: 'ulVqhizKGy',
          },
          {
            first,
            last,
          },
        );
  return first === last
    ? translateMessage(
        {
          defaultMessage: 'Inserted column {column}',
          id: 'qhyZmSkoiB',
        },
        {
          column: first,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Inserted columns {first} to {last}',
          id: 'rdYIkyL9D1',
        },
        {
          first,
          last,
        },
      );
}
export function rowHeightSetText({ heightInPixels, first, last, lineCount }: LinesDone): string {
  if (lineCount !== undefined)
    return heightInPixels === null
      ? translateMessage(
          {
            defaultMessage: '{count, plural, one {Row height fits text for # row} other {Row height fits text for # rows}}',
            id: '9waax3Q0tp',
          },
          {
            count: lineCount,
          },
        )
      : translateMessage(
          {
            defaultMessage: '{height, plural, one {Row height {height} pixel for {count} rows} other {Row height {height} pixels for {count} rows}}',
            id: 'oc8UmLkUwR',
          },
          {
            height: heightInPixels,
            count: lineCount,
          },
        );
  if (heightInPixels === null)
    return first === last
      ? translateMessage(
          {
            defaultMessage: 'Row height fits text for row {row}',
            id: '2/HNtktyMA',
          },
          {
            row: first,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Row height fits text for rows {first} to {last}',
            id: 'GlZBdtQ04o',
          },
          {
            first,
            last,
          },
        );
  return first === last
    ? translateMessage(
        {
          defaultMessage: '{height, plural, one {Row height {height} pixel for row {row}} other {Row height {height} pixels for row {row}}}',
          id: 'ONJRWaSzgO',
        },
        {
          height: heightInPixels,
          row: first,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{height, plural, one {Row height {height} pixel for rows {first} to {last}} other {Row height {height} pixels for rows {first} to {last}}}',
          id: 'GZ5J6GEGwP',
        },
        {
          height: heightInPixels,
          first,
          last,
        },
      );
}
export function columnWidthSetText({ widthInPixels, first, last, lineCount }: LinesDone): string {
  if (lineCount !== undefined)
    return widthInPixels === null
      ? translateMessage(
          {
            defaultMessage: '{count, plural, one {Column width fits text for # column} other {Column width fits text for # columns}}',
            id: 'FMysEZ8DJu',
          },
          {
            count: lineCount,
          },
        )
      : translateMessage(
          {
            defaultMessage:
              '{width, plural, one {Column width {width} pixel for {count} columns} other {Column width {width} pixels for {count} columns}}',
            id: 'UB6tzRMUDW',
          },
          {
            width: widthInPixels,
            count: lineCount,
          },
        );
  if (widthInPixels === null)
    return first === last
      ? translateMessage(
          {
            defaultMessage: 'Column width fits text for column {column}',
            id: 'J753E28T51',
          },
          {
            column: first,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Column width fits text for columns {first} to {last}',
            id: '3MFTvJR1Lq',
          },
          {
            first,
            last,
          },
        );
  return first === last
    ? translateMessage(
        {
          defaultMessage:
            '{width, plural, one {Column width {width} pixel for column {column}} other {Column width {width} pixels for column {column}}}',
          id: '+sUA3I5aOM',
        },
        {
          width: widthInPixels,
          column: first,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{width, plural, one {Column width {width} pixel for columns {first} to {last}} other {Column width {width} pixels for columns {first} to {last}}}',
          id: 'N++pFxU5DA',
        },
        {
          width: widthInPixels,
          first,
          last,
        },
      );
}
export const fixErrorsLabel = (count: number | null): string =>
  count === null
    ? translateMessage({
        defaultMessage: 'Fix errors',
        id: 'A2ZUnglqU4',
      })
    : translateMessage(
        {
          defaultMessage: '{count, plural, one {Fix # error} other {Fix # errors}}',
          id: 'rntFkkJGAw',
        },
        {
          count,
        },
      );
export const undoAgentChangesLabel = (): string =>
  translateMessage({
    defaultMessage: 'Undo Agent’s changes',
    id: 'WlJnv4M875',
  });
export const agentTurnUndoOffer = (turn: ChangesByAgent): UndoOfferWords => ({
  title: agentUpdatedCellsText(turn),
  undoLabel: undoAgentChangesLabel(),
});
export const dropdownOptionDeletedOffer = (
  offer: DropdownOptionDeletedOffer,
  maxLabelLength: number = DROPDOWN_OPTION_IN_NOTICE_MAX_CHARACTERS,
): UndoOfferWords => ({
  title: dropdownOptionDeletedTitle(offer, maxLabelLength),
  description: translateMessage(
    {
      defaultMessage: '{count, plural, one {This clears the cell that had it.} other {This clears the # cells that had it.}}',
      id: 'pABH1YHDud',
    },
    {
      count: offer.cellCount,
    },
  ),
  undoLabel:
    offer.onlyIn === null
      ? translateMessage({
          defaultMessage: 'Undo delete',
          id: 'NUS0XbZE2D',
        })
      : translateMessage({
          defaultMessage: 'Undo removal',
          id: 'E6UbwYDRil',
        }),
});
export const formulasAffectedText = ({ count, sheetNames: [firstSheet, ...otherSheets] }: FormulasReadingSheet): string =>
  otherSheets.length === 0
    ? translateMessage(
        {
          defaultMessage: '{count, plural, one {This affects # formula on “{sheet}”.} other {This affects # formulas on “{sheet}”.}}',
          id: '0KPPSW2Qc3',
        },
        {
          count,
          sheet: truncateGraphemes(firstSheet, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS),
        },
      )
    : translateMessage(
        {
          defaultMessage: '{count, plural, one {This affects # formula on other sheets.} other {This affects # formulas on other sheets.}}',
          id: 'oU3rhp8bfS',
        },
        {
          count,
        },
      );
