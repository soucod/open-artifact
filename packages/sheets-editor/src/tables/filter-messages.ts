import type { Comparison } from '@open-artifact/sheets-core';
import { ruleTestSummary, ruleColumnWords, ruleColumnName } from '../messages/conditional-format.ts';
import { translateMessage } from '../i18n/messages.ts';
import { QUICK_FILTER_COUNT } from './own-filter-list.ts';
import { namedViewSortLeftOutLabel } from './named-view-messages.ts';
import type { MessagePart } from '../i18n/messages.ts';
import type { ConditionChoice, RuleColumn, RuleOperand, RuleTest } from '../messages/conditional-format.ts';
import type { NoticeWithoutDetail, OwnFilterNotWorkedOutNotice, OwnSortIsOverNotice, ReadyFilterWhat } from '../state/initial-state.ts';
import type { LinesInTheWayNotice } from '../state/edit-answers.ts';
import type { DueDatePreset } from '../model/date-serials.ts';
import type { RecordCountsOfFilter, SaidOfFilterItem } from './own-filters.ts';
import type { ConditionJoin } from './filter-model.ts';
import type { SortsFor } from './sort-pane.ts';
/** A notice of the page's own sort: it is over, or it is in the way of an act. */
/** What of the person's own view is being applied while the rows are worked out. */
export type OwnViewShownAsApplied = 'sortAndFilter' | 'sort' | 'filter';
export type OwnSortNotice = OwnSortIsOverNotice | (LinesInTheWayNotice & { kind: 'ownSortInTheWay' });
export function describeValueFilterLine(filterLine: SaidOfFilterItem): MessagePart[] {
  if (filterLine.kind === 'test') return ruleTestSummary(filterLine.test);
  const columnName = ruleColumnWords(filterLine.column);
  const [first = null, second = null] = filterLine.values;
  const [count, isShowOnly] = [filterLine.values.length, filterLine.kind === 'isOneOf'];
  if (count === 2)
    return isShowOnly
      ? translateMessage(
          {
            defaultMessage: '{column} is {first} or {second}',
            id: 'd3UQNztzit',
          },
          {
            column: columnName,
            first: filterValueInSentence(first),
            second: filterValueInSentence(second),
          },
        )
      : translateMessage(
          {
            defaultMessage: '{column} is not {first} or {second}',
            id: 'geYOPXp8T9',
          },
          {
            column: columnName,
            first: filterValueInSentence(first),
            second: filterValueInSentence(second),
          },
        );
  return isShowOnly
    ? translateMessage(
        {
          defaultMessage: '{count, plural, one {{column} is one of # value} other {{column} is one of # values}}',
          id: 'YVbWVM0+Eo',
        },
        {
          column: columnName,
          count,
        },
      )
    : translateMessage(
        {
          defaultMessage: '{count, plural, one {{column} is not one of # value} other {{column} is not one of # values}}',
          id: 'gNn1krvvLk',
        },
        {
          column: columnName,
          count,
        },
      );
}
export function filterChoiceLabel(choice: ConditionChoice, isOfDates: boolean): string {
  switch (choice) {
    case 'isBlank':
      return translateMessage({
        defaultMessage: 'Is blank',
        id: 'yGdWJ9AJco',
      });
    case 'isNotBlank':
      return translateMessage({
        defaultMessage: 'Is not blank',
        id: 'u1jyE5vSge',
      });
    case 'textIs':
      return translateMessage({
        defaultMessage: 'Is',
        id: 'xhJJMvUDnd',
      });
    case 'textIsNot':
      return translateMessage({
        defaultMessage: 'Is not',
        id: 'qNn5V+MXV/',
      });
    case 'textContains':
      return translateMessage({
        defaultMessage: 'Contains',
        id: 'LUAOhcMwX9',
      });
    case 'textDoesNotContain':
      return translateMessage({
        defaultMessage: 'Does not contain',
        id: 'C+x3HVMjlN',
      });
    case 'textStartsWith':
      return translateMessage({
        defaultMessage: 'Starts with',
        id: 'mRgOYITK07',
      });
    case 'textEndsWith':
      return translateMessage({
        defaultMessage: 'Ends with',
        id: 'QJovHfdq2X',
      });
    case 'numberIsBetween':
      return translateMessage({
        defaultMessage: 'Between',
        id: 'fqujRuLDxr',
      });
    case 'numberIsNotBetween':
      return translateMessage({
        defaultMessage: 'Not between',
        id: '1G10w45VvN',
      });
    case 'isAmongTheLargest':
      return translateMessage({
        defaultMessage: 'Largest',
        id: 'x+MWXNXZ2p',
      });
    case 'isAmongTheSmallest':
      return translateMessage({
        defaultMessage: 'Smallest',
        id: '5o+ECZtk1z',
      });
    case 'isChecked':
      return translateMessage({
        defaultMessage: 'Checked',
        id: 'pI5lREc6go',
      });
    case 'isNotChecked':
      return translateMessage({
        defaultMessage: 'Not checked',
        id: 'tobtMVK6+/',
      });
    case 'appearsMoreThanOnce':
      return translateMessage({
        defaultMessage: 'Duplicates',
        id: 'LE0ZzV9ERP',
      });
    case 'isAnError':
      return translateMessage({
        defaultMessage: 'Errors',
        id: 'PAJnFoTF+q',
      });
    case 'lessThan':
      return isOfDates
        ? translateMessage({
            defaultMessage: 'Before',
            id: 'glAe+3oQ8J',
          })
        : translateMessage({
            defaultMessage: 'Less than',
            id: 'nxM8n0mICu',
          });
    case 'lessThanOrEqualTo':
      return isOfDates
        ? translateMessage({
            defaultMessage: 'On or before',
            id: 'HOmFFKtTTZ',
          })
        : translateMessage({
            defaultMessage: 'At most',
            id: 'sCuLSb5hmN',
          });
    case 'equalTo':
      return isOfDates
        ? translateMessage({
            defaultMessage: 'On',
            id: '60dzPLmsh/',
          })
        : translateMessage({
            defaultMessage: 'Equal to',
            id: 'RcC3QoPo5H',
          });
    case 'notEqualTo':
      return isOfDates
        ? translateMessage({
            defaultMessage: 'Not on',
            id: '8doY7v8hLX',
          })
        : translateMessage({
            defaultMessage: 'Not equal to',
            id: 'p++NVNkx4k',
          });
    case 'greaterThanOrEqualTo':
      return isOfDates
        ? translateMessage({
            defaultMessage: 'On or after',
            id: '3nVFUVl8kj',
          })
        : translateMessage({
            defaultMessage: 'At least',
            id: 'RMWQTsg74k',
          });
    case 'greaterThan':
      return isOfDates
        ? translateMessage({
            defaultMessage: 'After',
            id: 'zg9VvOfroD',
          })
        : translateMessage({
            defaultMessage: 'Greater than',
            id: 'cMHL758YIK',
          });
  }
}
export function comparisonWithValueText(comparison: Comparison, isOfDates: boolean, value: string): string {
  switch (comparison) {
    case 'lessThan':
      return isOfDates
        ? translateMessage(
            {
              defaultMessage: 'Before {value}',
              id: 'IcFvwiZl3i',
            },
            {
              value,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Less than {value}',
              id: 'nXDVkzsWe4',
            },
            {
              value,
            },
          );
    case 'lessThanOrEqualTo':
      return isOfDates
        ? translateMessage(
            {
              defaultMessage: 'On or before {value}',
              id: 'iOIwA90NnW',
            },
            {
              value,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'At most {value}',
              id: '1tbUjWR1H6',
            },
            {
              value,
            },
          );
    case 'equalTo':
      return isOfDates
        ? translateMessage(
            {
              defaultMessage: 'On {value}',
              id: 'cAfEYHB2be',
            },
            {
              value,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Equal to {value}',
              id: 'F+ycligLvh',
            },
            {
              value,
            },
          );
    case 'notEqualTo':
      return isOfDates
        ? translateMessage(
            {
              defaultMessage: 'Not on {value}',
              id: 'PF1UadDHvu',
            },
            {
              value,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Not equal to {value}',
              id: '2qEbVGNt3+',
            },
            {
              value,
            },
          );
    case 'greaterThanOrEqualTo':
      return isOfDates
        ? translateMessage(
            {
              defaultMessage: 'On or after {value}',
              id: 'ULrAWt6huH',
            },
            {
              value,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'At least {value}',
              id: '8YlNbN72Vk',
            },
            {
              value,
            },
          );
    case 'greaterThan':
      return isOfDates
        ? translateMessage(
            {
              defaultMessage: 'After {value}',
              id: 'Gcu26iIpxR',
            },
            {
              value,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Greater than {value}',
              id: 'UxLF1oXEdx',
            },
            {
              value,
            },
          );
  }
}
export function describeFilterCondition({ condition, isOfDates }: RuleTest): string {
  switch (condition.kind) {
    case 'textIs':
      return translateMessage(
        {
          defaultMessage: 'Is “{value}”',
          id: 'JB4xa0lj13',
        },
        {
          value: condition.text,
        },
      );
    case 'textIsNot':
      return translateMessage(
        {
          defaultMessage: 'Is not “{value}”',
          id: 'Pxliun4Yvq',
        },
        {
          value: condition.text,
        },
      );
    case 'textContains':
      return translateMessage(
        {
          defaultMessage: 'Contains “{value}”',
          id: 'mD1HsIxbUJ',
        },
        {
          value: condition.text,
        },
      );
    case 'textDoesNotContain':
      return translateMessage(
        {
          defaultMessage: 'Does not contain “{value}”',
          id: 'pc1BaxlejA',
        },
        {
          value: condition.text,
        },
      );
    case 'textStartsWith':
      return translateMessage(
        {
          defaultMessage: 'Starts with “{value}”',
          id: 'gl11tSUFSo',
        },
        {
          value: condition.text,
        },
      );
    case 'textEndsWith':
      return translateMessage(
        {
          defaultMessage: 'Ends with “{value}”',
          id: '9jofslClzW',
        },
        {
          value: condition.text,
        },
      );
    case 'numberIs':
      return comparisonWithValueText(condition.comparison, isOfDates, shownOperandText(condition.operand));
    case 'numberIsBetween':
      return translateMessage(
        {
          defaultMessage: 'Between {from} and {to}',
          id: 'gTmLg7ozNv',
        },
        {
          from: shownOperandText(condition.oneEnd),
          to: shownOperandText(condition.otherEnd),
        },
      );
    case 'numberIsNotBetween':
      return translateMessage(
        {
          defaultMessage: 'Not between {from} and {to}',
          id: 'J/4Oc6gYLo',
        },
        {
          from: shownOperandText(condition.oneEnd),
          to: shownOperandText(condition.otherEnd),
        },
      );
    case 'isAmongTheLargest':
      return largestCountLabel(condition.count);
    case 'isAmongTheSmallest':
      return smallestCountLabel(condition.count);
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
    case 'isAnError':
      return filterChoiceLabel(condition.kind, isOfDates);
    case 'booleanIs':
      return filterChoiceLabel(condition.value ? 'isChecked' : 'isNotChecked', isOfDates);
  }
}
export function datePresetLabel(preset: DueDatePreset): string {
  switch (preset) {
    case 'thisWeek':
      return translateMessage({
        defaultMessage: 'This week',
        id: 'GB4c5YfKY7',
      });
    case 'nextWeek':
      return translateMessage({
        defaultMessage: 'Next week',
        id: 'r/zKMW/sgC',
      });
    case 'thisMonth':
      return translateMessage({
        defaultMessage: 'This month',
        id: 'thqLbjibx+',
      });
    case 'overdue':
      return translateMessage({
        defaultMessage: 'Before today',
        id: 'XjvlLOZmku',
      });
  }
}
export function readyFilterLabel(readyFilter: Exclude<ReadyFilterWhat, 'mine' | 'allBut'>): string {
  switch (readyFilter) {
    case 'largest':
      return largestCountLabel(QUICK_FILTER_COUNT);
    case 'smallest':
      return smallestCountLabel(QUICK_FILTER_COUNT);
    case 'duplicates':
      return filterChoiceLabel('appearsMoreThanOnce', false);
    case 'thisWeek':
    case 'nextWeek':
    case 'thisMonth':
    case 'overdue':
      return datePresetLabel(readyFilter);
  }
}
/** Only the filter notices among `NoticeWithoutDetail` have words here; any other kind has none. */
export function filterNoticeText(notice: NoticeWithoutDetail | OwnFilterNotWorkedOutNotice): string | undefined {
  switch (notice.kind) {
    case 'noTableToFilter':
      return translateMessage({
        defaultMessage: 'Nothing was filtered, because there’s no table here. Select the cells to filter, with their header row, then try again.',
        id: 'VTkV4ySuNK',
      });
    case 'filteredTableIsGone':
      return translateMessage({
        defaultMessage: 'The table you were filtering was deleted, so its filter was cleared.',
        id: 'LDYrsNERWf',
      });
    case 'ownFilterNotWorkedOut':
      return notice.why === 'dayIsNotKnown'
        ? translateMessage({
            defaultMessage: 'Nothing was changed, because the filter can’t use today’s date yet. Try again in a moment.',
            id: 'C4p9caO5Ia',
          })
        : translateMessage({
            defaultMessage: 'Nothing was changed, because that filter took too long to apply. Try again.',
            id: 'WbTBwJVyM5',
          });
  }
}
export function ownSortInTheWayText(act: LinesInTheWayNotice['act']): string {
  switch (act) {
    case 'paste':
      return translateMessage({
        defaultMessage: 'Nothing was pasted, because only you see these rows in this order. Clear your sort first.',
        id: 's0AuhvdjJ0',
      });
    case 'fill':
      return translateMessage({
        defaultMessage: 'Nothing was filled, because only you see these rows in this order. Clear your sort first.',
        id: 'kTLLh6LwFf',
      });
    case 'pasteOfFormula':
      return translateMessage({
        defaultMessage: 'Nothing was pasted, because a formula refers to another row, and only you see these rows in this order. Clear your sort first.',
        id: 'p7SIWZexml',
      });
    case 'fillOfFormula':
      return translateMessage({
        defaultMessage: 'Nothing was filled, because a formula refers to another row, and only you see these rows in this order. Clear your sort first.',
        id: 'ncN21/iAx6',
      });
    case 'mergeCells':
      return translateMessage({
        defaultMessage: 'These cells weren’t merged, because only you see these rows in this order. Clear your sort first.',
        id: 'gvASu36lIp',
      });
    case 'cut':
      return translateMessage({
        defaultMessage: 'Nothing was cut, because only you see these rows in this order. You can copy them, or clear your sort first.',
        id: 'xxX+a14PQW',
      });
    case 'referTo':
      return translateMessage({
        defaultMessage: 'A formula can’t use these cells as one range, because only you see these rows in this order. Clear your sort first.',
        id: '7TiAm8Oas9',
      });
    case 'dropdown':
    case 'moveCells':
    case 'moveRows':
    case 'otherEdit':
      return translateMessage({
        defaultMessage: 'Nothing was changed, because only you see these rows in this order. Clear your sort first.',
        id: '8q8nncklC7',
      });
  }
}
export function ownSortNoticeText(notice: OwnSortNotice): string {
  if (notice.kind === 'ownSortInTheWay') return ownSortInTheWayText(notice.act);
  switch (notice.why) {
    case 'leftOutOfNamedView':
      return namedViewSortLeftOutLabel(false);
    case 'leftOutOfNamedViewWithFilter':
      return namedViewSortLeftOutLabel(true);
    case 'tableIsGone':
      return translateMessage({
        defaultMessage: 'The table you were sorting was deleted, so its sort was cleared.',
        id: 'kljrchsl8N',
      });
    case 'columnIsGone':
      return translateMessage({
        defaultMessage: 'A column you sorted by was deleted, so your sort was cleared.',
        id: 'Kjd6/Rn44P',
      });
    case 'tableChanged':
      return translateMessage({
        defaultMessage: 'This table was changed, so your sort was cleared.',
        id: '8vZY+7c7zY',
      });
  }
}
export function applyingOwnFilterLabel(sortsAndFilters: OwnViewShownAsApplied): string {
  if (sortsAndFilters === 'sortAndFilter')
    return translateMessage({
      defaultMessage: 'Applying your sort and filter…',
      id: 'VmJMQaCKpN',
    });
  if (sortsAndFilters === 'sort')
    return translateMessage({
      defaultMessage: 'Applying your sort…',
      id: '2dd4GBb/2Q',
    });
  return translateMessage({
    defaultMessage: 'Applying your filter…',
    id: 'Dgj7mhNTBC',
  });
}
export const filterMessages = {
  filter: () =>
    translateMessage({
      defaultMessage: 'Filter',
      id: 'N9/407riFn',
    }),
  filteredForYouOnly: () =>
    translateMessage({
      defaultMessage: 'Filtered for you only',
      id: '0tJfXIGRaf',
    }),
  allRows: () =>
    translateMessage({
      defaultMessage: 'All rows',
      id: 'JtODpScDFo',
    }),
  refresh: () =>
    translateMessage({
      defaultMessage: 'Reapply',
      id: 'v812QNcDiC',
    }),
  refreshFilter: () =>
    translateMessage({
      defaultMessage: 'The rows shown may not match the filter. Reapply it to update them.',
      id: '1nC+Kv0oiR',
    }),
  backToSortAndFilter: () =>
    translateMessage({
      defaultMessage: 'Back to Filter',
      id: 'wdUIsWdsR5',
    }),
  searchOrFilter: () =>
    translateMessage({
      defaultMessage: 'Search or filter',
      id: 'fZxJw+SQlN',
    }),
  clearFilter: () =>
    translateMessage({
      defaultMessage: 'Clear filter',
      id: 'wLOio5vhje',
    }),
  filterCutsCellsForAgent: () =>
    translateMessage({
      defaultMessage: 'Clear the filter to ask Agent about these cells.',
      id: 'SuheYcI+ak',
    }),
  addFilter: () =>
    translateMessage({
      defaultMessage: 'Add filter',
      id: 'ZKbzG8kt/6',
    }),
  clearAll: () =>
    translateMessage({
      defaultMessage: 'Clear all',
      id: 'Oe7fcVL70t',
    }),
  clearAllFilters: () =>
    translateMessage({
      defaultMessage: 'Clear all filters',
      id: 'vH5g/F7NTe',
    }),
  filterOnWithAllRows: () =>
    translateMessage({
      defaultMessage: 'Filter on. All rows are showing.',
      id: '90Mrmr54kA',
    }),
  allRowsAreShowing: () =>
    translateMessage({
      defaultMessage: 'All rows are showing.',
      id: 'pE4ywcJMms',
    }),
  filterCleared: () =>
    translateMessage({
      defaultMessage: 'Filter cleared',
      id: '7fMQVXnMcn',
    }),
  blankAsAValue: () =>
    translateMessage({
      defaultMessage: '(Blank)',
      id: 'Jiem0E4/Xf',
    }),
  blankInASentence: () =>
    translateMessage({
      defaultMessage: 'blank',
      id: 'R8NUU0QUrc',
    }),
  sorts: () =>
    translateMessage({
      defaultMessage: 'Sort',
      id: 'naFJErfDME',
    }),
  filters: () =>
    translateMessage({
      defaultMessage: 'Filter',
      id: 'u3TM5Ti337',
    }),
  forEveryone: () =>
    translateMessage({
      defaultMessage: 'for everyone',
      id: 'W99ySoBTku',
    }),
  forYouOnly: () =>
    translateMessage({
      defaultMessage: 'for you only',
      id: '3uqtkJpVb5',
    }),
  values: () =>
    translateMessage({
      defaultMessage: 'Values',
      id: '5wsKVLpVxV',
    }),
  addCondition: () =>
    translateMessage({
      defaultMessage: 'Add a condition',
      id: '5DIdXQsjOL',
    }),
  removeCondition: () =>
    translateMessage({
      defaultMessage: 'Remove condition',
      id: '5au1zsVLBy',
    }),
  and: () =>
    translateMessage({
      defaultMessage: 'and',
      id: 'T3u/S0BWEt',
    }),
  or: () =>
    translateMessage({
      defaultMessage: 'or',
      id: 'LzV9dVulYA',
    }),
  from: () =>
    translateMessage({
      defaultMessage: 'From',
      id: 'aWFn1FKHpZ',
    }),
  to: () =>
    translateMessage({
      defaultMessage: 'To',
      id: 'ZBPlnXqbWs',
    }),
  selectAll: () =>
    translateMessage({
      defaultMessage: 'Select all',
      id: 'JkmMXHTfYp',
    }),
  noMatches: () =>
    translateMessage({
      defaultMessage: 'No matches',
      id: 'nMfQ6iaXh9',
    }),
  moreValuesLeftOut: () =>
    translateMessage({
      defaultMessage: 'This column has more values than fit in this list.',
      id: 'uBH8eG0t9s',
    }),
  valuesNotListed: () =>
    translateMessage({
      defaultMessage: 'This column’s values can’t be listed right now. Try again in a moment.',
      id: 'DwSxKnts9V',
    }),
};
export const showOnlyValueLabel = (text: string): string =>
  text === ''
    ? translateMessage({
        defaultMessage: 'Show only blank cells',
        id: '1hDCjZtiOr',
      })
    : translateMessage(
        {
          defaultMessage: 'Show only {text}',
          id: 'NKoXxrfvAw',
        },
        {
          text,
        },
      );
