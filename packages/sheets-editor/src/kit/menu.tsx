import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { preventRepeatedActivation } from './closing-guard.ts';
import { cn } from './cn.ts';
import { Icon, LeadingIcon, type IconName } from './icon.tsx';
import { useKitLabel } from './labels.tsx';
import { OVERLAY_ATTRIBUTE, useOverlayLayer } from './layers.tsx';
import { isApplePlatform, useCoarsePointerMedia } from './platform.ts';
import {
  PopupLayerScope,
  PopupScrollArea,
  SHEET_POSITIONER_STYLE,
  SHEET_SURFACE_CLASSES,
  POPUP_MOTION_CLASSES,
  SheetBackdrop,
  SheetPresentationProvider,
  SheetTitleBar,
  isInteractivePopupTarget,
  useInnerOverlay,
  useIsSheet,
  useMergedRefs,
  useOpenerFocusReturn,
  useSheetPresentation,
  useSwallowSheetEntryTaps,
  type PopupFinalFocus,
} from './popup-frame.tsx';
import { Shortcut, parseSingleShortcut } from './shortcut.tsx';
import { DisabledReasonDescription, InlineEndTooltip, isEmptyTooltipContent } from './tooltip.tsx';

type PositionerProps = BaseMenu.Positioner.Props;
type ElementProps = React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> };

/** How the menu was opened, as `initialFocus` is told. */
export type MenuOpenType = 'keyboard' | 'mouse' | '';

/** Whether opening the menu moves focus into it; a function decides per open. */
export type MenuInitialFocus = boolean | ((openType: MenuOpenType) => boolean | undefined | void);

export type MenuItemVariant = 'default' | 'danger';

export const MENU_ITEM_BASE_CLASSES =
  'ui-reset flex w-full items-center gap-xs compact:px-2 comfortable:px-2.5 py-[calc((var(--ui-h-control)-var(--ui-leading-body))/2)] rounded-[var(--ui-radius)] text-body font-normal font-control text-start [--ui-shortcut-cap-ink:var(--ui-text-muted)] select-none outline-none focus-visible:outline-hidden data-[disabled]:opacity-disabled data-[disabled]:pointer-events-none data-[disabled]:focus-visible:shadow-focus';

export const MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES =
  'forced-colors:data-[highlighted]:outline-2 forced-colors:data-[highlighted]:outline-solid forced-colors:data-[highlighted]:-outline-offset-2 forced-colors:data-[highlighted]:outline-[color:Highlight]';

const MENU_ITEM_VARIANT_CLASSES: Readonly<Record<MenuItemVariant, string>> = {
  default: 'text-primary data-[highlighted]:bg-fill-ghost-hover',
  danger:
    'group/menu-danger text-[var(--ui-text-danger)] data-[highlighted]:bg-fill-danger data-[highlighted]:text-on-danger data-[highlighted]:[--ui-shortcut-cap-ink:currentColor]',
};

/** The classes of a menu row, for rows the page draws itself. */
export function menuItemVariants({ variant = 'default', className }: { variant?: MenuItemVariant; className?: string } = {}): string {
  return cn(MENU_ITEM_BASE_CLASSES, MENU_ITEM_VARIANT_CLASSES[variant], MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES, className);
}

export const MENU_GROUP_LABEL_CLASSES = 'compact:px-2 comfortable:px-2.5 py-1 text-footnote font-medium text-muted';

const MENU_SEPARATOR_CLASSES = 'compact:mx-2 comfortable:mx-2.5 my-1 h-px shrink-0 bg-[var(--ui-menu-line)]';

const MENU_POPUP_CLASSES =
  'ui-reset group/menu-popup relative flex flex-col min-w-[128px] max-w-[320px] max-h-[var(--available-height)] bg-surface-popover text-primary shadow-popover rounded-[calc(var(--ui-radius)+var(--ui-menu-gutter))] text-body font-normal outline-none focus-visible:outline-hidden';

const ENABLED_MENU_ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])';
const ENGAGING_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** Keys that move the highlight or choose a row, which end a run of typed letters. */
const MOVING_KEY_PATTERN = /^(Arrow|Home$|End$|Enter$)/;
/** How long after a typed letter the menu still counts the next key as part of the same search. */
const TYPEAHEAD_WINDOW_MS = 500;

/**
 * Letters typed in a menu jump to the row they spell, and a space can be part of that text. A
 * space typed within the search window must not also choose the highlighted row, so the click it
 * makes is swallowed.
 */
