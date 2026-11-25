import * as React from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Button } from './button.tsx';
import { cn } from './cn.ts';
import { useKitLabel } from './labels.tsx';
import { OVERLAY_ATTRIBUTE, useOverlayLayer } from './layers.tsx';
import {
  InnerOverlayContext,
  POPUP_MOTION_CLASSES,
  POPUP_PADDING_CLASSES,
  POPUP_SCROLL_ATTRIBUTE,
  POPUP_SURFACE_CLASSES,
  PopupLayerScope,
  SHEET_POSITIONER_STYLE,
  SHEET_SURFACE_CLASSES,
  SheetBackdrop,
  SheetPresentationProvider,
  SheetTitleBar,
  createInnerOverlayRegistry,
  isInteractivePopupTarget,
  useIsSheet,
  useMergedRefs,
  useOpenerFocusReturn,
  useSheetPresentation,
  useSwallowSheetEntryTaps,
  useTallSheet,
  type PopupFinalFocus,
  type PopupPadding,
} from './popup-frame.tsx';
import { useScrollableOverflow } from './scrollable-overflow.ts';
import { tabStopsWithin } from './tab-stops.ts';

type PositionerProps = BasePopover.Positioner.Props;
type OpenChangeDetails = BasePopover.Root.ChangeEventDetails;

const POPOVER_POPUP_CLASSES = `${POPUP_SURFACE_CLASSES} max-w-[320px] max-h-[var(--available-height)]`;

const POPOVER_BODY_CLASSES =
  '[display:inherit] [flex-direction:inherit] [flex-wrap:inherit] [align-items:inherit] [justify-content:inherit] [justify-items:inherit] [gap:inherit] [grid-template-columns:inherit] [grid-template-rows:inherit] [grid-auto-flow:inherit] [grid-auto-columns:inherit] [grid-auto-rows:inherit] col-span-full row-span-full self-stretch justify-self-stretch max-h-[inherit] min-h-0 min-w-0 flex-auto overflow-y-auto rounded-[inherit] outline-none focus-visible:outline-hidden';

/** A popover not exposed as a dialog: its body is not given a name and a tab stop of its own. */
const PRESENTATIONAL_OVERLAY_SELECTOR = '[role="presentation"], [role="none"], [aria-hidden="true"]';
/** A row of a roving-focus group that holds the group's tab stop. */
const ROVING_TAB_STOP_SELECTOR = '[data-tabindex]:not([data-tabindex="-1"])';

const POINTER_OPEN_TYPES = new Set(['mouse', 'touch', 'pen']);

const EDITABLE_SELECTOR =
  'input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=color],[type=file],[type=image],[type=hidden],[readonly]), textarea:not([readonly]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

interface PopoverRootState {
  open: boolean;
  close: () => void;
}

const PopoverRootContext = React.createContext<PopoverRootState | null>(null);

export type PopoverRootProps = BasePopover.Root.Props;

/**
 * The root of a popover. Escape first closes a menu opened inside it, and only then the popover.
 */
function PopoverRoot({ open, defaultOpen, onOpenChange, actionsRef, children, ...rest }: PopoverRootProps): React.ReactElement {
  const [registry] = React.useState(createInnerOverlayRegistry);
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen ?? false);
  const isOpen = open ?? ownOpen;
  const sheet = useSheetPresentation();
  const actions = React.useRef<BasePopover.Root.Actions | null>(null);
  React.useEffect(() => {
    if (actionsRef) actionsRef.current = actions.current;
  });
  const handleOpenChange = React.useCallback(
    (next: boolean, details: OpenChangeDetails) => {
      if (!next && details.reason === 'escape-key' && registry.closeTop(details.event)) {
        details.cancel();
        return;
      }
      onOpenChange?.(next, details);
      if (!details.isCanceled) setOwnOpen(next);
    },
    [registry, onOpenChange],
  );
  const state = React.useMemo<PopoverRootState>(() => ({ open: isOpen, close: () => actions.current?.close() }), [isOpen]);
  return (
    <PopoverRootContext.Provider value={state}>
      <InnerOverlayContext.Provider value={registry}>
        <SheetPresentationProvider sheet={sheet}>
          <BasePopover.Root {...rest} open={open} defaultOpen={defaultOpen} actionsRef={actions} onOpenChange={handleOpenChange}>
            {children}
          </BasePopover.Root>
        </SheetPresentationProvider>
      </InnerOverlayContext.Provider>
    </PopoverRootContext.Provider>
  );
}