export const leaveOutValueLabel = (text: string): string =>
  text === ''
    ? translateMessage({
        defaultMessage: 'Leave out blank cells',
        id: 'JFWp0kX6H/',
      })
    : translateMessage(
        {
          defaultMessage: 'Leave out {text}',
          id: 'JiDU6ItT2R',
        },
        {
          text,
        },
      );
export const rowsInViewOfAllText = ({ inView, all }: RecordCountsOfFilter): string =>
  translateMessage(
    {
      defaultMessage: '{all, plural, one {{inView, number} of # row} other {{inView, number} of # rows}}',
      id: 'xLHGIfj9Q/',
    },
    {
      inView,
      all,
    },
  );
export const filterValueInSentence = (text: string | null): MessagePart[] =>
  text === null
    ? [filterMessages.blankInASentence()]
    : [
        {
          setApart: text,
        },
      ];
export const describeFilterLineAlternatives = ([first, ...others]: readonly SaidOfFilterItem[]): MessagePart[] =>
  others.reduce(
    (sentence, next) =>
      translateMessage(
        {
          defaultMessage: '{first} or {second}',
          id: 'UMD8mYCvqK',
        },
        {
          first: sentence,
          second: describeValueFilterLine(next),
        },
      ),
    describeValueFilterLine(first),
  );