function useTypeaheadSpaceGuard(
  onClickCapture: React.MouseEventHandler<HTMLDivElement> | undefined,
  onKeyDownCapture: React.KeyboardEventHandler<HTMLDivElement> | undefined,
): Pick<React.HTMLAttributes<HTMLDivElement>, 'onClickCapture' | 'onKeyDownCapture'> {
  const lastLetterAt = React.useRef(Number.NEGATIVE_INFINITY);
  const swallowsClick = React.useRef(false);
  const handleKeyDownCapture = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      swallowsClick.current = false;
      onKeyDownCapture?.(event);
      if (MOVING_KEY_PATTERN.test(event.key)) {
        lastLetterAt.current = Number.NEGATIVE_INFINITY;
        return;
      }
      const popup = event.currentTarget;
      const target = event.target;
      const onRowOrPopup =
        target === popup || (target instanceof Element && popup.contains(target) && target.getAttribute('role')?.startsWith('menuitem') === true);
      if (!onRowOrPopup || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.isPropagationStopped()) return;
      if (event.key !== ' ') {
        lastLetterAt.current = event.timeStamp;
        return;
      }
      if (event.timeStamp - lastLetterAt.current >= TYPEAHEAD_WINDOW_MS) return;
      swallowsClick.current = true;
      popup.ownerDocument.defaultView?.setTimeout(() => {
        swallowsClick.current = false;
      }, 0);
    },
    [onKeyDownCapture],
  );
  const handleClickCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (swallowsClick.current && !event.isTrusted && event.detail === 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClickCapture?.(event);
    },
    [onClickCapture],
  );
  return React.useMemo(
    () => ({ onClickCapture: handleClickCapture, onKeyDownCapture: handleKeyDownCapture }),
    [handleClickCapture, handleKeyDownCapture],
  );
}

export function menuOpenType(event: Event | undefined): MenuOpenType {
  if (event === undefined) return '';
  if ('key' in event) return 'keyboard';
  const { type } = event;
  if (type === 'click' && event instanceof MouseEvent && event.detail === 0) return 'keyboard';
  if (type === 'click' || type === 'contextmenu' || type.startsWith('mouse') || type.startsWith('pointer') || type.startsWith('touch')) return 'mouse';
  return '';
}

function declinesFocus(initialFocus: MenuInitialFocus | undefined, openType: MenuOpenType): boolean {
  if (initialFocus === undefined || initialFocus === true) return false;
  if (initialFocus === false) return true;
  const decided = initialFocus(openType);
  return decided === false || decided === undefined;
}

export type MenuKind = 'menu' | 'contextmenu';

interface MenuLevel {
  kind: MenuKind;
  nested: boolean;
  open: boolean;
  sheet: boolean;
  sheetTitle?: React.ReactNode;
  closeLabel?: string;
  openType: React.RefObject<MenuOpenType>;
  trigger: React.RefObject<Element | null>;
  close: () => void;
}

const MenuLevelContext = React.createContext<MenuLevel | null>(null);

/** True while the root popup declined focus: its rows stay out of the tab order until a key engages them. */
const PassiveMenuContext = React.createContext(false);

/** The kind of the menu being rendered: a context menu's popups stack above other menus. */
export function useMenuKind(): MenuKind {
  return React.useContext(MenuLevelContext)?.kind ?? 'menu';
}

function useMenuLevel(): MenuLevel {
  const level = React.useContext(MenuLevelContext);
  if (level === null) throw new Error('Menu parts must be inside Menu.Root or ContextMenu.Root.');
  return level;
}

/** Strips `tabIndex` so the element cannot take focus. */
function unfocusable(props: ElementProps): React.ReactElement {
  const { tabIndex: _tabIndex, ref, ...rest } = props;
  return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)} ref={ref as React.Ref<HTMLDivElement>} />;
}

interface RootChangeDetails {
  readonly isCanceled: boolean;
  readonly event: Event;
  readonly trigger: Element | undefined;
}

interface MenuRootStateOptions<D extends RootChangeDetails> {
  kind: MenuKind;
  open: boolean | undefined;
  defaultOpen: boolean | undefined;
  onOpenChange: ((open: boolean, details: D) => void) | undefined;
  actionsRef: React.RefObject<BaseMenu.Root.Actions | null> | undefined;
  sheetTitle: React.ReactNode;
  closeLabel: string | undefined;
}

