import { Popover } from '../kit/popover.tsx';
import { MENU_GROUP_LABEL_CLASSES, MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES, Menu, menuItemVariants } from '../kit/menu.tsx';
import { useUiWindow } from '../kit/theme.tsx';
import { OverflowTooltip } from '../kit/tooltip.tsx';
import type { TooltipSide } from '../kit/tooltip.tsx';
import { Icon, LeadingIcon } from '../kit/icon.tsx';
import * as React from 'react';
import type { Color } from '@open-artifact/sheets-core';
import type { PopoverPopupProps } from '../kit/popover.tsx';
import type { PopupCollisionPadding } from '../shell/bottom-insets.ts';
import type { ListCardDrawn, ListCardRowLabel, ListCardSwatch } from '../chips/dropdowns.ts';
import type { AnchorOnPage, ListboxIds } from '../chips/people-list-view.tsx';
import type { PointerPoint } from '../formulas/from-words/offer-list.tsx';
import type { IconName, LeadingIconProps } from '../kit/icon.tsx';
import { pushTopLayerClose } from '../shell/top-layer-close.ts';
import { editCardHeadingLabel, deleteCardHeadingLabel, currentColorLabel, cardAndRowLabel } from '../i18n/menu-labels.ts';
import { useCoveredUnderCells, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { cachedOptionChipColors, setSwatchColors } from '../format/cell-colors.ts';
import { fillPaintStyle, textPaintStyle } from '../grid/cell-drawing.tsx';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import { dropdownPaneMessages } from '../i18n/format-labels.ts';
import { optionColorName } from '../i18n/chip-labels.ts';
import { useCoarsePointer } from '../app/media-queries.ts';
/** A press on a list under a cell: when it went down and came up, whether rows were coming, and when the acts before it were. */
export interface PressOnList {
  downAtMs: number;
  wereRowsComing: boolean;
  upAtMs: number | null;
  actBeforeAtMs: number | null;
  actBeforeBeganAtMs: number | null;
}
/** A click on a list under a cell, and when the acts before it were. */
export interface ClickOnList {
  atMs: number;
  actBeforeAtMs: number | null;
  actBeforeBeganAtMs: number | null;
}
/** The rows of a list under a cell as a click on them is judged: when they came, whether more are coming, and whether they end quietly. */
export interface RowsOfListClicked {
  cameAtMs: number;
  areComing: boolean;
  doesQuietEnd: boolean;
}
/** When an answer was shown in a list, and when the user last acted on it. */
export interface ListAnswerTimes {
  answerShownAtMs: number;
  lastActAtMs: number;
}
/** A press outside a list under a cell, as the list weighs whether it shuts. */
export interface PressOutsideList {
  isClick: boolean;
  isInCard: boolean;
  didPressBeginInListOrCard: boolean;
}
/** What tells whether focus stays on a row of a list, as it does on iOS. */
export interface RowFocusOnIos {
  isWebKitOfIos: boolean;
  isRow: boolean;
  isPressUnderWay: boolean;
  isEntryOpen: boolean;
}
/** The aria attributes of a field that a list under a cell pops up from. */
export interface ComboboxAriaProps {
  role?: 'combobox';
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'listbox';
  'aria-autocomplete'?: 'list';
  'aria-controls'?: string;
  'aria-activedescendant'?: string;
}
/** What a hover on the rows of a list does to the card on them. */
export interface ListCardHoverWatch {
  rowsListed: string | null;
  isOpen: boolean;
  onAsked: (ofRow: string) => void;
  onShut: () => void;
  isKeptOpen?: () => boolean;
}
/** What the rows of a list tell the card on them as the pointer moves over them. */
export interface ListCardHover {
  overOpener: (row: string) => void;
  offOpener: () => void;
  overOtherRow: () => void;
  overCard: () => void;
  rowsScrolled: (row: Element | null) => void;
}
/** Where a list's card sits against the list: beside it or under it, and how far from the edges. */
export type ListCardSide = Pick<PopoverPopupProps, 'side' | 'align' | 'collisionAvoidance' | 'collisionPadding'>;
/** How big the rows of a list are drawn: large under a coarse pointer. */
export type ListRowSize = 'lg' | undefined;
/** The cell a list was opened for, and since when. */
interface ListOpenedFor {
  ofCell: string | null;
  sinceMs: number;
}
/** What the rows of a list are, and since when they have been drawn. */
interface ListRowsSince {
  are: string | undefined;
  sinceMs: number;
}
export interface ListRowsBoxProps {
  ref: React.Ref<HTMLDivElement>;
  id: string;
  label: string;
  sizeOfRows: ListRowSize;
  doHeadingsStayInSight: boolean;
  leastHeightOfRows: string | undefined;
  mostHeightOfRows: string | undefined;
  foot: React.ReactNode;
  under: React.ReactNode;
  onScroll: React.UIEventHandler<HTMLDivElement> | undefined;
  onAllScrolled: React.UIEventHandler<HTMLDivElement> | undefined;
  children: React.ReactNode;
}
export interface ListUnderCellProps {
  id: string;
  isOpen: boolean;
  anchor: AnchorOnPage;
  cellElementId: string | null;
  label: string;
  className: string;
  isMovedOnlyAsFarAsNeeded?: boolean;
  onShut: (event: Event) => void;
  canBeShut?: boolean;
  foot?: React.ReactNode;
  under?: React.ReactNode;
  leastHeightOfRows?: string;
  mostHeightOfRows?: string;
  doHeadingsStayInSight?: boolean;
  onRowsScrolled?: (rowsElement: Element) => void;
  onRoomBesideMeasured?: (hasRoomBeside: boolean) => void;
  onPointerInOrOut?: (isIn: boolean) => void;
  hasRows?: boolean;
  /** What the rows are, as a stamp that changes when other rows come. */
  rowsAre?: string;
  doesQuietEnd?: boolean;
  areRowsComing?: boolean;
  onClickDropped?: () => void;
  onPressJudged?: (isPressGuarded: boolean) => void;
  onPressLetGo?: () => void;
  children: React.ReactNode;
}
export interface ListRowProps {
  id: string;
  name?: string;
  placeInList: number;
  rowsInList: number;
  isHighlighted: boolean;
  hasCardOpen?: boolean;
  tellsOfEveryMove?: boolean;
  onChosen: (() => void) | null;
  isEveryClickHeard?: boolean;
  onPointedAt?: () => void;
  isOnlyTintedByPointer?: boolean;
  onPointerLeave?: () => void;
  children: React.ReactNode;
}
export interface ListRowTooltipProps {
  className: string;
  dir?: string;
  children: React.ReactNode;
}
export interface ListCardProps {
  listId: string;
  label: string | undefined;
  rowId: string;
  cell: AnchorOnPage;
  isBeside: boolean;
  head?: React.ReactNode;
  onPointerInOrOut?: (isIn: boolean) => void;
  children: React.ReactNode;
}
export interface OptionsListCardProps extends Omit<ListCardProps, 'children'> {
  card: ListCardDrawn;
  lead?: React.ReactNode;
  onRowChosen: (rowKey: string) => void;
  onRowPointedAt: () => void;
}
export interface OptionColorSwatchProps {
  color: Color;
}
export interface PlainListBoxProps {
  id: string;
  label: string;
  children: React.ReactNode;
}
/** The lead of a row: an icon or an element, or an icon drawn quietly. */
export type ListRowLeadProps = Pick<LeadingIconProps, 'icon'> | { icon: IconName; isQuiet: boolean };
export interface ListRowLabelProps {
  children: React.ReactNode;
}
export interface ListRowQuietTextProps {
  isKey?: boolean;
  children: React.ReactNode;
}
export interface ListRowSwatchesProps {
  marks: readonly ListCardSwatch[];
}
export interface ListHeadingProps {
  children: React.ReactNode;
}
export interface ListGroupProps {
  headingId: string;
  heading: React.ReactNode;
  doesHeadingStayInSight?: boolean;
  children: React.ReactNode;
}
export interface ListRowCaretProps {
  isCardBeside: boolean;
}
export let lastPointerPoint: PointerPoint;
export let didPressBeginInListUnderCell: boolean;
export let scrollTopUnderListCard: number | null;
export let rowNotToScrollIntoView: Element | null;
export function reportTimeAfterNextPaint(win: Window | undefined, report: (atMs: number) => void): () => void {
  if (win === undefined) {
    report(performance.now());
    return () => {};
  }
  let isPending = true;
  let reportNow = () => {
    if (isPending) report(win.performance.now());
    isPending = false;
  };
  report(Number.POSITIVE_INFINITY);
  let timeoutId: number | undefined;
  let frameId = win.requestAnimationFrame(() => {
    timeoutId = win.setTimeout(reportNow);
  });
  return () => {
    win.cancelAnimationFrame(frameId);
    win.clearTimeout(timeoutId);
    reportNow();
  };
}
export function useTopLayerClose(isOpen: boolean, close: () => void): void {
  let closeRef = React.useRef(close);
  React.useLayoutEffect(() => {
    closeRef.current = close;
  });
  React.useEffect(() => (isOpen ? pushTopLayerClose(() => closeRef.current()) : undefined), [isOpen]);
}
export function useLastNonNull<T>(value: T | null): T | null {
  let [lastNonNull, setLastNonNull] = React.useState(value);
  if (value !== null && value !== lastNonNull) setLastNonNull(value);
  return value ?? lastNonNull;
}
export function listAnnouncement(list: ListCardDrawn | null): string | null {
  let highlightedRow = list?.rows[list.highlightedRow ?? -1];
  let headingWords = list?.heading !== undefined && list.isAsOpened === true ? editCardHeadingLabel(list.heading) : null;
  if (list === null || highlightedRow === undefined) return headingWords;
  let rowLabel = optionLabelText(highlightedRow.label);
  let isChosenColor = highlightedRow.isChosen && colorOfferedOf(highlightedRow.label) !== null;
  let rowWords =
    isRemovingOption(highlightedRow.label) && list.heading !== undefined
      ? deleteCardHeadingLabel(list.heading)
      : isChosenColor
        ? currentColorLabel(rowLabel)
        : rowLabel;
  return headingWords === null ? rowWords : cardAndRowLabel(headingWords, rowWords);
}
export function roomForListRows(anchorRect: Pick<DOMRect, 'top' | 'bottom'>, windowHeight: number): number {
  let roomBelow = windowHeight - anchorRect.bottom - LIST_SIDE_OFFSET - LIST_EDGE_PADDING;
  let roomAbove = anchorRect.top - LIST_SIDE_OFFSET - LIST_EDGE_PADDING;
  return roomBelow >= LIST_MIN_ROOM_BELOW ? roomBelow : Math.max(roomBelow, roomAbove);
}
export function shouldDropListClick(rows: RowsOfListClicked, press: PressOnList | null, click: ClickOnList): boolean {
  let isPressCounting = isPressStillCounting(click.atMs, press);
  let { actBeforeAtMs, actBeforeBeganAtMs } = isPressCounting ? press! : click;
  let judged = isPressCounting
    ? {
        atMs: press!.downAtMs,
        wereRowsComing: press!.wereRowsComing,
      }
    : {
        atMs: click.atMs,
        wereRowsComing: rows.areComing,
      };
  let lastActAtMs = actBeforeAtMs ?? Number.NEGATIVE_INFINITY;
  let isTooSoonAfterAct = !rows.doesQuietEnd && judged.atMs - (actBeforeBeganAtMs ?? Number.NEGATIVE_INFINITY) < LIST_ACT_GAP_MS;
  return (
    judged.wereRowsComing ||
    isTooSoonAfterListAnswer(
      {
        answerShownAtMs: rows.cameAtMs,
        lastActAtMs,
      },
      judged.atMs,
    ) ||
    isTooSoonAfterAct
  );
}
export function hasRoomForCardBesideList(listRect: Pick<DOMRect, 'left' | 'right'>, windowWidth: number): boolean {
  let roomNeeded = LIST_CARD_BESIDE_GAP + LIST_CARD_BESIDE_WIDTH + LIST_EDGE_PADDING;
  return listRect.right + roomNeeded <= windowWidth || listRect.left >= roomNeeded;
}
export function watchAncestorStyles(element: Element, onStyleChange: () => void): () => void {
  let ownerDocument = element.ownerDocument;
  let observer = ownerDocument.defaultView === null ? null : new ownerDocument.defaultView.MutationObserver(onStyleChange);
  for (let ancestor = element.parentElement; ancestor !== null && ancestor !== ownerDocument.body; ancestor = ancestor.parentElement)
    observer?.observe(ancestor, {
      attributes: true,
      attributeFilter: ['style'],
    });
  return () => observer?.disconnect();
}
export function ListRowsBox({
  ref,
  id,
  label,
  sizeOfRows,
  doHeadingsStayInSight,
  leastHeightOfRows,
  mostHeightOfRows,
  foot,
  under,
  onScroll,
  onAllScrolled,
  children,
}: ListRowsBoxProps) {
  let { className: rowsClassName } = doHeadingsStayInSight ? listRowsWithStickyHeadingsProps : listRowsScrollProps;
  if (under !== undefined)
    return <div data-holds-list-box data-size={sizeOfRows} className="flex min-h-0 flex-col overflow-y-auto" onScroll={onAllScrolled} style={{
        maxHeight: 'var(--sheet-room-for-rows)',
      }}><div ref={ref} id={id} role="listbox" aria-label={label} className={rowsClassName} data-rows-that-scroll onScroll={onScroll} tabIndex={-1} style={{
            minHeight: leastHeightOfRows,
            maxHeight: mostHeightOfRows,
          }}>{children}</div>{under}</div>;
  if (foot === undefined || foot === null || foot === false)
    return <div ref={ref} id={id} role="listbox" aria-label={label} data-size={sizeOfRows} className={rowsClassName} data-rows-that-scroll onScroll={onScroll} tabIndex={-1} style={{
        maxHeight:
          mostHeightOfRows === undefined ? 'var(--sheet-room-for-rows)' : `min(var(--sheet-room-for-rows, ${mostHeightOfRows}), ${mostHeightOfRows})`,
      }}>{children}</div>;
  return <div ref={ref} id={id} role="listbox" aria-label={label} data-size={sizeOfRows} className="flex min-h-0 flex-col" style={{
      maxHeight: 'var(--sheet-room-for-rows)',
    }}><div role="presentation" className={rowsClassName} data-rows-that-scroll onScroll={onScroll} style={{
          maxHeight: mostHeightOfRows,
        }}>{children}</div>{foot}</div>;
}
export function ListUnderCell({
  id,
  isOpen,
  anchor,
  cellElementId,
  label,
  className,
  isMovedOnlyAsFarAsNeeded = false,
  onShut,
  canBeShut = true,
  foot,
  under,
  leastHeightOfRows,
  mostHeightOfRows,
  doHeadingsStayInSight = false,
  onRowsScrolled,
  onRoomBesideMeasured,
  onPointerInOrOut,
  hasRows = true,
  rowsAre,
  doesQuietEnd = false,
  areRowsComing = false,
  onClickDropped,
  onPressJudged,
  onPressLetGo,
  children,
}: ListUnderCellProps) {
  let [roomForRows, setRoomForRows] = React.useState<number | null>(null);
  let coveredAtFoot = useCoveredUnderCells();
  let rowSize = listRowSize();
  let shutOnBack = React.useCallback(() => onShut(new Event('back')), [onShut]);
  useTopLayerClose(isOpen && canBeShut, shutOnBack);
  let openedForRef = React.useRef<ListOpenedFor>({
    ofCell: null,
    sinceMs: 0,
  });
  let pressGuardStartRef = React.useRef<number | null>(null);
  let pointersDownRef = React.useRef(new Set<number>());
  React.useLayoutEffect(() => {
    let openForCell = isOpen && hasRows ? cellElementId : null;
    if (openForCell === openedForRef.current.ofCell) return;
    openedForRef.current = {
      ofCell: openForCell,
      sinceMs: performance.now(),
    };
    pressGuardStartRef.current = null;
    pointersDownRef.current.clear();
  }, [isOpen, hasRows, cellElementId]);
  let rowsAreSinceRef = React.useRef<ListRowsSince>({
    are: rowsAre,
    sinceMs: 0,
  });
  let win = useUiWindow();
  React.useLayoutEffect(() => {
    if (rowsAre === rowsAreSinceRef.current.are) return;
    return reportTimeAfterNextPaint(win, (atMs) => {
      rowsAreSinceRef.current = {
        are: rowsAre,
        sinceMs: atMs,
      };
    });
  }, [rowsAre, win]);
  let pressRef = React.useRef<PressOnList | null>(null);
  let lastActAtRef = React.useRef<number | null>(null);
  let lastActBeganAtRef = React.useRef<number | null>(null);
  let measureRowsBox = React.useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      let ownerDocument = element.ownerDocument;
      let pageWindow = ownerDocument.defaultView;
      let measureRoomBeside = () => {
        let cardRect = listBoxFrameOf(element)?.getBoundingClientRect();
        if (cardRect !== undefined) onRoomBesideMeasured?.(hasRoomForCardBesideList(cardRect, ownerDocument.documentElement.clientWidth));
      };
      let tellsRoomBeside = onRoomBesideMeasured !== undefined;
      let measureRoom = () => {
        setRoomForRows(roomForListRows(anchor.getBoundingClientRect(), ownerDocument.documentElement.clientHeight - coveredAtFoot));
        if (tellsRoomBeside) measureRoomBeside();
      };
      measureRoom();
      let stopWatchingStyles = tellsRoomBeside ? watchAncestorStyles(element, measureRoomBeside) : null;
      pageWindow?.addEventListener('resize', measureRoom);
      return () => {
        stopWatchingStyles?.();
        pageWindow?.removeEventListener('resize', measureRoom);
      };
    },
    [anchor, onRoomBesideMeasured, coveredAtFoot],
  );
  let roomStyle: StyleWithVariables | undefined =
    roomForRows === null
      ? undefined
      : {
          '--sheet-room-for-rows': `calc(${String(roomForRows)}px - 2 * var(--ui-pad-xs))`,
        };
  return withListTabStops(
    <Popover.Root open={isOpen} onOpenChange={(open, { event }) => {
        let target = 'relatedTarget' in event && event.relatedTarget !== null ? event.relatedTarget : event.target;
        let targetNode = target instanceof Node ? target : null;
        let card = listBoxFrameOf(targetNode?.ownerDocument?.getElementById(listCardIdOf(id)) ?? null);
        let isInCard = targetNode !== null && card?.contains(targetNode) === true;
        let outsidePress = {
          isClick: event.type === 'click',
          isInCard,
          didPressBeginInListOrCard: didPressBeginInListUnderCell,
        };
        if (!open && shouldShutListOnOutside(outsidePress)) onShut(event);
      }}><Popover.Popup anchor={anchor} side="bottom" align="start" {...(isMovedOnlyAsFarAsNeeded && {
          collisionAvoidance: SHIFT_ONLY_COLLISION,
        })} sideOffset={LIST_SIDE_OFFSET} collisionPadding={popupCollisionPadding(coveredAtFoot)} padding="xs" scrollFade={false} initialFocus={false} finalFocus={false} keepFocus role="presentation" data-list-under-cell className={`flex flex-col ${className}`} style={roomStyle} onPointerEnter={() => onPointerInOrOut?.(true)} onPointerLeave={({ pointerId }) => {
          pointersDownRef.current.delete(pointerId);
          onPointerInOrOut?.(false);
        }} onPointerDownCapture={({ isPrimary, button, pointerId }) => {
          let nowMs = performance.now();
          pointersDownRef.current.add(pointerId);
          let isPressGuarded = (!isOpen || hasRows) && isWithinPressGuard(openedForRef.current.sinceMs, nowMs);
          pressGuardStartRef.current = isPressGuarded ? nowMs : null;
          onPressJudged?.(isPressGuarded);
          let lastActAtMs = lastActAtRef.current;
          let lastActBeganAtMs = lastActBeganAtRef.current;
          lastActAtRef.current = nowMs;
          lastActBeganAtRef.current = nowMs;
          if (!isPrimary || button !== 0) return;
          pressRef.current = {
            downAtMs: nowMs,
            wereRowsComing: areRowsComing,
            upAtMs: null,
            actBeforeAtMs: lastActAtMs,
            actBeforeBeganAtMs: lastActBeganAtMs,
          };
        }} onPointerCancelCapture={({ pointerId }) => {
          pointersDownRef.current.delete(pointerId);
          pressRef.current = null;
        }} onPointerUpCapture={({ isPrimary, button, pointerId }) => {
          let nowMs = performance.now();
          lastActAtRef.current = nowMs;
          if (!pointersDownRef.current.delete(pointerId)) lastActBeganAtRef.current = nowMs;
          onPressLetGo?.();
          if (isPrimary && button === 0 && pressRef.current !== null)
            pressRef.current = {
              ...pressRef.current,
              upAtMs: nowMs,
            };
        }} onClickCapture={(event) => {
          let pressGuardStart = pressGuardStartRef.current;
          pressGuardStartRef.current = null;
          let press = pressRef.current;
          pressRef.current = null;
          let nowMs = performance.now();
          if (pressGuardStart !== null && isWithinClickAfterUp(pressGuardStart, nowMs)) {
            event.stopPropagation();
            onShut(event.nativeEvent);
            return;
          }
          let actBeforeAtMs = lastActAtRef.current;
          let actBeforeBeganAtMs = lastActBeganAtRef.current;
          if (!isPressStillCounting(nowMs, press)) {
            lastActAtRef.current = nowMs;
            lastActBeganAtRef.current = nowMs;
          }
          let rows = {
            cameAtMs: rowsAreSinceRef.current.sinceMs,
            areComing: areRowsComing,
            doesQuietEnd,
          };
          if (
            rowsAre !== undefined &&
            shouldDropListClick(rows, press, {
              atMs: nowMs,
              actBeforeAtMs,
              actBeforeBeganAtMs,
            })
          ) {
            event.stopPropagation();
            onClickDropped?.();
          }
        }}><ListRowsBox ref={measureRowsBox} id={id} label={label} sizeOfRows={rowSize} doHeadingsStayInSight={doHeadingsStayInSight} leastHeightOfRows={leastHeightOfRows} mostHeightOfRows={mostHeightOfRows} foot={foot} under={under} onScroll={onRowsScrolled === undefined
              ? undefined
              : ({ currentTarget }: React.UIEvent<HTMLDivElement>) => {
                  if (hasListScrolledSinceCard(currentTarget.scrollTop)) onRowsScrolled(currentTarget);
                }} onAllScrolled={onRowsScrolled === undefined ? undefined : ({ currentTarget }: React.UIEvent<HTMLDivElement>) => onRowsScrolled(currentTarget)}>{children}</ListRowsBox></Popover.Popup></Popover.Root>,
  );
}
export function notePointerMove({ clientX, clientY }: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
  lastPointerPoint = {
    x: clientX,
    y: clientY,
    isWhereItWas: clientX === lastPointerPoint.x && clientY === lastPointerPoint.y,
  };
}
export function notePressStart({ target }: Pick<Event, 'target'>): void {
  didPressBeginInListUnderCell = target instanceof Element && isInListUnderCell(target);
}
export function cancelListHoverTimers(): void {
  for (let cancelTimer of listHoverTimerCancelers) cancelTimer();
}
export function shutListCardsOnResize(): void {
  for (let shutCard of listCardShutters) shutCard();
}
export function listenForListUnderCellEvents(element: Element | null): (() => void) | undefined {
  let win = element?.ownerDocument.defaultView ?? null;
  if (win === null) return;
  win.addEventListener('pointermove', notePointerMove, true);
  win.addEventListener('pointerdown', notePressStart, true);
  win.addEventListener('keydown', cancelListHoverTimers, true);
  win.addEventListener('resize', shutListCardsOnResize);
  return () => {
    win.removeEventListener('pointermove', notePointerMove, true);
    win.removeEventListener('pointerdown', notePressStart, true);
    win.removeEventListener('keydown', cancelListHoverTimers, true);
    win.removeEventListener('resize', shutListCardsOnResize);
  };
}
export function noteScrollTopUnderListCard(scrollTop: number | null): void {
  scrollTopUnderListCard = scrollTop;
}
export function keepRowFromScrollingIntoView(row: Element | null): void {
  rowNotToScrollIntoView = row;
}
export function scrollHighlightedRowIntoView(row: Element | null): void {
  if (row === null) return;
  let isSpared = row === rowNotToScrollIntoView;
  rowNotToScrollIntoView = null;
  if (!isSpared)
    row.scrollIntoView({
      block: 'nearest',
    });
}
export function ListRow({
  id,
  name,
  placeInList,
  rowsInList,
  isHighlighted,
  hasCardOpen = false,
  tellsOfEveryMove = false,
  onChosen,
  isEveryClickHeard = false,
  onPointedAt,
  isOnlyTintedByPointer = onPointedAt === undefined,
  onPointerLeave,
  children,
}: ListRowProps) {
  return <button ref={isHighlighted ? scrollHighlightedRowIntoView : undefined} type="button" role="option" id={id} aria-label={name} aria-posinset={placeInList} aria-setsize={rowsInList} aria-selected={isHighlighted} aria-disabled={onChosen === null || undefined} tabIndex={-1} className={isOnlyTintedByPointer && onChosen !== null ? `${LIST_ROW_CLASS} hover:bg-fill-ghost-hover` : LIST_ROW_CLASS} data-highlighted={isHighlighted || undefined} data-popup-open={hasCardOpen || undefined} onPointerMove={(isHighlighted && !tellsOfEveryMove) || onPointedAt === undefined ? undefined : highlightRowOnPointerMove(onPointedAt, !isOnlyTintedByPointer)} onPointerLeave={onPointerLeave} onClick={({ detail }) => {
      if (detail <= 1 || isEveryClickHeard) onChosen?.();
    }}>{children}</button>;
}
export function ListRowTooltip({ className, dir, children }: ListRowTooltipProps) {
  let anchorRef = React.useRef<HTMLSpanElement>(null);
  return <OverflowTooltip ref={anchorRef} side="right" sideOffset={({ side }: { side: TooltipSide }) => {
      let rowRect = anchorRef.current?.getBoundingClientRect();
      let listRect = anchorRef.current?.closest('[role="menu"], [role="listbox"]')?.getBoundingClientRect();
      if (rowRect === undefined || listRect === undefined) return 4;
      if (side === 'right') return 8 + listRect.right - rowRect.right;
      return side === 'left' ? 8 + rowRect.left - listRect.left : 4;
    }} dir={dir} className={className}>{children}</OverflowTooltip>;
}
export function useListCardHover({
  rowsListed,
  isOpen,
  onAsked,
  onShut,
  isKeptOpen,
}: ListCardHoverWatch): ListCardHover {
  let timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  let setTimer = (delayMs: number | null, then: () => void) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = delayMs === null ? null : setTimeout(then, delayMs);
  };
  let cancelTimer = React.useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  React.useEffect(() => (rowsListed === null ? undefined : cancelTimer), [rowsListed, cancelTimer]);
  React.useEffect(
    () => (listHoverTimerCancelers.add(cancelTimer), () => void listHoverTimerCancelers.delete(cancelTimer)),
    [cancelTimer],
  );
  let shutUnlessKept = React.useCallback(() => {
    if (isKeptOpen?.() !== true) onShut();
  }, [isKeptOpen, onShut]);
  React.useEffect(() => {
    if (!isOpen) return;
    listCardShutters.add(shutUnlessKept);
    return () => void listCardShutters.delete(shutUnlessKept);
  }, [isOpen, shutUnlessKept]);
  useTopLayerClose(isOpen, onShut);
  return {
    overOpener: (row: string) => setTimer(isOpen ? null : LIST_CARD_OPEN_DELAY_MS, () => onAsked(row)),
    offOpener: () => (isOpen ? undefined : setTimer(null, onShut)),
    overOtherRow: () => setTimer(isOpen ? LIST_CARD_SHUT_DELAY_MS : null, shutUnlessKept),
    overCard: () => setTimer(null, onShut),
    rowsScrolled(row: Element | null) {
      keepRowFromScrollingIntoView(row);
      setTimer(null, onShut);
      onShut();
    },
  };
}
export function listCardPadding(
  anchorRect: Pick<DOMRect, 'top'>,
  listRect: Pick<DOMRect, 'top' | 'bottom'>,
  windowHeight: number,
  coveredAtFoot: number,
): PopupCollisionPadding {
  let leastBottom = LIST_EDGE_PADDING + coveredAtFoot;
  return listRect.top >= anchorRect.top
    ? {
        ...LIST_CARD_PADDING,
        top: listRect.top,
        bottom: leastBottom,
      }
    : {
        ...LIST_CARD_PADDING,
        top: LIST_EDGE_PADDING,
        bottom: Math.max(windowHeight - listRect.bottom, leastBottom),
      };
}
export function OptionsListCard({
  listId,
  card,
  lead,
  onRowChosen,
  onRowPointedAt,
  ...cardProps
}: OptionsListCardProps) {
  return <ListCard listId={listId} {...cardProps}>{card.rows.flatMap(
      ({ key, label, marks, isChosen }, rowIndex) => [
        ...(isRemovingOption(label) ? [<ListSeparator key="rule" />] : []),
        (<ListRow key={key} id={listRowIdOf(listId, key)} placeInList={rowIndex + 1} rowsInList={card.rows.length} isHighlighted={rowIndex === card.highlightedRow} tellsOfEveryMove isOnlyTintedByPointer onChosen={() => onRowChosen(key)} onPointedAt={onRowPointedAt}>{optionLead(label) ?? lead}<ListRowLabel>{optionLabelText(label)}</ListRowLabel><ListRowSwatches marks={marks} />{isChosen &&
                <Icon name="Check" size="sm" className="text-accent" />}</ListRow>),
      ],
    )}</ListCard>;
}
export function optionLead(label: ListCardRowLabel): React.ReactNode {
  let color = colorOfferedOf(label);
  if (color !== null)
    return <ListRowLead icon={<OptionColorSwatch color={color} />} />;
  return isRemovingOption(label)
    ? <ListRowLead icon="Trash" />
    : null;
}
export function OptionColorSwatch({ color }: OptionColorSwatchProps) {
  let chipColors = cachedOptionChipColors(color);
  return <span aria-hidden className="sheet-swatch sheet-swatch-of-option flex-none" data-has-fill={color.kind !== 'none' || undefined} style={{
      ...fillPaintStyle(chipColors.fill),
      ...textPaintStyle(chipColors.text),
    }} />;
}
export function ListCard({
  listId,
  label,
  rowId,
  cell,
  isBeside,
  head,
  onPointerInOrOut,
  children,
}: ListCardProps) {
  let coveredAtFoot = useCoveredUnderCells();
  let rowSize = listRowSize();
  let cardRef = React.useRef<HTMLDivElement | null>(null);
  let [padding, setPadding] = React.useState(LIST_CARD_PADDING);
  let attachCard = React.useCallback(
    (element: HTMLDivElement | null) => {
      cardRef.current = element;
      let ownerDocument = element?.ownerDocument;
      let row = ownerDocument?.getElementById(rowId) ?? null;
      if (element === null || ownerDocument === undefined || row === null) return;
      noteScrollTopUnderListCard(row.closest('[data-rows-that-scroll]')?.scrollTop ?? null);
      let fitPadding = () => {
        let listRect = listBoxFrameOf(row)?.getBoundingClientRect();
        if (listRect !== undefined)
          setPadding(listCardPadding(cell.getBoundingClientRect(), listRect, ownerDocument.documentElement.clientHeight, coveredAtFoot));
      };
      fitPadding();
      let stopWatchingRow = watchAncestorStyles(row, fitPadding);
      let stopWatchingCard = watchAncestorStyles(
        element,
        () =>
          element.querySelector('[aria-selected=true]')?.scrollIntoView({
            block: 'nearest',
          }),
      );
      return () => {
        stopWatchingRow();
        stopWatchingCard();
        noteScrollTopUnderListCard(null);
      };
    },
    [cell, rowId, coveredAtFoot],
  );
  let anchor: AnchorOnPage = {
    getBoundingClientRect() {
      let ownerDocument = cardRef.current?.ownerDocument;
      let row = ownerDocument?.getElementById(rowId) ?? null;
      let listBox = listBoxFrameOf(row);
      let win = ownerDocument?.defaultView ?? null;
      if (row === null || listBox === null || win === null) return new DOMRect();
      if (!isBeside) return row.getBoundingClientRect();
      let { left, width } = listBox.getBoundingClientRect();
      let { top, height } = row.getBoundingClientRect();
      let padTop = Number.parseFloat(win.getComputedStyle(listBox).paddingTop);
      return new DOMRect(left, top - padTop, width, height + 2 * padTop);
    },
  };
  return withListTabStops(
    <Popover.Root open><Popover.Popup anchor={anchor} {...listCardSide(isBeside, isBeside ? popupCollisionPadding(coveredAtFoot) : padding)} sideOffset={LIST_CARD_BESIDE_GAP} padding="xs" initialFocus={false} finalFocus={false} keepFocus role="presentation" data-list-under-cell style={{
          width: LIST_CARD_BESIDE_WIDTH,
        }} onPointerEnter={() => onPointerInOrOut?.(true)} onPointerLeave={() => onPointerInOrOut?.(false)}>{head !== undefined &&
            <div data-size={rowSize}>{head}<ListSeparator /></div>}<div ref={attachCard} id={listCardIdOf(listId)} role="listbox" aria-label={label} data-size={rowSize}>{children}</div></Popover.Popup></Popover.Root>,
  );
}
export const PRESS_READY_DELAY_MS = 300;
export const LIST_ACT_GAP_MS = 500;
export const LIST_ANSWER_SETTLE_MS = 1500;
export const NO_LIST_ANSWER_TIMES: ListAnswerTimes = {
  answerShownAtMs: Number.NEGATIVE_INFINITY,
  lastActAtMs: Number.NEGATIVE_INFINITY,
};
export const isTooSoonAfterListAnswer = ({ answerShownAtMs, lastActAtMs }: ListAnswerTimes, atMs: number): boolean =>
  atMs - answerShownAtMs < 300 || (atMs - answerShownAtMs < 1500 && atMs - lastActAtMs < 500);
