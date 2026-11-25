import type { SortDirection } from '@open-artifact/sheets-core';
import type { LinesAxisName } from '../grid/geometry.ts';
import type { WordSetApart } from './messages.ts';
import { translateMessage, joinMessageParts } from './messages.ts';
import { columnLetters } from '../model/a1-references.ts';
/** What every cell of a sort column holds, when they all hold the same kind of value. */
export type SortedValuesKind = 'numbers' | 'dates' | 'times' | 'text' | 'options';
export function sortOrderLabel(valuesKind: SortedValuesKind, direction: SortDirection): string {
  switch (valuesKind) {
    case 'numbers':
      return direction === 'ascending'
        ? translateMessage({
            defaultMessage: 'Smallest first',
            id: 'Dw2eST8ryY',
          })
        : translateMessage({
            defaultMessage: 'Largest first',
            id: '5ntEturiZu',
          });
    case 'dates':
      return direction === 'ascending'
        ? translateMessage({
            defaultMessage: 'Oldest first',
            id: 'rH3J9mFvuI',
          })
        : translateMessage({
            defaultMessage: 'Newest first',
            id: 'POmx2LHTRA',
          });
    case 'times':
      return direction === 'ascending'
        ? translateMessage({
            defaultMessage: 'Earliest first',
            id: 'wnHGxKx4K3',
          })
        : translateMessage({
            defaultMessage: 'Latest first',
            id: 'zaF1FJicD3',
          });
    case 'text':
      return direction === 'ascending'
        ? translateMessage({
            defaultMessage: 'A to Z',
            id: 'NvvytC4Xjo',
          })
        : translateMessage({
            defaultMessage: 'Z to A',
            id: '4+oWddGEIp',
          });
    case 'options':
      return direction === 'ascending'
        ? translateMessage({
            defaultMessage: 'List order',
            id: 'sp1gaZg+Nr',
          })
        : translateMessage({
            defaultMessage: 'Reverse list order',
            id: 'LUQJmnjGT7',
          });
  }
}
export function truncateGraphemes(text: string, maxCharacters: number): string {
  let graphemes = Array.from(
    new Intl.Segmenter().segment(text),
    ({ segment }) => segment,
  );
  return graphemes.length <= maxCharacters ? text : `${graphemes.slice(0, maxCharacters).join('').trimEnd()}…`;
}
/** The words before and after the row count field, split where the field goes. */
export function rowsFieldTextParts(count: number): [string, string] {
  let parts = translateMessage(
    {
      defaultMessage: '{count, plural, one {{field} row} other {{field} rows}}',
      id: 'p6tL7SIpHA',
    },
    {
      count,
      field: ROWS_FIELD_PLACEHOLDER,
    },
  );
  let fieldIndex = Math.max(
    0,
    parts.findIndex((part) => typeof part !== 'string'),
  );
  return [joinMessageParts(parts.slice(0, fieldIndex)), joinMessageParts(parts.slice(fieldIndex))];
}
export const editingCellOnSheetLabel = (cell: string, sheet: string): string =>
  translateMessage(
    {
      defaultMessage: 'Editing {cell} on {sheet}',
      id: 'KdQvTZ1aJx',
    },
    {
      cell,
      sheet,
    },
  );
export const editingCellLabel = (cell: string): string =>
  translateMessage(
    {
      defaultMessage: 'Editing {cell}',
      id: 'j2ODfneE/9',
    },
    {
      cell,
    },
  );
export const cellEditorShortHint = (): string =>
  translateMessage({
    defaultMessage: '@ to insert, = for a formula',
    id: '7Z1ogKFTrY',
  });
export const cellEditorHint = (): string =>
  translateMessage({
    defaultMessage: 'Type a value, = for a formula, or @ to insert a person, date, or dropdown',
    id: 'QZbreTiH/4',
  });
