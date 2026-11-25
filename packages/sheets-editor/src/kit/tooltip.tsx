import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { useDirection } from '@base-ui/react/direction-provider';
import { cn } from './cn.ts';
import { isDismissalRelatedFocus, isFocusVisible } from './focus-origin.ts';
import { LayerBaseContext, useOverlayLayer } from './layers.tsx';
import { DarkScope, PopupScope } from './popup.tsx';
import { Shortcut } from './shortcut.tsx';

type PositionerProps = React.ComponentProps<typeof BaseTooltip.Positioner>;
type OpenChangeDetails = BaseTooltip.Root.ChangeEventDetails;

export type TooltipSide = NonNullable<PositionerProps['side']>;
export type TooltipAlign = NonNullable<PositionerProps['align']>;

/** A tooltip's body; a function is read only when the tooltip is about to show. */
export type TooltipContent = React.ReactNode | (() => React.ReactNode);

export const TOOLTIP_DEFAULT_DELAY = 300;

export const TOOLTIP_SURFACE_CLASSES =
  'rounded-[calc(0.375rem*var(--ui-rem-scale,1))] bg-[var(--ui-tooltip-bg)] text-[var(--ui-tooltip-fg)] shadow-sm dark:shadow-panel-sm print:hidden text-[calc(0.8125rem*var(--ui-rem-scale,1))]/[calc(1.125rem*var(--ui-rem-scale,1))] font-normal';
export const TOOLTIP_ANIMATION_CLASSES =
  'origin-[var(--transform-origin)] transition-[opacity,scale] duration-snap ease-snap motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[instant]:duration-0';
export const TOOLTIP_WRAP_CLASSES = 'max-w-[240px] whitespace-normal';
export const TOOLTIP_PADDING_CLASSES = 'px-2 py-1.5';
export const TOOLTIP_DOTTED_UNDERLINE_CLASSES =
  'underline decoration-dotted decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_srgb,currentColor,transparent_55%)]';

const TEXT_BREAK_CLASSES = 'min-w-0 break-words';
const ROW_CLASSES =
  'inline-flex items-center gap-2 min-h-[calc(1.5rem*var(--ui-rem-scale,1))] max-w-[240px] py-[calc(0.1875rem*var(--ui-rem-scale,1))]';
const STACKED_CLASSES = `flex flex-col gap-0.5 ${TOOLTIP_WRAP_CLASSES} py-1.5`;

/** True inside the trigger of a tooltip that has something to show. */
const InsideTooltipContext = React.createContext(false);
const GroupDelayContext = React.createContext<number | null>(null);

export function useInsideTooltip(): boolean {
  return React.useContext(InsideTooltipContext);
}

export function isEmptyTooltipContent(content: unknown): boolean {
  return (
    content === null ||
    content === undefined ||
    content === '' ||
    typeof content === 'boolean' ||
    (Array.isArray(content) && content.every(isEmptyTooltipContent))
  );
}

/** A trigger whose menu or popover is open; its tooltip would cover what it opened. */
export function isExpandedPopupTrigger(target: unknown): boolean {
  if (!(target instanceof Element)) return false;
  const popup = target.getAttribute('aria-haspopup');
  return popup !== null && popup !== 'false' && target.getAttribute('aria-expanded') === 'true';
}

interface ActiveTooltip {
  closeInstant: () => void;
}

let activeTooltip: React.RefObject<ActiveTooltip> | null = null;

/** Only one tooltip shows at a time: a new one shuts the last at once. */
function useSingleActiveTooltip(handle: React.RefObject<ActiveTooltip>, isShowing: boolean): void {
  React.useLayoutEffect(() => {
    if (!isShowing) return;
    if (activeTooltip !== null && activeTooltip !== handle) activeTooltip.current.closeInstant();
    activeTooltip = handle;
    return () => {
      if (activeTooltip === handle) activeTooltip = null;
    };
  }, [handle, isShowing]);
}

interface View {
  open: boolean;
  body: React.ReactNode;
}

