import * as React from 'react';
import { cn } from './cn.ts';
import { useKitLabel } from './labels.tsx';
import { LayerBaseContext, type OverlayLayer } from './layers.tsx';
import { COARSE_POINTER_MEDIA_QUERY, NARROW_VIEWPORT_MEDIA_QUERY, subscribeSheetMedia, windowMatchesMedia } from './platform.ts';
import { PopupScope } from './popup.tsx';
import { useUiWindow } from './theme.tsx';

/** What a popup's focus does when it closes: the element to focus, `true` for the default, `false` to leave it. */
export type PopupFinalFocus =
  | boolean
  | React.RefObject<HTMLElement | null>
  | ((closeType: 'mouse' | 'touch' | 'pen' | 'keyboard' | '') => void | boolean | HTMLElement | null)
  | undefined;

export type PopupPadding = 'none' | 'xs' | 'sm' | 'md' | 'lg';

export const POPUP_SURFACE_CLASSES =
  'ui-reset relative bg-surface-popover text-primary shadow-popover rounded-panel text-body font-normal outline-none focus-visible:outline-hidden';

export const POPUP_MOTION_CLASSES =
  'origin-[var(--transform-origin)] transition-[opacity,scale] duration-snap ease-snap motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[instant]:duration-0';

export const SHEET_MAX_HEIGHT = 'calc((100dvh - env(safe-area-inset-top)) * 0.9)';

export const SHEET_SURFACE_CLASSES =
  'flex w-full max-w-none flex-col max-h-[calc((100dvh-env(safe-area-inset-top))*0.9)] rounded-b-none rounded-t-[calc(var(--ui-radius)*3)] pb-[env(safe-area-inset-bottom)] transition-transform duration-sheet ease-snap motion-reduce:transition-none data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full';

/** Pins a positioner to the foot of the window, over whatever placement it worked out. */
export const SHEET_POSITIONER_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 'auto',
  left: 0,
  right: 0,
  bottom: 0,
  transform: 'none',
  width: 'auto',
  maxWidth: 'none',
};

export const POPUP_PADDING_CLASSES: Readonly<Record<PopupPadding, string>> = {
  none: 'p-0 [--ui-band-bleed:initial]',
  xs: 'p-xs [--ui-band-bleed:var(--ui-pad-xs)]',
  sm: 'p-sm [--ui-band-bleed:var(--ui-pad-sm)]',
  md: 'p-md [--ui-band-bleed:var(--ui-pad-md)]',
  lg: 'p-lg [--ui-band-bleed:var(--ui-pad-lg)]',
};

/** Marks the element that scrolls inside a popup, which the page looks for on small screens. */
export const POPUP_SCROLL_ATTRIBUTE = 'data-ui-sheet-scroll';

const EDITABLE_SELECTOR =
  'input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=color],[type=file],[type=image],[type=hidden],[readonly]), textarea:not([readonly]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Popups open as a sheet from the foot of the window on a narrow touch screen. */
export function matchesSheetPresentation(win: Window | null | undefined): boolean {
  return windowMatchesMedia(COARSE_POINTER_MEDIA_QUERY, win) && windowMatchesMedia(NARROW_VIEWPORT_MEDIA_QUERY, win);
}

export function useSheetPresentation(): boolean {
  const win = useUiWindow();
  const subscribe = React.useCallback((onChange: () => void) => subscribeSheetMedia(onChange, win), [win]);
  return React.useSyncExternalStore(
    subscribe,
    () => matchesSheetPresentation(win),
    () => false,
  );
}

const SheetPresentationContext = React.createContext(false);

export function SheetPresentationProvider({ sheet, children }: { sheet: boolean; children?: React.ReactNode }): React.ReactElement {
  return <SheetPresentationContext.Provider value={sheet}>{children}</SheetPresentationContext.Provider>;
}

/** Whether the popup being rendered shows as a sheet. */
export function useIsSheet(): boolean {
  return React.useContext(SheetPresentationContext);
}

