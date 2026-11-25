import type { SortDirection } from '@open-artifact/sheets-core';
import type { SortHoldsOfColumn, SuggestedAskWhat } from '../state/initial-state.ts';
import type { SaidOfFilterItem, SaidOfSortColumn } from './own-filters.ts';
import { sortOrderLabel } from '../i18n/grid-action-labels.ts';
import { translateMessage, joinMessageParts, MESSAGE_LOCALE } from '../i18n/messages.ts';
import { filterMessages, describeFilterLineAlternatives } from './filter-messages.ts';
import { ruleColumnName } from '../messages/conditional-format.ts';
/** What rows a filter lets through, line by line, and the columns they are sorted by. */
export interface FilterAndSortSaid {
  lines: SaidOfFilterItem[][];
  sortBy: SaidOfSortColumn[];
}
/** The first words of a summary of a filter and sort, and the words of the sort that follow, if any. */
export interface FilterAndSortSummaryParts {
  first: string;
  thenSort: string | null;
}
export function sortDirectionWords(holds: SortHoldsOfColumn | null, direction: SortDirection): string {
  if (holds !== null) return sortOrderLabel(holds, direction);
  return direction === 'ascending'
    ? translateMessage({
        defaultMessage: 'Ascending',
        id: 'N4wJOxRnC1',
      })
    : translateMessage({
        defaultMessage: 'Descending',
        id: '/A2U0xMiaS',
      });
}
export function filterViewChoiceLabel(choice: SuggestedAskWhat): string {
  switch (choice.kind) {
    case 'mine':
      return sortAndFilterMessages.onlyMine();
    case 'mineSorted':
      return translateMessage(
        {
          defaultMessage: 'Only mine, by {column}',
          id: 'graNsSixAp',
        },
        {
          column: choice.column,
        },
      );
    case 'allBut':
      return translateMessage(
        {
          defaultMessage: 'Not {label}',
          id: 'KVj+dGOBuC',
        },
        {
          label: choice.label,
        },
      );
    case 'only':
      return choice.label;
    case 'sorted':
      return translateMessage(
        {
          defaultMessage: 'Sort by {column}',
          id: '260esUZfLY',
        },
        {
          column: choice.column,
        },
      );
  }
}
export function sortKeysWords([firstKey, ...otherKeys]: readonly SaidOfSortColumn[], isAlone: boolean): string | null {
  if (firstKey === undefined) return null;
  let firstWords = isAlone
    ? translateMessage(
        {
          defaultMessage: 'Sort by {column}',
          id: '+epa2/KNxw',
        },
        {
          column: sortKeyWords(firstKey),
        },
      )
    : translateMessage(
        {
          defaultMessage: 'by {column}',
          id: 'LUBWLcPY35',
        },
        {
          column: sortKeyWords(firstKey),
        },
      );
  return withThenByWords(firstWords, otherKeys);
}
export function withThenByWords(firstWords: string, otherKeys: readonly SaidOfSortColumn[]): string {
  return otherKeys.reduce(
    (before, key) =>
      translateMessage(
        {
          defaultMessage: '{before}, then {column}',
          id: 'qzFZJnigGD',
        },
        {
          before,
          column: sortKeyWords(key),
        },
      ),
    firstWords,
  );
}
export function filterAndSortSummaryParts({ lines, sortBy }: FilterAndSortSaid): FilterAndSortSummaryParts {
  let sortWords = sortKeysWords(sortBy, lines.length === 0);
  return lines.length === 0
    ? {
        first: sortWords ?? filterMessages.allRows(),
        thenSort: null,
      }
    : {
        first: joinAsUnitList(lines.map((line) => joinMessageParts(describeFilterLineAlternatives(line)))),
        thenSort: sortWords,
      };
}
export function filterAndSortSummary(filterAndSort: FilterAndSortSaid): string {
  let { first, thenSort } = filterAndSortSummaryParts(filterAndSort);
  return thenSort === null ? first : joinAsUnitList([first, thenSort]);
}
export const customSortMessages = {
  customSort: () =>
    translateMessage({
      defaultMessage: 'Custom sort',
      id: '+l/tNxISuS',
    }),
  appliesTo: () =>
    translateMessage({
      defaultMessage: 'Applies to',
      id: 'jAyRMyAVC2',
    }),
  cells: () =>
    translateMessage({
      defaultMessage: 'Cells',
      id: 'hbm0DNvbHH',
    }),
  useSelection: () =>
    translateMessage({
      defaultMessage: 'Use selection',
      id: 'BK7RNr6G8G',
    }),
  cellsNotFound: () =>
    translateMessage({
      defaultMessage: 'Enter cells like A2:D20.',
      id: 'cJipJxw0Mp',
    }),
  headerRow: () =>
    translateMessage({
      defaultMessage: 'Header row',
      id: '5M5/edml3D',
    }),
  sortBy: () =>
    translateMessage({
      defaultMessage: 'Sort by',
      id: 'UttQy+KeSu',
    }),
  thenBy: () =>
    translateMessage({
      defaultMessage: 'Then by',
      id: 'UJcjXcwLqv',
    }),
  addColumn: () =>
    translateMessage({
      defaultMessage: 'Sort by another column',
      id: '85Lqd+Uir5',
    }),
  sortCells: () =>
    translateMessage({
      defaultMessage: 'Sort',
      id: 'R9nmYgVXF2',
    }),
  keysThatMove: () =>
    translateMessage({
      defaultMessage: 'Use the up and down arrow keys to move it.',
      id: 'uWw+xP0N6j',
    }),
};
export const columnLettersLabel = (letters: string): string =>
  translateMessage(
    {
      defaultMessage: 'Column {letters}',
      id: 'ZRJxTihJCV',
    },
    {
      letters,
    },
  );