export const listAnswerSettlesAtMs = ({ answerShownAtMs, lastActAtMs }: ListAnswerTimes): number =>
  Math.max(answerShownAtMs + 300, Math.min(lastActAtMs + 500, answerShownAtMs + 1500));
export const withListTabStops = (children: React.ReactNode) =>
  <div className="contents" data-tab-stops-of-list-under-cell>{children}</div>;
export const colorOfferedOf = (label: ListCardRowLabel): Color | null =>
  typeof label === 'object' && 'colorOffered' in label ? label.colorOffered : null;
export const isRemovingOption = (label: ListCardRowLabel): boolean => typeof label === 'object' && 'removes' in label;
export const optionLabelText = (label: ListCardRowLabel): string => {
  if (typeof label === 'string') return label;
  return 'removes' in label ? dropdownPaneMessages.deleteOption() : optionColorName(label.colorOffered);
};
export const listCardIdOf = (listId: string): string => `${listId}-card`;
export const listRowIdOf = (listId: string, rowKey: string): string => `${listCardIdOf(listId)}-${rowKey.replaceAll(' ', '-')}`;
export const withListCardIds = (listbox: ListboxIds, card: ListCardDrawn | null): ListboxIds => {
  let highlightedRow = card?.rows[card.highlightedRow ?? -1];
  if (card === null) return listbox;
  return {
    id: `${listbox.id} ${listCardIdOf(listbox.id)}`,
    highlightedRowId: highlightedRow === undefined ? listbox.highlightedRowId : listRowIdOf(listbox.id, highlightedRow.key),
  };
};
export const withHighlightedRowIdOr = (listbox: ListboxIds, highlightedRowId: string | null): ListboxIds => ({
  ...listbox,
  highlightedRowId: listbox.highlightedRowId ?? highlightedRowId,
});
export const comboboxAriaProps = (isCombobox: boolean, listbox: ListboxIds | null): ComboboxAriaProps => ({
  ...(isCombobox && {
    role: 'combobox',
    'aria-expanded': listbox !== null,
  }),
  ...((isCombobox || listbox !== null) && {
    'aria-haspopup': 'listbox',
    'aria-autocomplete': 'list',
  }),
  ...(listbox !== null && {
    'aria-controls': listbox.id,
    'aria-activedescendant': listbox.highlightedRowId ?? undefined,
  }),
});
export const SHIFT_ONLY_COLLISION: PopoverPopupProps['collisionAvoidance'] = {
  align: 'shift',
};
export const LIST_SIDE_OFFSET = 2;
export const LIST_EDGE_PADDING = 8;
export const LIST_MIN_ROOM_BELOW = 260;
export const PRESS_TOO_SOON_MS = 300;
export const isWithinPressGuard = (sinceMs: number, nowMs: number): boolean => nowMs - sinceMs < PRESS_TOO_SOON_MS;
export const CLICK_AFTER_UP_MS = 1000;
export const isWithinClickAfterUp = (upAtMs: number, nowMs: number): boolean => nowMs - upAtMs < CLICK_AFTER_UP_MS;
export const isPressStillCounting = (nowMs: number, press: PressOnList | null): boolean =>
  press !== null && (press.upAtMs === null || isWithinClickAfterUp(press.upAtMs, nowMs));