export const removeFilterLineLabel = (line: string): string =>
  translateMessage(
    {
      defaultMessage: 'Remove “{line}”',
      id: 'GOaQ5GA4+U',
    },
    {
      line,
    },
  );
export const searchOrFilterColumnLabel = (column: RuleColumn): string =>
  translateMessage(
    {
      defaultMessage: 'Search or filter {column}',
      id: 'aALemaAx/7',
    },
    {
      column: ruleColumnName(column),
    },
  );
export const shownOperandText = (operand: RuleOperand): string => (operand.kind === 'shown' ? operand.text : '');
export const changeConditionLabel = (condition: string): string =>
  translateMessage(
    {
      defaultMessage: 'Change condition: {condition}',
      id: '1KqqsodDf6',
    },
    {
      condition,
    },
  );
export const wholeNumberRangeHint = (most: number): string =>
  translateMessage(
    {
      defaultMessage: 'Enter a whole number from 1 to {most, number}.',
      id: 'VgncZvmgCb',
    },
    {
      most,
    },
  );
export const conditionJoinHint = (join: ConditionJoin): string =>
  join === 'and'
    ? translateMessage({
        defaultMessage: 'And: rows must meet both conditions. Press to change to “or”.',
        id: 'QT2z9QHZqC',
      })
    : translateMessage({
        defaultMessage: 'Or: rows must meet either condition. Press to change to “and”.',
        id: 'v3odhQtIi8',
      });