const CLOSED: View = { open: false, body: undefined };
const opened = (view: View): View => (view.open ? view : { ...view, open: true });
const closed = (view: View): View => (view.open ? { ...view, open: false } : view);
const reset = (view: View): View => (view.open || view.body !== undefined ? CLOSED : view);
const cleared = (view: View): View => (view.body === undefined ? view : { ...view, body: undefined });
const showing =
  (body: React.ReactNode) =>
  (view: View): View =>
    view.open && Object.is(view.body, body) ? view : { open: true, body };
const holding =
  (body: React.ReactNode) =>
  (view: View): View =>
    Object.is(view.body, body) ? view : { ...view, body };

const NOTHING = Symbol('nothing to show');

function readContent(content: () => React.ReactNode): React.ReactNode | typeof NOTHING {
  const body = content();
  return isEmptyTooltipContent(body) ? NOTHING : body;
}

/** Keeps a tooltip's body as a stable key, so swapping text does not replay the entry. */
function bodyKey(node: React.ReactNode): string {
  if (isEmptyTooltipContent(node)) return 'none';
  if (Array.isArray(node)) return `[${node.map(bodyKey).join(',')}]`;
  if (!React.isValidElement(node)) return typeof node;
  const type = node.type;
  const key = node.key ?? '';
  if (type === React.Fragment || typeof type === 'string') {
    return `<${String(type)}:${key}>${bodyKey((node.props as { children?: React.ReactNode }).children)}`;
  }
  return `${typeKey(type)}:${key}`;
}

const typeKeys = new WeakMap<object, string>();
let typeKeyCount = 0;
function typeKey(type: object): string {
  let key = typeKeys.get(type);
  if (key === undefined) {
    key = `type:${typeKeyCount++}`;
    typeKeys.set(type, key);
  }
  return key;
}

function ShortcutHint({ keys, className }: { keys: string; className?: string }): React.ReactElement {
  return (
    <Shortcut
      keys={keys}
      variant="text"
      className={cn('text-[calc(0.75rem*var(--ui-rem-scale,1))] [--ui-shortcut-cap-ink:var(--ui-text-muted)]', className)}
    />
  );
}