export const LIST_CARD_BESIDE_WIDTH = 200;
export const LIST_CARD_BESIDE_GAP = 2;
export const listRowSize = (): ListRowSize => (useCoarsePointer() ? 'lg' : undefined);
export const listBoxFrameOf = (element: Element | null): HTMLElement | null => {
  let listBox = element?.closest('[role=listbox]')?.parentElement ?? null;
  return listBox?.hasAttribute('data-holds-list-box') === true ? listBox.parentElement : listBox;
};
export const listRowsScrollProps = {
  className: 'scroll-fade-y relative min-h-0 overflow-y-auto',
};
export const listRowsWithStickyHeadingsProps = {
  className: `${listRowsScrollProps.className} scroll-fade-hide-top scroll-pt-[calc(var(--ui-leading-footnote)+0.5rem)]`,
};
export const PlainListBox = ({ id, label, children }: PlainListBoxProps) =>
  <div id={id} role="listbox" aria-label={label}>{children}</div>;
export const isInListUnderCell = (element: Element | null): boolean => element !== null && element.closest('[data-list-under-cell]') !== null;
export const isListUnderCellRow = (element: EventTarget | null): boolean =>
  element instanceof HTMLElement && element.matches('[role="option"]') && isInListUnderCell(element);
export const isRowFocusOnIos = ({
  isWebKitOfIos,
  isRow,
  isPressUnderWay,
  isEntryOpen,
}: RowFocusOnIos): boolean => isWebKitOfIos && isRow && !isPressUnderWay && !isEntryOpen;
export const LIST_ROW_CLASS = menuItemVariants({
  className: `overflow-clip text-start data-[popup-open]:bg-fill-ghost-hover ${MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES}`,
});
lastPointerPoint = {
  x: Number.NaN,
  y: Number.NaN,
  isWhereItWas: false,
};
export const getLastPointerPoint = (): PointerPoint => lastPointerPoint;
export const POINTER_STILL_MAX_PX = 6;
export const isPointerStillAt = (point: PointerPoint | null): boolean =>
  point !== null && (point === lastPointerPoint || Math.hypot(point.x - lastPointerPoint.x, point.y - lastPointerPoint.y) < POINTER_STILL_MAX_PX);