/** The portalled part of a popup: the root's tokens, and the stacking band its own popups open from. */
export function PopupLayerScope({
  layer,
  sheet = false,
  children,
}: {
  layer: OverlayLayer;
  sheet?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <PopupScope density={sheet ? 'comfortable' : undefined}>
      <LayerBaseContext.Provider value={layer.base}>{children}</LayerBaseContext.Provider>
    </PopupScope>
  );
}

/** Dims the page behind a sheet; a press on it lands outside the popup and closes it. */
export function SheetBackdrop({ layer }: { layer: OverlayLayer }): React.ReactElement {
  return (
    <div
      aria-hidden
      className="fixed inset-0 bg-[var(--ui-backdrop,rgb(0_0_0/0.32))] transition-opacity duration-sheet motion-reduce:transition-none starting:opacity-0"
      style={{ zIndex: layer.style.zIndex }}
    />
  );
}

/** The top of a sheet: its title, and a close button for screen readers. */
export function SheetTitleBar({
  title,
  closeLabel,
  onClose,
}: {
  title?: React.ReactNode;
  closeLabel?: string;
  onClose: () => void;
}): React.ReactElement {
  const dismiss = useKitLabel('dismiss');
  return (
    <div className="flex shrink-0 flex-col items-center gap-xs px-lg pt-sm">
      <span aria-hidden className="h-1 w-9 rounded-full bg-[var(--ui-border-strong)]" />
      {title !== undefined && title !== null && title !== '' && (
        <div className="w-full truncate pb-xs text-center text-body-semibold">{title}</div>
      )}
      <button type="button" className="sr-only" onClick={onClose}>
        {closeLabel ?? dismiss}
      </button>
    </div>
  );
}

/** Grows a sheet to its full height when it holds a field to type in, so the keyboard does not cover it. */
export function useTallSheet(enabled: boolean, body: React.RefObject<HTMLElement | null>): boolean {
  const [tall, setTall] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!enabled) {
      setTall(false);
      return;
    }
    setTall(body.current?.querySelector(EDITABLE_SELECTOR) != null);
  }, [enabled, body]);
  return tall;
}

interface PointerPress {
  pointerId: number;
  /** When the press went down, on the page's clock. */
  downAt: number;
  /** When it was let go or cancelled, if it has been. */
  upAt: number | undefined;
  byFinger: boolean;
}

/** The last press on each document, kept from the start so a press made before a sheet opened is known. */
const lastPressByDocument = new WeakMap<Document, PointerPress | null>();

/** How far an event's own time may lag the clock and still be trusted as when it happened. */
const EVENT_TIME_TRUST_MS = 1000;

const isFingerLike = (pointerType: string): boolean => pointerType === 'touch' || pointerType === 'pen';

function watchPresses(doc: Document): void {
  if (lastPressByDocument.has(doc)) return;
  lastPressByDocument.set(doc, null);
  const now = (): number => doc.defaultView?.performance.now() ?? 0;
  doc.addEventListener(
    'pointerdown',
    (event) => {
      const clock = now();
      const lag = clock - event.timeStamp;
      const downAt = event.timeStamp > 0 && lag >= 0 && lag <= EVENT_TIME_TRUST_MS ? event.timeStamp : clock;
      lastPressByDocument.set(doc, { pointerId: event.pointerId, downAt, upAt: undefined, byFinger: isFingerLike(event.pointerType) });
    },
    true,
  );
  const onPressEnd = (event: PointerEvent): void => {
    const press = lastPressByDocument.get(doc);
    if (press && press.upAt === undefined && press.pointerId === event.pointerId) press.upAt = now();
  };
  doc.addEventListener('pointerup', onPressEnd, true);
  doc.addEventListener('pointercancel', onPressEnd, true);
}

if (typeof document !== 'undefined') watchPresses(document);

function cssDurationMs(value: string): number {
  const amount = Number.parseFloat(value);
  if (Number.isNaN(amount)) return 0;
  return value.trim().endsWith('ms') ? amount : amount * 1000;
}

const ENTRY_TAP_EVENTS = ['mousedown', 'mouseup', 'click'] as const;

/**
 * A finger that lands while a sheet is still sliding in meant whatever was under it before the
 * sheet arrived: the mouse events that touch sends on to the sheet are swallowed.
 */