export interface TooltipProps {
  content: TooltipContent;
  /** A second, quieter line under the content. */
  detail?: React.ReactNode;
  /** Lets the content wrap onto several lines. */
  multiline?: boolean;
  shortcut?: string;
  side?: TooltipSide;
  align?: TooltipAlign;
  /** Points the tooltip at something other than its children. */
  anchor?: PositionerProps['anchor'];
  sideOffset?: PositionerProps['sideOffset'];
  collisionPadding?: PositionerProps['collisionPadding'];
  collisionAvoidance?: PositionerProps['collisionAvoidance'];
  delay?: number;
  closeDelay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Keeps the tooltip open while the pointer is over it. */
  hoverable?: boolean;
  closeOnClick?: boolean;
  /** Shows even when focus came back from closing something. */
  openOnHandedBackFocus?: boolean;
  /**
   * Says why its trigger is disabled. The text may wrap, stays through clicks and comes back with
   * focus; it can be hovered when it opened from hovering, and presses on it go no further.
   */
  explainsDisabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/** A short label that appears beside its trigger on hover or keyboard focus. */
export function Tooltip({
  content,
  detail,
  explainsDisabled = false,
  multiline = explainsDisabled,
  shortcut,
  side = 'top',
  align,
  anchor,
  sideOffset = 4,
  collisionPadding,
  collisionAvoidance,
  delay,
  closeDelay,
  open,
  onOpenChange,
  hoverable: hoverableProp,
  closeOnClick = explainsDisabled ? false : undefined,
  openOnHandedBackFocus = explainsDisabled,
  className,
  children,
}: TooltipProps): React.ReactElement {
  const hoverable = hoverableProp ?? explainsDisabled;
  const groupDelay = React.useContext(GroupDelayContext);
  const openDelay = delay ?? groupDelay ?? TOOLTIP_DEFAULT_DELAY;
  const layer = useOverlayLayer('tooltip');
  const triggerId = React.useId();
  const actionsRef = React.useRef<BaseTooltip.Root.Actions | null>(null);
  const [closesInstantly, setClosesInstantly] = React.useState(false);
  const handle = React.useRef<ActiveTooltip>({
    closeInstant: () => {
      setClosesInstantly(true);
      actionsRef.current?.close();
    },
  });
  const [hoveredTrigger, setHoveredTrigger] = React.useState<Element | null>(null);
  const [view, setView] = React.useState<View>(CLOSED);
  if (open === false && view.open) setView(closed);

  const readsLater = typeof content === 'function';
  const hasContent = readsLater || !isEmptyTooltipContent(content);
  const body = !readsLater && hasContent ? content : view.body;
  const hasBody = !isEmptyTooltipContent(body);
  const isOpen = (open ?? view.open) && (!readsLater || hasBody);
  if (!readsLater && hasContent && isOpen && !Object.is(view.body, content)) setView(holding(content));

  const handleOpenChange = React.useCallback(
    (next: boolean, details: OpenChangeDetails) => {
      if (details.reason === 'trigger-focus' && !openOnHandedBackFocus && next && isDismissalRelatedFocus(details.event)) {
        details.cancel();
        return;
      }
      if (next && details.reason === 'trigger-hover' && isExpandedPopupTrigger(details.trigger ?? details.event.target)) {
        details.cancel();
        return;
      }
      if (next) {
        if (typeof content !== 'function') setView(showing(content));
        else if (!isOpen) {
          const read = readContent(content);
          if (read === NOTHING) {
            details.cancel();
            return;
          }
          setView(showing(read));
        } else setView(opened);
        setClosesInstantly(false);
      } else setView(isOpen ? closed : reset);
      setHoveredTrigger(next && details.reason === 'trigger-hover' ? (details.trigger ?? null) : null);
      if (next || isOpen || details.reason !== 'none') onOpenChange?.(next);
    },
    [content, isOpen, onOpenChange, openOnHandedBackFocus],
  );

  const handleOpenChangeComplete = React.useCallback((next: boolean) => {
    if (next) return;
    setClosesInstantly(false);
    setHoveredTrigger(null);
    setView(cleared);
  }, []);

  // A reason that opened from focus rather than hover does not stay open for the pointer to reach it.
  const disableHoverablePopup =
    !hoverable || (explainsDisabled && hoverableProp === undefined && isOpen && hoveredTrigger === null);

  const rendersTrigger = children !== undefined || anchor === undefined;
  useSingleActiveTooltip(handle, rendersTrigger && hasContent && isOpen);

  React.useEffect(() => {
    if (hoveredTrigger === null) return;
    const doc = hoveredTrigger.ownerDocument;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && target !== hoveredTrigger && target.contains(hoveredTrigger)) handle.current.closeInstant();
    };
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const view = doc.defaultView;
    const observer =
      view === null
        ? null
        : new view.MutationObserver(() => {
            if (isExpandedPopupTrigger(hoveredTrigger)) handle.current.closeInstant();
          });
    observer?.observe(hoveredTrigger, { attributes: true, attributeFilter: ['aria-expanded'] });
    return () => {
      doc.removeEventListener('scroll', onScroll, { capture: true });
      observer?.disconnect();
    };
  }, [hoveredTrigger]);

  const render: React.ComponentProps<typeof BaseTooltip.Trigger>['render'] =
    React.isValidElement(children) && children.type !== React.Fragment
      ? (children as React.ReactElement<Record<string, unknown>>)
      : (props) => (
          <span {...props} className="inline-flex">
            {children}
          </span>
        );

  const stacked = multiline || detail !== undefined;
  const popup = hasBody ? (
    <BaseTooltip.Portal>
      <PopupScope>
        <LayerBaseContext.Provider value={layer.base}>
          <BaseTooltip.Positioner
            data-ui="Tooltip"
            className="data-[anchor-hidden]:invisible"
            style={layer.style}
            side={side}
            align={align}
            anchor={anchor}
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            collisionAvoidance={collisionAvoidance}
            positionMethod="fixed"
          >
            <BaseTooltip.Popup
              role="tooltip"
              {...(explainsDisabled ? REASON_POPUP_HANDLERS : undefined)}
              style={closesInstantly ? { transition: 'none' } : undefined}
              className={cn(
                'px-2',
                TOOLTIP_SURFACE_CLASSES,
                TOOLTIP_ANIMATION_CLASSES,
                stacked ? STACKED_CLASSES : ROW_CLASSES,
                shortcut === undefined && 'text-balance',
                className,
              )}
            >
              <DarkScope>
                {stacked ? (
                  <>
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span key={bodyKey(body)} className={TEXT_BREAK_CLASSES}>
                        {body}
                      </span>
                      {shortcut !== undefined && <ShortcutHint keys={shortcut} />}
                    </span>
                    {detail !== undefined && detail !== null && (
                      <span
                        key={bodyKey(detail)}
                        className="break-words text-[calc(0.6875rem*var(--ui-rem-scale,1))]/[calc(0.875rem*var(--ui-rem-scale,1))] text-secondary"
                      >
                        {detail}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span key={bodyKey(body)} className={TEXT_BREAK_CLASSES}>
                      {body}
                    </span>
                    {shortcut !== undefined && <ShortcutHint keys={shortcut} className="self-start" />}
                  </>
                )}
              </DarkScope>
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </LayerBaseContext.Provider>
      </PopupScope>
    </BaseTooltip.Portal>
  ) : null;

  return (
    <BaseTooltip.Root
      open={isOpen}
      disableHoverablePopup={disableHoverablePopup}
      disabled={!hasContent}
      actionsRef={actionsRef}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
      triggerId={triggerId}
    >
      <InsideTooltipContext.Provider value={hasContent}>
        {rendersTrigger && (
          <BaseTooltip.Trigger id={triggerId} delay={openDelay} closeDelay={closeDelay} closeOnClick={closeOnClick} render={render} />
        )}
      </InsideTooltipContext.Provider>
      {popup}
    </BaseTooltip.Root>
  );
}

const stopPropagation = (event: React.SyntheticEvent): void => event.stopPropagation();

/** A press on a reason keeps focus where it was and does not reach what the tooltip sits over. */
const REASON_POPUP_HANDLERS = {
  onMouseDown: (event: React.MouseEvent): void => event.preventDefault(),
  onClick: stopPropagation,
  onDoubleClick: stopPropagation,
};

/** Shows a tooltip on the side where text ends: right, or left in right-to-left text. */
export function InlineEndTooltip(props: Omit<TooltipProps, 'side'>): React.ReactElement {
  return <Tooltip {...props} side={useDirection() === 'rtl' ? 'left' : 'right'} />;
}

export interface TooltipGroupProps {
  delay?: number;
  closeDelay?: number;
  children?: React.ReactNode;
}

/** Once one tooltip in the group has shown, its neighbours show without waiting. */
export function TooltipGroup({ delay, closeDelay = 200, children }: TooltipGroupProps): React.ReactElement {
  const outer = React.useContext(GroupDelayContext);
  const groupDelay = delay ?? outer ?? TOOLTIP_DEFAULT_DELAY;
  return (
    <GroupDelayContext.Provider value={groupDelay}>
      <BaseTooltip.Provider delay={groupDelay} closeDelay={closeDelay}>
        {children}
      </BaseTooltip.Provider>
    </GroupDelayContext.Provider>
  );
}

export function useInTooltipGroup(): boolean {
  return React.useContext(GroupDelayContext) !== null;
}

export const DISABLED_REASON_ATTRIBUTE = 'data-ui-disabled-reason';

export const DISABLED_REASON_WRAPPER_CLASSES =
  'rounded-[calc(var(--ui-radius)+var(--ui-button-radius-add,0px))] outline-none focus-visible:outline-hidden [&[data-initial-focus]:focus]:outline-hidden transition-shadow duration-fast focus-visible:shadow-focus [&[data-initial-focus]:focus]:shadow-focus';

/** Props for the focusable span that stands in for a disabled control, so its reason can be read. */
export function disabledReasonWrapperProps(
  reason: React.ReactNode,
  descriptionId: string,
  className?: string,
): React.HTMLAttributes<HTMLSpanElement> & { 'data-ui-disabled-reason-wrapper': '' } {
  const hasReason = !isEmptyTooltipContent(reason);
  return {
    tabIndex: hasReason ? 0 : -1,
    'aria-describedby': hasReason ? descriptionId : undefined,
    'data-ui-disabled-reason-wrapper': '',
    className: cn('inline-flex', DISABLED_REASON_WRAPPER_CLASSES, className),
  };
}

export function DisabledReasonDescription({ id, reason }: { id: string; reason: React.ReactNode }): React.ReactElement {
  const shown = isEmptyTooltipContent(reason) ? null : reason;
  return (
    <span key={bodyKey(shown)} id={id} hidden {...{ [DISABLED_REASON_ATTRIBUTE]: '' }}>
      {shown}
    </span>
  );
}

export interface DisabledReasonTooltipProps extends Pick<
  TooltipProps,
  'side' | 'align' | 'sideOffset' | 'multiline' | 'delay' | 'collisionPadding' | 'hoverable' | 'className'
> {
  /** Why the control is disabled; nothing shows when it is empty. */
  reason: React.ReactNode;
  wrapperClassName?: string;
  children?: React.ReactNode;
}

/** Explains why the control inside is disabled, on hover or focus of a wrapper that stays focusable. */
export function DisabledReasonTooltip({
  reason,
  multiline = true,
  wrapperClassName,
  children,
  ...tooltip
}: DisabledReasonTooltipProps): React.ReactElement {
  const descriptionId = React.useId();
  return (
    <Tooltip
      {...tooltip}
      content={isEmptyTooltipContent(reason) ? undefined : reason}
      multiline={multiline}
      explainsDisabled
    >
      <span {...disabledReasonWrapperProps(reason, descriptionId, wrapperClassName)}>
        {children}
        <DisabledReasonDescription id={descriptionId} reason={reason} />
      </span>
    </Tooltip>
  );
}

function rangeOverflows(element: Element): boolean {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const text = range.getBoundingClientRect();
  if (text.width === 0) return false;
  const box = element.getBoundingClientRect();
  return text.right - box.right > 0.1 || box.left - text.left > 0.1;
}

/** Whether a one-line label is cut off. */
export function isLabelOverflowing(element: Element): boolean {
  return element.scrollWidth > element.clientWidth || rangeOverflows(element);
}

/** Whether a label is cut off, across or, when it may wrap, down. */
export function isTextOverflowing(element: HTMLElement): boolean {
  return (
    rangeOverflows(element) ||
    (element.scrollHeight > element.clientHeight + 1 && element.ownerDocument.defaultView?.getComputedStyle(element).whiteSpace !== 'nowrap')
  );
}

const FOCUS_OWNER_SELECTOR = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
const FOCUS_TARGET_SELECTOR =
  'a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role^="menuitem"], [role="treeitem"], [role="option"], [role="radio"], [role="checkbox"], [role="switch"], [role="row"], [role="gridcell"]';

type OverflowShow = 'no' | 'shown' | 'shut';

const overflowSetters = new WeakMap<Element, (shown: boolean) => void>();
const focusedLabels = new WeakMap<Document, { label: Element; owner: Element }>();
const blurTargets = new WeakMap<Document, Element>();
const watchedDocuments = new WeakSet<Document>();

function hideFocusedLabel(doc: Document): void {
  const entry = focusedLabels.get(doc);
  focusedLabels.delete(doc);
  if (entry !== undefined) overflowSetters.get(entry.label)?.(false);
}

function onFocusIn(event: FocusEvent): void {
  const doc = event.currentTarget as Document;
  hideFocusedLabel(doc);
  const returnedFromBlur = blurTargets.get(doc) === event.target;
  blurTargets.delete(doc);
  if (returnedFromBlur) return;
  const target = event.target;
  if (!(target instanceof Element) || !target.matches(FOCUS_TARGET_SELECTOR) || !isFocusVisible(target) || isDismissalRelatedFocus(event)) {
    return;
  }
  const label = [...target.querySelectorAll('[data-ui="OverflowTooltip"]')].find(
    (candidate) => overflowSetters.has(candidate) && candidate.closest(FOCUS_OWNER_SELECTOR) === target && isLabelOverflowing(candidate),
  );
  if (label === undefined) return;
  focusedLabels.set(doc, { label, owner: target });
  overflowSetters.get(label)?.(true);
}

function onFocusOut(event: Event): void {
  hideFocusedLabel(event.currentTarget as Document);
}

function onKeyDown(event: KeyboardEvent): void {
  const doc = event.currentTarget as Document;
  const label = focusedLabels.get(doc)?.label;
  if (label === undefined || !overflowSetters.has(label) || !label.hasAttribute('data-popup-open')) return;
  if (event.key === 'Escape') {
    ReactDOM.flushSync(() => hideFocusedLabel(doc));
    if (label.hasAttribute('data-popup-open')) return;
    event.preventDefault();
    event.stopPropagation();
  } else if (event.key === 'Enter' || event.key === ' ') hideFocusedLabel(doc);
}

function watchOverflowFocus(doc: Document): void {
  if (watchedDocuments.has(doc)) return;
  watchedDocuments.add(doc);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);
  doc.addEventListener('click', onFocusOut, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.defaultView?.addEventListener('blur', () => {
    if (doc.activeElement !== null) blurTargets.set(doc, doc.activeElement);
  });
}

const shut = (show: OverflowShow): OverflowShow => (show === 'shown' ? 'shut' : show);

/**
 * Shows the full text of a label inside a focusable row when the row gets keyboard focus
 * and the label is cut off.
 */
function useOverflowFocus(ref: React.RefObject<HTMLSpanElement | null>, disabled: boolean): [OverflowShow, (open: boolean) => void] {
  const [show, setShow] = React.useState<OverflowShow>('no');
  React.useLayoutEffect(() => {
    const label = ref.current;
    if (label === null || disabled) return;
    const doc = label.ownerDocument;
    watchOverflowFocus(doc);
    overflowSetters.set(label, (shown) => setShow(shown ? 'shown' : shut));
    const entry = focusedLabels.get(doc);
    if (entry?.label !== label || !isFocusVisible(entry.owner)) setShow(shut);
    return () => {
      overflowSetters.delete(label);
    };
  }, [disabled, ref]);
  const onOpenChange = React.useCallback((open: boolean) => setShow((current) => (open ? 'no' : shut(current))), []);
  return [show, onOpenChange];
}

export interface OverflowTooltipProps extends React.HTMLAttributes<HTMLSpanElement>, Pick<
  TooltipProps,
  'side' | 'align' | 'sideOffset' | 'delay' | 'collisionPadding' | 'hoverable'
> {}

/** A one-line label that shows its full text in a tooltip, only when it is cut off. */
export const OverflowTooltip = React.forwardRef<HTMLSpanElement, OverflowTooltipProps>(function OverflowTooltip(
  { className, side, align, sideOffset, delay, collisionPadding, hoverable, children, ...rest },
  forwardedRef,
) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const setRef = React.useCallback(
    (node: HTMLSpanElement | null) => {
      ref.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef !== null) forwardedRef.current = node;
    },
    [forwardedRef],
  );
  const insideTooltip = useInsideTooltip();
  const [show, onOpenChange] = useOverflowFocus(ref, insideTooltip);
  const full = rest.dir === undefined ? children : <span dir={rest.dir}>{children}</span>;
  return (
    <Tooltip
      content={
        insideTooltip
          ? undefined
          : show === 'shown'
            ? full
            : () => (ref.current !== null && isLabelOverflowing(ref.current) ? full : undefined)
      }
      open={show === 'shown' ? true : undefined}
      onOpenChange={onOpenChange}
      className={show === 'no' ? undefined : 'transition-none'}
      side={side}
      align={align}
      sideOffset={sideOffset}
      delay={delay}
      collisionPadding={collisionPadding}
      hoverable={hoverable}
    >
      <span
        {...rest}
        ref={setRef}
        data-ui="OverflowTooltip"
        className={cn('block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap', className)}
      >
        {children}
      </span>
    </Tooltip>
  );
});
