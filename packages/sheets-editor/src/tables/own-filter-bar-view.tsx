import { Popover } from '../kit/popover.tsx';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { OverflowTooltip, Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import * as React from 'react';
import type { ColumnId, SheetId } from '@open-artifact/sheets-core';
import type { PopoverPopupProps } from '../kit/popover.tsx';
import type { MessagePart } from '../i18n/messages.ts';
import type { SortFilterCardListProps, SortFilterCard } from './sort-filter-card.tsx';
import type { OwnFilterBar } from './own-filter-bar.ts';
import type { FilterButtonAt } from './table-drawing.ts';
import type { PageView } from '../view/page-view.ts';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import { usePopupGivenUpOnBlur } from '../ui/popup-given-up-on-blur.ts';
import { usePopupFieldFocus } from '../ui/popup-field-focus.ts';
import { useBottomInsetWhileOpen, popupCollisionPadding } from '../shell/bottom-insets.ts';
import {
  filterMessages,
  editSortLabel,
  describeFilterLineAlternatives,
  editFilterLineLabel,
  sortMessages,
  removeFilterLineLabel,
  rowsInViewOfAllText,
  alsoHidesCellsText,
} from './filter-messages.ts';
import { sortAndFilterMessages, sortedByWords } from './sort-filter-labels.ts';
import { wrapTabFocusInBar, preventMouseDownDefault } from '../ui/dom-events.ts';
import { CONTEXT_BAR_PART_ATTRIBUTE } from '../ui/toolbar-tooltip.tsx';
import { SortFilterCardList } from './sort-filter-card.tsx';
import { lookAgainDelay, LOOK_AGAIN_MAX_DELAY_MS } from '../history/cell-history-popover.tsx';
import { joinMessageParts } from '../i18n/messages.ts';
import { ContentsBox } from '../ui/contents-box.tsx';
import { NamedViewsMenu } from './named-views-menu.tsx';
import type { NamedViewsMenuProps } from './named-views-menu.tsx';
import { WordsWithColumnNames } from '../ui/card-rows.tsx';
/** Where the caret goes once a card or list shuts: an element, or `false` to leave it where it is. */
export type CaretTarget = HTMLElement | false;
/** Asks for the list of a column's own filter, from the element it was opened from. */
export type ColumnListAsked = (tableKey: string, c: ColumnId, opener: HTMLElement | null) => void;
/** Where a press on a filter line's cross was, and when. */
export type CrossPress = Pick<MouseEvent, 'clientX' | 'clientY' | 'timeStamp'>;
/** The card that sorts and filters a table, to open from the filter bar or beside the table. */
export interface SortFilterCardToAdd extends Omit<SortFilterCardListProps, 'card' | 'onColumnAsked'> {
  card: SortFilterCard | null;
  besideTable: PopoverPopupProps['anchor'];
  hangsBesideTable: boolean;
  clearAtFoot: number;
  onDrawn: (popup: HTMLElement | null) => void;
  onOpenChange: (isOpen: boolean, event: Event | null) => void;
}
export interface SortFilterCardPopoverProps {
  cardToAdd: SortFilterCardToAdd;
  onColumnAsked: ColumnListAsked;
  whatHasCaretAfterCard: () => CaretTarget;
  timesPressed: () => number;
  crossPressed: React.RefObject<CrossPress | null> | null;
}
/** The opener the caret is owed back to, if it was pressed as many times as now. */
export interface OpenerOwed {
  opener: HTMLElement | null;
  presses: number;
}
/** Where the caret goes back to: the opener owed it, or else somewhere else. */
export interface CaretReturn {
  owed: OpenerOwed | null;
  pressesNow: number;
  otherwise: CaretTarget;
}
/** What the page remembers of the caret when a card of the filter bar shuts. */
export interface CaretMemoryOfFilterCard {
  owedAfterBack: OpenerOwed | null;
  pressesNow: number;
  afterMenu: () => CaretTarget;
}
/** Whether the refresh button of a sheet's filter bar is offered, and whether it has just come in view. */
export interface RefreshOfferSeen {
  sheetId: SheetId;
  isOffered: boolean;
  hasComeInView: boolean;
}
/** A chip of the filter bar: the sort, or a line of the filter. */
export interface FilterBarChip {
  key: string;
  tableKey: string;
  c: ColumnId | null;
  words: MessagePart[];
  edit: string;
  onRemoved: () => void;
}
export interface OwnFilterBarViewProps {
  bar: OwnFilterBar;
  cardToAdd: SortFilterCardToAdd | null;
  whatHasCaretAfterCard: () => CaretTarget;
  onColumnAsked: ColumnListAsked;
  columnOpen: FilterButtonAt | null;
  timesPressed: () => number;
  onLineRemoved: (tableKey: string, lineIndex: number) => void;
  onSortRemoved: (tableKey: string) => void;
  onSortMadeForEveryone: ((tableKey: string) => void) | null;
  actsOnNamedViews: Omit<NamedViewsMenuProps, 'views'>;
  onRefreshed: (sheetId: SheetId) => void;
  onCleared: (sheetId: SheetId) => void;
  onLookAgain: (sheetId: SheetId) => void;
  onGoingWithCaret: () => void;
  onKeyDown: (keyEvent: React.KeyboardEvent) => void;
  className: string;
  style: StyleWithVariables;
  ref: React.Ref<HTMLFieldSetElement>;
}
export function SortFilterCardPopover({
  cardToAdd: {
    card,
    besideTable,
    hangsBesideTable,
    clearAtFoot,
    onDrawn,
    onOpenChange,
    ...listProps
  },
  onColumnAsked,
  whatHasCaretAfterCard,
  timesPressed,
  crossPressed,
}: SortFilterCardPopoverProps) {
  let addButtonRef = React.useRef<HTMLElement | null>(null);
  let isOpen = card !== null;
  let [lastCard, setLastCard] = React.useState(card);
  if (card !== null && card !== lastCard) setLastCard(card);
  let [isBesideTable, setBesideTable] = React.useState(hangsBesideTable);
  if (isOpen && hangsBesideTable !== isBesideTable) setBesideTable(hangsBesideTable);
  let timesPressedRef = React.useRef<number | null>(null);
  let shut = React.useCallback(() => onOpenChange(false, null), [onOpenChange]);
  let { isGivenUp, holdPopup, noteFocus } = usePopupGivenUpOnBlur(isOpen, shut);
  let popupRef = React.useRef<HTMLElement | null>(null);
  let setPopup = React.useCallback(
    (popup: HTMLElement | null) => {
      popupRef.current = popup;
      holdPopup(popup);
      onDrawn(popup);
    },
    [holdPopup, onDrawn],
  );
  let initialFocus = usePopupFieldFocus({
    isOpen: isOpen && !isGivenUp,
    popup: popupRef,
    shut,
  });
  let collisionPadding = useBottomInsetWhileOpen(isOpen, false, crossPressed === null);
  React.useLayoutEffect(() => {
    if (isOpen && popupRef.current !== null) onDrawn(popupRef.current);
  }, [isOpen, onDrawn]);
  return <>{crossPressed !== null &&
        (<Button ref={addButtonRef} variant="ghost" size="xs" iconOnly flush icon={<Icon name="Add" size="xs" />} className="text-accent" aria-label={filterMessages.addFilter()} tooltip aria-haspopup="dialog" aria-expanded={isOpen} onClick={(event) => {
            if (isClickRightAfterCrossPress(crossPressed.current, event)) return;
            timesPressedRef.current = !isOpen && event.detail === 0 ? timesPressed() : null;
            onOpenChange(!isOpen, event.nativeEvent);
          }} />)}<Popover.Root open={isOpen && !isGivenUp} onOpenChange={(willOpen, { event, reason }) => {
          let isInsideAddButton = event.target instanceof Node && addButtonRef.current?.contains(event.target);
          if (willOpen || isInsideAddButton === true) return;
          let isOnOwnFilterButton = event.target instanceof Element && event.target.closest(OWN_FILTER_BUTTON_SELECTOR) !== null;
          if (reason === 'outside-press' && isOnOwnFilterButton) return;
          if (reason === 'outside-press') timesPressedRef.current = null;
          onOpenChange(false, event);
        }}><Popover.Popup ref={setPopup} anchor={isBesideTable ? besideTable : addButtonRef} side="bottom" align="start" {...(isBesideTable && {
            collisionAvoidance: SORT_FILTER_COLLISION_AVOIDANCE,
          })} collisionPadding={popupCollisionPadding(Math.max(collisionPadding, clearAtFoot))} padding="none" aria-label={sortAndFilterMessages.sortAndFilter()} initialFocus={initialFocus} finalFocus={() => {
            let pressCount = timesPressedRef.current;
            timesPressedRef.current = null;
            return openerOwedOrOtherwise({
              owed:
                pressCount === null
                  ? null
                  : {
                      opener: addButtonRef.current,
                      presses: pressCount,
                    },
              pressesNow: timesPressed(),
              otherwise: whatHasCaretAfterCard(),
            });
          }} onFocus={noteFocus} onKeyDown={wrapTabFocusInBar} {...{
            [CONTEXT_BAR_PART_ATTRIBUTE]: true,
          }}>{lastCard !== null &&
            (<SortFilterCardList card={lastCard} {...listProps} onColumnAsked={(tableKey, c) => {
                if (crossPressed === null || addButtonRef.current !== null) onColumnAsked(tableKey, c, addButtonRef.current);
              }} />)}</Popover.Popup></Popover.Root></>;
}
export function useOwnFilterLookAgain(
  { sheetId, behindAsOf, dayAwaitedSinceTry }: Pick<OwnFilterBar, 'sheetId' | 'behindAsOf' | 'dayAwaitedSinceTry'>,
  onLookAgain: (sheetId: SheetId) => void,
): void {
  let behindSinceRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (behindAsOf === null) {
      behindSinceRef.current = null;
      return;
    }
    behindSinceRef.current ??= performance.now();
    let timer = setTimeout(
      () => {
        behindSinceRef.current = null;
        onLookAgain(sheetId);
      },
      lookAgainDelay(performance.now() - behindSinceRef.current),
    );
    return () => clearTimeout(timer);
  }, [sheetId, behindAsOf, onLookAgain]);
  React.useEffect(() => {
    if (dayAwaitedSinceTry === null) return;
    let timer = setTimeout(() => onLookAgain(sheetId), LOOK_AGAIN_MAX_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sheetId, dayAwaitedSinceTry, onLookAgain]);
}
export const OWN_FILTER_BUTTON_SELECTOR = '.sheet-own-filter-button';
export const isEventInsideCurrentTarget = ({ currentTarget, target }: Pick<React.SyntheticEvent<Element>, 'currentTarget' | 'target'>): boolean =>
  target instanceof Node && currentTarget.contains(target);