export function useSwallowSheetEntryTaps(sheet: HTMLElement | null, open: boolean): void {
  React.useLayoutEffect(() => {
    const doc = sheet?.ownerDocument;
    const view = doc?.defaultView ?? null;
    if (!sheet || !doc || view === null || !open) return undefined;
    watchPresses(doc);
    const slideMs = cssDurationMs(view.getComputedStyle(sheet).getPropertyValue('--ui-dur-sheet'));
    const openedAt = view.performance.now();
    let slideStartedAt = openedAt;
    let slideEndedAt = Number.POSITIVE_INFINITY;
    const onSlideRun = (event: TransitionEvent): void => {
      if (event.target !== sheet || event.propertyName !== 'translate') return;
      slideStartedAt = view.performance.now();
      sheet.removeEventListener('transitionrun', onSlideRun);
    };
    const onSlideEnd = (event: TransitionEvent): void => {
      if (event.target === sheet && event.propertyName === 'translate') slideEndedAt = view.performance.now();
    };
    const stopWaitingForSlide = view.setTimeout(() => sheet.removeEventListener('transitionrun', onSlideRun), slideMs);
    const landedWhileSliding = (event: MouseEvent): boolean => {
      const press = lastPressByDocument.get(doc);
      if (press === undefined || press === null) return event instanceof view.PointerEvent && isFingerLike(event.pointerType);
      const letGoBeforeOpen = press.upAt !== undefined && press.upAt < openedAt;
      return press.byFinger && !letGoBeforeOpen && press.downAt - slideStartedAt < slideMs && press.downAt < slideEndedAt;
    };
    const swallow = (event: MouseEvent): void => {
      if (event.detail === 0 || !landedWhileSliding(event)) return;
      event.stopPropagation();
      if (event.type === 'click') event.preventDefault();
    };
    sheet.addEventListener('transitionrun', onSlideRun);
    sheet.addEventListener('transitionend', onSlideEnd);
    for (const type of ENTRY_TAP_EVENTS) sheet.addEventListener(type, swallow, true);
    return () => {
      view.clearTimeout(stopWaitingForSlide);
      sheet.removeEventListener('transitionrun', onSlideRun);
      sheet.removeEventListener('transitionend', onSlideEnd);
      for (const type of ENTRY_TAP_EVENTS) sheet.removeEventListener(type, swallow, true);
    };
  }, [sheet, open]);
}

/** Sizes a list to show `count` rows before it scrolls. */
export function visibleRowsMaxHeight(count: number, withHeader: boolean): string {
  const gutter = withHeader ? 'var(--ui-menu-gutter) + 0.25rem' : '2 * var(--ui-menu-gutter)';
  return `calc(${count} * max(var(--ui-h-control), var(--ui-leading-body)) + ${gutter})`;
}

export interface PopupScrollAreaProps {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  maxVisibleItems?: number;
  className?: string;
  children?: React.ReactNode;
}

/** A popup's rows between a fixed header and footer, scrolling with faded edges. */
export function PopupScrollArea({ header, footer, maxVisibleItems, className, children }: PopupScrollAreaProps): React.ReactElement {
  const hasHeader = header !== undefined && header !== null && header !== false;
  const hasFooter = footer !== undefined && footer !== null && footer !== false;
  return (
    <>
      {hasHeader && <div className="shrink-0 px-[var(--ui-menu-gutter)] pt-[var(--ui-menu-gutter)]">{header}</div>}
      <div
        {...{ [POPUP_SCROLL_ATTRIBUTE]: '' }}
        className={cn(
          'relative min-h-0 flex-auto overflow-y-auto overflow-x-hidden scroll-fade-y p-[var(--ui-menu-gutter)]',
          hasHeader && 'pt-0',
          hasFooter && 'pb-0',
          className,
        )}
        style={maxVisibleItems === undefined ? undefined : { maxHeight: visibleRowsMaxHeight(maxVisibleItems, hasHeader) }}
      >
        {children}
      </div>
      {hasFooter && <div className="shrink-0 px-[var(--ui-menu-gutter)] pb-[var(--ui-menu-gutter)]">{footer}</div>}
    </>
  );
}

/**
 * Remembers what had focus when an anchored popup opened and returns focus there on close,
 * but only when focus is still in the popup or has fallen to the page body.
 */