export const insertLinesLabel = (lines: LinesAxisName, count: number): string =>
  lines === 'rows'
    ? translateMessage(
        {
          defaultMessage: '{count, plural, one {Insert row} other {Insert rows}}',
          id: 'tix62H2JJV',
        },
        {
          count,
        },
      )
    : translateMessage(
        {
          defaultMessage: '{count, plural, one {Insert column} other {Insert columns}}',
          id: 'RHyXpUfqsO',
        },
        {
          count,
        },
      );
export const rowsAboveLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Row above} other {# rows above}}',
      id: 'KXgppCNbGN',
    },
    {
      count,
    },
  );
export const rowsBelowLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Row below} other {# rows below}}',
      id: 'yo+3SPw8zC',
    },
    {
      count,
    },
  );
export const columnsLeftLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Column to the left} other {# columns to the left}}',
      id: 'bHpZaDcq0B',
    },
    {
      count,
    },
  );
export const columnsRightLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Column to the right} other {# columns to the right}}',
      id: 'U9hzRROf01',
    },
    {
      count,
    },
  );
export const rowCountLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Row} other {# rows}}',
      id: '5d4jfHzofP',
    },
    {
      count,
    },
  );
export const columnCountLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Column} other {# columns}}',
      id: '85/7jzCQg0',
    },
    {
      count,
    },
  );
export const insertRowsAboveLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Insert row above} other {Insert # rows above}}',
      id: 't+8FgWIKbE',
    },
    {
      count,
    },
  );
export const insertRowsBelowLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Insert row below} other {Insert # rows below}}',
      id: 'T6lJpY+VG0',
    },
    {
      count,
    },
  );
export const insertColumnsLeftLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Insert column left} other {Insert # columns left}}',
      id: '8n3iyc4p5Q',
    },
    {
      count,
    },
  );
export const insertColumnsRightLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Insert column right} other {Insert # columns right}}',
      id: 'hs1s70jfcr',
    },
    {
      count,
    },
  );
export const moveRowsUpLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Move row up} other {Move # rows up}}',
      id: 'IbnRqui2Nr',
    },
    {
      count,
    },
  );
export const moveRowsDownLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Move row down} other {Move # rows down}}',
      id: 'rO+L5Cj9l0',
    },
    {
      count,
    },
  );
export const moveColumnsLeftLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Move column left} other {Move # columns left}}',
      id: '7hdWcV7tXS',
    },
    {
      count,
    },
  );
export const moveColumnsRightLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Move column right} other {Move # columns right}}',
      id: '9kHSuGumH4',
    },
    {
      count,
    },
  );
export const deleteRowsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Delete row} other {Delete # rows}}',
      id: 'opogheqCkG',
    },
    {
      count,
    },
  );
export const deleteColumnsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Delete column} other {Delete # columns}}',
      id: 'kyBgJLr3/O',
    },
    {
      count,
    },
  );
export const resizeColumnsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Resize column} other {Resize # columns}}',
      id: 'lae8GCUBBJ',
    },
    {
      count,
    },
  );
export const rowsFromFirstLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, =0 {No rows} =1 {1 row} =2 {2 rows} one {Rows 1 to {last}} other {Rows 1 to {last}}}',
      id: 'H+TSuNytIa',
    },
    {
      count,
      last: String(count),
    },
  );
export const columnsFromFirstLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, =0 {No columns} =1 {1 column} =2 {2 columns} one {Columns A to {last}} other {Columns A to {last}}}',
      id: 'kpbrVkwPET',
    },
    {
      count,
      last: columnLetters(Math.max(0, count - 1)),
    },
  );
export const freezeRowsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, =0 {Unfreeze rows} =1 {Freeze row 1} one {Freeze rows 1 to {last}} other {Freeze rows 1 to {last}}}',
      id: 'CjXNX8GOTo',
    },
    {
      count,
      last: String(count),
    },
  );