export const SORT_FILTER_COLLISION_AVOIDANCE: PopoverPopupProps['collisionAvoidance'] = {
  side: 'none',
  align: 'shift',
  fallbackAxisSide: 'none',
};
export const isElementFocused = (element: Element): boolean =>
  element.ownerDocument.activeElement === element && element.ownerDocument.hasFocus();
export const isFilterBarAskOpen = (sheetView: Pick<PageView, 'rowsAskedFor' | 'tableThatFilterBarAddsTo'>): boolean =>
  sheetView.rowsAskedFor?.isOfFilterBar === true && (sheetView.tableThatFilterBarAddsTo !== null || sheetView.rowsAskedFor.isFilterNotDrawnYet);
export const openerOwedOrOtherwise = (caretReturn: CaretReturn): CaretTarget =>
  caretReturn.otherwise !== false && caretReturn.owed?.presses === caretReturn.pressesNow && caretReturn.owed.opener !== null
    ? caretReturn.owed.opener
    : caretReturn.otherwise;
export const whatHasCaretAfterOwnFilterCard = (
  sheetView: Pick<PageView, 'ownFilterBar' | 'ownFilterList'>,
  caretMemory: CaretMemoryOfFilterCard,
): CaretTarget =>
  openerOwedOrOtherwise({
    owed: sheetView.ownFilterBar === null ? null : caretMemory.owedAfterBack,
    pressesNow: caretMemory.pressesNow,
    otherwise: sheetView.ownFilterList === null && caretMemory.afterMenu(),
  });
