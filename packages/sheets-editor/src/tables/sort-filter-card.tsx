import { Icon } from '../kit/icon.tsx';
import type { ColumnId } from '@open-artifact/sheets-core';
import type { SuggestedAsk } from '../state/initial-state.ts';
import type { RowsAsked, RowsAskedForAct } from '../state/event-reducer.ts';
import type { RuleColumn } from '../messages/conditional-format.ts';
import type { SaidOfSortColumn } from './own-filters.ts';
import type { FilterAndSortSaid } from './sort-filter-labels.ts';
import * as React from 'react';
import {
  sortByColumnLabel,
  filterViewChoiceLabel,
  rowCountWords,
  filterAndSortSummaryParts,
  filterAndSortSummary,
  customSortMessages,
  sortAndFilterMessages,
} from './sort-filter-labels.ts';
import { labelWithCount, AskOrPickList, askListFoundSaid } from '../ui/ask-list/ask-or-pick-list.tsx';
import { filterMessages, filterByColumnLabel } from './filter-messages.ts';
import { ruleColumnName } from '../messages/conditional-format.ts';
import { MOST_CHARACTERS_OF_WORDS } from '../words/vocabulary.ts';
import { SIDE_PANE_DEFAULT_WIDTH } from '../ui/side-pane/side-pane.tsx';
import { isoDayOfDate } from '../chips/calendar.ts';
import { namedViewMessages } from './named-view-messages.ts';
import type { NamedViewOfTable } from './named-view-model.ts';
/** A column of the table offered on the card, and whether the filter asks of it. */
export interface ColumnOnSortFilterCard {
  c: ColumnId;
  column: RuleColumn;
  isAsked: boolean;
}
/** A sort by the column at the cell, offered on the card with the rows it asks for. */
export interface SortOfColumnOnCard extends SaidOfSortColumn {
  asked: RowsAsked;
}
/** The rows the words typed are read as: what they ask, as the page tells it, and how many records they come to. */
export interface SortFilterAnswer extends FilterAndSortSaid {
  asked: RowsAsked;
  records: number | null;
}
/** Why a sort asked for in words is left out: blank rows in the table, sections in it, or the sheet can't be edited. */
export type WhySortIsLeftOut = { blankRows: number } | 'cannotEdit' | 'hasSections';
/** The card that asks for rows in words, as drawn. */
export interface SortFilterCard {
  isOfFilterBar: boolean;
  isFilterNotDrawnYet: boolean;
  hasTable: boolean;
  isFilterTried: boolean;
  tableKey: string | null;
  columnCameBackFrom: ColumnId | null;
  columns: ColumnOnSortFilterCard[];
  namedViews: NamedViewOfTable[];
  areSortsForOneself: boolean;
  sortsOfColumn: SortOfColumnOnCard[];
  suggested: SuggestedAsk[];
  answer: SortFilterAnswer | null;
  sortLeftOutBecause: WhySortIsLeftOut | null;
  isAgentAsked: boolean;
  askThatAnswered: number | null;
  callToAgent: 'failed' | 'rateLimited' | null;
  areWordsNotRead: boolean;
  wordsNotKnown: string[];
}
export interface SortFilterCardListProps {
  card: SortFilterCard;
  onAct: (act: RowsAskedForAct) => void;
  onCustomSortAsked: () => void;
  onColumnAsked?: (tableKey: string, c: ColumnId) => void;
}
export let SORT_FILTER_ANSWER_ROW_ID: string;
export let CUSTOM_SORT_ROW_ID: string;
export function SortFilterCardList({
  card,
  onAct,
  onCustomSortAsked,
  onColumnAsked,
}: SortFilterCardListProps) {
  let [text, setText] = React.useState('');
  let whyOutOfUseId = React.useId();
  let hasText = text.trim() !== '';
  let { answer, hasTable } = card;
  let answerRowId = card.askThatAnswered === null ? SORT_FILTER_ANSWER_ROW_ID : `${SORT_FILTER_ANSWER_ROW_ID} ${card.askThatAnswered}`;
  let restTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  let isRowPointedRef = React.useRef(false);
  React.useEffect(() => () => clearTimeout(restTimerRef.current), []);
  let rows = [
    ...card.sortsOfColumn.map(
      (sort) => ({
        id: `sort ${sort.direction}`,
        asked: sort.asked,
        drawn: sortByColumnLabel(sort),
      }),
    ),
    ...card.suggested.map(
      ({ what, asked, records }, suggestedIndex) => ({
        id: `suggested ${suggestedIndex}`,
        asked,
        drawn: filterViewChoiceLabel(what),
        atEnd: records === null ? undefined : rowCountWords(records),
      }),
    ),
  ];
  let filterRows = rows.filter(({ asked }) => asked.filter !== null);
  let hasSortRows = rows.length > filterRows.length;
  let headingCount = hasSortRows && filterRows.length > 0 ? 2 : 1;
  let namedViewRowCount = card.namedViews.length === 0 ? 0 : card.namedViews.length + 1.5;
  let [shownRowCount] = React.useState(Math.max(rows.length + 1 + headingCount + namedViewRowCount + (hasTable ? 0 : 0.75), 4));
  let answerRow =
    answer === null
      ? null
      : {
          id: answerRowId,
          isOfAgent: card.askThatAnswered !== null,
          laysItselfOut: true,
          drawn: <span className="flex min-w-0 flex-1 flex-col"><span className={`min-w-0 wrap-anywhere ${card.askThatAnswered === null ? 'line-clamp-2' : ''}`}>{filterAndSortSummaryParts(answer).first}{filterAndSortSummaryParts(answer).thenSort !== null &&
                    <span className="text-muted">{' '}{filterAndSortSummaryParts(answer).thenSort}</span>}</span>{(answer.lines.length > 0 || answer.records !== null) &&
                <span className="min-h-[1lh] text-footnote text-muted">{answer.records === null ? '' : rowCountWords(answer.records)}</span>}</span>,
          inFull: filterAndSortSummary(answer),
        };
  let customSortRow = {
    id: CUSTOM_SORT_ROW_ID,
    drawn: customSortMessages.customSort(),
  };
  let sortRows = rows.filter(({ asked }) => asked.filter === null);
  let alwaysGroup = {
    id: 'always',
    heading: null,
    rows: [customSortRow],
  };
  let areSortsForOneself = hasSortRows && card.areSortsForOneself;
  let sortsGroup = {
    id: 'sorts',
    heading: labelWithCount(filterMessages.sorts(), areSortsForOneself ? filterMessages.forYouOnly() : filterMessages.forEveryone()),
    rows: areSortsForOneself ? sortRows : [...sortRows, customSortRow],
  };
  let filtersGroup = {
    id: 'filters',
    heading: labelWithCount(filterMessages.filters(), filterMessages.forYouOnly()),
    rows: filterRows,
  };
  let groupsWithoutText = areSortsForOneself
    ? [sortsGroup, ...(filterRows.length === 0 ? [] : [filtersGroup]), alwaysGroup]
    : filterRows.length === 0
      ? [sortsGroup]
      : !hasSortRows
        ? [filtersGroup, alwaysGroup]
        : [sortsGroup, filtersGroup];
  let columnsMatching = (searchText: string) =>
    card.columns.filter(({ column }) => ruleColumnName(column).toLowerCase().includes(searchText.trim().toLowerCase()));
  let columnsFound = columnsMatching(text);
  let columnRows = columnsFound.map(
    ({ c, column, isAsked }) => ({
      id: `column ${c}`,
      drawn: ruleColumnName(column),
      atEnd: isAsked
        ? <span className="flex text-accent"><Icon name="FilterLines" size="xs" alt={sortAndFilterMessages.filtered()} /></span>
        : undefined,
    }),
  );
  let isColumnFoundOnly = hasText && answer === null && columnRows.length > 0;
  let whyNoAnswer = !hasTable
    ? sortAndFilterMessages.noTable()
    : !hasText
      ? null
      : card.callToAgent !== null
        ? card.callToAgent === 'failed'
          ? sortAndFilterMessages.callFailed()
          : sortAndFilterMessages.callRateLimited()
        : card.areWordsNotRead && !isColumnFoundOnly
          ? card.wordsNotKnown.length === 0
            ? sortAndFilterMessages.notUnderstood()
            : sortAndFilterMessages.wordsNotUnderstood(card.wordsNotKnown)
          : card.sortLeftOutBecause === null
            ? null
            : card.sortLeftOutBecause === 'cannotEdit'
              ? sortAndFilterMessages.cannotEdit()
              : card.sortLeftOutBecause === 'hasSections'
                ? sortAndFilterMessages.tableHasSections()
                : sortAndFilterMessages.tableHasBlankRows(card.sortLeftOutBecause.blankRows);
  let answerGroups =
    answerRow !== null || whyNoAnswer !== null
      ? [
          {
            id: 'answer',
            heading: null,
            rows: answerRow === null ? [] : [answerRow],
          },
        ]
      : [];
  let columnGroups =
    columnRows.length === 0
      ? []
      : [
          {
            id: 'columns',
            heading: sortAndFilterMessages.filterByColumn(),
            rows: columnRows,
          },
        ];
  let namedViewRows = card.namedViews.map(
    ({ namedViewId, name }) => ({
      id: `view ${namedViewId}`,
      drawn: name,
    }),
  );
  let namedViewGroups =
    namedViewRows.length === 0
      ? []
      : [
          {
            id: 'views',
            heading: namedViewMessages.savedViews(),
            rows: namedViewRows,
          },
        ];
  let groups = hasText ? [...answerGroups, ...columnGroups, alwaysGroup] : [...namedViewGroups, ...groupsWithoutText, ...columnGroups];
  let columnFound = isColumnFoundOnly ? columnsFound[0]?.column : undefined;
  let askedOfRow = (rowId: string | null): RowsAsked | null =>
    rowId === answerRowId ? (answer?.asked ?? null) : (rows.find((row) => row.id === rowId)?.asked ?? null);
  let takeAnswer = () =>
    onAct({
      kind: 'takeAnswer',
      askOnShow: card.askThatAnswered,
    });
  return <AskOrPickList nameOfField={sortAndFilterMessages.sayWhichRowsToShow()} nameOfList={sortAndFilterMessages.waysToSortAndFilter()} placeholder={sortAndFilterMessages.whichRowsToShow()} text={text} {...(!hasTable && {
      idOfWhyFieldIsOutOfUse: whyOutOfUseId,
    })} mostCharacters={MOST_CHARACTERS_OF_WORDS} stands="atRest" isAgentAtWork={card.isAgentAsked} said={card.isAgentAsked ? sortAndFilterMessages.agentIsWorking() : hasText ? null : whyNoAnswer} foundSaid={hasText ? sortFilterFoundSaid(answer, columnFound ?? null, whyNoAnswer) : askListFoundSaid(null)} note={whyNoAnswer === null
        ? null
        : <div id={whyOutOfUseId} className="px-md py-1 text-footnote text-secondary">{whyNoAnswer}</div>} idOfAgentsNote={card.callToAgent === null ? null : `call ${card.askThatAnswered}`} sections={groups} doesFirstRowAnswer={hasText && (answer !== null || isColumnFoundOnly)} {...(card.columnCameBackFrom !== null && {
      rowPointedAtFirst: `column ${card.columnCameBackFrom}`,
    })} foot={null} wordsOfFoot={{
      keep: '',
      discard: '',
      stop: '',
    }} height={card.isOfFilterBar
      ? {
          atMost: '600px',
        }
      : sortFilterCardHeight(shownRowCount)} width={SIDE_PANE_DEFAULT_WIDTH} onTextChange={(typedText: string) => {
      setText(typedText);
      onAct({
        kind: 'type',
        words: typedText,
        today: isoDayOfDate(new Date()),
      });
      clearTimeout(restTimerRef.current);
      restTimerRef.current = setTimeout(
        () =>
          onAct({
            kind: 'rest',
            isRowPointedAt: isRowPointedRef.current,
            isColumnFound: columnsMatching(typedText).length > 0,
          }),
        SORT_FILTER_REST_MS,
      );
    }} onCompositionBegun={() => clearTimeout(restTimerRef.current)} onRowPointedAt={(rowId: string | null) => {
      isRowPointedRef.current = rowId !== null;
      onAct({
        kind: 'pointAt',
        asked: askedOfRow(rowId),
      });
    }} onRowTaken={(rowId: string) => {
      if (rowId === CUSTOM_SORT_ROW_ID) return onCustomSortAsked();
      let namedView = card.namedViews.find(({ namedViewId }) => rowId === `view ${namedViewId}`);
      if (namedView !== undefined)
        return onAct({
          kind: 'takeNamedView',
          namedViewId: namedView.namedViewId,
        });
      let column = card.columns.find(({ c }) => rowId === `column ${c}`);
      if (column !== undefined) return card.tableKey === null ? undefined : onColumnAsked?.(card.tableKey, column.c);
      if (rowId === answerRowId) return takeAnswer();
      let asked = askedOfRow(rowId);
      return asked === null
        ? undefined
        : onAct({
            kind: 'take',
            asked,
          });
    }} onEntered={takeAnswer} onKept={() => {}} onSteppedBack={() => {}} />;
}
[SORT_FILTER_ANSWER_ROW_ID, CUSTOM_SORT_ROW_ID] = ['answer', 'customSort'];
export const sortFilterCardHeight = (rowCount: number): string => `calc(3.625rem + ${rowCount} * max(var(--ui-h-control), 1.75rem))`;
export const SORT_FILTER_REST_MS = 500;
export const sortFilterFoundSaid = (answer: SortFilterAnswer | null, foundColumn: RuleColumn | null, note: string | null) =>
  askListFoundSaid({
    rowOfEnter: answer !== null ? filterAndSortSummary(answer) : foundColumn === null ? null : filterByColumnLabel(foundColumn),
    count: answer === null || answer.records === null ? null : rowCountWords(answer.records),
    note,
  });