export const freezeColumnsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage:
        '{count, plural, =0 {Unfreeze columns} =1 {Freeze column A} one {Freeze columns A to {last}} other {Freeze columns A to {last}}}',
      id: 'dirtHX//XU',
    },
    {
      count,
      last: columnLetters(Math.max(0, count - 1)),
    },
  );
export const timeValueLabel = (time: string): string =>
  translateMessage(
    {
      defaultMessage: 'Time, {time}',
      id: 'j464aluuLS',
    },
    {
      time,
    },
  );
export const decimalPlacesLimitText = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {The limit is # decimal place.} other {The limit is # decimal places.}}',
      id: 'Th/e4hWhfR',
    },
    {
      count,
    },
  );
export const toolUnavailableLabel = (tool: string): string =>
  translateMessage(
    {
      defaultMessage: '{tool}, unavailable.',
      id: 'psVfNzWiwz',
    },
    {
      tool,
    },
  );
export const enterTimeHint = (example: string): string =>
  translateMessage(
    {
      defaultMessage: 'Enter a time, such as {example}.',
      id: 'j3Pq7nfqyh',
    },
    {
      example,
    },
  );
export const resizeRowsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Resize row} other {Resize # rows}}',
      id: 'mdCNqlRGF+',
    },
    {
      count,
    },
  );
export const sortMenuLabel = (): string =>
  translateMessage({
    defaultMessage: 'Sort',
    id: 'xn8Q2qgLFE',
  });
export const sortTableUnclearHint = (isPivotTable?: boolean): string =>
  isPivotTable
    ? translateMessage({
        defaultMessage: 'To sort a pivot table, use Edit pivot table.',
        id: 'l1Doh/z3aK',
      })
    : translateMessage({
        defaultMessage: 'The table for this cell isn’t clear. Select all the cells to sort, then use Custom sort.',
        id: 'F1NZETubq4',
      });
export const sortRangeLabel = (): string =>
  translateMessage({
    defaultMessage: 'Sort range',
    id: 'btjrqFR8AZ',
  });
export const sortSheetLabel = (): string =>
  translateMessage({
    defaultMessage: 'Sort sheet',
    id: 'Tmgcec9uzN',
  });
export const byColumnLabel = (column: string): string =>
  translateMessage(
    {
      defaultMessage: 'By column {column}',
      id: 'EInADw5Q0O',
    },
    {
      column,
    },
  );
export const byHeadingLabel = (heading: string): string =>
  translateMessage(
    {
      defaultMessage: 'By “{heading}”',
      id: 'xTNJFt/EuR',
    },
    {
      heading,
    },
  );
export const ascendingLabel = (): string =>
  translateMessage({
    defaultMessage: 'Ascending',
    id: 'I9vb5JJE/U',
  });
export const descendingLabel = (): string =>
  translateMessage({
    defaultMessage: 'Descending',
    id: 'Kv55Kps4Ah',
  });
export const sortByText = (): string =>
  translateMessage({
    defaultMessage: 'Sort by',
    id: 'a9fGMOM8q8',
  });
export const columnLetterLabel = (column: string): string =>
  translateMessage(
    {
      defaultMessage: 'Column {column}',
      id: 'Z+DwYSfjt8',
    },
    {
      column,
    },
  );
export const sortCellsInsteadQuestion = (cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'Sort {cells} instead?',
      id: 'VwuU2X9CVu',
    },
    {
      cells,
    },
  );
export const dataNextToCellsWarning = (cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'There’s data next to {cells}. Sorting only these cells would separate them from the rest of their rows.',
      id: 'TCypuuEHx9',
    },
    {
      cells,
    },
  );
export const sortCellsLabel = (cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'Sort {cells}',
      id: 'KWMVKbOBfw',
    },
    {
      cells,
    },
  );
export const sortCellsOnlyLabel = (cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'Sort {cells} only',
      id: 'HwOXC9bT1e',
    },
    {
      cells,
    },
  );