didPressBeginInListUnderCell = false;
export const shouldShutListOnOutside = ({
  isClick,
  isInCard,
  didPressBeginInListOrCard,
}: PressOutsideList): boolean => !isInCard && !(isClick && didPressBeginInListOrCard);
export const listHoverTimerCancelers = new Set<() => void>();
export const listCardShutters = new Set<() => void>();
scrollTopUnderListCard = null;
export const hasListScrolledSinceCard = (scrollTop: number): boolean => scrollTop !== scrollTopUnderListCard;
rowNotToScrollIntoView = null;
export const highlightRowOnPointerMove =
  (onPointedAt: () => void, sparesRow: boolean) =>
  ({ currentTarget }: React.PointerEvent<HTMLElement>): void => {
    if (lastPointerPoint.isWhereItWas) return;
    if (sparesRow) keepRowFromScrollingIntoView(currentTarget);
    onPointedAt();
  };
export const ListRowLead = (lead: ListRowLeadProps) =>
  <LeadingIcon icon={'isQuiet' in lead && lead.isQuiet
        ? <Icon name={lead.icon} size="auto" className="text-secondary" />
        : lead.icon} />;
export const ListRowLabel = ({ children }: ListRowLabelProps) =>
  <ListRowTooltip className="min-w-0 flex-1">{children}</ListRowTooltip>;
