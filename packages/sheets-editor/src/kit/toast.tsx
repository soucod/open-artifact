import * as React from 'react';
import { Toast as BaseToast } from '@base-ui/react/toast';
import { Button } from './button.tsx';
import { guardHeldActivationKey, guardWhileClosing } from './closing-guard.ts';
import { cn } from './cn.ts';
import { Icon, type IconName } from './icon.tsx';
import { useKitLabel } from './labels.tsx';
import { GLOBAL_LAYER_BASE, LayerBaseContext } from './layers.tsx';
import { PopupScope } from './popup.tsx';

/** How long a toast stays by default, and the shortest time one may be given. */
export const DEFAULT_TOAST_TIMEOUT_MS = 6000;

export type ToastVariant = 'neutral' | 'warning' | 'danger';

export interface ToastCloseInfo {
  /** The person closed it, with its close button or Escape, rather than it timing out or being taken down. */
  byUser: boolean;
}

export interface ToastOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** An element in place of the variant's icon; `null` shows none. */
  icon?: React.ReactNode | null;
  /** Content under the text, such as a button; a toast with one stays until it is closed. */
  action?: React.ReactNode;
  /** Milliseconds before the toast goes; 0 keeps it until closed. Shorter times are raised to the default. */
  timeout?: number;
  onClose?: (info: ToastCloseInfo) => void;
}

/** A card that stays below the toasts until it is replaced or taken down, such as a save status. */
export interface PinnedToast {
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  action?: React.ReactNode;
  /** Shows a close button, and lets Escape take the card down. */
  dismissible?: boolean;
  dismissLabel?: string;
  /** Called when the card is replaced or taken down. */
  onClose?: () => void;
}

export interface Toasts {
  /** Shows a toast and returns its id. */
  add: (options: ToastOptions) => string;
  /** Closes one toast, or all of them when no id is given. */
  close: (id?: string) => void;
  /** Puts up the pinned card, replacing any other, or takes it down with `null`. */
  setPinned: (pinned: PinnedToast | null) => void;
}

interface ToastData {
  variant: ToastVariant;
  icon: React.ReactNode | null | undefined;
  action: React.ReactNode;
}

type ToastObject = BaseToast.Root.ToastObject<ToastData>;