function useMenuRootState<D extends RootChangeDetails>({ kind, open, defaultOpen, onOpenChange, actionsRef, sheetTitle, closeLabel }: MenuRootStateOptions<D>) {
  const sheet = useSheetPresentation();
  const actions = React.useRef<BaseMenu.Root.Actions | null>(null);
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen ?? false);
  const isOpen = open ?? ownOpen;
  const openRef = React.useRef(isOpen);
  openRef.current = isOpen;
  const openType = React.useRef<MenuOpenType>('');
  const trigger = React.useRef<Element | null>(null);

  React.useEffect(() => {
    if (actionsRef) actionsRef.current = actions.current;
  });

  const close = React.useCallback(() => actions.current?.close(), []);
  useInnerOverlay(() => openRef.current, close);

  const handleOpenChange = React.useCallback(
    (next: boolean, details: D) => {
      onOpenChange?.(next, details);
      if (details.isCanceled) return;
      if (next) {
        openType.current = menuOpenType(details.event);
        trigger.current = details.trigger ?? null;
      }
      setOwnOpen(next);
    },
    [onOpenChange],
  );

  const level = React.useMemo<MenuLevel>(
    () => ({ kind, nested: false, open: isOpen, sheet, sheetTitle, closeLabel, openType, trigger, close }),
    [kind, isOpen, sheet, sheetTitle, closeLabel, close],
  );
  return { level, actions, isOpen, handleOpenChange };
}

export interface MenuRootProps extends BaseMenu.Root.Props {
  /** The title over the menu when it opens as a sheet on a small touch screen. */
  sheetTitle?: React.ReactNode;
  closeLabel?: string;
}

function MenuRoot({ sheetTitle, closeLabel, open, defaultOpen, onOpenChange, actionsRef, children, ...rest }: MenuRootProps): React.ReactElement {
  const { level, actions, isOpen, handleOpenChange } = useMenuRootState({
    kind: 'menu',
    open,
    defaultOpen,
    onOpenChange,
    actionsRef,
    sheetTitle,
    closeLabel,
  });
  return (
    <MenuLevelContext.Provider value={level}>
      <SheetPresentationProvider sheet={level.sheet}>
        <BaseMenu.Root {...rest} open={isOpen} onOpenChange={handleOpenChange} actionsRef={actions}>
          {children}
        </BaseMenu.Root>
      </SheetPresentationProvider>
    </MenuLevelContext.Provider>
  );
}

export interface ContextMenuRootProps extends BaseContextMenu.Root.Props {
  sheetTitle?: React.ReactNode;
  closeLabel?: string;
}

/** The root of a context menu; its popup opens at the pointer, or at `anchor` when the page opens it. */
export function ContextMenuRoot({
  sheetTitle,
  closeLabel,
  open,
  defaultOpen,
  onOpenChange,
  actionsRef,
  children,
  ...rest
}: ContextMenuRootProps): React.ReactElement {
  const { level, actions, isOpen, handleOpenChange } = useMenuRootState({
    kind: 'contextmenu',
    open,
    defaultOpen,
    onOpenChange,
    actionsRef,
    sheetTitle,
    closeLabel,
  });
  return (
    <MenuLevelContext.Provider value={level}>
      <SheetPresentationProvider sheet={level.sheet}>
        <BaseContextMenu.Root {...rest} open={isOpen} onOpenChange={handleOpenChange} actionsRef={actions}>
          {children}
        </BaseContextMenu.Root>
      </SheetPresentationProvider>
    </MenuLevelContext.Provider>
  );
}

export type MenuTriggerProps = BaseMenu.Trigger.Props;

const MenuTrigger = React.forwardRef<HTMLButtonElement, MenuTriggerProps>(function MenuTrigger(props, ref) {
  return <BaseMenu.Trigger ref={ref} {...props} />;
});

export interface MenuPopupProps extends Omit<BaseMenu.Popup.Props, 'className' | 'finalFocus' | 'children' | 'render'> {
  side?: PositionerProps['side'];
  align?: PositionerProps['align'];
  sideOffset?: PositionerProps['sideOffset'];
  alignOffset?: PositionerProps['alignOffset'];
  anchor?: PositionerProps['anchor'];
  collisionAvoidance?: PositionerProps['collisionAvoidance'];
  collisionPadding?: PositionerProps['collisionPadding'];
  /** Whether opening moves focus into the menu. When declined, focus stays put until an arrow key engages the menu. */
  initialFocus?: MenuInitialFocus;
  finalFocus?: PopupFinalFocus;
  /** Rows above the scrolling list that stay in view. */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** Rows shown before the list scrolls. */
  maxVisibleItems?: number;
  'data-ui'?: string;
  className?: string;
  children?: React.ReactNode;
}