export const labeledSortColumnWords = (label: string, column: string): string =>
  translateMessage(
    {
      defaultMessage: '{label}: {column}',
      id: 'uejRhJTxo2',
    },
    {
      label,
      column,
    },
  );
export const sortOrderOfColumnLabel = (column: string, direction: string): string =>
  translateMessage(
    {
      defaultMessage: 'Order of {column}: {direction}',
      id: 'gCmbSkn1um',
    },
    {
      column,
      direction,
    },
  );
export const removeSortColumnLabel = (column: string): string =>
  translateMessage(
    {
      defaultMessage: 'Remove {column} from the sort',
      id: 'wUpSuFcVVg',
    },
    {
      column,
    },
  );
export const reorderSortColumnLabel = (column: string): string =>
  translateMessage(
    {
      defaultMessage: 'Reorder {column}',
      id: 'KM4xGxgZK2',
    },
    {
      column,
    },
  );
export const quotedFilterWords = (words: string): string =>
  translateMessage(
    {
      defaultMessage: '“{words}”',
      id: 'IHDZaAzRxR',
    },
    {
      words,
    },
  );
export const sortAndFilterMessages = {
  sortAndFilter: () =>
    translateMessage({
      defaultMessage: 'Filter',
      id: 'IO44/rneD7',
    }),
  whichRowsToShow: () =>
    translateMessage({
      defaultMessage: 'Which rows to show',
      id: 'PK7wQVCsG7',
    }),
  filtered: () =>
    translateMessage({
      defaultMessage: 'Filtered',
      id: 'dfSMJvXi2E',
    }),
  filterByColumn: () =>
    translateMessage({
      defaultMessage: 'Filter by column',
      id: 'KvzUM89dCa',
    }),
  sayWhichRowsToShow: () =>
    translateMessage({
      defaultMessage: 'Say which rows to show, and in what order',
      id: 'I2Oo96/H7a',
    }),
  waysToSortAndFilter: () =>
    translateMessage({
      defaultMessage: 'Ways to sort and filter',
      id: '4oRCynJ3pr',
    }),
  suggested: () =>
    translateMessage({
      defaultMessage: 'Suggested',
      id: 'wJ7vhypTBr',
    }),
  onlyMine: () =>
    translateMessage({
      defaultMessage: 'Only mine',
      id: 'Hg4/vPCyV1',
    }),
  noTable: () =>
    translateMessage({
      defaultMessage: 'No table here to filter',
      id: 'IWeLjLwBqR',
    }),
  notUnderstood: () =>
    translateMessage({
      defaultMessage: 'Couldn’t understand that. Try naming a column.',
      id: '2jBU8SX6lY',
    }),
  agentIsWorking: () =>
    translateMessage({
      defaultMessage: 'Agent is working…',
      id: 'vc0IHKihpG',
    }),
  callFailed: () =>
    translateMessage({
      defaultMessage: 'Couldn’t reach Agent. Try again.',
      id: 'A5SkxctgGc',
    }),
  callRateLimited: () =>
    translateMessage({
      defaultMessage: 'Agent is temporarily unavailable. Try again later.',
      id: 'LUJnRAzRGK',
    }),
  wordsNotUnderstood: (wordsNotKnown: readonly string[]) =>
    translateMessage(
      {
        defaultMessage: 'Couldn’t understand {words}.',
        id: 'PsmATlHCcO',
      },
      {
        words: new Intl.ListFormat(MESSAGE_LOCALE).format(wordsNotKnown.map(quotedFilterWords)),
      },
    ),
  tableHasBlankRows: (blankRows: number) =>
    translateMessage(
      {
        defaultMessage:
          '{count, plural, one {Can’t sort this table while it has a blank row.} other {Can’t sort this table while it has blank rows.}}',
        id: '2/P/UNgigV',
      },
      {
        count: blankRows,
      },
    ),
  tableHasSections: () =>
    translateMessage({
      defaultMessage: 'Can’t sort this table while it has sections or subtotals.',
      id: 'EBcH8Qxjwo',
    }),
  cannotEdit: () =>
    translateMessage({
      defaultMessage: 'Can’t sort because you can’t edit this Sheet.',
      id: 'TG4yDHr/Jn',
    }),
};
export const sortByColumnLabel = ({ column, direction, holds }: SaidOfSortColumn): string =>
  translateMessage(
    {
      defaultMessage: 'Sort by {column}: {direction}',
      id: 'cWmPG/xFlY',
    },
    {
      column: ruleColumnName(column),
      direction: sortDirectionWords(holds, direction),
    },
  );
export const rowCountWords = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# row} other {# rows}}',
      id: 'gSxh2fW9E+',
    },
    {
      count,
    },
  );
export const sortKeyWords = ({ column, direction, holds }: SaidOfSortColumn): string =>
  direction === 'ascending'
    ? ruleColumnName(column)
    : translateMessage(
        {
          defaultMessage: '{column} ({direction})',
          id: 'WXXyHiMuTQ',
        },
        {
          column: ruleColumnName(column),
          direction: sortDirectionWords(holds, direction),
        },
      );
export const sortedByWords = ([firstKey, ...otherKeys]: readonly SaidOfSortColumn[]): string =>
  withThenByWords(
    translateMessage(
      {
        defaultMessage: 'Sorted by {column}',
        id: '8Vfzelj23h',
      },
      {
        column: sortKeyWords(firstKey),
      },
    ),
    otherKeys,
  );
export const joinAsUnitList = (parts: readonly string[]): string =>
  new Intl.ListFormat(MESSAGE_LOCALE, {
    type: 'unit',
  }).format(parts);