interface ToastContextValue {
  autoDismiss: boolean;
  setPinned: (pinned: PinnedToast | null) => void;
  /** Ids of toasts the person is closing, so their `onClose` can tell. */
  closedByUser: Set<string>;
  isFocusInRegion: () => boolean;
  /** Puts focus back where it was before it went into the toasts, if closing one left it nowhere. */
  returnFocus: () => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const ICON_NAMES: Readonly<Record<ToastVariant, IconName>> = {
  neutral: 'Info',
  warning: 'Warning',
  danger: 'WarningCircle',
};

const CARD_CLASSES = 'rounded-panel bg-surface-popover shadow-popover [--ui-page-bg:var(--ui-surface-popover)] forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText]';
const CARD_VARIANT_CLASSES: Readonly<Record<ToastVariant, string>> = {
  neutral: 'text-primary',
  warning: '[background-image:linear-gradient(var(--ui-bg-warning),var(--ui-bg-warning))] text-[var(--ui-text-warning)]',
  danger: '[background-image:linear-gradient(var(--ui-bg-danger),var(--ui-bg-danger))] text-[var(--ui-text-danger)]',
};
const ICON_COLOR_CLASSES: Readonly<Record<ToastVariant, string>> = {
  neutral: 'text-secondary',
  warning: 'text-[var(--ui-fill-warning)]',
  danger: 'text-fill-danger',
};
/** Toasts stack from the bottom, each one behind slightly higher and smaller. */
const STACKED_ITEM_CLASSES =
  'absolute w-full bottom-0 right-0 origin-bottom rounded-panel outline-none focus-visible:outline-hidden focus-visible:shadow-focus [--ty:calc(var(--toast-index)_*_-14px)] [--ts:calc(1_-_var(--toast-index)_*_0.04)] [transform:translateY(var(--ty))_scale(var(--ts))] transition-[transform,opacity] duration-base ease-out motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:[--ty:100%] data-[ending-style]:opacity-0 data-[ending-style]:[--ts:0.85] data-[limited]:opacity-0';
const BODY_CLASSES =
  'flex items-start gap-sm px-lg py-md overflow-hidden rounded-[inherit] text-body font-normal transition-[opacity,visibility] duration-base ease-out motion-reduce:transition-none data-[behind]:invisible data-[behind]:opacity-0';
const TEXT_CLASSES = 'min-w-0 flex-1 text-pretty break-words';
const ACTION_CLASSES = 'mt-pad-md empty:hidden';
const CLOSE_CLASSES = '-me-1 -mt-0.5 -mb-1 shrink-0';
const REGION_CLASSES =
  'ui-reset pointer-events-none fixed right-4 bottom-4 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col-reverse gap-md rtl:right-auto rtl:left-4';

const NO_SWIPE: ('up' | 'down' | 'left' | 'right')[] = [];

/** Below the default the toast is gone before it can be read; 0 or less keeps it until closed. */
function clampTimeout(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (timeout <= 0 || !Number.isFinite(timeout)) return 0;
  return Math.max(timeout, DEFAULT_TOAST_TIMEOUT_MS);
}

function isIdle(doc: Document): boolean {
  return doc.activeElement === null || doc.activeElement === doc.body;
}

const ending = guardWhileClosing({}, 'data-ending-style');

/**
 * A tap that closes a toast lifts after the card is fading out or gone; the click the browser
 * would make of it then lands on the page underneath, so that touch end is cancelled.
 */
function cancelTapThroughClosingCard(event: React.TouchEvent<HTMLElement>): void {
  const card = event.currentTarget;
  event.target.addEventListener(
    'touchend',
    (touchEnd) => {
      if (touchEnd.cancelable && (card.hasAttribute('data-ending-style') || !card.isConnected)) touchEnd.preventDefault();
    },
    { once: true },
  );
}

/** A tap on the empty part of the toast region makes no click on the page behind it. */
function cancelTapOnRegion(event: React.TouchEvent<HTMLElement>): void {
  if (event.target === event.currentTarget && event.cancelable) event.preventDefault();
}

interface ToastCardProps {
  toast: ToastObject;
  isFront: boolean;
  frontHeight: number | undefined;
  zIndex: number;
}

function ToastCard({ toast, isFront, frontHeight, zIndex }: ToastCardProps): React.ReactElement {
  const context = React.useContext(ToastContext);
  const dismissLabel = useKitLabel('dismiss');
  const variant = toast.data?.variant ?? 'neutral';
  const icon = toast.data?.icon;
  const action = toast.data?.action;
  const markClosedByUser = (): void => {
    context?.closedByUser.add(toast.id);
  };

  // A card behind the front one shows only its edge; while it fades out it keeps the look it had.
  const isEnding = toast.transitionStatus === 'ending';
  const behind = !isFront;
  const lockedHeight = behind ? frontHeight : undefined;
  const [kept, setKept] = React.useState({ behind, lockedHeight });
  if (!isEnding && (kept.behind !== behind || kept.lockedHeight !== lockedHeight)) setKept({ behind, lockedHeight });
  const shownBehind = isEnding ? kept.behind : behind;
  const shownHeight = isEnding ? kept.lockedHeight : lockedHeight;

  return (
    <BaseToast.Root
      onTouchStartCapture={cancelTapThroughClosingCard}
      toast={toast}
      swipeDirection={NO_SWIPE}
      className={STACKED_ITEM_CLASSES}
      style={{ zIndex }}
      {...ending}
      onKeyDownCapture={(event) => {
        guardHeldActivationKey(event);
        const doc = event.currentTarget.ownerDocument;
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.currentTarget.contains(doc.activeElement)) markClosedByUser();
        ending.onKeyDownCapture(event);
      }}
    >
      <div className={cn(CARD_CLASSES, CARD_VARIANT_CLASSES[variant])}>
        <div
          className={BODY_CLASSES}
          data-behind={shownBehind ? '' : undefined}
          style={shownHeight === undefined ? undefined : { height: shownHeight }}
        >
          {icon !== null && (
            <span className={cn('flex h-[1lh] shrink-0 items-center', ICON_COLOR_CLASSES[variant])}>
              {icon === undefined ? <Icon name={ICON_NAMES[variant]} size="md" /> : icon}
            </span>
          )}
          <div className={TEXT_CLASSES}>
            <BaseToast.Title className="font-medium" aria-atomic="true" />
            <BaseToast.Description className={variant === 'neutral' ? 'text-secondary' : undefined} />
            {action !== undefined && action !== null && action !== false && <div className={ACTION_CLASSES}>{action}</div>}
          </div>
          <BaseToast.Close
            onClick={markClosedByUser}
            render={
              <Button variant="ghost" size="xs" icon="X" iconOnly tooltip={false} aria-label={dismissLabel} className={CLOSE_CLASSES} />
            }
          />
        </div>
      </div>
    </BaseToast.Root>
  );
}

interface PinnedCardProps {
  pinned: PinnedToast;
  onDismiss: () => void;
}