/** The menu popup: placed beside its trigger or anchor, or as a sheet on a small touch screen. */
const MenuPopup = React.forwardRef<HTMLDivElement, MenuPopupProps>(function MenuPopup(
  {
    side,
    align = 'start',
    sideOffset,
    alignOffset,
    anchor,
    collisionAvoidance,
    collisionPadding,
    initialFocus,
    finalFocus,
    header,
    footer,
    maxVisibleItems,
    className,
    children,
    onMouseDown,
    onKeyDown,
    onContextMenu,
    onClickCapture,
    onKeyDownCapture,
    'data-ui': dataUi,
    ...rest
  },
  ref,
) {
  const level = useMenuLevel();
  const sheet = useIsSheet();
  const atRoot = !level.nested;
  const cursorAnchored = atRoot && level.kind === 'contextmenu';
  const layer = useOverlayLayer(cursorAnchored ? 'contextmenu' : 'menu');
  const back = useKitLabel('back');
  const parentPassive = React.useContext(PassiveMenuContext);

  const initialFocusRef = React.useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  const [declined, setDeclined] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!atRoot) return;
    setDeclined(level.open && !sheet && declinesFocus(initialFocusRef.current, level.openType.current));
  }, [atRoot, level.open, level.openType, sheet]);

  const anchoredAlone = atRoot && !cursorAnchored && anchor !== undefined && anchor !== null && finalFocus === undefined;
  const opener = useOpenerFocusReturn(atRoot && (declined || anchoredAlone), !declined);
  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const [popupElement, setPopupElement] = React.useState<HTMLDivElement | null>(null);
  const mergedRef = useMergedRefs<HTMLDivElement>(ref, popupRef, opener.popupRef, setPopupElement);
  const typeaheadGuard = useTypeaheadSpaceGuard(onClickCapture, onKeyDownCapture);
  useSwallowSheetEntryTaps(sheet ? popupElement : null, level.open);

  const resolvedFinalFocus: PopupFinalFocus = declined
    ? finalFocus === false
      ? false
      : typeof finalFocus === 'object'
        ? finalFocus
        : opener.finalFocus
    : anchoredAlone
      ? opener.finalFocus
      : finalFocus;

  const engage = React.useCallback(() => ReactDOM.flushSync(() => setDeclined(false)), []);

  // While the popup declines focus, arrow keys on its trigger move focus to the first or last row.
  React.useEffect(() => {
    const trigger = level.trigger.current;
    if (!declined || !atRoot || trigger === null) return undefined;
    const onTriggerKeyDown = (event: Event): void => {
      if (!(event instanceof KeyboardEvent) || event.isComposing || !ENGAGING_KEYS.has(event.key)) return;
      engage();
      const rows = Array.from(popupRef.current?.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR) ?? []);
      const row = event.key === 'ArrowUp' || event.key === 'End' ? rows[rows.length - 1] : rows[0];
      if (row === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      row.focus({ preventScroll: true });
    };
    trigger.addEventListener('keydown', onTriggerKeyDown);
    return () => trigger.removeEventListener('keydown', onTriggerKeyDown);
  }, [declined, atRoot, level.trigger, engage]);

  const defaultSideOffset = cursorAnchored ? undefined : level.nested ? 2 : 6;

  const positionerStyle = sheet ? { ...layer.style, ...SHEET_POSITIONER_STYLE } : layer.style;

  return (
    <BaseMenu.Portal>
      <PopupLayerScope layer={layer} sheet={sheet}>
        {sheet && atRoot && <SheetBackdrop layer={layer} />}
        <BaseMenu.Positioner
          className="data-[anchor-hidden]:invisible"
          style={positionerStyle}
          side={side}
          align={cursorAnchored && align === 'start' ? undefined : align}
          sideOffset={sideOffset ?? defaultSideOffset}
          alignOffset={alignOffset}
          anchor={anchor}
          collisionAvoidance={sheet ? NO_COLLISION_AVOIDANCE : collisionAvoidance}
          collisionPadding={collisionPadding}
        >
          <PassiveMenuContext.Provider value={atRoot ? declined : parentPassive}>
            <BaseMenu.Popup
              ref={mergedRef}
              data-ui={dataUi ?? (level.kind === 'contextmenu' ? 'ContextMenu' : 'Menu')}
              data-presentation={sheet ? 'sheet' : undefined}
              {...{ [OVERLAY_ATTRIBUTE]: '' }}
              {...rest}
              {...typeaheadGuard}
              finalFocus={resolvedFinalFocus}
              render={declined ? unfocusable : undefined}
              onMouseDown={(event) => {
                onMouseDown?.(event);
                if (declined && !isInteractivePopupTarget(event)) event.preventDefault();
              }}
              onKeyDown={(event) => {
                onKeyDown?.(event);
                if (declined && ENGAGING_KEYS.has(event.key)) engage();
              }}
              onContextMenu={(event) => {
                onContextMenu?.(event);
                if (level.kind !== 'contextmenu' || event.defaultPrevented) return;
                const target = event.target instanceof Element ? event.target : null;
                if (target?.closest('input, textarea, a[href]') == null) event.preventDefault();
              }}
              className={cn(MENU_POPUP_CLASSES, sheet ? SHEET_SURFACE_CLASSES : POPUP_MOTION_CLASSES, className)}
            >
              {sheet && atRoot && <SheetTitleBar title={level.sheetTitle} closeLabel={level.closeLabel} onClose={level.close} />}
              {sheet && level.nested && (
                <div className="shrink-0 px-[var(--ui-menu-gutter)] pt-[var(--ui-menu-gutter)]">
                  <BaseMenu.Item closeOnClick={false} onClick={level.close} onKeyDown={preventRepeatedActivation} className={menuItemVariants()}>
                    <LeadingIcon icon={<Icon name="CaretLeft" size="auto" />} />
                    <span className="min-w-0 flex-1 truncate">{back}</span>
                  </BaseMenu.Item>
                </div>
              )}
              <PopupScrollArea header={header} footer={footer} maxVisibleItems={maxVisibleItems}>
                {children}
              </PopupScrollArea>
            </BaseMenu.Popup>
          </PassiveMenuContext.Provider>
        </BaseMenu.Positioner>
      </PopupLayerScope>
    </BaseMenu.Portal>
  );
});