/** A popover that declines focus beside a field stays next to it on a touch screen, so typing goes on. */
function anchorKeepsPlace(anchor: PositionerProps['anchor']): boolean {
  if (anchor === undefined || anchor === null) return false;
  const element = anchor instanceof Element ? anchor : 'current' in anchor ? anchor.current : undefined;
  if (element === undefined) return true;
  if (!(element instanceof Element)) return false;
  return element.matches(EDITABLE_SELECTOR) || element.querySelector(EDITABLE_SELECTOR) !== null || element.closest(EDITABLE_SELECTOR) !== null;
}

export type PopoverTriggerProps = BasePopover.Trigger.Props;

const PopoverTrigger = React.forwardRef<HTMLButtonElement, PopoverTriggerProps>(function PopoverTrigger(props, ref) {
  return <BasePopover.Trigger ref={ref} {...props} />;
});

export interface PopoverPopupProps extends Omit<BasePopover.Popup.Props, 'className' | 'finalFocus'> {
  side?: PositionerProps['side'];
  align?: PositionerProps['align'];
  sideOffset?: PositionerProps['sideOffset'];
  alignOffset?: PositionerProps['alignOffset'];
  anchor?: PositionerProps['anchor'];
  collisionAvoidance?: PositionerProps['collisionAvoidance'];
  collisionPadding?: PositionerProps['collisionPadding'];
  finalFocus?: PopupFinalFocus;
  /** Space between the edge and the content. */
  padding?: PopupPadding;
  /** Fades the content where it scrolls under the edges. */
  scrollFade?: boolean;
  /** Leaves focus where it was when the popover is pressed somewhere that does not need it. */
  keepFocus?: boolean;
  /** As a sheet, grows to full height when it holds a field to type in. */
  sheetHeight?: 'tall';
  closeLabel?: string;
  className?: string;
  'data-ui'?: string;
}

