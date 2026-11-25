import { PropertyRow, PropertySection } from '../../kit/property.tsx';
import { Menu } from '../../kit/menu.tsx';
import { ResizeHandle } from '../../kit/resize-handle.tsx';
import { Button } from '../../kit/button.tsx';
import { Tooltip, TooltipGroup } from '../../kit/tooltip.tsx';
import { Icon } from '../../kit/icon.tsx';
import type { IconName } from '../../kit/icon.tsx';
import type { TooltipProps } from '../../kit/tooltip.tsx';
import * as React from 'react';
import { jsxs } from 'react/jsx-runtime';
import { focusOrFallback } from '../focus-or-fallback.ts';
import { CanTakeFocusContext } from '../popup-given-up-on-blur.ts';
import { createOpeningEdgeDetector, offerKeyboardWhenReady } from '../keyboard-handoff.ts';
import { useTooltipHeldAsPaneOpens } from './held-tooltip.ts';
import type { TooltipHeldAsPaneOpens } from './held-tooltip.ts';
import { useTopLayerClose } from '../list-under-cell.tsx';
import { ContentsBox } from '../contents-box.tsx';
import { opensMenuAtPointer, preventMouseDownDefault } from '../dom-events.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { HIDDEN_SCROLLBAR_CLASSES, OverlayScrollbar } from '../overlay-scrollbar.tsx';
import { storeSidePaneWidth, readStoredSidePaneWidth } from './stored-width.ts';
import { useCoarsePointer } from '../../app/media-queries.ts';
import { blockRepeatedEnterOrSpace } from '../repeated-key-guards.ts';
import type { CaretTarget } from '../../tables/own-filter-bar-view.tsx';
/** An element measured in the nearest scroller around it: its box and the scroller's view, in client pixels. */
export interface MeasuredInScroller {
  scroller: HTMLElement;
  box: DOMRect;
  view: DOMRect;
}
/** Where the caret stands in a pane: the focused element, how far down the view it is, and how far down the list. */
export interface CaretPlace {
  element: Element;
  downView: number;
  downList: number;
}
/** What puts the caret in a side pane as it opens and when it is asked to, and where the caret goes once it shuts. */
export interface SidePaneCaret {
  isOpen: boolean;
  /** The pane is open in another form, such as a dialog, so opening it here is not a new opening. */
  isOpenInAnotherForm?: boolean;
  isCaretLeftAsItOpens?: boolean;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  putCaretWhereToStart: () => void;
  whatHasCaretAfter: () => CaretTarget;
}
export type PaneButtonProps = React.ComponentProps<typeof Button>;
export interface SidePaneProps {
  ref: React.RefObject<HTMLElement | null>;
  title: string;
  takesNoTyping: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  beforeTitle?: React.ReactNode;
  actions?: React.ReactNode;
  foot?: React.ReactNode;
  /** Which view the pane shows; the pane scrolls back to its top when it changes. */
  view?: string;
  onPressed?: () => void;
  wasPointerPressedLast: () => boolean;
  children: React.ReactNode;
}
export interface PaneSectionProps {
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** A note over the section's title. */
  above?: React.ReactNode;
  doesTitleStay?: boolean;
  children: React.ReactNode;
}
export interface PaneRowProps {
  label?: React.ReactNode;
  labelInFull?: string;
  labelEnd?: React.ReactNode;
  hasDot?: boolean;
  trailing?: React.ReactNode;
  isPointedAt?: boolean;
  children: React.ReactNode;
}
export interface PaneTableButtonProps {
  name: string;
  onPressed: () => void;
}
export interface PaneRowNoteProps {
  id?: string;
  isRefusal?: boolean;
  isInRow?: boolean;
  children: React.ReactNode;
}
/** A choice in a pane's select. */
export interface PaneSelectItem<Value extends string = string> {
  value: Value;
  label: string;
  icon?: IconName;
  isIconTurned?: boolean;
  description?: React.ReactNode;
  /** An example of the choice, shown at the end of its row and after it in the box. */
  example?: string;
  hint?: React.ReactNode;
  /** Words read out for the choice. */
  heard?: string;
  /** What the box shows in place of the label once the choice is picked. */
  inBox?: React.ReactNode;
}
/** The choice the agent suggests, shown first under a caption of its own. */
export interface PaneSelectSuggested<Value extends string = string> {
  value: Value;
  caption: React.ReactNode;
  inWords: string;
  captionOfTheRest: React.ReactNode;
}
/** A row at the foot of a select's menu that does something other than pick. */
export interface PaneSelectLastRow {
  label: string;
  onPicked: () => void;
}
export interface PaneSelectProps<Value extends string = string> {
  name: string;
  value: Value;
  items: readonly PaneSelectItem<Value>[];
  hasLongRows?: boolean;
  /** Picking the choice already picked is told as well. */
  isSamePickTold?: boolean;
  isOff?: boolean;
  isFlush?: boolean;
  heading?: string;
  suggested?: PaneSelectSuggested<Value>;
  heard?: string;
  lastRow?: PaneSelectLastRow;
  beforeCaret?: React.ReactNode;
  tooltip?: Omit<TooltipProps, 'children'> | null;
  placeholder?: React.ReactNode;
  longestLabelInCharacters?: number;
  onChange: (value: Value) => void;
}
/** The style that sets how wide the side pane is beside the sheet. */
export type SidePaneWidthStyle = React.CSSProperties & Record<typeof SIDE_PANE_WIDTH_VAR, string>;
export interface PaneEmptyStateProps {
  title: string;
  hint: string;
  action?: React.ReactNode;
  /** The words are said as they change. */
  isSaid?: boolean;
}
export function nearestScrollableAncestor(container: Element, element: Element) {
  for (let ancestor = element.parentElement; ancestor !== null && ancestor !== container; ancestor = ancestor.parentElement) {
    let { overflowY } = getComputedStyle(ancestor);
    if (overflowY === 'auto' || overflowY === 'scroll') return container.contains(ancestor) ? ancestor : null;
  }
  return null;
}
export function measureInScroller(container: Element, element: Element): MeasuredInScroller | null {
  let scroller = nearestScrollableAncestor(container, element);
  return scroller === null
    ? null
    : {
        scroller,
        box: element.getBoundingClientRect(),
        view: scroller.getBoundingClientRect(),
      };
}
export function scrollNeededToReveal({ scroller, box, view }: MeasuredInScroller, ignoreFade: boolean) {
  let hasFade = !ignoreFade && scroller.classList.contains(SCROLL_FADE_CLASS);
  let overflowBelow = box.bottom + (hasFade ? SIDE_PANE_FADE_SCROLL_MARGIN : SIDE_PANE_SCROLL_MARGIN) - view.bottom;
  return overflowBelow > 0 ? overflowBelow : Math.max(overflowBelow, Math.min(0, box.top - view.top - SIDE_PANE_SCROLL_MARGIN));
}
export function revealInSidePane(container: Element | null, element: Element, isInstant: boolean = false) {
  let measured = container === null ? null : measureInScroller(container, element);
  if (measured === null) return;
  let scrollNeeded = scrollNeededToReveal(measured, isInstant);
  if (scrollNeeded === 0) return;
  let prefersReducedMotion = measured.scroller.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion:reduce)').matches;
  let isFocusInside = element.contains(element.ownerDocument.activeElement);
  let isSmooth = prefersReducedMotion === false && !isFocusInside;
  measured.scroller.scrollBy({
    top: scrollNeeded,
    behavior: isSmooth ? 'smooth' : 'instant',
  });
}
export function caretPlaceInPane(container: Element): CaretPlace | null {
  let activeElement = container.ownerDocument.activeElement;
  if (activeElement === null || !container.contains(activeElement)) return null;
  let measured = measureInScroller(container, activeElement);
  if (measured === null || measured.box.bottom <= measured.view.top || measured.box.top >= measured.view.bottom) return null;
  let downView = measured.box.top - measured.view.top;
  return {
    element: activeElement,
    downView,
    downList: downView + measured.scroller.scrollTop,
  };
}
export function keepCaretInPlace(container: Element, caretPlace: CaretPlace | null, isWindowResize: boolean) {
  if (caretPlace === null || container.ownerDocument.activeElement !== caretPlace.element) return caretPlace;
  let measured = measureInScroller(container, caretPlace.element);
  if (measured === null) return null;
  let drift = measured.box.top - measured.view.top - caretPlace.downView;
  let hasMovedInView =
    Math.abs(drift) >= 1 && Math.abs(drift + caretPlace.downView + measured.scroller.scrollTop - caretPlace.downList) >= 1;
  let maxScroll = isWindowResize ? 1 / 0 : hasMovedInView ? Math.abs(drift) : 0;
  let scrollNeeded = scrollNeededToReveal(measured, false);
  let scrollBy = isWindowResize || scrollNeeded * drift > 0 ? Math.sign(scrollNeeded) * Math.min(Math.abs(scrollNeeded), maxScroll) : 0;
  if (scrollBy !== 0)
    measured.scroller.scrollBy({
      top: scrollBy,
      behavior: 'instant',
    });
  return caretPlaceInPane(container);
}
export function useKeepCaretInView(
  paneRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  isCaretMovedByUser: () => boolean,
) {
  let caretPlaceRef = React.useRef<CaretPlace | null>(null);
  let keepCaret = React.useEffectEvent((isWindowResize: boolean) => {
    let pane = paneRef.current;
    if (pane === null) return;
    caretPlaceRef.current = isCaretMovedByUser() ? caretPlaceInPane(pane) : keepCaretInPlace(pane, caretPlaceRef.current, isWindowResize);
  });
  React.useLayoutEffect(() => {
    if (isOpen) keepCaret(false);
  });
  React.useEffect(() => {
    let [pane, view] = [paneRef.current, paneRef.current?.ownerDocument.defaultView];
    if (!isOpen || pane === null) return;
    let recordCaretPlace = () => void (caretPlaceRef.current = caretPlaceInPane(pane));
    let onWindowResize = () => keepCaret(true);
    recordCaretPlace();
    pane.addEventListener('focusin', recordCaretPlace);
    pane.addEventListener('scroll', recordCaretPlace, {
      capture: true,
      passive: true,
    });
    view?.addEventListener('resize', onWindowResize);
    return () => {
      caretPlaceRef.current = null;
      pane.removeEventListener('focusin', recordCaretPlace);
      pane.removeEventListener('scroll', recordCaretPlace, {
        capture: true,
      });
      view?.removeEventListener('resize', onWindowResize);
    };
  }, [isOpen, paneRef]);
}
export function useRevealCaretOnShrink(paneRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    let [pane, view] = [paneRef.current, paneRef.current?.ownerDocument.defaultView];
    if (pane === null || view === null || view === undefined) return;
    let lastClientHeight = pane.clientHeight;
    let isCaretInView = false;
    let recordCaretInView = () => void (isCaretInView = caretPlaceInPane(pane) !== null);
    let resizeObserver = new view.ResizeObserver(() => {
      let activeElement = pane.ownerDocument.activeElement;
      if (pane.clientHeight < lastClientHeight && isCaretInView && activeElement !== null) revealInSidePane(pane, activeElement, true);
      lastClientHeight = pane.clientHeight;
    });
    recordCaretInView();
    pane.addEventListener('focusin', recordCaretInView);
    pane.addEventListener('focusout', recordCaretInView);
    pane.addEventListener('scroll', recordCaretInView, {
      capture: true,
      passive: true,
    });
    resizeObserver.observe(pane);
    return () => {
      pane.removeEventListener('focusin', recordCaretInView);
      pane.removeEventListener('focusout', recordCaretInView);
      pane.removeEventListener('scroll', recordCaretInView, {
        capture: true,
      });
      resizeObserver.disconnect();
    };
  }, [paneRef]);
}
export function PaneButton(buttonProps: PaneButtonProps) {
  return <Button {...buttonProps} {...{
      [HOLDS_TOOLTIP_ATTRIBUTE]: true,
    }} {...React.useContext(PaneButtonPropsContext)} />;
}
export function focusPaneStart(
  pane: HTMLElement | null,
  where: 'start' | 'lastUsed',
  { isByPointer = false }: { isByPointer?: boolean } = {},
) {
  if (pane === null) return false;
  let BUTTON_SELECTOR = 'button:not(:disabled)';
  let lastFocused = where === 'lastUsed' ? (lastFocusedInPane.get(pane) ?? null) : null;
  for (let candidate of [
    lastFocused,
    lastFocused?.querySelector<HTMLElement>(BUTTON_SELECTOR) ?? null,
    pane.querySelector<HTMLElement>(`[${PANE_SECTION_ACTIONS_ATTRIBUTE}] ${BUTTON_SELECTOR}[${PANE_START_ATTRIBUTE}]`),
    pane.querySelector<HTMLElement>(`[${PANE_START_ATTRIBUTE}]`),
    pane.querySelector<HTMLElement>(`[${PANE_SECTION_ACTIONS_ATTRIBUTE}] ${BUTTON_SELECTOR}`),
    pane.querySelector<HTMLElement>(BUTTON_SELECTOR),
  ]) {
    candidate?.focus({
      preventScroll: true,
      focusVisible: !isByPointer || (candidate instanceof HTMLInputElement && candidate.type === 'text'),
    });
    if (candidate === null || candidate !== pane.ownerDocument.activeElement) continue;
    revealInSidePane(pane, candidate);
    return true;
  }
  return false;
}
export function focusSidePaneOrTitle(pane: HTMLElement | null, target: HTMLElement | null) {
  if (pane === null) return false;
  let ownerDocument = pane.ownerDocument;
  let title = pane.querySelector<HTMLElement>(`[${SIDE_PANE_TITLE_ATTRIBUTE}]`);
  let untabTitle = () => {
    title?.removeAttribute('tabindex');
    ownerDocument.removeEventListener('focusin', onFocusIn, true);
    ownerDocument.removeEventListener('pointerdown', untabTitle, true);
  };
  let onFocusIn = ({ target: focused }: FocusEvent) => {
    if (focused !== title) untabTitle();
  };
  let didFocus = focusOrFallback(
    target,
    (candidate) => pane.contains(candidate) || lastFocusedInPane.get(pane) === candidate,
    () => (
      title?.setAttribute('tabindex', '-1'),
      ownerDocument.addEventListener('focusin', onFocusIn, true),
      ownerDocument.addEventListener('pointerdown', untabTitle, true),
      title
    ),
    () => (ownerDocument.activeElement?.matches(':disabled') === true ? null : ownerDocument.activeElement),
  );
  if (ownerDocument.activeElement !== title) untabTitle();
  return didFocus;
}
export function useWasJustOpened(isOpen: boolean, isOpenElsewhere: boolean = false) {
  let isPaneOpenedByUser = React.useContext(CanTakeFocusContext);
  let onSidePaneShut = React.useContext(SidePaneShutContext);
  let [detectOpeningEdge] = React.useState(createOpeningEdgeDetector);
  let wasJustOpenedRef = React.useRef(false);
  React.useLayoutEffect(() => {
    wasJustOpenedRef.current = detectOpeningEdge(isOpen, isOpenElsewhere) && isPaneOpenedByUser();
    if (wasJustOpenedRef.current) onSidePaneShut();
  });
  let [wasJustOpened] = React.useState(() => () => wasJustOpenedRef.current);
  return wasJustOpened;
}
export function useSidePaneCaret({
  isOpen,
  isOpenInAnotherForm = false,
  isCaretLeftAsItOpens = false,
  timesAsked,
  paneRef,
  putCaretWhereToStart,
  whatHasCaretAfter,
}: SidePaneCaret) {
  let wasJustOpened = useWasJustOpened(isOpen, isOpenInAnotherForm);
  let onSidePaneShut = React.useContext(SidePaneShutContext);
  let putCaretWhereToStartEvent = React.useEffectEvent(putCaretWhereToStart);
  let lastTimesAskedRef = React.useRef<number | null>(null);
  let callOffHandoffRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    let timesAskedNow = isOpen ? timesAsked : null;
    if (lastTimesAskedRef.current === timesAskedNow) return;
    let isFirstAsk = lastTimesAskedRef.current === null;
    lastTimesAskedRef.current = timesAskedNow;
    callOffHandoffRef.current?.();
    callOffHandoffRef.current = null;
    if (timesAskedNow === null || wasJustOpened() || (isFirstAsk && isCaretLeftAsItOpens)) return;
    let pane = paneRef.current;
    if (isFirstAsk && pane !== null)
      callOffHandoffRef.current = offerKeyboardWhenReady(pane, putCaretWhereToStartEvent, {
        keys: {
          onShut: onSidePaneShut,
        },
      });
    else putCaretWhereToStartEvent();
  });
  React.useEffect(() => () => callOffHandoffRef.current?.(), []);
  React.useEffect(() => {
    if (!isOpen) return;
    let ownerDocument = paneRef.current?.ownerDocument;
    return () => {
      let caretTarget = ownerDocument?.activeElement === ownerDocument?.body ? whatHasCaretAfter() : false;
      if (caretTarget !== false)
        caretTarget.focus({
          preventScroll: true,
        });
    };
  }, [isOpen, paneRef, whatHasCaretAfter]);
}
export function SidePane(props: SidePaneProps) {
  let {
    ref,
    title,
    takesNoTyping,
    width,
    onWidthChange,
    onClose,
    onKeyDown,
  } = props;
  let {
    beforeTitle,
    actions,
    foot,
    view,
    onPressed,
    wasPointerPressedLast,
    children,
  } = props;
  let busyClass = takesNoTyping ? 'opacity-disabled' : '';
  let windowWidth = React.useSyncExternalStore(subscribeSidePaneWindowResize, getWindowInnerWidth, getServerWindowWidth);
  let maxWidth = sidePaneMaxWidthFor(windowWidth);
  let closeButtonRef = React.useRef<HTMLElement | null>(null);
  let heldTooltip = useTooltipHeldAsPaneOpens();
  let close = React.useCallback(() => {
    if (ref.current?.contains(ref.current.ownerDocument.activeElement) === true)
      closeButtonRef.current?.focus({
        preventScroll: true,
      });
    onClose();
  }, [ref, onClose]);
  useTopLayerClose(windowWidth < 600, close);
  let shownWidth = Math.min(width, maxWidth);
  let [aroundScrollerRef, scrollerRef] = [React.useRef<HTMLDivElement | null>(null), React.useRef<HTMLDivElement | null>(null)];
  let lastViewRef = React.useRef(view);
  React.useLayoutEffect(() => {
    if (lastViewRef.current === view) return;
    lastViewRef.current = view;
    for (let scroller of [aroundScrollerRef.current, scrollerRef.current])
      scroller?.scrollTo({
        top: 0,
        behavior: 'instant',
      });
  });
  useRevealCaretOnShrink(ref);
  let widthAtResizeStartRef = React.useRef(shownWidth);
  let draftWidthRef = React.useRef(shownWidth);
  let widthHostRef = React.useRef<Element | null>(null);
  let setDraftWidth = (draftWidth: number) => {
    if (widthHostRef.current instanceof HTMLElement) widthHostRef.current.style.setProperty(SIDE_PANE_WIDTH_VAR, sidePaneWidthCss(draftWidth));
  };
  let lastFocusedRef = React.useRef<Element | null>(null);
  React.useEffect(() => {
    let [lastFocused, ownerDocument] = [lastFocusedRef.current, ref.current?.ownerDocument];
    if (lastFocused === null || (lastFocused.isConnected && !lastFocused.matches(':disabled'))) return;
    let activeElement = ownerDocument?.activeElement ?? null;
    if (activeElement !== ownerDocument?.body && activeElement !== lastFocused) {
      if (!lastFocused.isConnected) lastFocusedRef.current = ref.current?.contains(activeElement) === true ? activeElement : null;
      return;
    }
    lastFocusedRef.current = null;
    if (ownerDocument?.hasFocus() !== true) return;
    focusPaneStart(ref.current, 'start', {
      isByPointer: wasPointerPressedLast(),
    });
  });
  return <ContentsBox onFocus={({ target }) => {
      lastFocusedRef.current = target;
      if (target.closest(`[${HOLDS_TOOLTIP_ATTRIBUTE}]`) === null) heldTooltip.end();
      if (ref.current?.contains(target) === true && !target.hasAttribute(SIDE_PANE_TITLE_ATTRIBUTE)) lastFocusedInPane.set(ref.current, target);
    }} onBlur={({ target, relatedTarget }) => {
      let isStayingInPane = ref.current?.contains(relatedTarget) === true;
      let wasDisabledUnderFocus = relatedTarget === null && target.matches(':disabled');
      lastFocusedRef.current = isStayingInPane ? relatedTarget : wasDisabledUnderFocus ? target : null;
    }} onKeyDown={(event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target) === true) onKeyDown(event);
    }} onClick={({ target }) => {
      if (target instanceof Element && ref.current?.contains(target) === true && target.closest('button[type="submit"]') === null) onPressed?.();
    }} onContextMenu={(event) => {
      if ((event.target instanceof Element && ref.current?.contains(event.target)) === true && opensMenuAtPointer(event)) onPressed?.();
    }} onSubmit={() => onPressed?.()}><aside ref={ref} aria-label={title} aria-busy={takesNoTyping || undefined} onPointerEnter={heldTooltip.end} className="@container-[size] absolute end-0 bottom-0 flex flex-col border-alpha-2 bg-surface-panel min-[600px]:top-0 min-[600px]:w-[312px] min-[768px]:w-(--sheet-side-pane-width) min-[600px]:border-s max-[600px]:h-(--sheet-side-pane-at-foot) max-[600px]:w-full max-[600px]:border-t max-[600px]:pb-[var(--sheet-strip-at-foot,0px)]"><div className={`flex min-h-10 min-w-0 shrink-0 items-center gap-xs pe-sm max-[600px]:pointer-coarse:py-md min-[600px]:min-h-(--sheet-formula-row-height) ${beforeTitle === undefined ? 'ps-lg' : 'ps-sm'} ${busyClass}`}><TooltipGroup>{beforeTitle}<h2 {...{
                  [SIDE_PANE_TITLE_ATTRIBUTE]: true,
                }} className="min-w-0 flex-1 truncate text-body-semibold text-primary outline-none">{title}</h2>{actions}<Button ref={closeButtonRef} variant="ghost" iconOnly icon={<Icon name="X" size="sm" />} aria-label={sheetMessages.close()} {...{
                  [HOLDS_TOOLTIP_ATTRIBUTE]: true,
                }} {...heldTooltip.ofButton} className="text-secondary" onClick={onClose} /></TooltipGroup></div><div ref={aroundScrollerRef} {...SHORT_PANE_LAYOUT.aroundWhatScrollsAndFoot}><div ref={scrollerRef} className={`${SCROLL_FADE_CLASS} scroll-fade-hide-top flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-alpha-2 pb-3 ${SHORT_PANE_LAYOUT.whatScrolls.className} ${HIDDEN_SCROLLBAR_CLASSES} ${busyClass}`}><PaneButtonPropsContext value={heldTooltip.ofButton}>{children}</PaneButtonPropsContext><OverlayScrollbar /></div>{foot !== undefined &&
              <div className={`flex shrink-0 flex-col gap-sm border-t border-alpha-2 py-md ps-lg pe-md ${busyClass}`}>{foot}</div>}</div><ResizeHandle side="inline-start" aria-label={sheetMessages.resizePane()} aria-valuenow={shownWidth} aria-valuemin={SIDE_PANE_MIN_WIDTH} aria-valuemax={maxWidth} className="[--ui-ring-inner:0px] [--ui-ring-outer:1px] max-[768px]:hidden" onResizeStart={() => {
            widthAtResizeStartRef.current = shownWidth;
            widthHostRef.current = ref.current?.offsetParent ?? null;
          }} onResize={(delta) => {
            let pane = ref.current;
            if (pane === null) return;
            let widthDelta = getComputedStyle(pane).direction === 'rtl' ? delta : -delta;
            let nextWidth = Math.round(widthAtResizeStartRef.current + widthDelta);
            draftWidthRef.current = Math.max(SIDE_PANE_MIN_WIDTH, Math.min(maxWidth, nextWidth));
            let isUnchanged = draftWidthRef.current === widthAtResizeStartRef.current;
            setDraftWidth(isUnchanged ? width : draftWidthRef.current);
          }} onResizeEnd={(didResize) => {
            if (!didResize) setDraftWidth(width);
            if (!didResize || draftWidthRef.current === widthAtResizeStartRef.current) return;
            onWidthChange(draftWidthRef.current);
            storeSidePaneWidth(draftWidthRef.current);
          }} /></aside></ContentsBox>;
}
export function PaneSection(props: PaneSectionProps) {
  let { title, actions, className = '', above, doesTitleStay, children } = props;
  let hasOwnHead = above !== undefined || doesTitleStay === true;
  return <PropertySection className={`${PANE_PROPERTY_PAD_VARS} ${hasOwnHead ? '[&:not(:first-child)]:pt-0' : ''} ${className}`} {...(!hasOwnHead && {
      title,
    })} {...(!hasOwnHead &&
      actions !== undefined && {
        actions: (<span {...{
            [PANE_SECTION_ACTIONS_ATTRIBUTE]: true,
          }} className="contents font-normal">{actions}</span>),
      })}>{hasOwnHead &&
        (<>{above !== undefined &&
              <p className={`pt-3 text-footnote leading-snug text-secondary ${PANE_GUTTER_CLASSES}`}>{above}</p>}<div className={`flex min-h-10 min-w-0 shrink-0 items-center gap-xs py-2 select-none ${PANE_GUTTER_CLASSES} ${doesTitleStay === true ? 'sticky top-0 z-1 bg-surface-panel' : ''}`}><h3 className="min-w-0 flex-1 truncate text-body-semibold text-primary">{title}</h3>{actions !== undefined &&
                  (<span {...{
                      [PANE_SECTION_ACTIONS_ATTRIBUTE]: true,
                    }} className="-my-1 flex shrink-0 items-center gap-0.5">{actions}</span>)}</div></>)}{children}</PropertySection>;
}
export function PaneRow(props: PaneRowProps) {
  let { label, labelInFull, labelEnd, hasDot = false, trailing } = props;
  let { isPointedAt = false, children } = props;
  return <PropertyRow className={`relative ${PANE_PROPERTY_PAD_VARS} ${label === undefined ? '' : PANE_ROW_LABEL_COLUMNS} ${trailing === undefined ? '[--cmp-property-trailing:initial]' : '[--cmp-property-trailing:var(--ui-h-control)]'}`} {...(label !== undefined && {
      label: (<span className="flex min-w-0 gap-1" title={labelInFull}>{hasDot &&
            <span className="absolute inset-y-0 start-[7px] my-auto size-0 rounded-full border-[3px] border-[color:var(--ui-fill-accent)]" />}<span dir="auto" className="min-w-0 truncate">{label}</span>{labelEnd !== undefined &&
            <span className="shrink-0">{labelEnd}</span>}</span>),
    })} {...(trailing !== undefined && {
      trailing,
    })}><div className={isPointedAt ? `flex min-w-0 flex-1 items-center gap-2 rounded ${POINTED_AT_MARK.className}` : 'contents'} {...(isPointedAt && POINTED_AT_MARK.mark)}>{children}</div></PropertyRow>;
}
export function PaneTableButton({ name, onPressed }: PaneTableButtonProps) {
  let isTouch = useCoarsePointer();
  return <Button variant="ghost" size={isTouch ? 'sm' : 'xs'} iconOnly icon="Table" aria-label={name} className={`text-secondary ${isTouch ? 'relative after:absolute after:inset-x-[calc(50%-20px)] after:-inset-y-0.5' : ''}`} onMouseDown={preventMouseDownDefault} onClick={onPressed} />;
}
export function useNoteKeptInView(noteRef: React.RefObject<HTMLElement | null>, isRefusal: boolean) {
  React.useEffect(() => {
    let [note, pane] = [noteRef.current, noteRef.current?.closest('aside') ?? null];
    let win = pane?.ownerDocument.defaultView ?? null;
    if (!isRefusal || note === null || pane === null || win === null) return;
    let describedSelector = `[aria-describedby~="${note.id}"]`;
    let lastHeight: number | null = null;
    let wasInView = true;
    let isInView = (element: Element | null) => {
      let measured = element === null ? null : measureInScroller(pane, element);
      return measured !== null && measured.box.bottom > measured.view.top && measured.box.top < measured.view.bottom;
    };
    let onScroll = () => {
      if (lastHeight === null) return;
      wasInView = isInView(note) || isInView(pane.querySelector(describedSelector));
    };
    let observer = new win.ResizeObserver(() => {
      if (pane.clientHeight === lastHeight) return;
      lastHeight = pane.clientHeight;
      let focused = pane.ownerDocument.activeElement;
      if (wasInView && (focused?.matches(describedSelector) === true || !pane.contains(focused))) revealInSidePane(pane, note);
    });
    observer.observe(pane);
    pane.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      observer.disconnect();
      pane.removeEventListener('scroll', onScroll, {
        capture: true,
      });
    };
  }, [noteRef, isRefusal]);
}
export function PaneRowNote({ id, isRefusal = false, isInRow = false, children }: PaneRowNoteProps) {
  let noteRef = React.useRef<HTMLParagraphElement | null>(null);
  useNoteKeptInView(noteRef, isRefusal);
  let note = <p ref={noteRef} id={id} className={`col-start-2 min-w-0 ps-md text-caption leading-snug [overflow-wrap:anywhere] ${isRefusal ? 'text-danger' : 'text-secondary'} ${isInRow ? 'pt-0.5 pb-0.5' : ''}`}>{children}</p>;
  if (isInRow) return note;
  return <div className={`grid shrink-0 ${PANE_ROW_LABEL_COLUMNS} gap-x-sm pb-1 ${PANE_GUTTER_CLASSES}`}>{note}</div>;
}
export function PaneSelect<Value extends string>(props: PaneSelectProps<Value>) {
  let {
    name,
    value,
    items,
    hasLongRows,
    isSamePickTold,
    isOff = false,
    isFlush,
  } = props;
  let {
    heading,
    suggested,
    heard,
    lastRow,
    beforeCaret,
    tooltip,
    onChange,
  } = props;
  let { longestLabelInCharacters } = props;
  let selectId = React.useId();
  let heardIdOf = (item: PaneSelectItem<Value>) => `${selectId}-${items.indexOf(item)}`;
  let picked = items.find((item) => item.value === value);
  let pickedExample = picked?.inBox === undefined && beforeCaret === undefined ? picked?.example : undefined;
  let renderItem = (item: PaneSelectItem<Value>) =>
    <Menu.Item key={item.value} {...(item.icon !== undefined && {
          icon:
            item.isIconTurned === true
              ? <Icon name={item.icon} size="auto" rotate={90} />
              : item.icon,
        })} checked={item.value === value} checkedRole="radio" label={item.label} description={item.description ?? null} {...(item.example !== undefined && {
          hint: item.example,
          hintDir: 'auto',
        })} {...(item.heard !== undefined && {
          'aria-describedby': heardIdOf(item),
        })} onClick={() => {
          if (item.value !== value || isSamePickTold === true) onChange(item.value);
        }}><span className={`flex min-w-0 flex-1 items-center ${hasLongRows !== true ? 'gap-1.5' : longestLabelInCharacters === undefined ? 'justify-between gap-lg' : 'gap-lg'}`}><span dir="auto" className={hasLongRows === true ? 'max-w-full shrink-0 truncate' : 'min-w-0 truncate'} {...(longestLabelInCharacters !== undefined &&
                item.hint !== undefined && {
                  style: {
                    minWidth: `${longestLabelInCharacters}ch`,
                  },
                })}>{item.label}</span>{item.heard !== undefined &&
              <span id={heardIdOf(item)} hidden>{item.heard}</span>}{item.value === suggested?.value &&
              <span className="sr-only">{' '}{suggested.inWords}</span>}{item.hint !== undefined &&
              <span className={`text-footnote text-muted ${hasLongRows === true ? 'min-w-0 truncate' : 'shrink-0'}`}>{item.hint}</span>}</span></Menu.Item>;
  let trigger = <Menu.Trigger render={<button type="button" aria-label={name} aria-describedby={heard === undefined ? undefined : selectId} disabled={isOff} className={`${(isFlush === true ? PANE_SELECT_FLUSH_TRIGGER_CLASSES : PANE_SELECT_TRIGGER_CLASSES).className} ${hasLongRows === true ? 'min-h-control py-1 leading-snug pointer-coarse:min-h-10' : PANE_SELECT_HEIGHT_CLASSES.className}`}>{picked?.icon !== undefined &&
          <Icon name={picked.icon} size="sm" rotate={picked.isIconTurned === true ? 90 : 0} className="shrink-0 text-secondary" />}<span dir="auto" className={`min-w-0 ${isFlush === true ? '' : 'flex-1'} ${hasLongRows === true ? 'line-clamp-3' : 'truncate'} ${pickedExample === undefined ? '' : '-me-1'}`}>{picked?.inBox ??
              picked?.label ??
              <span className="text-muted">{props.placeholder}</span>}{pickedExample !== undefined &&
              <span className="text-footnote text-muted">{' '}{pickedExample}</span>}</span>{beforeCaret}<PaneSelectCaret /></button>} />;
  return <Menu.Root>{tooltip === undefined
        ? trigger
        : (<Tooltip {...(tooltip ?? {
              content: null,
            })}>{trigger}</Tooltip>)}{heard !== undefined &&
        <span id={selectId} hidden>{heard}</span>}<Menu.Popup align="start" className={hasLongRows === true
            ? 'w-auto max-w-[min(32rem,var(--available-width))] min-w-[var(--anchor-width)]'
            : 'w-max max-w-[var(--available-width)] min-w-[max(var(--anchor-width),12rem)]'} onKeyDownCapture={blockRepeatedEnterOrSpace}>{suggested === undefined
            ? (<Menu.Group>{heading !== undefined &&
                    <Menu.GroupLabel>{heading}</Menu.GroupLabel>}{items.map(renderItem)}</Menu.Group>)
            : <Menu.Group aria-label={heading}>{suggested.caption}{items.filter((item) => item.value === suggested.value).map(renderItem)}<Menu.Separator /><Menu.Header>{suggested.captionOfTheRest}</Menu.Header>{items.filter((item) => item.value !== suggested.value).map(renderItem)}</Menu.Group>}{lastRow !== undefined &&
            <><Menu.Separator /><Menu.Item label={lastRow.label} onClick={lastRow.onPicked}>{lastRow.label}</Menu.Item></>}</Menu.Popup></Menu.Root>;
}
export function PaneEmptyState({ title, hint, action, isSaid }: PaneEmptyStateProps) {
  return <div className={`flex flex-col items-center justify-center text-center text-footnote text-secondary ${title === '' && hint === '' ? '' : 'flex-1 px-lg py-12'}`}>{jsxs(isSaid === true ? 'output' : 'div', {
        className: 'flex flex-col gap-xs',
        children: [
          title !== '' &&
            <span className="text-body text-primary">{title}</span>,
          hint !== '' &&
            <span>{hint}</span>,
        ],
      })}<div className="pt-md empty:hidden">{action}</div></div>;
}
export const SIDE_PANE_DEFAULT_WIDTH = 312;
export const SIDE_PANE_MIN_WIDTH = 285;
export const SIDE_PANE_MAX_WIDTH = 560;
export const initialSidePaneWidth = () =>
  readStoredSidePaneWidth(SIDE_PANE_MIN_WIDTH, SIDE_PANE_MAX_WIDTH) ?? SIDE_PANE_DEFAULT_WIDTH;