const NO_COLLISION_AVOIDANCE: PositionerProps['collisionAvoidance'] = { side: 'none', align: 'none', fallbackAxisSide: 'none' };

function menuDescriptionClamp(lines: number | undefined): { className: string; style?: React.CSSProperties } {
  const count = Math.floor(lines ?? 0);
  if (!Number.isFinite(count) || count < 1) return { className: 'break-words' };
  if (count === 1) return { className: 'truncate' };
  return {
    className: 'line-clamp-[var(--ui-menu-description-lines)] break-words',
    style: { '--ui-menu-description-lines': String(count) } as React.CSSProperties,
  };
}

export interface MenuItemProps extends Omit<BaseMenu.Item.Props, 'children' | 'className' | 'closeOnClick'> {
  /** An icon name, or an element to show in its place, before the label. */
  icon?: IconName | React.ReactNode;
  /** Quiet text at the end of the row. */
  hint?: React.ReactNode;
  hintDir?: 'auto';
  shortcut?: string;
  /** A second, quieter line under the label. */
  description?: React.ReactNode;
  /** Lines the description may take before it is cut off. */
  descriptionLines?: number;
  descriptionDir?: 'auto';
  labelDir?: 'auto';
  /** Makes the row a checkbox or radio row; `checkedRole` picks which. */
  checked?: boolean;
  checkedRole?: 'checkbox' | 'radio';
  checkPosition?: 'leading' | 'trailing';
  /** Leaves the menu open after the row is chosen. */
  keepOpen?: boolean;
  closeOnClick?: boolean;
  /** Why the row is disabled; shown beside it on hover or focus. */
  disabledReason?: React.ReactNode;
  variant?: MenuItemVariant;
  /** Something placed before the hint and shortcut, at the end of the row. */
  trailing?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

const MenuItem = React.forwardRef<HTMLElement, MenuItemProps>(function MenuItem(
  {
    icon,
    hint,
    hintDir,
    shortcut,
    description,
    descriptionLines,
    descriptionDir,
    labelDir,
    checked,
    checkedRole = 'checkbox',
    checkPosition = 'trailing',
    keepOpen = false,
    closeOnClick,
    disabledReason,
    variant = 'default',
    trailing,
    className,
    children,
    disabled,
    render,
    ...rest
  },
  ref,
) {
  const passive = React.useContext(PassiveMenuContext);
  const reasonId = React.useId();
  const hasDescription = description !== undefined && description !== null && description !== false && description !== '';
  const hasCheck = checked !== undefined;
  const showsReason = disabled === true && disabledReason !== undefined && !isEmptyTooltipContent(disabledReason);
  const clamp = menuDescriptionClamp(descriptionLines);
  const closes = closeOnClick ?? !keepOpen;

  const checkMark = (
    <span className="flex h-[1lh] w-icon shrink-0 items-center justify-center self-start text-[var(--ui-fill-accent)]">
      {checked ? <Icon name="Check" size="auto" bold /> : null}
    </span>
  );
  const hintNode =
    hint !== undefined && hint !== null && hint !== false && hint !== '' ? (
      <span dir={hintDir} className="max-w-[160px] truncate text-footnote text-muted group-data-[highlighted]/menu-danger:text-inherit">
        {hint}
      </span>
    ) : null;
  const shortcutNode =
    shortcut !== undefined && shortcut !== '' ? (
      <Shortcut keys={shortcut} variant="text" aria-hidden className="pointer-coarse:hidden text-footnote" />
    ) : null;
  const hasEnd = hintNode !== null || shortcutNode !== null || (hasCheck && checkPosition === 'trailing');

  const content = (
    <>
      {hasCheck && checkPosition === 'leading' && checkMark}
      {icon !== undefined && icon !== null && <LeadingIcon icon={icon} firstLine={hasDescription} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir={labelDir} className="min-w-0 truncate">
          {children}
        </span>
        {hasDescription && (
          <span dir={descriptionDir} className={cn('text-footnote text-muted', clamp.className)} style={clamp.style}>
            {description}
          </span>
        )}
      </span>
      {trailing !== undefined && trailing !== null && <span className="ms-md flex shrink-0 items-center">{trailing}</span>}
      {hasEnd && (
        <span className="ms-auto flex shrink-0 items-center gap-xs ps-md">
          {hintNode}
          {shortcutNode}
          {hasCheck && checkPosition === 'trailing' && checkMark}
        </span>
      )}
    </>
  );

  const guardsRepeats = closes || hasCheck || rest['aria-checked'] !== undefined;
  const shared = {
    ...rest,
    ref,
    disabled,
    onKeyDown: (event: Parameters<NonNullable<typeof rest.onKeyDown>>[0]) => {
      rest.onKeyDown?.(event);
      if (guardsRepeats) preventRepeatedActivation(event);
    },
    render: render ?? (passive ? unfocusable : undefined),
    'aria-keyshortcuts': rest['aria-keyshortcuts'] ?? (shortcut ? parseSingleShortcut(shortcut, isApplePlatform()) : undefined),
    'aria-describedby': cn(showsReason && reasonId, rest['aria-describedby']) || undefined,
    'data-ui-icon-row': icon !== undefined && icon !== null ? '' : undefined,
    className: menuItemVariants({ variant, className }),
  };

  const row =
    hasCheck && checkedRole === 'checkbox' ? (
      <BaseMenu.CheckboxItem {...shared} checked={checked} closeOnClick={closes}>
        {content}
      </BaseMenu.CheckboxItem>
    ) : (
      <BaseMenu.Item
        {...shared}
        closeOnClick={closes}
        {...(hasCheck ? { role: 'menuitemradio', 'aria-checked': checked } : null)}
      >
        {content}
      </BaseMenu.Item>
    );

  if (disabledReason === undefined) return row;
  return (
    <InlineEndTooltip content={showsReason ? disabledReason : undefined} explainsDisabled>
      <div role="none">
        {row}
        <DisabledReasonDescription id={reasonId} reason={showsReason ? disabledReason : undefined} />
      </div>
    </InlineEndTooltip>
  );
});

export type MenuGroupProps = BaseMenu.Group.Props;

const MenuGroup = React.forwardRef<HTMLDivElement, MenuGroupProps>(function MenuGroup(props, ref) {
  return <BaseMenu.Group ref={ref} {...props} />;
});

export interface MenuGroupLabelProps extends Omit<BaseMenu.GroupLabel.Props, 'className'> {
  className?: string;
}

const MenuGroupLabel = React.forwardRef<HTMLDivElement, MenuGroupLabelProps>(function MenuGroupLabel({ className, ...rest }, ref) {
  return <BaseMenu.GroupLabel ref={ref} {...rest} className={cn(MENU_GROUP_LABEL_CLASSES, className)} />;
});

export interface MenuSeparatorProps {
  className?: string;
}

function MenuSeparator({ className }: MenuSeparatorProps): React.ReactElement {
  return <BaseMenu.Separator className={cn(MENU_SEPARATOR_CLASSES, className)} />;
}

/** A caption at the top of a menu that is not a group label. */
const MenuHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function MenuHeader({ className, ...rest }, ref) {
  return <div ref={ref} role="presentation" {...rest} className={cn(MENU_GROUP_LABEL_CLASSES, className)} />;
});

export interface MenuSubmenuProps extends BaseMenu.SubmenuRoot.Props {}

/** A menu opened from a row of another menu. */
function MenuSubmenu({ open, defaultOpen, onOpenChange, children, ...rest }: MenuSubmenuProps): React.ReactElement {
  const parent = useMenuLevel();
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen ?? false);
  const isOpen = open ?? ownOpen;
  const handleOpenChange = React.useCallback(
    (next: boolean, details: BaseMenu.SubmenuRoot.ChangeEventDetails) => {
      onOpenChange?.(next, details);
      if (!details.isCanceled) setOwnOpen(next);
    },
    [onOpenChange],
  );
  const onCloseRef = React.useRef(onOpenChange);
  onCloseRef.current = onOpenChange;
  const close = React.useCallback(() => {
    setOwnOpen(false);
    onCloseRef.current?.(false, closePressDetails());
  }, []);
  const level = React.useMemo<MenuLevel>(() => ({ ...parent, nested: true, open: isOpen, close }), [parent, isOpen, close]);
  return (
    <MenuLevelContext.Provider value={level}>
      <BaseMenu.SubmenuRoot {...rest} open={isOpen} onOpenChange={handleOpenChange}>
        {children}
      </BaseMenu.SubmenuRoot>
    </MenuLevelContext.Provider>
  );
}

