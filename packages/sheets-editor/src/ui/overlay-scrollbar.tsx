import * as React from 'react';
/** Where the thumb of an overlay scrollbar is drawn, from the bottom of what scrolls. */
export interface OverlayThumb {
  top: number;
  height: number;
  /** From the inline end of what scrolls. */
  fromEnd: number;
}
/** The padding of what scrolls that the thumb keeps clear of. */
export interface ScrollerPadding {
  bottom: number;
  inlineEnd: number;
}
interface ThumbDrag {
  /** Where the pointer went down along the scrollbar. */
  from: number;
  pointerId: number;
  /** The pointer is up, though its capture is not yet released. */
  isOver: boolean;
}
export function overlayScrollbarThumb(
  { scrollHeight, clientHeight, scrollTop }: Pick<Element, 'scrollHeight' | 'clientHeight' | 'scrollTop'>,
  padding: ScrollerPadding,
): OverlayThumb | null {
  if (scrollHeight <= clientHeight + 1) return null;
  const thumbHeight = Math.max(OVERLAY_SCROLLBAR_MIN_THUMB_PX, Math.round((clientHeight / scrollHeight) * clientHeight));
  return {
    top: Math.round((scrollTop / (scrollHeight - clientHeight)) * (clientHeight - thumbHeight)) - clientHeight + padding.bottom,
    height: thumbHeight,
    fromEnd: OVERLAY_SCROLLBAR_INSET_PX - padding.inlineEnd,
  };
}
export function thumbDragToScroll(
  dragDelta: number,
  { scrollHeight, clientHeight }: Pick<Element, 'scrollHeight' | 'clientHeight'>,
  thumbHeight: number,
) {
  const trackRoom = clientHeight - thumbHeight;
  return trackRoom <= 0 ? 0 : (dragDelta * (scrollHeight - clientHeight)) / trackRoom;
}
export function useOverlayScrollbarVisibility(anchorRef: React.RefObject<HTMLElement | null>) {
  const [areShown, setAreShown] = React.useState(false);
  const isPointerOverRef = React.useRef(false);
  const isHeldRef = React.useRef(false);
  const hideTimerRef = React.useRef<number | null>(null);
  const hideLater = React.useCallback(() => {
    const view = anchorRef.current?.ownerDocument.defaultView ?? null;
    if (view === null) return;
    if (hideTimerRef.current !== null) view.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = view.setTimeout(() => {
      hideTimerRef.current = null;
      if (!isPointerOverRef.current && !isHeldRef.current) setAreShown(false);
    }, OVERLAY_SCROLLBAR_HIDE_DELAY_MS);
  }, [anchorRef]);
  const moved = React.useCallback(() => {
    setAreShown(true);
    hideLater();
  }, [hideLater]);
  const held = React.useCallback(
    (isHeld: boolean) => {
      if (isHeldRef.current === isHeld) return;
      isHeldRef.current = isHeld;
      moved();
    },
    [moved],
  );
  React.useEffect(() => {
    const scroller = anchorRef.current?.parentElement ?? null;
    const view = scroller?.ownerDocument.defaultView ?? null;
    if (scroller === null || view === null) return;
    const onPointerEnter = () => {
      isPointerOverRef.current = true;
      setAreShown(true);
    };
    const onPointerLeave = () => {
      isPointerOverRef.current = false;
      if (!isHeldRef.current) hideLater();
    };
    scroller.addEventListener('pointerenter', onPointerEnter);
    scroller.addEventListener('pointerleave', onPointerLeave);
    return () => {
      scroller.removeEventListener('pointerenter', onPointerEnter);
      scroller.removeEventListener('pointerleave', onPointerLeave);
      if (hideTimerRef.current !== null) view.clearTimeout(hideTimerRef.current);
    };
  }, [anchorRef, hideLater]);
  return {
    areShown,
    moved,
    held,
  };
}
export interface OverlayScrollbarThumbProps {
  along: 'x' | 'y';
  isShown: boolean;
  /** Lets a touch drag the thumb, not only a mouse or pen. */
  isForFingersToo?: boolean;
  style: React.CSSProperties;
  onHeld: (isHeld: boolean) => void;
  /** Called with how far the pointer has moved along the scrollbar since it went down. */
  onDragged: (dragDelta: number) => void;
}
export function OverlayScrollbarThumb({
  along,
  isShown,
  isForFingersToo = true,
  style,
  onHeld,
  onDragged,
}: OverlayScrollbarThumbProps) {
  const [isDragged, setIsDragged] = React.useState(false);
  const dragRef = React.useRef<ThumbDrag | null>(null);
  const releaseOnUnmount = React.useEffectEvent(() => {
    if (dragRef.current?.isOver === false) onHeld(false);
  });
  React.useEffect(() => () => releaseOnUnmount(), []);
  const pointerPosition = (pointer: Pick<PointerEvent, 'clientX' | 'clientY'>) => (along === 'y' ? pointer.clientY : pointer.clientX);
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const { isOver: wasOver } = dragRef.current;
    const hadCapture = event.currentTarget.hasPointerCapture(event.pointerId);
    dragRef.current = hadCapture
      ? {
          ...dragRef.current,
          isOver: true,
        }
      : null;
    if (hadCapture) event.currentTarget.releasePointerCapture(event.pointerId);
    if (wasOver) return;
    setIsDragged(false);
    onHeld(false);
  };
  return <div role="presentation" data-along={along} data-is-shown={isShown} data-dragged={isDragged ? '' : undefined} className={`absolute cursor-default touch-none rounded-full bg-alpha-3 transition-opacity duration-150 select-none hover:bg-alpha-4 data-dragged:bg-alpha-4 motion-reduce:transition-none forced-colors:border-3 ${isShown ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} style={style} onMouseDown={(event) => event.preventDefault()} onDoubleClick={(event) => event.stopPropagation()} onPointerDown={(event) => {
      const isUnwantedTouch = !isForFingersToo && event.pointerType === 'touch';
      if (event.button !== 0 || event.ctrlKey || isUnwantedTouch) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      dragRef.current = {
        from: pointerPosition(event),
        pointerId: event.pointerId,
        isOver: false,
      };
      setIsDragged(true);
      onHeld(true);
    }} onPointerMove={(event) => {
      if (dragRef.current?.pointerId !== event.pointerId || dragRef.current.isOver) return;
      if ((event.buttons & 1) === 0) endDrag(event);
      else onDragged(pointerPosition(event) - dragRef.current.from);
    }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} />;
}
export function OverlayScrollbar() {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<OverlayThumb | null>(null);
  const { areShown, moved, held } = useOverlayScrollbarVisibility(anchorRef);
  const scrollTopAtHoldRef = React.useRef(0);
  React.useEffect(() => {
    const scroller = anchorRef.current?.parentElement ?? null;
    const view = scroller?.ownerDocument.defaultView ?? null;
    if (scroller === null || view === null) return;
    let frame: number | null = null;
    const measureSoon = () => {
      frame ??= view.requestAnimationFrame(() => {
        frame = null;
        const { paddingBottom, paddingInlineEnd } = view.getComputedStyle(scroller);
        const nextThumb = overlayScrollbarThumb(scroller, {
          bottom: parseCssNumberOrZero(paddingBottom),
          inlineEnd: parseCssNumberOrZero(paddingInlineEnd),
        });
        setThumb((shownThumb) => (isSameThumb(shownThumb, nextThumb) ? shownThumb : nextThumb));
      });
    };
    const onScroll = () => {
      measureSoon();
      moved();
    };
    scroller.addEventListener('scroll', onScroll, {
      passive: true,
    });
    scroller.addEventListener('pointerenter', measureSoon);
    const resizeObserver = new view.ResizeObserver(measureSoon);
    resizeObserver.observe(scroller);
    const mutationObserver = new view.MutationObserver(measureSoon);
    mutationObserver.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    measureSoon();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('pointerenter', measureSoon);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (frame !== null) view.cancelAnimationFrame(frame);
    };
  }, [moved]);
  return <div ref={anchorRef} aria-hidden className="sticky bottom-0 h-0 w-full shrink-0 overflow-visible">{thumb !== null &&
      (<OverlayScrollbarThumb along="y" isShown={areShown} style={{
          width: OVERLAY_SCROLLBAR_WIDTH_PX,
          insetInlineEnd: thumb.fromEnd,
          top: thumb.top,
          height: thumb.height,
        }} onHeld={(isHeld) => {
          scrollTopAtHoldRef.current = anchorRef.current?.parentElement?.scrollTop ?? 0;
          held(isHeld);
        }} onDragged={(dragDelta) => {
          const scroller = anchorRef.current?.parentElement ?? null;
          if (scroller === null) return;
          scroller.scrollTo({
            top: scrollTopAtHoldRef.current + thumbDragToScroll(dragDelta, scroller, thumb.height),
            behavior: 'instant',
          });
        }} />)}</div>;
}
export const HIDDEN_SCROLLBAR_CLASSES = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
export const OVERLAY_SCROLLBAR_WIDTH_PX = 6;
export const OVERLAY_SCROLLBAR_INSET_PX = 2;
export const OVERLAY_SCROLLBAR_MIN_THUMB_PX = 24;
export const OVERLAY_SCROLLBAR_HIDE_DELAY_MS = 800;
export const parseCssNumberOrZero = (cssValue: string) => {
  const parsed = Number.parseFloat(cssValue);
  return Number.isNaN(parsed) ? 0 : parsed;
};
export const isSameThumb = (thumb: OverlayThumb | null, otherThumb: OverlayThumb | null) =>
  thumb?.top === otherThumb?.top && thumb?.height === otherThumb?.height && thumb?.fromEnd === otherThumb?.fromEnd;
