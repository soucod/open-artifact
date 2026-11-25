import { Surface } from '../kit/surface.tsx';
import { Button } from '../kit/button.tsx';
import type { GridView } from '../grid/grid-view.ts';
import type { PaneRect } from '../grid/geometry.ts';
import type { DrawnBox } from '../grid/view-boxes.ts';
import type { BodyOrigin } from '../grid/grid-drawing.tsx';
import type { SelectionOfferPlace } from '../state/offers-at-selection.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { PressToSwallow } from './press-swallow.ts';
import * as React from 'react';
import { DOUBLE_TAP_GAP_MS } from '../selection/finger-taps.ts';
import { useCoarsePointer } from '../app/media-queries.ts';
import { preventMouseDownDefault } from './dom-events.ts';
import { isWithinPressGuard, isWithinClickAfterUp } from './list-under-cell.tsx';
import { clipBoxToShown } from '../grid/view-boxes.ts';
import { EXPAND_BUTTON_SIZE } from '../editor/expanded-entry.ts';
import { outlineBoxInBody } from '../grid/grid-drawing.tsx';
import { shortcutKeysFor } from '../keys/shortcut-list.ts';
import { stopEnterOrSpacePropagation } from '../tables/filter-buttons-layer.tsx';
import { contrastingShades } from '../format/cell-colors.ts';
import { paintDataAttributes, fillPaintStyle, textPaintStyle } from '../grid/cell-drawing.tsx';
import { translateMessage } from '../i18n/messages.ts';
import { swallowRestOfPress } from './press-swallow.ts';
/** A tool offered on a bar beside the selection. */
export interface OfferAtSelection {
  id: string;
  icon: (size: number) => React.ReactNode;
  label: string;
  canAct: boolean;
  whyNot: string | null;
  onPress: (event: React.MouseEvent<HTMLButtonElement>) => void;
}
/** Where and how the grid offers tools beside the selection. */
export type OffersAtSelectionView = NonNullable<GridView['offersAtSelection']>;
export type OffersBarStyle = NonNullable<ReturnType<typeof offersAtSelectionStyle>>;
export function focusNeighbourOffer(offer: EventTarget | null, step: number) {
  if (!(offer instanceof HTMLElement)) return;
  const offers = [...(offer.closest('.sheet-grid')?.querySelectorAll<HTMLElement>(OFFERS_AT_SELECTION_BUTTONS_SELECTOR) ?? [])];
  offers[offers.indexOf(offer) + step]?.focus({
    preventScroll: true,
  });
}
export function offersAtSelectionStyle(anchor: SelectionOfferPlace | null, gridBody: BodyOrigin, zoom: number) {
  if (anchor === null) return null;
  const { left: anchorLeft, middle: anchorMiddle, top: anchorTop, bottom: anchorBottom } = anchor;
  return {
    scale: 1 / zoom,
    transformOrigin: '0 0',
    left: gridBody.left + anchorLeft,
    top: gridBody.top + anchorMiddle,
    translate: `0 clamp(${anchorTop - anchorMiddle}px, ${-50 / zoom}%, calc(${anchorBottom - anchorMiddle}px - ${100 / zoom}%))`,
  };
}
/** Keeps what is offered after a press on the cells from taking presses until the pointer moves on. */
export interface OffersHeldAfterPress {
  holder: React.RefObject<HTMLElement | null>;
  wasLastPressByMouse: () => boolean;
  isAfterPressOnCells: boolean;
}
export function useOffersHeldAfterPress({
  holder,
  wasLastPressByMouse,
  isAfterPressOnCells,
}: OffersHeldAfterPress) {
  const [isHeld, setHeld] = React.useState(isAfterPressOnCells);
  const isLastPressByMouse = React.useEffectEvent(wasLastPressByMouse);
  React.useEffect(() => {
    const ownerDocument = holder.current?.ownerDocument;
    if (ownerDocument === undefined || !isAfterPressOnCells) return;
    if (!isLastPressByMouse()) {
      const timer = setTimeout(() => setHeld(false), DOUBLE_TAP_GAP_MS);
      return () => clearTimeout(timer);
    }
    let firstPointer: PagePoint | null = null;
    const onPointerMove = ({ clientX, clientY }: PointerEvent) => {
      firstPointer ??= {
        x: clientX,
        y: clientY,
      };
      if (Math.hypot(clientX - firstPointer.x, clientY - firstPointer.y) <= POINTER_STILL_PX) return;
      ownerDocument.removeEventListener('pointermove', onPointerMove);
      setHeld(false);
    };
    ownerDocument.addEventListener('pointermove', onPointerMove, {
      passive: true,
    });
    return () => ownerDocument.removeEventListener('pointermove', onPointerMove);
  }, [holder, isAfterPressOnCells]);
  return isHeld && isAfterPressOnCells;
}
export interface OffersAtSelectionProps {
  grid: Pick<GridView, 'body' | 'offersAtSelection'>;
  zoom: number;
  offers: OfferAtSelection[];
  isHeldBack: boolean;
  wasLastPressByMouse: () => boolean;
  onCaretLost: () => void;
}
export function OffersAtSelection({
  grid: { body: gridBody, offersAtSelection },
  zoom,
  offers,
  isHeldBack,
  wasLastPressByMouse,
  onCaretLost,
}: OffersAtSelectionProps) {
  const isShown = offersAtSelection !== null && !isHeldBack && offers.length > 0;
  const [selectionPressed, setSelectionPressed] = React.useState<number | null>(null);
  const isShort = !useCoarsePointer() && offersAtSelection?.isOneCell === true;
  const barStyle = isShown
    ? offersAtSelectionStyle(isShort ? offersAtSelection.besideIfShort : offersAtSelection.beside, gridBody, zoom)
    : null;
  const nthSelectionShown = isShown && barStyle !== null ? offersAtSelection.nthSelection : null;
  const caretHolderRef = React.useRef<Document | null>(null);
  const loseCaret = React.useEffectEvent(onCaretLost);
  const nthSelectionRef = React.useRef(nthSelectionShown);
  React.useEffect(() => {
    if (nthSelectionRef.current === nthSelectionShown) return;
    nthSelectionRef.current = nthSelectionShown;
    const caretHolder = caretHolderRef.current;
    caretHolderRef.current = null;
    if (caretHolder !== null && caretHolder.activeElement === caretHolder.body) loseCaret();
  });
  if (!isShown || barStyle === null) return null;
  return <OffersAtSelectionBar key={nthSelectionShown} comes={offersAtSelection.comes} isShort={isShort} isBackAfterOwnPress={selectionPressed === offersAtSelection.nthSelection} onPressed={() => setSelectionPressed(offersAtSelection.nthSelection)} style={barStyle} offers={offers} wasLastPressByMouse={wasLastPressByMouse} onCaretChange={(caretHolder) => void (caretHolderRef.current = caretHolder)} onEscape={onCaretLost} />;
}
export interface OffersAtSelectionBarProps {
  /** Whether the bar comes at once after the cells are pressed, or after the pointer rests. */
  comes: OffersAtSelectionView['comes'];
  isShort: boolean;
  isBackAfterOwnPress: boolean;
  onPressed: () => void;
  style: OffersBarStyle;
  offers: OfferAtSelection[];
  wasLastPressByMouse: () => boolean;
  /** Called with the document while the bar has the caret, and with null when it loses it. */
  onCaretChange: (caretHolder: Document | null) => void;
  onEscape: () => void;
}
export function OffersAtSelectionBar({
  comes,
  isShort,
  isBackAfterOwnPress,
  onPressed,
  style,
  offers,
  wasLastPressByMouse,
  onCaretChange,
  onEscape,
}: OffersAtSelectionBarProps) {
  const barRef = React.useRef<HTMLDivElement>(null);
  const guardUntilMsRef = React.useRef(0);
  const placeKeyRef = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const placeKey = [style.left, style.top, ...offers.map(({ label }) => label)].join();
    if (placeKey === placeKeyRef.current) return;
    const guardMs = placeKeyRef.current === null && comes === 'afterRest' ? OFFERS_AFTER_REST_GUARD_MS : 0;
    guardUntilMsRef.current = Math.max(guardUntilMsRef.current, performance.now() + guardMs);
    placeKeyRef.current = placeKey;
  });
  const pressAtMsRef = React.useRef<number | null>(null);
  const isHeldAfterPress = useOffersHeldAfterPress({
    holder: barRef,
    wasLastPressByMouse,
    isAfterPressOnCells: comes === 'atOnce' && !isBackAfterOwnPress,
  });
  return <Surface ref={barRef} elevation="popover" className={`sheet-offers-at-selection flex-col gap-0.5 ${isShort ? 'rounded-lg p-0.5' : 'p-1'}`} {...{
      [OFFERS_AT_SELECTION_ATTRIBUTE]: true,
    }} data-is-short={isShort || undefined} data-comes={comes} style={isHeldAfterPress
      ? {
          ...style,
          pointerEvents: 'none',
        }
      : style} onMouseDown={preventMouseDownDefault} onFocus={({ currentTarget }) => onCaretChange(currentTarget.ownerDocument)} onBlur={() => onCaretChange(null)} onKeyDownCapture={(event) => {
      if (event.key === 'Escape') onEscape();
    }} onPointerDownCapture={() => {
      const nowMs = performance.now();
      pressAtMsRef.current = isWithinPressGuard(guardUntilMsRef.current, nowMs) ? nowMs : null;
    }} onClickCapture={(event) => {
      const pressAtMs = pressAtMsRef.current;
      pressAtMsRef.current = null;
      if (pressAtMs !== null && isWithinClickAfterUp(pressAtMs, performance.now())) event.stopPropagation();
    }}>{offers.map(
      ({ id, icon, label, canAct, whyNot, onPress }) =>
        (<Button key={id} variant="ghost" size={isShort ? 'xxs' : 'sm'} iconOnly icon={icon(isShort ? SHORT_OFFER_ICON_SIZE : OFFER_ICON_SIZE)} aria-label={label} tooltip={canAct ? label : (whyNot ?? label)} tooltipSide="right" aria-disabled={!canAct} aria-description={canAct ? undefined : (whyNot ?? undefined)} className={canAct ? undefined : 'opacity-disabled'} tabIndex={-1} onClick={(event) => {
              onPressed();
              if (canAct) onPress(event);
            }} />),
    )}</Surface>;
}
export function expandButtonRoomOf(box: DrawnBox) {
  const shown = clipBoxToShown(box);
  return shown.width >= 2 * EXPAND_BUTTON_SIZE && shown.height >= EXPAND_BUTTON_SIZE ? shown : null;
}
export function useEntryWidth(entryBoxRef: React.RefObject<HTMLElement | null>, isMeasured: boolean, zoom: number) {
  const [width, setWidth] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const entryBox = entryBoxRef.current;
    const win = entryBox?.ownerDocument.defaultView ?? null;
    if (!isMeasured || entryBox === null || win === null) return;
    const measure = () => setWidth(entryBox.getBoundingClientRect().width / zoom);
    measure();
    const observer = new win.ResizeObserver(measure);
    observer.observe(entryBox);
    return () => {
      observer.disconnect();
      setWidth(null);
    };
  }, [entryBoxRef, isMeasured, zoom]);
  return width;
}
export interface ExpandedEntryFinishButtonProps {
  grid: Pick<GridView, 'body' | 'expandedEntryCard'>;
  onFinished: () => void;
}
export function ExpandedEntryFinishButton({ grid: { body, expandedEntryCard }, onFinished }: ExpandedEntryFinishButtonProps) {
  if (expandedEntryCard === null) return null;
  return <div className="sheet-expanded-entry" style={outlineBoxInBody(expandedEntryCard, body)} {...{
      [EXPANDED_ENTRY_ATTRIBUTE]: '',
    }}><Button variant="ghost" size="xs" tabIndex={-1} shortcut={shortcutKeysFor('finishExpandedCell')} onKeyDown={stopEnterOrSpacePropagation} onKeyUp={stopEnterOrSpacePropagation} onClick={pressSwallowingRest(onFinished)}>{expandCellMessages.finish()}</Button></div>;
}
export interface ExpandButtonAtSelectionProps extends Omit<ExpandButtonProps, 'grid' | 'of'> {
  grid: ExpandButtonProps['grid'] & Pick<GridView, 'activeCellBox' | 'editorBox'>;
  /** The field typed in, measured when the button stands in the entry. */
  entryBoxRef: React.RefObject<HTMLElement | null>;
  zoom: number;
  isHeldBack: boolean;
}
export function ExpandButtonAtSelection({ grid, entryBoxRef, zoom, isHeldBack, ...rest }: ExpandButtonAtSelectionProps) {
  const {
    body,
    activeCellBox,
    editorBox,
    expandedEntryCard,
    expandButtonStandsIn,
  } = grid;
  const entryWidth = useEntryWidth(entryBoxRef, expandButtonStandsIn === 'entry', zoom);
  const box =
    expandedEntryCard ??
    (expandButtonStandsIn === 'cell' && activeCellBox !== null && !isHeldBack
      ? expandButtonRoomOf(activeCellBox)
      : expandButtonStandsIn === 'entry' && editorBox !== null && entryWidth !== null
        ? expandButtonRoomOf(entryBoxAsWide(editorBox, entryWidth, body))
        : null);
  return box === null
    ? null
    : <ExpandButton grid={grid} of={box} {...rest} />;
}
export interface ExpandButtonProps {
  grid: Pick<GridView, 'body' | 'editorPaints' | 'expandedEntryCard' | 'expandButtonStandsIn' | 'isExpandButtonAfterPress'>;
  /** The box the button is put at the corner of. */
  of: PaneRect;
  wasLastPressByMouse: () => boolean;
  onPressed: () => void;
}
export function ExpandButton({
  grid: {
    body,
    editorPaints,
    expandedEntryCard,
    expandButtonStandsIn,
    isExpandButtonAfterPress,
  },
  of: box,
  wasLastPressByMouse,
  onPressed,
}: ExpandButtonProps) {
  const buttonRef = React.useRef<HTMLElement>(null);
  const isHeldAfterPress = useOffersHeldAfterPress({
    holder: buttonRef,
    wasLastPressByMouse,
    isAfterPressOnCells: isExpandButtonAfterPress,
  });
  const isExpanded = expandedEntryCard !== null;
  const { fill } = editorPaints;
  const paints = {
    fill,
    text: fill === null ? null : contrastingShades(fill),
  };
  return <Button ref={buttonRef} variant="ghost" size="xxs" iconOnly icon={isExpanded ? 'Collapse' : 'Expand'} tabIndex={-1} className="sheet-expand-button" aria-label={isExpanded ? expandCellMessages.collapse() : expandCellMessages.expand()} shortcut={shortcutKeysFor('expandCell')} data-stands-in={isExpanded ? 'card' : expandButtonStandsIn} {...paintDataAttributes(paints)} style={{
      ...expandButtonPlace(outlineBoxInBody(box, body), isExpanded ? EXPAND_BUTTON_CARD_INSET : 0),
      ...fillPaintStyle(paints.fill),
      ...textPaintStyle(paints.text),
      ...(isHeldAfterPress && {
        pointerEvents: 'none',
      }),
    }} onKeyDown={stopEnterOrSpacePropagation} onKeyUp={stopEnterOrSpacePropagation} onClick={pressSwallowingRest(onPressed)} {...{
      [EXPANDED_ENTRY_ATTRIBUTE]: '',
    }} />;
}
export const expandCellMessages = {
  expand: () =>
    translateMessage({
      defaultMessage: 'Expand cell',
      id: 'zkU0dCLYF6',
    }),
  collapse: () =>
    translateMessage({
      defaultMessage: 'Collapse cell',
      id: 'Mhm03XO/j3',
    }),
  finish: () =>
    translateMessage({
      defaultMessage: 'Done',
      id: 'jUjL/MeZiM',
    }),
};
export const OFFERS_AT_SELECTION_ATTRIBUTE = 'data-is-offers-at-selection';
export const OFFERS_AT_SELECTION_BUTTONS_SELECTOR = `[${OFFERS_AT_SELECTION_ATTRIBUTE}] button`;
export const isInOffersAtSelection = (element: EventTarget | null) =>
  element instanceof Element && element.closest(`[${OFFERS_AT_SELECTION_ATTRIBUTE}]`) !== null;