export function useOpenerFocusReturn(
  enabled: boolean,
  fallback = true,
): {
  popupRef: (node: HTMLElement | null) => void;
  finalFocus: PopupFinalFocus;
} {
  const popup = React.useRef<HTMLElement | null>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const popupRef = React.useCallback((node: HTMLElement | null) => {
    popup.current = node;
    if (node === null) return;
    const active = node.ownerDocument.activeElement;
    opener.current = active instanceof HTMLElement && active !== node.ownerDocument.body && !node.contains(active) ? active : null;
  }, []);
  const finalFocus = React.useCallback((): boolean | HTMLElement => {
    const node = popup.current;
    const doc = node?.ownerDocument;
    const active = doc?.activeElement ?? null;
    if (node && active !== null && active !== doc?.body && !node.contains(active)) return false;
    const target = opener.current;
    return target !== null && target.isConnected ? target : fallback;
  }, [fallback]);
  return { popupRef, finalFocus: enabled ? finalFocus : undefined };
}

function isScrollbarPress(event: React.MouseEvent, element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const { offsetX, offsetY } = event.nativeEvent;
  return (element.clientWidth > 0 && offsetX > element.clientWidth) || (element.clientHeight > 0 && offsetY > element.clientHeight);
}

/** Whether a press inside a popup lands on something that needs focus to work. */
export function isInteractivePopupTarget(event: React.MouseEvent<HTMLElement>, { draggable = false } = {}): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (target === null) return false;
  const within = (selector: string): boolean => {
    const match = target.closest(selector);
    return match !== null && event.currentTarget.contains(match);
  };
  return (
    target.matches(EDITABLE_SELECTOR) ||
    target.matches('input[type="range"], select, input[readonly], textarea[readonly]') ||
    within('select') ||
    (draggable && within('[draggable="true"]')) ||
    isScrollbarPress(event, target)
  );
}

/** Keeps focus where it is when the popup is pressed anywhere that does not need it. */
export function keepFocusOnPress(event: React.MouseEvent<HTMLElement>): void {
  if (!isInteractivePopupTarget(event, { draggable: true })) event.preventDefault();
}

export interface InnerOverlay {
  isOpen: () => boolean;
  close: (event: Event | undefined) => void;
}

export interface InnerOverlayRegistry {
  add: (overlay: InnerOverlay) => () => void;
  /** Closes the newest open overlay inside; false when none is open. */
  closeTop: (event: Event | undefined) => boolean;
}

export function createInnerOverlayRegistry(): InnerOverlayRegistry {
  const overlays: InnerOverlay[] = [];
  return {
    add(overlay) {
      overlays.push(overlay);
      return () => {
        const index = overlays.indexOf(overlay);
        if (index !== -1) overlays.splice(index, 1);
      };
    },
    closeTop(event) {
      for (let index = overlays.length - 1; index >= 0; index -= 1) {
        const overlay = overlays[index];
        if (overlay?.isOpen()) {
          overlay.close(event);
          return true;
        }
      }
      return false;
    },
  };
}

/** The overlays, such as menus, opened from inside a popover, so Escape closes them before it. */
export const InnerOverlayContext = React.createContext<InnerOverlayRegistry | null>(null);

/** Registers an overlay with the popover around it while it is mounted. */
export function useInnerOverlay(isOpen: () => boolean, close: (event: Event | undefined) => void): void {
  const registry = React.useContext(InnerOverlayContext);
  const latest = React.useRef({ isOpen, close });
  latest.current = { isOpen, close };
  React.useEffect(() => {
    if (registry === null) return undefined;
    return registry.add({
      isOpen: () => latest.current.isOpen(),
      close: (event) => latest.current.close(event),
    });
  }, [registry]);
}

/** Joins refs into one callback ref. */
export function useMergedRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  const latest = React.useRef(refs);
  latest.current = refs;
  return React.useCallback((node: T | null) => {
    for (const ref of latest.current) {
      if (typeof ref === 'function') ref(node);
      else if (ref !== null && ref !== undefined) (ref as React.MutableRefObject<T | null>).current = node;
    }
  }, []);
}