function PinnedCard({ pinned, onDismiss }: PinnedCardProps): React.ReactElement {
  const titleId = React.useId();
  const fallbackLabel = useKitLabel('dismiss');
  const variant = pinned.variant ?? 'neutral';
  return (
    <div
      data-pinned=""
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      onTouchStartCapture={cancelTapThroughClosingCard}
      className={cn('pointer-events-auto relative w-full outline-none focus-visible:outline-hidden', CARD_CLASSES, CARD_VARIANT_CLASSES[variant], 'focus-visible:shadow-focus')}
    >
      <div className={BODY_CLASSES}>
        <span className={cn('flex h-[1lh] shrink-0 items-center', ICON_COLOR_CLASSES[variant])}>
          <Icon name={ICON_NAMES[variant]} size="md" />
        </span>
        <div className={TEXT_CLASSES}>
          <div id={titleId} className="font-medium">
            {pinned.title}
          </div>
          {pinned.description !== undefined && pinned.description !== null && (
            <div className={variant === 'neutral' ? 'text-secondary' : undefined}>{pinned.description}</div>
          )}
          {pinned.action !== undefined && pinned.action !== null && pinned.action !== false && (
            <div className={ACTION_CLASSES}>{pinned.action}</div>
          )}
        </div>
        {pinned.dismissible === true && (
          <Button
            variant="ghost"
            size="xs"
            icon="X"
            iconOnly
            tooltip={false}
            aria-label={pinned.dismissLabel ?? fallbackLabel}
            className={CLOSE_CLASSES}
            onClick={onDismiss}
          />
        )}
      </div>
    </div>
  );
}

interface ToastRegionProps {
  className?: string;
  pinned: PinnedToast | null;
  setPinned: (pinned: PinnedToast | null) => void;
  regionRef: React.RefCallback<HTMLDivElement>;
  slotRef: React.RefObject<HTMLDivElement | null>;
}

function ToastRegion({ className, pinned, setPinned, regionRef, slotRef }: ToastRegionProps): React.ReactElement {
  const { toasts } = BaseToast.useToastManager<ToastData>();
  const front = toasts.find((toast) => toast.transitionStatus !== 'ending');
  return (
    <BaseToast.Portal>
      <PopupScope>
        <LayerBaseContext.Provider value={GLOBAL_LAYER_BASE}>
          <div ref={regionRef} data-ui="Toast" className={cn(REGION_CLASSES, className)} style={{ zIndex: GLOBAL_LAYER_BASE }}>
            <div
              ref={slotRef}
              role="status"
              aria-live="polite"
              className={pinned === null ? 'sr-only' : 'w-full'}
              onClick={(event) => {
                // A press on a card that cannot be closed should not leave the card itself focused.
                const active = event.currentTarget.ownerDocument.activeElement;
                if (pinned !== null && pinned.dismissible !== true && active !== null && active.matches('[data-pinned]')) {
                  (active as HTMLElement).blur();
                }
              }}
              onKeyDown={(event) => {
                const doc = event.currentTarget.ownerDocument;
                if (
                  event.key === 'Escape' &&
                  !event.defaultPrevented &&
                  !event.nativeEvent.isComposing &&
                  pinned?.dismissible === true &&
                  event.currentTarget.contains(doc.activeElement)
                ) {
                  setPinned(null);
                }
              }}
              onKeyDownCapture={(event) => guardHeldActivationKey(event, event.currentTarget.querySelector('[data-pinned]'))}
            >
              {pinned !== null && <PinnedCard pinned={pinned} onDismiss={() => setPinned(null)} />}
            </div>
            <BaseToast.Viewport
              onTouchEnd={cancelTapOnRegion}
              className="pointer-events-auto relative outline-none focus-visible:outline-hidden"
              style={{ height: front?.height }}
            >
              {toasts.map((toast, index) => (
                <ToastCard
                  key={toast.id}
                  toast={toast}
                  isFront={toast === front}
                  frontHeight={front?.height}
                  zIndex={toasts.length - index}
                />
              ))}
            </BaseToast.Viewport>
          </div>
        </LayerBaseContext.Provider>
      </PopupScope>
    </BaseToast.Portal>
  );
}

export interface ToastProviderProps {
  children?: React.ReactNode;
  /** How long toasts stay unless they say otherwise. */
  timeout?: number;
  /** Turn off to keep every toast until it is closed. */
  autoDismiss?: boolean;
  /** How many toasts show at once. */
  limit?: number;
  /** Classes for the region that holds the toasts. */
  viewportClassName?: string;
}