export const wholeNumberBetweenHint = (smallest: number, largest: number): string =>
  translateMessage(
    {
      defaultMessage: 'Enter a whole number from {smallest} to {largest}.',
      id: 'BXrulCaiQs',
    },
    {
      smallest,
      largest,
    },
  );
export const digitsBetweenHint = (smallest: number, largest: number): string =>
  translateMessage(
    {
      defaultMessage: 'Enter digits only, from {smallest} to {largest}, such as 120.',
      id: 'QJItV7rV7f',
    },
    {
      smallest,
      largest,
    },
  );
export const HEADING_LABEL_MAX_CHARACTERS = 24;
export const SHEET_NAME_IN_NOTICE_MAX_CHARACTERS = 32;
export const DROPDOWN_OPTION_IN_NOTICE_MAX_CHARACTERS = 32;
export const PLACED_VIEW_NAME_IN_NOTICE_MAX_CHARACTERS = 32;
export const PERSON_NAME_IN_NOTICE_MAX_CHARACTERS = 32;
export const figureNameLabel = (figure: string): string =>
  translateMessage(
    {
      defaultMessage: '{figure, select, sum {Sum} average {Average} min {Min} max {Max} other {Count}}',
      id: 'SJ8F3Yr1VZ',
    },
    {
      figure,
    },
  );
export const figureWithValueLabel = (figure: string, written: string): string =>
  translateMessage(
    {
      defaultMessage:
        '{figure, select, sum {Sum {written}} average {Average {written}} min {Min {written}} max {Max {written}} other {Count {written}}}',
      id: '3VSiQ3ZdeR',
    },
    {
      figure,
      written,
    },
  );
export const figureForSelectionLabel = (figure: string): string =>
  translateMessage(
    {
      defaultMessage: '{figure} for the selected cells',
      id: 'V4PmjXrr/k',
    },
    {
      figure,
    },
  );
export const selectionSummaryLabel = (): string =>
  translateMessage({
    defaultMessage: 'Summary of the selected cells',
    id: 'fX2hBE5ED9',
  });
export const addFormulaUnderNumbersLabel = (heading: string | null): string =>
  heading === null
    ? translateMessage({
        defaultMessage: 'Add a formula under the numbers',
        id: '8zcgxGIHkK',
      })
    : translateMessage(
        {
          defaultMessage: '{heading}: add a formula under the numbers',
          id: 'TL92B5GFil',
        },
        {
          heading: truncateGraphemes(heading, HEADING_LABEL_MAX_CHARACTERS),
        },
      );
export const shortHeadingLabel = (heading: string): string => truncateGraphemes(heading, HEADING_LABEL_MAX_CHARACTERS);
export const ROWS_FIELD_PLACEHOLDER: WordSetApart[] = [
  {
    setApart: '',
  },
];
export const addColumnsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Add # column} other {Add # columns}}',
      id: 'iyP9oa5IB5',
    },
    {
      count,
    },
  );
export const upToAtATimeHint = (most: number): string =>
  translateMessage(
    {
      defaultMessage: 'Up to {most, number} at a time',
      id: 'YHxAbKkvU/',
    },
    {
      most,
    },
  );
export const enterNumberUpToHint = (most: number): string =>
  translateMessage(
    {
      defaultMessage: 'Enter a number from 1 to {most, number}',
      id: 'G12J9/sb70',
    },
    {
      most,
    },
  );
export const errorCountLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# error} other {# errors}}',
      id: 'NGpjD2CoP3',
    },
    {
      count,
    },
  );
export const writingFormulasLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Writing # formula…} other {Writing # formulas…}}',
      id: 'EY+f+rW9dH',
    },
    {
      count,
    },
  );
export const keepFixesLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, =1 {Keep} one {Keep all # fix} other {Keep all # fixes}}',
      id: 'Lj0j+SWLX4',
    },
    {
      count,
    },
  );