export const nextRefreshOfferSeen = (seen: RefreshOfferSeen, sheetId: SheetId, isOffered: boolean): RefreshOfferSeen =>
  seen.sheetId === sheetId && seen.isOffered === isOffered
    ? seen
    : {
        sheetId,
        isOffered,
        hasComeInView: isOffered && seen.sheetId === sheetId,
      };
export const nonBreakingExceptAfterCommas = (words: string): string => words.replace(/(?<!,) /g, ' ');
export const isClickRightAfterCrossPress = (crossPressed: CrossPress | null, click: CrossPress): boolean =>
  crossPressed !== null &&
  click.timeStamp - crossPressed.timeStamp < 1000 &&
  Math.hypot(click.clientX - crossPressed.clientX, click.clientY - crossPressed.clientY) < 24;
export const FILTER_LINE_PRESS_WINDOW_MS = 1500;
export const OwnFilterBarView = React.memo(function ({
  bar,
  cardToAdd,
  whatHasCaretAfterCard,
  onColumnAsked,
  columnOpen,
  timesPressed,
  onLineRemoved,
  onSortRemoved,
  onSortMadeForEveryone,
  actsOnNamedViews,
  onRefreshed,
  onCleared,
  onLookAgain,
  onGoingWithCaret,
  onKeyDown,
  className,
  style,
  ref,
}: OwnFilterBarViewProps) {
  let crossPressWordsRef = React.useRef<{ words: string; atMs: number } | null>(null);
  let crossPressedRef = React.useRef<CrossPress | null>(null);
  let caretGoesOnRef = React.useCallback(
    (button: HTMLElement) =>
      () => {
        if (isElementFocused(button)) onGoingWithCaret();
      },
    [onGoingWithCaret],
  );
  useOwnFilterLookAgain(bar, onLookAgain);
  let forYouOnlyId = React.useId();
  let {
    sheetId,
    isNothingAsked,
    records,
    cellsBesideOutOfView,
    isRefreshOffered,
  } = bar;
  let hasCounts = isNothingAsked || records !== null || cellsBesideOutOfView !== '';
  let isFilterTried = cardToAdd?.card?.isFilterTried === true;
  let [linesKept, setLinesKept] = React.useState(bar.lines);
  if (!isFilterTried && linesKept !== bar.lines) setLinesKept(bar.lines);
  let lines = isFilterTried ? linesKept : bar.lines;
  let [namedViewsKept, setNamedViewsKept] = React.useState(bar.namedViews);
  if (!isFilterTried && namedViewsKept !== bar.namedViews) setNamedViewsKept(bar.namedViews);
  let namedViews = isFilterTried ? namedViewsKept : bar.namedViews;
  let { sort } = bar;
  let sortShown =
    sort === null
      ? null
      : {
          ...sort,
          words: sortedByWords(sort.said),
        };
  let chips: FilterBarChip[] = [
    ...(sortShown === null
      ? []
      : [
          {
            ...sortShown,
            key: 'sort',
            words: [
              {
                setApart: sortShown.words,
              },
            ],
            edit: editSortLabel(sortShown.words),
            onRemoved: () => onSortRemoved(sortShown.tableKey),
          },
        ]),
    ...lines.map(({ tableKey, lineIndex, line, c }) => {
      let lineWords = describeFilterLineAlternatives(line);
      return {
        key: `${tableKey} ${lineIndex}`,
        tableKey,
        c,
        words: lineWords,
        edit: editFilterLineLabel(joinMessageParts(lineWords)),
        onRemoved: () => onLineRemoved(tableKey, lineIndex),
      };
    }),
  ];
  let [refreshSeen, setRefreshSeen] = React.useState<RefreshOfferSeen>({
    sheetId,
    isOffered: isRefreshOffered,
    hasComeInView: false,
  });
  let refreshNow = nextRefreshOfferSeen(refreshSeen, sheetId, isRefreshOffered);
  if (refreshNow !== refreshSeen) setRefreshSeen(refreshNow);
  return <fieldset ref={ref} aria-label={sort === null ? filterMessages.filter() : sortMessages.bar(!isNothingAsked)} aria-describedby={forYouOnlyId} className={`sheet-own-filter-bar ${className}`} style={style}><ContentsBox onMouseDown={(mouseEvent: React.MouseEvent) => {
        if (isEventInsideCurrentTarget(mouseEvent)) preventMouseDownDefault(mouseEvent);
      }} onKeyDown={(keyEvent: React.KeyboardEvent) => {
        if (isEventInsideCurrentTarget(keyEvent)) onKeyDown(keyEvent);
      }}><div className="sheet-own-filter-parts"><span className="sheet-own-filter-glyph"><Icon name="FilterLines" customSize={14} /></span><div className="sheet-own-filter-asked">{chips.length > 0 &&
                (<ul className="sheet-own-filter-lines scroll-fade-x">{chips.map(
                    ({ key, tableKey, words, c, edit, onRemoved }) =>
                      (<li key={key} className="sheet-own-filter-line rounded-chip bg-tint-blue text-caption font-medium text-accent">{c === null
                              ? <OverflowTooltip className="sheet-own-filter-line-words min-w-0"><WordsWithColumnNames words={words} /></OverflowTooltip>
                              : <button type="button" className="sheet-own-filter-line-edit outline-none focus-visible:shadow-focus focus-visible:outline-hidden" aria-haspopup="dialog" aria-expanded={columnOpen?.tableKey === tableKey && columnOpen.c === c} aria-label={edit} onClick={({ currentTarget }) => onColumnAsked(tableKey, c, currentTarget)}><OverflowTooltip className="sheet-own-filter-line-words min-w-0"><WordsWithColumnNames words={words} /></OverflowTooltip></button>}<Button ref={caretGoesOnRef} variant="ghost" size="xxs" iconOnly icon={<Icon name="X" size="xs" />} className="sheet-own-filter-line-remove" aria-label={removeFilterLineLabel(joinMessageParts(words))} onPointerDown={({ clientX, clientY, timeStamp }) => {
                                crossPressWordsRef.current = {
                                  words: joinMessageParts(words),
                                  atMs: timeStamp,
                                };
                                crossPressedRef.current = {
                                  clientX,
                                  clientY,
                                  timeStamp,
                                };
                              }} onClick={({ timeStamp }) => {
                                let crossPress = crossPressWordsRef.current;
                                crossPressWordsRef.current = null;
                                if (
                                  !(crossPress !== null && timeStamp - crossPress.atMs < FILTER_LINE_PRESS_WINDOW_MS) ||
                                  crossPress.words === joinMessageParts(words)
                                )
                                  onRemoved();
                              }} /></li>),
                  )}</ul>)}{cardToAdd !== null &&
                <div className="sheet-own-filter-acts"><SortFilterCardPopover cardToAdd={cardToAdd} onColumnAsked={onColumnAsked} whatHasCaretAfterCard={whatHasCaretAfterCard} timesPressed={timesPressed} crossPressed={crossPressedRef} /></div>}{hasCounts &&
                (<ul className="sheet-own-filter-said">{isNothingAsked &&
                      <li className="sheet-listed-row sheet-own-filter-count">{filterMessages.allRows()}</li>}{records !== null &&
                      <li className="sheet-listed-row sheet-own-filter-count tabular-nums">{rowsInViewOfAllText(records)}</li>}{cellsBesideOutOfView !== '' &&
                      <li className="sheet-listed-row">{nonBreakingExceptAfterCommas(alsoHidesCellsText(cellsBesideOutOfView))}</li>}</ul>)}</div><span id={forYouOnlyId} className="sheet-own-filter-for-whom"><span><Icon name="Lock" size="xs" />{sort === null ? filterMessages.filteredForYouOnly() : sortMessages.forYouOnly(!isNothingAsked)}</span></span>{namedViews !== null &&
            <NamedViewsMenu key={namedViews.tableKey} views={namedViews} {...actsOnNamedViews} />}<TooltipGroup>{isRefreshOffered &&
                (<Tooltip content={sort === null ? filterMessages.refreshFilter() : sortMessages.refresh(!isNothingAsked)}><Button ref={caretGoesOnRef} variant="primary" size="xs" className="sheet-own-filter-refresh" data-has-come-in-view={refreshNow.hasComeInView ? '' : undefined} onAnimationEnd={({ target, currentTarget }) => {
                      if (target === currentTarget)
                        setRefreshSeen({
                          ...refreshNow,
                          hasComeInView: false,
                        });
                    }} onClick={() => onRefreshed(sheetId)}>{filterMessages.refresh()}</Button></Tooltip>)}{sort?.canBeForEveryone === true &&
                onSortMadeForEveryone !== null &&
                (<Tooltip content={sortMessages.whatSortForEveryoneDoes()}><Button ref={caretGoesOnRef} variant="ghost" size="xs" className="text-accent" onClick={(clickEvent) => {
                      if (!isClickRightAfterCrossPress(crossPressedRef.current, clickEvent)) onSortMadeForEveryone(sort.tableKey);
                    }}>{sortMessages.sortForEveryone()}</Button></Tooltip>)}</TooltipGroup><Button ref={caretGoesOnRef} variant="ghost" size="xs" flush="both" className="text-accent" aria-label={sort === null ? filterMessages.clearAllFilters() : sortMessages.clearAll(!isNothingAsked)} onClick={(clickEvent) => {
              if (!isClickRightAfterCrossPress(crossPressedRef.current, clickEvent)) onCleared(sheetId);
            }}>{filterMessages.clearAll()}</Button></div></ContentsBox></fieldset>;
});