export const alsoHidesCellsText = (cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'Also hides {cells}',
      id: 'JeGgYeOQco',
    },
    {
      cells,
    },
  );
export const editFilterLineLabel = (line: string): string =>
  translateMessage(
    {
      defaultMessage: 'Edit filter: {line}',
      id: 'Cfc8C54rg5',
    },
    {
      line,
    },
  );
export const filterByColumnLabel = (column: RuleColumn, isFiltered: boolean = false): string =>
  isFiltered
    ? translateMessage(
        {
          defaultMessage: 'Filter by {column}, filtered',
          id: 'xdSNFVR7D4',
        },
        {
          column: ruleColumnName(column),
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Filter by {column}',
          id: 'QFf7HFB0gt',
        },
        {
          column: ruleColumnName(column),
        },
      );
export const largestCountLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, number} largest',
      id: 'TbjdPrtkv+',
    },
    {
      count,
    },
  );
export const smallestCountLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, number} smallest',
      id: '72RUe/6RZ9',
    },
    {
      count,
    },
  );
export const sortMessages = {
  sortCutsCellsForAgent: () =>
    translateMessage({
      defaultMessage: 'Clear your sort to ask Agent about these cells.',
      id: 'zhqFx5lyPS',
    }),
  sortAndFilterCutCellsForAgent: () =>
    translateMessage({
      defaultMessage: 'Clear your sort and filter to ask Agent about these cells.',
      id: 'cpMeldoshO',
    }),
  bar: (isFiltered: boolean) =>
    isFiltered
      ? translateMessage({
          defaultMessage: 'Sort and filter',
          id: 'BJqAcNhKrh',
        })
      : translateMessage({
          defaultMessage: 'Sort',
          id: 'Nip0Cb6jqY',
        }),
  forYouOnly: (isFiltered: boolean) =>
    isFiltered
      ? translateMessage({
          defaultMessage: 'Sorted and filtered for you only',
          id: 'EmgrsFErM7',
        })
      : translateMessage({
          defaultMessage: 'Sorted for you only',
          id: 'mfNYFWlNAV',
        }),
  sortForEveryone: () =>
    translateMessage({
      defaultMessage: 'Sort for everyone',
      id: 'vHvMZbYIBB',
    }),
  whatSortForEveryoneDoes: () =>
    translateMessage({
      defaultMessage: 'Puts the table’s rows in this order for everyone.',
      id: 'cAo+r/WFfW',
    }),
  refresh: (isFiltered: boolean) =>
    isFiltered
      ? translateMessage({
          defaultMessage: 'The rows shown may not match your sort or filter. Reapply to update them.',
          id: 'OCXvnygtoE',
        })
      : translateMessage({
          defaultMessage: 'The rows shown may not be in sorted order. Reapply your sort to update them.',
          id: 'fXGdUEDvlF',
        }),
  clearAll: (isFiltered: boolean) =>
    isFiltered
      ? translateMessage({
          defaultMessage: 'Clear all sorts and filters',
          id: 'UCx2Ik6E6D',
        })
      : translateMessage({
          defaultMessage: 'Clear all sorts',
          id: 'cN6Yy9umRl',
        }),
  cleared: () =>
    translateMessage({
      defaultMessage: 'Sort cleared',
      id: 'R+LCoTT1Ck',
    }),
};
export const editSortLabel = (sort: string): string =>
  translateMessage(
    {
      defaultMessage: 'Edit sort: {sort}',
      id: '3XUjhNk1SD',
    },
    {
      sort,
    },
  );
export const filterForWhomLabel = (forWhom: SortsFor | null): string | null =>
  forWhom === null ? null : forWhom === 'oneself' ? filterMessages.forYouOnly() : filterMessages.forEveryone();