export const SIDE_PANE_WIDTH_VAR = '--sheet-side-pane-width';
export const sidePaneWidthCss = (width: number) => `min(${width}px,max(${SIDE_PANE_MIN_WIDTH}px,50vw))`;
export const sidePaneMaxWidthFor = (windowWidth: number) =>
  Math.max(SIDE_PANE_MIN_WIDTH, Math.min(SIDE_PANE_MAX_WIDTH, Math.floor(windowWidth / 2)));
export const subscribeSidePaneWindowResize = (onResize: () => void) => (
  window.addEventListener('resize', onResize),
  () => window.removeEventListener('resize', onResize)
);
export const getWindowInnerWidth = () => window.innerWidth;
export const getServerWindowWidth = () => 1 / 0;
export const sheetBesideSidePaneProps = (width: number, isPaneOpen: boolean): { className: string; style: SidePaneWidthStyle } => ({
  className: isPaneOpen ? 'min-[600px]:pe-[312px] min-[768px]:pe-(--sheet-side-pane-width) max-[600px]:pb-(--sheet-side-pane-at-foot)' : '',
  style: {
    [SIDE_PANE_WIDTH_VAR]: sidePaneWidthCss(width),
  },
});
export const SHEET_BEHIND_SIDE_PANE_CLASS = 'sheet-behind-side-pane';
export const SIDE_PANE_SCROLL_MARGIN = 12;
export const SIDE_PANE_FADE_SCROLL_MARGIN = 32;
export const SCROLL_FADE_CLASS = 'scroll-fade-y';
export const SHORT_PANE_LAYOUT = {
  aroundWhatScrollsAndFoot: {
    className: 'flex min-h-0 flex-1 flex-col [@container(max-height:280px)]:overflow-y-auto',
  },
  whatScrolls: {
    className: '[@container(max-height:280px)]:flex-none [@container(max-height:280px)]:overflow-y-visible [@container(max-height:280px)]:mask-none',
  },
};
export const PANE_SECTION_ACTIONS_ATTRIBUTE = 'data-actions-of-pane-section';
export const PANE_START_ATTRIBUTE = 'data-start-of-pane';
/** The element last focused in each side pane, to put the caret back on. */
export const lastFocusedInPane = new WeakMap<Element, HTMLElement>();
export const HOLDS_TOOLTIP_ATTRIBUTE = 'data-holds-tooltip-as-pane-opens';
export const PaneButtonPropsContext: React.Context<TooltipHeldAsPaneOpens['ofButton'] | null> = React.createContext<TooltipHeldAsPaneOpens['ofButton'] | null>(null);
export const SIDE_PANE_TITLE_ATTRIBUTE = 'data-title-of-side-pane';
export const SidePaneShutContext = React.createContext(() => {});
export const PANE_GUTTER_CLASSES = 'ps-[var(--sheet-pane-gutter,var(--ui-pad-lg))] pe-[var(--sheet-pane-gutter,var(--ui-pad-md))]';
export const POINTED_AT_MARK = {
  className: 'sheet-pointed-at',
  mark: {
    'data-is-pointed-at': true,
  },
};
export const PANE_ROW_LABEL_COLUMNS = 'grid-cols-[80px_minmax(0,1fr)]';
export const PANE_PROPERTY_PAD_VARS =
  '[--cmp-property-pad-start:var(--sheet-pane-gutter,var(--ui-pad-lg))] [--cmp-property-pad-end:var(--sheet-pane-gutter,var(--ui-pad-md))]';
