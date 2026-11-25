import { Icon } from '../../kit/icon.tsx';
import { Tabs } from '../../kit/tabs.tsx';
import { Counter } from '../../kit/counter.tsx';
import { PreviewCard } from '../../kit/preview-card.tsx';
import { Menu } from '../../kit/menu.tsx';
import { Button } from '../../kit/button.tsx';
import { OverflowTooltip, Tooltip } from '../../kit/tooltip.tsx';
import * as React from 'react';
import type { SheetId } from '@open-artifact/sheets-core';
import type { ListedSheet, ViewOnlyBecause } from '../../view/page-view.ts';
import type { SheetController } from '../../state/controller.ts';
import type { TooltipSide } from '../../kit/tooltip.tsx';
import type { CaretTarget } from '../../tables/own-filter-bar-view.tsx';
import type { MenuOpenChange } from './add-sheet.tsx';
import { sheetMessages, moreOptionsForSheetLabel } from '../../i18n/sheet-messages.ts';
import { useSheenDelayStyle } from '../../agent/changes-by-agent-marks.tsx';
import { sheetNameRefusedText } from '../../i18n/notice-labels.ts';
import { SheetNameField, SheetTabMenuItems } from './tab-menu.tsx';
import { usePopupRoomAtFoot } from '../../shell/bottom-insets.ts';
import { useReorderRows } from '../reorder-rows.ts';
import { othersOnSheetDescription, TabFaces, sheetTabLabel, BetaBadge } from './tab-badges.tsx';
import { isTouchBelowSm } from '../../app/media-queries.ts';
import { swallowRestOfPress, swallowPressAfterItemPress } from '../press-swallow.ts';
import { opensMenuAtPointer, preventMouseDownDefault } from '../dom-events.ts';
import { isRepeatedEnterOrSpace } from '../repeated-key-guards.ts';
import { MENU_CARETS } from '../menu-trigger.tsx';
import { isSyntheticEscapeClose } from '../../app/page-guards.ts';
import { menuTakesInitialCaret } from '../menu-initial-focus.ts';
/** The keys and modifiers a key press is told apart by. */
export type KeyWithModifiers = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>;
/** A scroll of the tabs that may still be under way: where it went from and to, and when. */
export interface SheetTabScroll {
  from: number;
  to: number;
  atMs: number;
}
/** A way the tabs scroll: back to earlier tabs, or on to later ones. */
export type SheetTabScrollDirection = -1 | 1;
/** Why the menu of a sheet tab shut, when it matters for where the caret goes. */
export type SheetMenuCloseReason = 'windowLeft' | 'pressOutside';
export function createTabKeyFocusTracker() {
  let hasKeyBroughtFocus = false;
  let forgetKeyTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    keyPressed: (event: React.KeyboardEvent) => {
      hasKeyBroughtFocus = isTabStripArrowKey(event);
      clearTimeout(forgetKeyTimer);
      if (hasKeyBroughtFocus) forgetKeyTimer = setTimeout(() => (hasKeyBroughtFocus = false));
    },
    hasKeyBroughtFocus: () => {
      let brought = hasKeyBroughtFocus;
      hasKeyBroughtFocus = false;
      return brought;
    },
  };
}
export function scrollSheetTabsTo(scroller: HTMLElement, scrollLeft: number) {
  let clampedLeft = Math.max(0, Math.min(scrollLeft, scroller.scrollWidth - scroller.clientWidth));
  if (clampedLeft === scroller.scrollLeft && clampedLeft === settledSheetTabScrollLeft(scroller)) return;
  sheetTabScrollsUnderWay.set(scroller, {
    from: scroller.scrollLeft,
    to: clampedLeft,
    atMs: performance.now(),
  });
  scroller.scrollLeft = clampedLeft;
}
export function settledSheetTabScrollLeft(scroller: HTMLElement) {
  let { scrollLeft, scrollWidth, clientWidth } = scroller;
  let scrollUnderWay = sheetTabScrollsUnderWay.get(scroller);
  if (scrollUnderWay === undefined || performance.now() - scrollUnderWay.atMs > SHEET_TAB_SCROLL_SETTLE_MS) return scrollLeft;
  return scrollLeft >= Math.min(scrollUnderWay.from, scrollUnderWay.to) - 1 && scrollLeft <= Math.max(scrollUnderWay.from, scrollUnderWay.to) + 1
    ? Math.min(scrollUnderWay.to, scrollWidth - clientWidth)
    : scrollLeft;
}
export function scrollSheetTabIntoView(scroller: HTMLElement | null, tab: Element | null) {
  let tabBox = tab?.getBoundingClientRect();
  if (scroller === null || tabBox === undefined) return;
  let { left: scrollerLeft, right: scrollerRight } = scroller.getBoundingClientRect();
  let [tabLeft, tabRight] = [scrollerLeft + SHEET_TAB_EDGE_ROOM, scrollerRight - SHEET_TAB_EDGE_ROOM];
  if (tabBox.left < tabLeft || tabBox.width > tabRight - tabLeft) scrollSheetTabsTo(scroller, scroller.scrollLeft - (tabLeft - tabBox.left));
  else if (tabBox.right > tabRight) scrollSheetTabsTo(scroller, scroller.scrollLeft + (tabBox.right - tabRight));
}
export interface SheetTabScrollArrowsProps {
  scroller: React.RefObject<HTMLElement | null>;
}
export function SheetTabScrollArrows({ scroller }: SheetTabScrollArrowsProps) {
  let [canScrollBack, setCanScrollBack] = React.useState(false);
  let [canScrollOn, setCanScrollOn] = React.useState(false);
  let [heldArrow, setHeldArrow] = React.useState<SheetTabScrollDirection | null>(null);
  let [focusedArrow, setFocusedArrow] = React.useState<SheetTabScrollDirection | null>(null);
  let lingerTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(lingerTimerRef.current), []);
  React.useEffect(() => {
    let scrollerElement = scroller.current;
    let tabList = scrollerElement?.firstElementChild ?? null;
    if (scrollerElement === null || tabList === null) return;
    let updateArrows = () => {
      setCanScrollBack(scrollerElement.scrollLeft > 1);
      setCanScrollOn(scrollerElement.scrollLeft + scrollerElement.clientWidth < scrollerElement.scrollWidth - 1);
    };
    let resizeObserver = new ResizeObserver(updateArrows);
    resizeObserver.observe(scrollerElement);
    resizeObserver.observe(tabList);
    scrollerElement.addEventListener('scroll', updateArrows, {
      passive: true,
    });
    return () => {
      resizeObserver.disconnect();
      scrollerElement.removeEventListener('scroll', updateArrows);
    };
  }, [scroller]);
  let arrowButton = (direction: SheetTabScrollDirection, canScroll: boolean) =>
    <span className="sheet-tab-arrow" data-end={direction === 1 ? 'later' : 'earlier'} data-is-unseen={!canScroll && focusedArrow !== direction}><Button variant="ghost" iconOnly icon={direction === 1 ? 'CaretRight' : 'CaretLeft'} aria-label={direction === 1 ? sheetMessages.showLaterTabs() : sheetMessages.showEarlierTabs()} tooltip={false} tabIndex={-1} aria-hidden={(!canScroll && focusedArrow !== direction) || undefined} aria-disabled={!canScroll || undefined} className="aria-disabled:opacity-disabled" onFocus={() => setFocusedArrow(direction)} onBlur={() => setFocusedArrow(null)} onWheel={() => setHeldArrow(null)} onClick={() => {
          clearTimeout(lingerTimerRef.current);
          lingerTimerRef.current = setTimeout(() => setHeldArrow(null), SHEET_TAB_ARROW_LINGER_MS);
          setHeldArrow(direction);
          let scrollerElement = scroller.current;
          if (canScroll && scrollerElement !== null)
            scrollSheetTabsTo(scrollerElement, scrollerElement.scrollLeft + direction * scrollerElement.clientWidth * SHEET_TAB_PAGE_FRACTION);
        }} /></span>;
  return <>{(canScrollBack || heldArrow === -1 || focusedArrow === -1) && arrowButton(-1, canScrollBack)}{(canScrollOn || heldArrow === 1 || focusedArrow === 1) && arrowButton(1, canScrollOn)}</>;
}
export function sheetTabTooltipOffset(tab: HTMLElement | null, side: TooltipSide, hasFaces: boolean) {
  let overflowTooltip = tab?.querySelector('[data-ui="OverflowTooltip"]') ?? null;
  if (tab === null || overflowTooltip === null || !hasFaces || side !== 'top') return SHEET_TAB_TOOLTIP_GAP;
  return overflowTooltip.getBoundingClientRect().top - tab.getBoundingClientRect().top + 24 + SHEET_TAB_TOOLTIP_GAP;
}
export function refocusChosenSheetTab(scroller: HTMLElement, focusedBefore: Element | null) {
  let ownerDocument = scroller.ownerDocument;
  ownerDocument.defaultView?.queueMicrotask(() => {
    if (ownerDocument.hasFocus() && ownerDocument.activeElement === focusedBefore)
      findChosenSheetTab(scroller)?.focus({
        preventScroll: true,
      });
  });
}
export interface SheetTabNameProps {
  name: string;
  shimmers: boolean;
}
export function SheetTabName({ name: sheetName, shimmers }: SheetTabNameProps) {
  return <span data-shimmers={shimmers || undefined} style={useSheenDelayStyle(shimmers)}>{sheetName}</span>;
}
export interface SheetNameOverTabProps {
  sheetId: SheetId;
  isOpen: boolean;
  renaming: NonNullable<ListedSheet['renaming']>;
  dispatch: SheetController['dispatch'];
}
export function SheetNameOverTab({ sheetId, isOpen, renaming, dispatch }: SheetNameOverTabProps) {
  let whyNotId = React.useId();
  let refusedText = renaming.refused === null ? null : sheetNameRefusedText(renaming.refused);
  let boxRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    let tab = findSheetTab(boxRef.current?.parentElement ?? null, sheetId);
    if (boxRef.current === null || tab === null) return;
    boxRef.current.style.left = `${tab.offsetLeft}px`;
    boxRef.current.style.width = `${tab.offsetWidth}px`;
  });
  return <div ref={boxRef} role="presentation" className="sheet-name-over-tab text-body font-medium"><Tooltip content={refusedText} side="top" hoverable open={refusedText !== null}><span className={`flex min-w-0 flex-1 ${isOpen ? SHEET_TAB_BOLD_CLASS : ''}`}><SheetNameField renaming={renaming} whyNotId={whyNotId} dispatch={dispatch} /></span></Tooltip>{refusedText !== null &&
        <p id={whyNotId} role="alert" className="sr-only">{refusedText}</p>}</div>;
}
export interface SheetTabStripProps {
  listedSheets: ListedSheet[];
  viewOnlyBecause: ViewOnlyBecause | null;
  tabListRef: React.RefObject<HTMLDivElement | null>;
  isListOpen: boolean;
  isAddMenuOpen: boolean;
  isUnfinishedFormulaOpen: boolean;
  whatHasCaretAfterMenu: () => CaretTarget;
  timesRenameBegunElsewhere: number;
  onMenuOpenChange: MenuOpenChange;
  dispatchAfterEntry: SheetController['dispatch'];
  lookOnceEventsAreFinished: SheetController['lookOnceEventsAreFinished'];
  isChosenForFormula: (sheetId: SheetId) => boolean;
  dispatch: SheetController['dispatch'];
}
export function SheetTabStrip({
  listedSheets,
  viewOnlyBecause,
  tabListRef,
  isListOpen,
  isAddMenuOpen,
  isUnfinishedFormulaOpen,
  whatHasCaretAfterMenu,
  timesRenameBegunElsewhere,
  onMenuOpenChange,
  dispatchAfterEntry,
  lookOnceEventsAreFinished,
  isChosenForFormula,
  dispatch,
}: SheetTabStripProps) {
  let scrollerRef = React.useRef<HTMLDivElement | null>(null);
  let { sheetId: shownSheetId = null, name: shownName }: { sheetId?: SheetId | null; name?: string } = listedSheets.find(({ isShown }) => isShown) ?? {};
  let canEdit = viewOnlyBecause === null;
  let lastScrollKeyRef = React.useRef('');
  let lastShownSheetIdRef = React.useRef(shownSheetId);
  React.useLayoutEffect(() => {
    let shownIndex = listedSheets.findIndex(({ isShown }) => isShown);
    let scrollKey = `${shownSheetId} ${shownIndex} ${listedSheets.length} ${shownName}`;
    if (lastScrollKeyRef.current === scrollKey) return;
    lastScrollKeyRef.current = scrollKey;
    let scroller = scrollerRef.current;
    let chosenTab = findChosenSheetTab(scroller);
    scrollSheetTabIntoView(scroller, chosenTab);
    let previousTab = findSheetTab(scroller, lastShownSheetIdRef.current);
    lastShownSheetIdRef.current = shownSheetId;
    let focused = scroller?.ownerDocument.activeElement ?? null;
    if (scroller === null || focused !== previousTab || focused === chosenTab) return;
    let defaultView = scroller.ownerDocument.defaultView;
    if (scroller.ownerDocument.hasFocus()) refocusChosenSheetTab(scroller, focused);
    else if (defaultView !== null && focused instanceof defaultView.HTMLElement) focused.blur();
  });
  let openTabPlaceRef = React.useRef({
    sheets: '',
    counts: '',
    startOfOpenTab: 0,
    endOfOpenTab: 0,
  });
  React.useLayoutEffect(() => {
    let [scroller, chosenTab] = [scrollerRef.current, findChosenSheetTab(scrollerRef.current)];
    let sheetsUpToShown = listedSheets.slice(0, listedSheets.findIndex(({ isShown }) => isShown) + 1);
    let tabStart = SHEET_TAB_STRIP_INSET + (chosenTab?.offsetLeft ?? 0);
    let [previousPlace, place] = [
      openTabPlaceRef.current,
      {
        sheets: sheetsUpToShown.map(({ sheetId }) => sheetId).join(),
        counts: sheetsUpToShown.map(({ openCommentCount }) => openCommentCount).join(),
        startOfOpenTab: tabStart,
        endOfOpenTab: tabStart + (chosenTab?.offsetWidth ?? 0),
      },
    ];
    openTabPlaceRef.current = place;
    if (scroller === null || place.sheets !== previousPlace.sheets || place.counts === previousPlace.counts) return;
    let scrollLeft = settledSheetTabScrollLeft(scroller);
    let wasInView =
      previousPlace.endOfOpenTab - scrollLeft > SHEET_TAB_EDGE_ROOM &&
      previousPlace.startOfOpenTab - scrollLeft < scroller.clientWidth - SHEET_TAB_EDGE_ROOM;
    if ((place.startOfOpenTab !== previousPlace.startOfOpenTab || place.endOfOpenTab !== previousPlace.endOfOpenTab) && wasInView)
      scrollSheetTabIntoView(scroller, chosenTab);
  });
  React.useEffect(() => {
    let scroller = scrollerRef.current;
    if (scroller === null) return;
    let resizeObserver = new ResizeObserver(() => scrollSheetTabIntoView(scroller, findChosenSheetTab(scroller)));
    resizeObserver.observe(scroller);
    return () => resizeObserver.disconnect();
  }, []);
  let [keyFocusTracker] = React.useState(createTabKeyFocusTracker);
  let [menuSheetId, setMenuSheetId] = React.useState<SheetId | null>(null);
  let [menuKey, setMenuKey] = React.useState(0);
  let isMenuByKeyboardRef = React.useRef(false);
  let pressedControlRef = React.useRef<HTMLElement | null>(null);
  let isMenuFromKeyboard = () => isMenuByKeyboardRef.current || pressedControlRef.current?.getAttribute('role') === 'tab';
  let menuOpenedHereRef = React.useRef(false);
  let menuSheetOnPressRef = React.useRef<SheetId | null>(null);
  let menuCloseReasonRef = React.useRef<SheetMenuCloseReason | null>(null);
  let focusTabIfFocusInList = (tab: HTMLElement) => {
    let { activeElement } = tab.ownerDocument;
    let isFocusInList = tabListRef.current?.contains(activeElement) === true && tab.ownerDocument.hasFocus();
    if (activeElement === tabListRef.current || isFocusInList)
      tab.focus({
        preventScroll: true,
      });
  };
  let openSheetMenu = (sheetId: SheetId, event: Event, byKeyboard: boolean) => {
    if (isChosenForFormula(sheetId))
      return dispatchAfterEntry({
        kind: 'sheetChosen',
        sheetId,
      });
    isMenuByKeyboardRef.current = byKeyboard;
    let ownerDocument = scrollerRef.current?.ownerDocument;
    let pressedControl = ownerDocument?.hasFocus() === true ? ownerDocument.activeElement : null;
    pressedControlRef.current = pressedControl instanceof HTMLElement && pressedControl.matches('button, [readonly]') ? pressedControl : null;
    if (menuCloseReasonRef.current === 'windowLeft') menuCloseReasonRef.current = null;
    if (isUnfinishedFormulaOpen && !byKeyboard) return;
    scrollSheetTabIntoView(scrollerRef.current, findSheetTab(scrollerRef.current, sheetId));
    if (canEdit || sheetId !== shownSheetId)
      dispatchAfterEntry({
        kind: 'sheetChosen',
        sheetId,
      });
    setMenuSheetId(sheetId);
    setMenuKey((count) => count + 1);
    menuOpenedHereRef.current = true;
    onMenuOpenChange(true, event);
  };
  let closeSheetMenu = (event: Event, reason: SheetMenuCloseReason | null = null) => {
    menuCloseReasonRef.current = reason;
    menuOpenedHereRef.current = false;
    setMenuSheetId(null);
    onMenuOpenChange(false, event);
  };
  let closeSheetMenuEvent = React.useEffectEvent(closeSheetMenu);
  let popupRoom = usePopupRoomAtFoot(menuSheetId !== null, () => findSheetTab(scrollerRef.current, menuSheetId));
  React.useEffect(() => {
    let defaultView = scrollerRef.current?.ownerDocument.defaultView ?? null;
    if (menuSheetId === null || defaultView === null) return;
    let onWindowBlur = (event: FocusEvent) => {
      closeSheetMenuEvent(event, 'windowLeft');
      setMenuKey((count) => count + 1);
    };
    defaultView.addEventListener('blur', onWindowBlur);
    return () => defaultView.removeEventListener('blur', onWindowBlur);
  }, [menuSheetId]);
  let menuSheet = listedSheets.find(({ sheetId }) => sheetId === menuSheetId);
  let menuSheetState = {
    sheet: menuSheet,
    among: listedSheets,
  };
  let [keptMenuSheet, setKeptMenuSheet] = React.useState(menuSheetState);
  if (menuSheet !== undefined && (menuSheet !== keptMenuSheet.sheet || listedSheets !== keptMenuSheet.among)) setKeptMenuSheet(menuSheetState);
  let { sheet: shownMenuSheet, among: shownMenuAmong } = menuSheet === undefined ? keptMenuSheet : menuSheetState;
  if (menuSheetId !== null && (menuSheet === undefined || isAddMenuOpen)) setMenuSheetId(null);
  React.useLayoutEffect(() => {
    if (menuSheetId !== null || !menuOpenedHereRef.current) return;
    menuOpenedHereRef.current = false;
    if (!isAddMenuOpen) onMenuOpenChange(false, new Event('sheetgone'));
  }, [menuSheetId, isAddMenuOpen, onMenuOpenChange]);
  let renamingSheet = isListOpen ? undefined : listedSheets.find(({ renaming }) => renaming !== null);
  let renamingSheetId = renamingSheet?.sheetId;
  let wasListOpenRef = React.useRef(false);
  React.useLayoutEffect(() => {
    let wasListOpen = wasListOpenRef.current;
    wasListOpenRef.current = isListOpen;
    if (renamingSheetId === undefined) return;
    if (wasListOpen) isMenuByKeyboardRef.current = false;
    scrollSheetTabIntoView(scrollerRef.current, findSheetTab(scrollerRef.current, renamingSheetId));
  }, [isListOpen, renamingSheetId, isMenuByKeyboardRef, wasListOpenRef]);
  let timesRenameBegunRef = React.useRef(timesRenameBegunElsewhere);
  React.useLayoutEffect(() => {
    if (timesRenameBegunRef.current === timesRenameBegunElsewhere) return;
    timesRenameBegunRef.current = timesRenameBegunElsewhere;
    isMenuByKeyboardRef.current = false;
    pressedControlRef.current = null;
  }, [timesRenameBegunElsewhere, timesRenameBegunRef, isMenuByKeyboardRef, pressedControlRef]);
  let lastRenamingSheetIdRef = React.useRef(renamingSheet?.sheetId);
  let isRenameEndDeferredRef = React.useRef(false);
  React.useLayoutEffect(() => {
    let lastSheetId = lastRenamingSheetIdRef.current;
    lastRenamingSheetIdRef.current = renamingSheet?.sheetId;
    let ownerDocument = scrollerRef.current?.ownerDocument;
    if (lastSheetId === undefined || renamingSheet !== undefined || ownerDocument === undefined) return;
    let focusAfterRename = () => {
      if (ownerDocument.activeElement !== ownerDocument.body || !ownerDocument.hasFocus()) return;
      let focusTarget = !listedSheets.some(({ sheetId }) => sheetId === lastSheetId)
        ? tabListRef.current
        : isMenuFromKeyboard()
          ? findChosenSheetTab(scrollerRef.current)
          : whatHasCaretAfterMenu();
      if (focusTarget !== null && focusTarget !== false)
        focusTarget.focus({
          preventScroll: true,
        });
    };
    if (isRenameEndDeferredRef.current) ownerDocument.defaultView?.setTimeout(focusAfterRename);
    else focusAfterRename();
    isRenameEndDeferredRef.current = false;
  });
  let pressedSheetIdRef = React.useRef<SheetId | null>(null);
  React.useLayoutEffect(() => {
    let pressedSheetId = pressedSheetIdRef.current;
    if (pressedSheetId === null || listedSheets.some(({ sheetId }) => sheetId === pressedSheetId)) return;
    pressedSheetIdRef.current = null;
    let scroller = scrollerRef.current;
    let ownerDocument = scroller?.ownerDocument;
    if (scroller === null || ownerDocument === undefined) return;
    if (ownerDocument.activeElement !== ownerDocument.body || !ownerDocument.hasFocus()) return;
    tabListRef.current?.focus({
      preventScroll: true,
    });
    refocusChosenSheetTab(scroller, tabListRef.current);
  });
  let canReorder = canEdit && !isUnfinishedFormulaOpen && renamingSheet === undefined && listedSheets.length > 1;
  let reorder = useReorderRows({
    listRef: tabListRef,
    keys: canReorder ? listedSheets.map(({ sheetId }) => sheetId) : [],
    way: 'across',
    onMoved: (sheetId, toIndex, onDone) => {
      dispatchAfterEntry({
        kind: 'sheetChosen',
        sheetId,
      });
      dispatchAfterEntry({
        kind: 'sheetMoveChosen',
        sheetId,
        toIndex,
      });
      lookOnceEventsAreFinished(() => onDone(true));
    },
    roomKeptAtEnds: ({ scrollLeft, clientWidth, scrollWidth }, rowLength) =>
      clientWidth - 2 * SHEET_TAB_EDGE_ROOM < 2 * rowLength
        ? null
        : {
            start: Math.min(SHEET_TAB_EDGE_ROOM, SHEET_TAB_STRIP_INSET + scrollLeft),
            end: Math.min(SHEET_TAB_EDGE_ROOM, SHEET_TAB_STRIP_INSET + scrollWidth - clientWidth - scrollLeft),
          },
  });
  let areTooltipsOff = isListOpen || isAddMenuOpen || menuSheetId !== null || renamingSheet !== undefined || reorder.isRowHeld;
  return <Tabs.Root className="relative min-w-0" value={shownSheetId} onValueChange={(sheetId: SheetId) =>
      dispatchAfterEntry({
        kind: 'sheetChosen',
        sheetId,
      })}><div ref={scrollerRef} className="sheet-scroller scroll-fade-x scroll-fade-size-8 -mx-1" tabIndex={-1} onPointerDownCapture={() => {
          menuSheetOnPressRef.current = menuSheetId;
        }} onFocus={({ target, currentTarget }) => {
          if (target.classList.contains('sheet-name-field')) isRenameEndDeferredRef.current = false;
          if (target.getAttribute('role') !== 'tab') return;
          scrollSheetTabIntoView(currentTarget, target);
          pressedSheetIdRef.current = target.dataset.sheetTab ?? null;
        }} onBlur={({ target, relatedTarget }) => {
          if (target.isConnected) pressedSheetIdRef.current = null;
          if (relatedTarget === null && target.classList.contains('sheet-name-field')) isRenameEndDeferredRef.current = true;
        }}><div role="presentation" className="relative w-max" onKeyDownCapture={keyFocusTracker.keyPressed}><Tabs.List ref={tabListRef} aria-label={sheetMessages.sheets()} tabIndex={-1} activateOnFocus={false}>{listedSheets.map(
                (
                  { sheetId, name: sheetName, isShown, facesOfOthers, ...restOfSheet },
                  rowIndex,
                ) =>
                  (<PreviewCard.Root key={sheetId} delay={300} closeDelay={0} hoverable={false} disabled={facesOfOthers.length === 0 || areTooltipsOff}><PreviewCard.Trigger render={<Tabs.Tab {...othersOnSheetDescription(sheetId, facesOfOthers)} {...reorder.ofRow(sheetId, rowIndex)} onPointerDown={(pressEvent) => {
                              if (!isChosenForFormula(sheetId)) reorder.pressOnRowItself(pressEvent, sheetId, rowIndex);
                            }} onFocus={() => {
                              if (keyFocusTracker.hasKeyBroughtFocus() && !isShown)
                                dispatchAfterEntry({
                                  kind: 'sheetChosen',
                                  sheetId,
                                });
                            }} value={sheetId} data-sheet-tab={sheetId} aria-label={sheetTabLabel({
                                ...restOfSheet,
                                name: sheetName,
                              }) ??
                              (renamingSheet?.sheetId === sheetId ? sheetName : undefined)} aria-haspopup={isShown || menuSheetId === sheetId ? 'menu' : undefined} aria-expanded={isShown || menuSheetId === sheetId ? menuSheetId === sheetId : undefined} onClick={(event) => {
                              let { target, currentTarget: tab, nativeEvent } = event;
                              focusTabIfFocusInList(tab);
                              let isKeyboardClick = nativeEvent.detail === 0;
                              let isOnChevron = target instanceof Element && target.closest('.sheet-tab-chevron') !== null;
                              if (!(isKeyboardClick ? isShown : isOnChevron)) return;
                              if (menuSheetOnPressRef.current === sheetId && !isKeyboardClick) return;
                              if (isTouchBelowSm()) swallowRestOfPress(event);
                              openSheetMenu(sheetId, nativeEvent, isKeyboardClick);
                            }} onContextMenu={(event) => {
                              event.preventDefault();
                              focusTabIfFocusInList(event.currentTarget);
                              openSheetMenu(sheetId, event.nativeEvent, !opensMenuAtPointer(event));
                            }} onDoubleClick={({ target }) => {
                              let isOnChevron = target instanceof Element && target.closest('.sheet-tab-chevron') !== null;
                              if (!canEdit || isOnChevron || isChosenForFormula(sheetId)) return;
                              isMenuByKeyboardRef.current = false;
                              pressedControlRef.current = null;
                              dispatchAfterEntry({
                                kind: 'sheetRenameChosen',
                                sheetId,
                              });
                            }} onKeyDown={(event) => {
                              if (isRepeatedEnterOrSpace(event)) {
                                event.preventDefault();
                                event.preventBaseUIHandler();
                                return;
                              }
                              let canRename = canEdit && isShown && menuSheetId === null && !isChosenForFormula(sheetId);
                              if (isRenameKey(event) && !event.repeat && canRename) {
                                event.preventDefault();
                                isMenuByKeyboardRef.current = true;
                                dispatchAfterEntry({
                                  kind: 'sheetRenameChosen',
                                  sheetId,
                                });
                                return;
                              }
                              if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return;
                              event.preventDefault();
                              openSheetMenu(sheetId, event.nativeEvent, true);
                            }}><span aria-hidden className="sheet-tab-card" /><span className={`flex items-center gap-xs ${renamingSheet?.sheetId === sheetId ? 'invisible' : ''}`}>{restOfSheet.isInteractive && <Icon name="Sliders" size="sm" className="flex-none text-secondary" />}<span className="sheet-tab-name grid min-w-0"><span aria-hidden className={`invisible col-start-1 row-start-1 truncate ${SHEET_TAB_BOLD_CLASS}`}>{sheetName}</span><OverflowTooltip className={`col-start-1 row-start-1 ${isShown ? SHEET_TAB_BOLD_CLASS : ''} ${areTooltipsOff ? 'pointer-events-none' : ''}`} sideOffset={({ side }: { side: TooltipSide }) =>
                                          sheetTabTooltipOffset(findSheetTab(scrollerRef.current, sheetId), side, facesOfOthers.length > 0)}><SheetTabName name={sheetName} shimmers={restOfSheet.isWhereAgentWorks} /></OverflowTooltip></span>{restOfSheet.isInteractive && <BetaBadge />}<Counter aria-hidden value={restOfSheet.openCommentCount} variant="neutral" size="xxs" /><span className="sheet-tab-chevron">{MENU_CARETS.tab}</span></span></Tabs.Tab>} /><PreviewCard.Popup side="top" align="center" sideOffset={4} padding="none" className="sheet-faces-over-tab [--ui-page-bg:var(--ui-surface-2)] [--preview-card-min-w:0px]"><TabFaces faces={facesOfOthers} /></PreviewCard.Popup></PreviewCard.Root>),
              )}</Tabs.List>{renamingSheet !== undefined &&
              renamingSheet.renaming !== null &&
              <SheetNameOverTab sheetId={renamingSheet.sheetId} isOpen={renamingSheet.isShown} renaming={renamingSheet.renaming} dispatch={dispatch} />}</div></div>{renamingSheet === undefined &&
        <SheetTabScrollArrows scroller={scrollerRef} />}<Menu.Root key={menuKey} modal={false} sheetTitle={shownMenuSheet?.name} open={menuSheet !== undefined} onOpenChange={(isOpen, { reason, event }) => {
            swallowPressAfterItemPress(reason, event);
            let isPressOutside = reason === 'outside-press' || isSyntheticEscapeClose(reason, event);
            if (!isOpen) closeSheetMenu(event, isPressOutside ? 'pressOutside' : null);
          }}><Menu.Popup aria-label={menuSheet === undefined ? undefined : moreOptionsForSheetLabel(menuSheet.name)} anchor={() => findSheetTab(scrollerRef.current, menuSheetId)} side="top" align="start" {...popupRoom} initialFocus={() => isMenuByKeyboardRef.current || menuTakesInitialCaret(scrollerRef.current, whatHasCaretAfterMenu())} finalFocus={() => {
              if (menuCloseReasonRef.current === 'windowLeft') return false;
              let caretTarget = whatHasCaretAfterMenu();
              if (menuCloseReasonRef.current === 'pressOutside')
                return scrollerRef.current?.ownerDocument.activeElement?.matches('body, [role="menu"], [role="menu"] *') !== false && caretTarget;
              let nameField = scrollerRef.current?.querySelector<HTMLElement>('.sheet-name-field');
              if (nameField !== null && nameField !== undefined) return nameField;
              if (isMenuFromKeyboard()) return findChosenSheetTab(scrollerRef.current) ?? true;
              let pressedControl = caretTarget === false ? null : pressedControlRef.current;
              pressedControl?.focus({
                preventScroll: true,
              });
              return pressedControl !== null && pressedControl === pressedControl.ownerDocument.activeElement ? pressedControl : caretTarget;
            }} onMouseDown={preventMouseDownDefault} onContextMenu={(event) => event.preventDefault()} onKeyDownCapture={(event) => {
              let isRepeatedPress = (event.key === 'Enter' || event.key === ' ') && event.repeat;
              if (event.key !== 'Tab' && !isRepeatedPress) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Tab') closeSheetMenu(event.nativeEvent);
            }} onFocus={({ target, currentTarget, relatedTarget }) => {
              if (!isMenuByKeyboardRef.current || target !== currentTarget) return;
              if (currentTarget.contains(relatedTarget)) return;
              currentTarget.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
            }}>{shownMenuSheet !== undefined &&
              (<SheetTabMenuItems sheet={shownMenuSheet} isOnlySheet={shownMenuAmong.length === 1} placeAmongTabs={{
                  index: shownMenuAmong.indexOf(shownMenuSheet),
                  count: shownMenuAmong.length,
                }} viewOnlyBecause={viewOnlyBecause} dispatch={dispatch} />)}</Menu.Popup></Menu.Root></Tabs.Root>;
}
export const isTabStripArrowKey = ({ key, shiftKey, ctrlKey, altKey, metaKey }: KeyWithModifiers) =>
  (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') && !(shiftKey || ctrlKey || altKey || metaKey);
export const isRenameKey = ({ key, shiftKey, ctrlKey, altKey, metaKey }: KeyWithModifiers) =>
  key === 'F2' && !(shiftKey || ctrlKey || altKey || metaKey);
export const SHEET_TAB_EDGE_ROOM = 48;
export const SHEET_TAB_STRIP_INSET = 4;
export const SHEET_TAB_PAGE_FRACTION = 0.8;
export const SHEET_TAB_ARROW_LINGER_MS = 1000;
export const sheetTabScrollsUnderWay = new WeakMap<HTMLElement, SheetTabScroll>();
export const SHEET_TAB_SCROLL_SETTLE_MS = 1000;
export const findSheetTab = (scroller: Element | null, sheetId: SheetId | null) =>
  sheetId === null ? null : (scroller?.querySelector<HTMLElement>(`[data-sheet-tab="${CSS.escape(sheetId)}"]`) ?? null);
export const SHEET_TAB_TOOLTIP_GAP = 4;
export const findChosenSheetTab = (scroller: Element | null) => scroller?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null;
export const SHEET_TAB_BOLD_CLASS = 'font-bold [font-synthesis:weight]';