export const OFFER_ICON_SIZE = 20;
export const SHORT_OFFER_ICON_SIZE = 16;
export const OFFERS_AFTER_REST_GUARD_MS = 250;
export const POINTER_STILL_PX = 3;
export const EXPANDED_ENTRY_ATTRIBUTE = 'data-is-of-expanded-entry';
export const isInExpandedEntry = (element: EventTarget | null) =>
  element instanceof Element && element.closest(`[${EXPANDED_ENTRY_ATTRIBUTE}]`) !== null;
export const EXPAND_BUTTON_INSET = 3;
export const EXPAND_BUTTON_CARD_INSET = 4;
export const expandButtonPlace = ({ left, top, width, height }: PaneRect, inset: number) => ({
  left: left + width - EXPAND_BUTTON_INSET - inset - EXPAND_BUTTON_SIZE / 2,
  top: top + Math.min(height / 2, EXPAND_BUTTON_INSET + 1 + inset + EXPAND_BUTTON_SIZE / 2),
});
export const entryBoxAsWide = (editorBox: DrawnBox, width: number, body: PaneRect): DrawnBox => ({
  ...editorBox,
  width: width - (outlineBoxInBody(editorBox, body).width - editorBox.width),
  showsIn: {
    ...editorBox.showsIn,
    width: body.width - editorBox.showsIn.left,
    height: body.height - editorBox.showsIn.top,
  },
});
export const pressSwallowingRest =
  (action: () => void) =>
  (event: PressToSwallow) => {
    swallowRestOfPress(event);
    action();
  };