function closePressDetails(): BaseMenu.SubmenuRoot.ChangeEventDetails {
  let canceled = false;
  let propagates = false;
  return {
    reason: 'close-press',
    event: new Event('close-press'),
    trigger: undefined,
    get isCanceled() {
      return canceled;
    },
    get isPropagationAllowed() {
      return propagates;
    },
    cancel() {
      canceled = true;
    },
    allowPropagation() {
      propagates = true;
    },
  } as BaseMenu.SubmenuRoot.ChangeEventDetails;
}

export interface MenuSubmenuTriggerProps extends Omit<BaseMenu.SubmenuTrigger.Props, 'className'> {
  icon?: IconName | React.ReactNode;
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}

const MenuSubmenuTrigger = React.forwardRef<HTMLElement, MenuSubmenuTriggerProps>(function MenuSubmenuTrigger(
  { icon, hint, trailing, className, children, openOnHover, render, onKeyDown, ...rest },
  ref,
) {
  const sheet = useIsSheet();
  const passive = React.useContext(PassiveMenuContext);
  return (
    <BaseMenu.SubmenuTrigger
      ref={ref}
      {...rest}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        preventRepeatedActivation(event);
      }}
      openOnHover={sheet ? false : openOnHover}
      render={render ?? (passive ? unfocusable : undefined)}
      data-ui-icon-row={icon !== undefined && icon !== null ? '' : undefined}
      className={menuItemVariants({ className: cn('justify-between data-[popup-open]:bg-fill-ghost-hover', className) })}
    >
      {icon !== undefined && icon !== null && <LeadingIcon icon={icon} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing !== undefined && trailing !== null && <span className="ms-md flex shrink-0 items-center">{trailing}</span>}
      {hint !== undefined && hint !== null && hint !== '' && <span className="max-w-[160px] truncate text-footnote text-muted">{hint}</span>}
      <Icon name="CaretRight" size="auto" className="-me-1 shrink-0 text-muted" />
    </BaseMenu.SubmenuTrigger>
  );
});