/** Holds the page's toasts and renders the region they appear in, at the foot of the window. */
export function ToastProvider({
  children,
  timeout = DEFAULT_TOAST_TIMEOUT_MS,
  autoDismiss = true,
  limit,
  viewportClassName,
}: ToastProviderProps): React.ReactElement {
  const [pinned, setPinnedState] = React.useState<PinnedToast | null>(null);
  const pinnedRef = React.useRef<PinnedToast | null>(null);
  const regionRef = React.useRef<HTMLDivElement | null>(null);
  // The region mounts inside a portal after the provider, so effects that need it wait for it.
  const [region, setRegion] = React.useState<HTMLDivElement | null>(null);
  const attachRegion = React.useCallback((node: HTMLDivElement | null) => {
    regionRef.current = node;
    setRegion(node);
  }, []);
  const slotRef = React.useRef<HTMLDivElement | null>(null);
  const lastFocusOutside = React.useRef<HTMLElement | SVGElement | null>(null);
  const pinnedHadFocus = React.useRef(false);
  const [closedByUser] = React.useState(() => new Set<string>());

  const isFocusInRegion = React.useCallback((): boolean => {
    const region = regionRef.current;
    return region !== null && region.contains(region.ownerDocument.activeElement);
  }, []);

  const returnFocus = React.useCallback((): void => {
    const target = lastFocusOutside.current;
    if (target === null || !target.isConnected || !isIdle(target.ownerDocument)) return;
    target.focus({ preventScroll: true });
  }, []);

  const setPinned = React.useCallback((next: PinnedToast | null): void => {
    const previous = pinnedRef.current;
    if (previous === next) return;
    pinnedRef.current = next;
    const slot = slotRef.current;
    if (slot !== null && slot.contains(slot.ownerDocument.activeElement)) pinnedHadFocus.current = true;
    setPinnedState(next);
    previous?.onClose?.();
  }, []);

  React.useLayoutEffect(() => {
    if (!pinnedHadFocus.current) return;
    pinnedHadFocus.current = false;
    const slot = slotRef.current;
    if (slot !== null && !slot.contains(slot.ownerDocument.activeElement)) returnFocus();
  }, [pinned, returnFocus]);

  // Remembers where focus was outside the toasts, to put it back when a focused toast goes.
  React.useEffect(() => {
    if (region === null) return;
    const doc = region.ownerDocument;
    const win = doc.defaultView;
    if (win === null) return;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof win.HTMLElement || target instanceof win.SVGElement)) return;
      if (target === doc.body || region.contains(target) || target.matches('[data-base-ui-focus-guard]')) return;
      lastFocusOutside.current = target;
    };
    doc.addEventListener('focusin', onFocusIn);
    return () => doc.removeEventListener('focusin', onFocusIn);
  }, [region]);

  const context = React.useMemo<ToastContextValue>(
    () => ({ autoDismiss, setPinned, closedByUser, isFocusInRegion, returnFocus }),
    [autoDismiss, setPinned, closedByUser, isFocusInRegion, returnFocus],
  );

  return (
    <BaseToast.Provider timeout={clampTimeout(timeout) ?? DEFAULT_TOAST_TIMEOUT_MS} limit={limit}>
      <ToastContext.Provider value={context}>
        {children}
        <ToastRegion className={viewportClassName} pinned={pinned} setPinned={setPinned} regionRef={attachRegion} slotRef={slotRef} />
      </ToastContext.Provider>
    </BaseToast.Provider>
  );
}

const noPinned = (): void => {};

/** Shows and closes toasts, and sets the pinned card, from inside a `ToastProvider`. */
export function useToasts(): Toasts {
  const manager = BaseToast.useToastManager<ToastData>();
  const context = React.useContext(ToastContext);
  const { add: addToManager, close } = manager;
  const add = React.useCallback(
    ({ title, description, variant = 'neutral', icon, action, timeout, onClose }: ToastOptions): string => {
      const hasAction = action !== undefined && action !== null && action !== false;
      const sticky = hasAction || context?.autoDismiss === false;
      let id = '';
      let hadFocus = false;
      id = addToManager({
        title,
        description,
        type: variant,
        priority: variant === 'danger' ? 'high' : 'low',
        timeout: sticky ? 0 : clampTimeout(timeout),
        data: { variant, icon, action },
        onClose: () => {
          const byUser = context?.closedByUser.delete(id) ?? false;
          hadFocus = context?.isFocusInRegion() ?? false;
          onClose?.({ byUser });
        },
        onRemove: () => {
          if (hadFocus) context?.returnFocus();
        },
      });
      return id;
    },
    [addToManager, context],
  );
  return React.useMemo(() => ({ add, close, setPinned: context?.setPinned ?? noPinned }), [add, close, context]);
}