export const ListRowQuietText = ({ isKey = false, children }: ListRowQuietTextProps) =>
  <span className={`sheet-quiet-text-in-row shrink-0 text-footnote text-muted ${isKey ? 'pointer-coarse:hidden' : ''}`}>{children}</span>;
export const ListRowSwatches = ({ marks }: ListRowSwatchesProps) =>
  <span aria-hidden className="flex gap-[3px]">{marks.map(
      (mark) =>
        <span key={mark.key} className="sheet-swatch sheet-swatch-of-set" data-has-fill style={fillPaintStyle(setSwatchColors(mark.color))} />,
    )}</span>;
export const ListHeading = ({ children }: ListHeadingProps) =>
  <div aria-hidden className={MENU_GROUP_LABEL_CLASSES}>{children}</div>;
export const ListGroup = ({
  headingId,
  heading,
  doesHeadingStayInSight = false,
  children,
}: ListGroupProps) =>
  <div {...(heading !== null && {
      role: 'group',
      'aria-labelledby': headingId,
    })}>{heading !== null &&
        <div id={headingId} className={doesHeadingStayInSight ? `${MENU_GROUP_LABEL_CLASSES} sticky top-0 z-1 bg-surface-3` : MENU_GROUP_LABEL_CLASSES}>{heading}</div>}{children}</div>;
export const ListSeparator = () =>
  <div aria-hidden><Menu.Separator /></div>;
export const LIST_CARD_OPEN_DELAY_MS = 100;
export const LIST_CARD_SHUT_DELAY_MS = 300;
export const ListRowCaret = ({ isCardBeside }: ListRowCaretProps) =>
  <span className="ms-md -me-1 flex shrink-0 text-muted"><Icon name={isCardBeside ? 'CaretRight' : 'CaretDown'} size="sm" /></span>;
export const LIST_CARD_PADDING: PopupCollisionPadding = {
  top: LIST_EDGE_PADDING,
  right: LIST_EDGE_PADDING,
  bottom: LIST_EDGE_PADDING,
  left: LIST_EDGE_PADDING,
};
export const NO_FALLBACK_AXIS: PopoverPopupProps['collisionAvoidance'] = {
  fallbackAxisSide: 'none',
};
export const listCardSide = (isBeside: boolean, collisionPadding: PopoverPopupProps['collisionPadding']): ListCardSide =>
  isBeside
    ? {
        side: 'inline-end',
        align: 'start',
        collisionPadding,
      }
    : {
        side: 'bottom',
        align: 'end',
        collisionAvoidance: NO_FALLBACK_AXIS,
        collisionPadding,
      };