export const ELLIPSIS_INPUT_CLASSES = 'text-ellipsis [&_input]:text-ellipsis';
export const PANE_SELECT_TRIGGER_CLASSES = {
  className:
    'group/select flex w-full min-w-0 flex-1 cursor-default items-center gap-1.5 rounded bg-fill-field ps-md pe-sm text-start text-body text-primary shadow-field-ring outline-none transition duration-fast hover:shadow-field-hover focus-visible:shadow-focus focus-visible:outline-hidden disabled:opacity-disabled aria-expanded:shadow-field-hover forced-colors:outline-1 forced-colors:-outline-offset-1 forced-colors:outline-solid',
};
export const PANE_SELECT_FLUSH_TRIGGER_CLASSES = {
  className:
    'group/select flex min-w-0 cursor-default items-center gap-1 rounded px-xs text-start text-body text-primary outline-none transition duration-fast hover:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden disabled:opacity-disabled aria-expanded:bg-fill-ghost-selected',
};
export const PANE_SELECT_HEIGHT_CLASSES = {
  className: 'h-control pointer-coarse:h-10',
};
export const PaneSelectCaret = () =>
  <Icon name="CaretDown" size="sm" className="me-0.5 shrink-0 text-muted transition-colors duration-fast group-hover/select:text-secondary" />;