/** The popover itself: placed beside its trigger or anchor, or as a sheet on a small touch screen. */
const PopoverPopup = React.forwardRef<HTMLDivElement, PopoverPopupProps>(function PopoverPopup(
  {
    side = 'bottom',
    align = 'center',
    sideOffset = 6,
    alignOffset,
    anchor,
    collisionAvoidance,
    collisionPadding,
    padding = 'lg',
    scrollFade = true,
    keepFocus = false,
    sheetHeight,
    closeLabel,
    initialFocus,
    finalFocus,
    className,
    children,
    onFocus,
    onMouseDown,
    ...rest
  },
  ref,
) {
  const root = React.useContext(PopoverRootContext);
  const sheet = useIsSheet() && !(initialFocus === false && anchorKeepsPlace(anchor));
  const layer = useOverlayLayer('popover');
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const tall = useTallSheet(sheet && sheetHeight === 'tall', bodyRef);
  const returnsToOpener = anchor !== undefined && anchor !== null && finalFocus === undefined;
  const opener = useOpenerFocusReturn(returnsToOpener);
  const [popupElement, setPopupElement] = React.useState<HTMLDivElement | null>(null);
  const mergedRef = useMergedRefs<HTMLDivElement>(ref, opener.popupRef, setPopupElement);
  useSwallowSheetEntryTaps(sheet ? popupElement : null, root?.open ?? false);

  // Opened by touch, or with nothing inside to tab to, focus goes to the popover itself.
  const openedByPointer = React.useRef(false);
  const focusOnOpen = (openType: string): HTMLDivElement | null | true => {
    openedByPointer.current = POINTER_OPEN_TYPES.has(openType);
    const body = bodyRef.current;
    return openType === 'touch' || (body !== null && tabStopsWithin(body).length === 0) ? popupElement : true;
  };

  return (
    <BasePopover.Portal>
      <SheetPresentationProvider sheet={sheet}>
        <PopupLayerScope layer={layer} sheet={sheet}>
          {sheet && <SheetBackdrop layer={layer} />}
          <BasePopover.Positioner
            style={sheet ? { ...layer.style, ...SHEET_POSITIONER_STYLE } : layer.style}
            className="data-[anchor-hidden]:invisible"
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            anchor={anchor}
            collisionAvoidance={collisionAvoidance}
            collisionPadding={collisionPadding}
          >
            <BasePopover.Popup
              data-ui="Popover"
              {...{ [OVERLAY_ATTRIBUTE]: '' }}
              data-presentation={sheet ? 'sheet' : undefined}
              {...rest}
              ref={mergedRef}
              initialFocus={sheet || initialFocus === undefined ? focusOnOpen : initialFocus}
              finalFocus={returnsToOpener ? opener.finalFocus : finalFocus}
              onFocus={(event) => {
                onFocus?.(event);
                const popup = event.currentTarget;
                if (event.target !== popup || popup.ownerDocument.activeElement !== popup) return;
                bodyRef.current?.focus(openedByPointer.current ? { preventScroll: true, focusVisible: false } : { preventScroll: true });
              }}
              onMouseDown={(event) => {
                onMouseDown?.(event);
                if (sheet || !keepFocus || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
                if (!isInteractivePopupTarget(event, { draggable: true })) event.preventDefault();
              }}
              className={cn(
                POPOVER_POPUP_CLASSES,
                sheet ? SHEET_SURFACE_CLASSES : POPUP_MOTION_CLASSES,
                tall && 'h-[calc((100dvh-env(safe-area-inset-top))*0.9)]',
                !sheet && className,
              )}
            >
              {sheet && <SheetTitleBar closeLabel={closeLabel} onClose={() => root?.close()} />}
              <PopoverBody
                ref={bodyRef}
                className={cn(POPOVER_BODY_CLASSES, scrollFade && 'scroll-fade-y', POPUP_PADDING_CLASSES[padding], sheet && className)}
              >
                {children}
              </PopoverBody>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </PopupLayerScope>
      </SheetPresentationProvider>
    </BasePopover.Portal>
  );
});

interface PopoverBodyProps {
  className: string;
  children?: React.ReactNode;
}

interface BodyStop {
  /** The body scrolls with nothing inside to tab to, so it takes a tab stop itself to be scrolled from the keyboard. */
  needed: boolean;
  labelledBy: string | null;
  label: string | null;
}

const NO_BODY_STOP: BodyStop = { needed: false, labelledBy: null, label: null };

const sameBodyStop = (a: BodyStop, b: BodyStop): boolean => a.needed === b.needed && a.labelledBy === b.labelledBy && a.label === b.label;

/** The scrolling part of a popover. While it scrolls and holds no tab stop, it is a named group Tab reaches. */
const PopoverBody = React.forwardRef<HTMLDivElement, PopoverBodyProps>(function PopoverBody({ className, children }, ref) {
  const [body, setBody] = React.useState<HTMLDivElement | null>(null);
  const mergedRef = useMergedRefs<HTMLDivElement>(ref, setBody);
  const scrolls = useScrollableOverflow(body);
  const [stop, setStop] = React.useState<BodyStop>(NO_BODY_STOP);
  const fallbackLabel = useKitLabel('unnamedPanelContent');

  React.useLayoutEffect(() => {
    const win = body?.ownerDocument.defaultView;
    if (!scrolls || !body || !win) return undefined;
    const overlay = body.closest(`[${OVERLAY_ATTRIBUTE}]`);
    const update = (): void => {
      const next: BodyStop = {
        needed:
          overlay?.matches(PRESENTATIONAL_OVERLAY_SELECTOR) !== true &&
          tabStopsWithin(body).length === 0 &&
          body.querySelector(ROVING_TAB_STOP_SELECTOR) === null,
        labelledBy: overlay?.getAttribute('aria-labelledby') ?? null,
        label: overlay?.getAttribute('aria-label') ?? null,
      };
      setStop((current) => (sameBodyStop(current, next) ? current : next));
    };
    update();
    const observer = new win.MutationObserver(update);
    observer.observe(body, { childList: true, subtree: true, attributes: true });
    if (overlay) observer.observe(overlay, { attributeFilter: ['aria-labelledby', 'aria-label'] });
    return () => observer.disconnect();
  }, [scrolls, body]);

  const isStop = scrolls && stop.needed;
  return (
    <div
      ref={mergedRef}
      {...(isStop
        ? {
            role: 'group',
            tabIndex: 0,
            'aria-labelledby': stop.labelledBy ?? undefined,
            'aria-label': stop.labelledBy === null ? (stop.label ?? fallbackLabel) : undefined,
          }
        : { tabIndex: -1 })}
      data-ui-popover-body=""
      {...{ [POPUP_SCROLL_ATTRIBUTE]: '' }}
      className={cn(className, isStop && 'focus-visible:shadow-focus')}
    >
      {children}
    </div>
  );
});

const HEADER_BAND_CLASSES =
  '-mx-[var(--ui-band-bleed,0px)] first:-mt-[var(--ui-band-bleed,0px)] mb-1 flex shrink-0 items-center gap-1 self-stretch justify-self-stretch min-h-[calc(var(--ui-h-control)+2*var(--ui-pad-xs))] ps-[var(--ui-band-bleed,var(--ui-pad-lg))] pe-[var(--ui-pad-xs)] py-xs';
const HEADER_TITLE_CLASSES =
  'min-w-0 flex-1 last:me-[calc(var(--ui-band-bleed,var(--ui-pad-lg))-var(--ui-pad-xs))] text-heading font-semibold break-words text-primary';
const HEADER_BACK_CLASSES = 'self-start -ms-[calc(var(--ui-band-bleed,var(--ui-pad-lg))-var(--ui-pad-xs))]';
const HEADER_DESCRIPTION_CLASSES =
  'mx-[calc(var(--ui-band-bleed,var(--ui-pad-lg))-var(--ui-band-bleed,0px))] mb-[var(--ui-band-bleed,var(--ui-pad-lg))] text-body font-normal text-secondary break-words';

export interface PopoverHeaderProps {
  /** Shows a close button at the end; never on a sheet, which has its own. */
  showClose?: boolean;
  closeLabel?: string;
  /** Shows a back button before the title; it is handed the button's click. */
  onBack?: React.MouseEventHandler<HTMLButtonElement>;
  backLabel?: string;
  /** Buttons between the title and the close button. */
  actions?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  /** The title. */
  children?: React.ReactNode;
}

/** The title row of a popover, with optional back and close buttons. */
function PopoverHeader({
  showClose = true,
  closeLabel,
  onBack,
  backLabel,
  actions,
  description,
  className,
  children,
}: PopoverHeaderProps): React.ReactElement {
  const sheet = useIsSheet();
  const close = useKitLabel('close');
  const back = useKitLabel('back');
  return (
    <>
      <div data-ui-part="band" className={cn(HEADER_BAND_CLASSES, className)}>
        {onBack && (
          <Button variant="ghost" iconOnly icon="CaretLeft" aria-label={backLabel ?? back} tooltip={false} onClick={onBack} className={HEADER_BACK_CLASSES} />
        )}
        <BasePopover.Title className={HEADER_TITLE_CLASSES}>{children}</BasePopover.Title>
        {actions !== undefined && actions !== null && <div className="flex items-center self-start">{actions}</div>}
        {showClose && !sheet && (
          <BasePopover.Close render={<Button variant="ghost" iconOnly icon="X" aria-label={closeLabel ?? close} tooltip={false} className="self-start" />} />
        )}
      </div>
      {description !== undefined && description !== null && description !== false && (
        <BasePopover.Description className={HEADER_DESCRIPTION_CLASSES}>{description}</BasePopover.Description>
      )}
    </>
  );
}

PopoverTrigger.displayName = 'Popover.Trigger';
PopoverPopup.displayName = 'Popover.Popup';

export { PopoverRoot, PopoverTrigger, PopoverPopup, PopoverHeader };

export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Popup: PopoverPopup,
  Header: PopoverHeader,
  Title: BasePopover.Title,
  Description: BasePopover.Description,
  Close: BasePopover.Close,
};