const SEARCH_INPUT_CLASSES =
  'ui-reset block w-full min-w-0 h-control bg-transparent border-0 outline-none focus-visible:outline-hidden compact:ps-2 comfortable:ps-2.5 pe-2 text-body font-normal text-primary placeholder:text-muted';

/** A key that types a character or deletes one, as opposed to moving around the menu. */
export function isMenuTypingKey(event: React.KeyboardEvent | KeyboardEvent): boolean {
  const altGraph = event.getModifierState('AltGraph');
  return (
    ((event.key.length === 1 && event.key !== ' ') || event.key === 'Backspace' || (event.key === 'Delete' && !event.shiftKey)) &&
    (!event.ctrlKey || altGraph) &&
    !event.metaKey &&
    (!event.altKey || altGraph) &&
    event.keyCode !== 229
  );
}

function preventBaseHandler(event: React.SyntheticEvent): void {
  (event as React.SyntheticEvent & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
}

function ResetQueryOnClose({ reset }: { reset: () => void }): null {
  const latest = React.useRef(reset);
  latest.current = reset;
  React.useEffect(() => () => latest.current(), []);
  return null;
}

export interface MenuSearchablePopupProps extends Omit<MenuPopupProps, 'children' | 'header'> {
  /** Draws the rows for what was typed: lower-cased and trimmed, then just trimmed. */
  children: (query: string, trimmedQuery: string) => React.ReactNode;
  /** Placeholder and accessible name of the search field. */
  searchLabel: string;
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Empties the field when the menu closes. */
  resetQueryOnClose?: boolean;
  /** Called with the trimmed query when Enter is pressed in the field; the menu then closes. */
  onSubmitQuery?: (query: string) => void;
  /** Focuses the field when the menu opens; never on a touch screen. */
  fieldFocusOnOpen?: boolean;
}

/** A menu with a search field at the top; typing anywhere in the menu goes into the field. */
const MenuSearchablePopup = React.forwardRef<HTMLDivElement, MenuSearchablePopupProps>(function MenuSearchablePopup(
  {
    children,
    searchLabel,
    query,
    onQueryChange,
    resetQueryOnClose = true,
    onSubmitQuery,
    fieldFocusOnOpen = true,
    onKeyDown,
    onFocus,
    onMouseDown,
    ...rest
  },
  ref,
) {
  const level = useMenuLevel();
  const sheet = useIsSheet();
  const coarse = useCoarsePointerMedia();
  const focusesField = fieldFocusOnOpen && !sheet && !coarse;
  const [ownQuery, setOwnQuery] = React.useState('');
  const shown = query ?? ownQuery;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const changeQuery = React.useCallback(
    (next: string) => {
      setOwnQuery(next);
      onQueryChange?.(next);
    },
    [onQueryChange],
  );
  const shownRef = React.useRef(shown);
  shownRef.current = shown;
  const reset = React.useCallback(() => {
    if (shownRef.current !== '') changeQuery('');
  }, [changeQuery]);

  React.useEffect(() => {
    if (!focusesField || !level.open) return undefined;
    const input = inputRef.current;
    if (input === null) return undefined;
    const win = input.ownerDocument.defaultView ?? window;
    const focusField = (): void => {
      const menu = input.closest('[role="menu"]');
      const active = input.ownerDocument.activeElement;
      if (menu?.contains(active) && active !== menu) return;
      input.focus({ preventScroll: true });
    };
    focusField();
    let frames = 0;
    let frame = 0;
    const again = (): void => {
      focusField();
      frames += 1;
      if (frames < 2) frame = win.requestAnimationFrame(again);
    };
    frame = win.requestAnimationFrame(again);
    return () => win.cancelAnimationFrame(frame);
  }, [focusesField, level.open]);

  const header = (
    <>
      <input
        ref={inputRef}
        value={shown}
        onChange={(event) => changeQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            event.stopPropagation();
            return;
          }
          if (event.key === 'Enter') {
            const trimmed = shown.trim();
            if (onSubmitQuery !== undefined && trimmed !== '' && !event.repeat && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              onSubmitQuery(trimmed);
              level.close();
            }
            event.stopPropagation();
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const rows = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR);
            const row = event.key === 'ArrowDown' ? rows?.[0] : rows?.[rows.length - 1];
            if (row !== undefined) {
              event.preventDefault();
              event.stopPropagation();
              row.focus();
            }
            return;
          }
          if (event.key === 'Escape' || event.key === 'Tab') return;
          event.stopPropagation();
        }}
        placeholder={searchLabel}
        aria-label={searchLabel}
        autoComplete="off"
        tabIndex={focusesField ? undefined : -1}
        className={SEARCH_INPUT_CLASSES}
      />
      <div aria-hidden className="-mx-[var(--ui-menu-gutter)] mt-[var(--ui-menu-gutter)] h-px bg-[var(--ui-menu-line)]" />
    </>
  );

  return (
    <MenuPopup
      ref={ref}
      {...rest}
      header={header}
      onKeyDown={(event) => {
        const input = inputRef.current;
        const target = event.target instanceof Element ? event.target : null;
        if (input === null || target?.closest('input, textarea, [contenteditable]') || event.nativeEvent.isComposing || !isMenuTypingKey(event)) {
          onKeyDown?.(event);
          return;
        }
        // Moving focus while the key is down lets the browser type the character into the field.
        event.stopPropagation();
        preventBaseHandler(event);
        input.focus({ preventScroll: true });
      }}
      onFocus={(event) => {
        onFocus?.(event);
        const popup = event.currentTarget;
        if (focusesField && event.target === popup && popup.ownerDocument.activeElement === popup) {
          const from = event.relatedTarget instanceof Element ? event.relatedTarget : null;
          if (!(from?.hasAttribute('data-popup-open') && popup.contains(from))) inputRef.current?.focus({ preventScroll: true });
        }
      }}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        const target = event.target;
        if ((target instanceof HTMLElement && target.localName === 'input') || target === event.currentTarget) return;
        if (isInteractivePopupTarget(event)) return;
        event.preventDefault();
      }}
    >
      {resetQueryOnClose && <ResetQueryOnClose reset={reset} />}
      {children(shown.trim().toLowerCase(), shown.trim())}
    </MenuPopup>
  );
});

MenuTrigger.displayName = 'Menu.Trigger';
MenuPopup.displayName = 'Menu.Popup';
MenuItem.displayName = 'Menu.Item';
MenuGroup.displayName = 'Menu.Group';
MenuGroupLabel.displayName = 'Menu.GroupLabel';
MenuHeader.displayName = 'Menu.Header';
MenuSubmenuTrigger.displayName = 'Menu.SubmenuTrigger';
MenuSearchablePopup.displayName = 'Menu.SearchablePopup';

export {
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuSearchablePopup,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuHeader,
};

export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Popup: MenuPopup,
  SearchablePopup: MenuSearchablePopup,
  Item: MenuItem,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
  SubmenuTrigger: MenuSubmenuTrigger,
  Header: MenuHeader,
};
