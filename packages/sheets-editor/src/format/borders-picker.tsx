import { Menu, menuItemVariants } from '../kit/menu.tsx';
import { Popover } from '../kit/popover.tsx';
import { useRovingToolbar } from '../kit/roving-toolbar.ts';
import { Icon, LeadingIcon } from '../kit/icon.tsx';
import { Button } from '../kit/button.tsx';
import type { BorderStyle } from '@open-artifact/sheets-core';
import type { CustomIcon, IconName, IconSizeChoice } from '../kit/icon.tsx';
import type { MenuPopupProps } from '../kit/menu.tsx';
import type { PopoverPopupProps } from '../kit/popover.tsx';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createPenPickerHoverIntent } from './border-pen-hover.ts';
import type { OpenPenPicker, PenPicker, PenRowOpenedBy } from './border-pen-hover.ts';
import { ARROW_KEY_FOCUS_STEPS, nearestElementInDirection } from './color-picker/swatches.tsx';
import { useTooltipHeldAsPaneOpens } from '../ui/side-pane/held-tooltip.ts';
import { useBottomInset, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { borderMenuMessages, borderColorButtonLabel, borderThicknessButtonLabel, borderStyleLabel, borderEdgesLabel } from '../i18n/format-labels.ts';
import { preventMouseDownDefault, wrapTabFocusInBar } from '../ui/dom-events.ts';
import { blockRepeatedEnterOrSpace } from '../ui/repeated-key-guards.ts';
import { fillPaintStyle } from '../grid/cell-drawing.tsx';
import { shownCellColor } from './cell-colors.ts';
import { COLOR_POPUP_PADDING, SheetColorPicker } from './color-picker.tsx';
import { CONTEXT_BAR_PART_ATTRIBUTE } from '../ui/toolbar-tooltip.tsx';
import { BORDER_LINE_STYLES, BORDER_EDGE_CHOICES } from './borders.ts';
import type { BorderChoice, BorderLine } from './borders.ts';
import type { AreaBorderLines, AreaBorderSide } from '../grid/borders.ts';
import type { ColorPickerChoices } from '../view/page-view.ts';
import { swallowRestOfPress } from '../ui/press-swallow.ts';
import { useCoarseBarIconSize } from '../ui/bar-buttons.tsx';
export interface BorderPenRowProps extends React.ComponentPropsWithRef<'button'> {
  icon: React.ReactNode;
  label: string;
  opensList: boolean;
  /** Shows a check mark when true, room for one when false, and neither when left out. */
  isChecked?: boolean;
}
/** How a popup of the pen was opened. */
export type PenPopupOpenType = 'mouse' | 'touch' | 'pen' | 'keyboard' | '';
export interface BordersPickerProps {
  pen: BorderLine;
  whatColorPickerShows: () => ColorPickerChoices;
  /** The element the caret goes back to when the picker shuts, or false when it stays. */
  whatHasCaretAfter: () => HTMLElement | false;
  areGridlinesHidden: boolean;
  onChosen: (choice: BorderChoice) => void;
  onPenChanged: (change: Partial<BorderLine>) => void;
  onGridlinesToggled: () => void;
}
/** The sizes a border picture is drawn at, in its view box. */
export interface BorderPictureMetrics {
  viewBox: number;
  /** Where the outer lines lie, from the near and the far edge. */
  near: number;
  far: number;
  /** How far a rounded corner reaches along each line. */
  reach: number;
  strokeWidth: number;
}
/** Where a line of a border picture lies: across (at a height) or down (at a width). */
export interface BorderPictureLinePlace {
  isAcross: boolean;
  at: number;
}
/** The line paths of a custom icon. */
export type IconPaths = CustomIcon['paths'];
export interface BorderPictureProps {
  strong: AreaBorderSide[];
  size: IconSizeChoice;
}
export interface BordersOfBlockIconProps {
  lines: AreaBorderLines;
}
export function borderChoiceIcon(choice: BorderChoice) {
  let icon = <Icon name={BORDER_CHOICE_ICONS[choice]} size="md" />;
  if (choice !== 'clear') return icon;
  let slashPath = `M${BORDER_PICTURE_MEDIUM.near} ${BORDER_PICTURE_MEDIUM.near}L${BORDER_PICTURE_MEDIUM.far} ${BORDER_PICTURE_MEDIUM.far}`;
  return <span className="sheet-border-picture">{icon}{borderPictureIcon(BORDER_PICTURE_MEDIUM, 'md', 'BordersSlash', slashPath)}</span>;
}
export function BorderPenRow({ icon, label, opensList, isChecked, ...buttonProps }: BorderPenRowProps) {
  return <button type="button" {...buttonProps} className={menuItemVariants({
      className: 'hover:bg-fill-ghost-hover focus-visible:shadow-focus data-[popup-open]:bg-fill-ghost-hover',
    })}><LeadingIcon icon={icon} /><span className="min-w-0 flex-1 truncate text-start">{label}</span>{isChecked !== undefined &&
        (<span className="ms-md -me-1 flex shrink-0" style={{
            color: 'var(--ui-fill-accent)',
          }}><LeadingIcon icon={isChecked &&
              <Icon name="Check" size="auto" />} /></span>)}{opensList &&
        <span className="ms-md -me-1 flex shrink-0 text-muted"><LeadingIcon icon={<Icon name="CaretRight" size="sm" />} /></span>}</button>;
}
export function useBorderPenPickers(containerRef: React.RefObject<HTMLElement | null>) {
  let [open, setOpen] = React.useState<OpenPenPicker | null>(null);
  let hover = React.useMemo(
    () =>
      createPenPickerHoverIntent({
        onChanged: setOpen,
        after(ms, run) {
          let timer = setTimeout(run, ms);
          return {
            cancel: () => clearTimeout(timer),
          };
        },
      }),
    [],
  );
  React.useEffect(() => () => hover.stop(), [hover]);
  let colorPopupRef = React.useRef<HTMLDivElement>(null);
  let stylePopupRef = React.useRef<HTMLDivElement>(null);
  let openByRest = open?.isHeld === false ? open.picker : null;
  React.useEffect(() => {
    let doc = containerRef.current?.ownerDocument;
    if (openByRest === null || doc === undefined) return;
    let notePointerMove = ({ clientX, clientY }: PointerEvent) => {
      let pickerBounds = (openByRest === 'color' ? colorPopupRef : stylePopupRef).current?.getBoundingClientRect();
      if (pickerBounds === undefined) return;
      let [distanceX, distanceY] = [
        Math.max(pickerBounds.left - clientX, 0, clientX - pickerBounds.right),
        Math.max(pickerBounds.top - clientY, 0, clientY - pickerBounds.bottom),
      ];
      hover.pointerDistanceFromPicker(Math.hypot(distanceX, distanceY));
    };
    doc.addEventListener('pointermove', notePointerMove);
    return () => doc.removeEventListener('pointermove', notePointerMove);
  }, [openByRest, hover, containerRef]);
  return {
    wasHeld: () => hover.wasHeld(),
    rootOf: (picker: PenPicker) => ({
      open: open?.picker === picker,
      onOpenChange: (isOpen: boolean) => (isOpen ? hover.openedByPressOrKey(picker) : hover.shutByDesignSystem(picker)),
    }),
    rowOf(picker: PenPicker) {
      let aboutToOpen = (openedBy: PenRowOpenedBy) => ReactDOM.flushSync(() => hover.rowAboutToOpenIt(picker, openedBy));
      return {
        onPointerMove: (event: React.PointerEvent) => isFinePointerEvent(event) && hover.pointerOnRow(picker, event.clientX, event.clientY),
        onPointerLeave: (event: React.PointerEvent) => isFinePointerEvent(event) && hover.pointerOffRow(picker),
        onClickCapture: () => aboutToOpen('pressOrClick'),
        ...(picker === 'style' && {
          onMouseDownCapture: ({ button }: React.MouseEvent) => button === 0 && aboutToOpen('pressOrClick'),
          onKeyDownCapture: ({ key }: React.KeyboardEvent) => (key === 'ArrowDown' || key === 'ArrowUp') && aboutToOpen('arrowKey'),
        }),
      };
    },
    popupOf: (picker: PenPicker) => ({
      ref: picker === 'color' ? colorPopupRef : stylePopupRef,
      onPointerEnter: (event: React.PointerEvent) => isFinePointerEvent(event) && hover.pointerOnPicker(picker),
      onPointerLeave: (event: React.PointerEvent) => isFinePointerEvent(event) && hover.pointerOffPicker(picker),
      onPointerDown: () => hover.held(picker),
      onFocus: () => hover.held(picker),
    }),
  };
}
export function moveFocusUpDownInBorders(event: React.KeyboardEvent<HTMLDivElement>) {
  let { key, target, currentTarget } = event;
  let step = key === 'ArrowUp' || key === 'ArrowDown' ? ARROW_KEY_FOCUS_STEPS.get(key) : undefined;
  if (step === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
  let items = [...currentTarget.querySelectorAll('button')];
  let match = items.find((button) => button === target);
  if (match === undefined || match.getAttribute('aria-expanded') === 'true') return;
  event.preventDefault();
  event.stopPropagation();
  let matches = items.filter((button) => button !== match);
  nearestElementInDirection(match, matches, step)?.focus({
    preventScroll: true,
    focusVisible: true,
  });
}
export function BordersPicker(props: BordersPickerProps) {
  let {
    pen,
    whatColorPickerShows,
    whatHasCaretAfter,
    areGridlinesHidden,
  } = props;
  let { onChosen, onPenChanged, onGridlinesToggled } = props;
  let penRef = React.useRef<HTMLDivElement>(null);
  let { wasHeld, rootOf, rowOf, popupOf } = useBorderPenPickers(penRef);
  let wasOpenedByKeyRef = React.useRef(false);
  let focusProps = {
    initialFocus(openType: PenPopupOpenType) {
      wasOpenedByKeyRef.current = openType === 'keyboard';
      return wasOpenedByKeyRef.current;
    },
    finalFocus() {
      if (wasOpenedByKeyRef.current) return true;
      return wasHeld() && whatHasCaretAfter();
    },
  };
  let toolbarFocus = useRovingToolbar();
  let gridlinesRef = React.useRef<HTMLButtonElement>(null);
  let allBordersRef = React.useRef<HTMLButtonElement>(null);
  let barHint = useTooltipHeldAsPaneOpens();
  let onFocusLeavingGridlines = (event: React.FocusEvent) => {
    let { target, relatedTarget, currentTarget } = event;
    if (target !== gridlinesRef.current || currentTarget.contains(relatedTarget)) return;
    if (currentTarget.closest('[data-presentation="sheet"]') === null) allBordersRef.current?.focus();
  };
  let bottomInset = useBottomInset();
  let placement: Pick<PopoverPopupProps & MenuPopupProps, 'anchor' | 'side' | 'align' | 'collisionPadding'> = {
    anchor: penRef,
    side: 'inline-end',
    align: 'end',
    collisionPadding: popupCollisionPadding(bottomInset),
  };
  return <div className="sheet-borders-picker" role="toolbar" aria-label={sheetMessages.borders()} {...toolbarFocus} onKeyDownCapture={moveFocusUpDownInBorders} onPointerEnter={barHint.end} onFocus={(event) => {
      toolbarFocus.onFocus(event);
      onFocusLeavingGridlines(event);
    }}><div className="sheet-gridlines-choice"><BorderPenRow ref={gridlinesRef} opensList={false} icon={null} isChecked={!areGridlinesHidden} label={borderMenuMessages.showGridlines()} aria-pressed={!areGridlinesHidden} onMouseDown={preventMouseDownDefault} onKeyDown={blockRepeatedEnterOrSpace} onClick={onGridlinesToggled} /></div><div ref={penRef} className="sheet-border-pen"><Popover.Root {...rootOf('color')}><Popover.Trigger render={<BorderPenRow opensList icon={<span className="sheet-color-bar sheet-border-pen-swatch" data-has-fill={pen.color.kind !== 'none' || undefined} style={fillPaintStyle(shownCellColor('textColor', pen.color))} />} label={borderMenuMessages.color()} aria-label={borderColorButtonLabel(pen.color)} {...rowOf('color')} />} /><Popover.Popup {...popupOf('color')} {...placement} padding={COLOR_POPUP_PADDING} aria-label={borderMenuMessages.borderColor()} {...focusProps} keepFocus onKeyDown={wrapTabFocusInBar} {...{
                  [CONTEXT_BAR_PART_ATTRIBUTE]: true,
                }}><SheetColorPicker property="textColor" color={pen.color} whatIsColored={{
                    kind: 'cells',
                    otherColor: null,
                  }} whatItShows={whatColorPickerShows} onChosen={(color) =>
                    onPenChanged({
                      color,
                    })} onDone={() => rootOf('color').onOpenChange(false)} /></Popover.Popup></Popover.Root><Menu.Root modal={false} {...rootOf('style')}><Menu.Trigger render={<BorderPenRow opensList icon={borderStyleIcon(pen.style)} label={borderMenuMessages.style()} aria-label={borderThicknessButtonLabel(pen.style)} {...rowOf('style')} />} /><Menu.Popup {...popupOf('style')} {...placement} collisionAvoidance={BORDER_STYLE_POPUP_COLLISION} {...focusProps} onMouseDown={preventMouseDownDefault} onKeyDownCapture={blockRepeatedEnterOrSpace} {...{
                  [CONTEXT_BAR_PART_ATTRIBUTE]: true,
                }}><Menu.Group aria-label={borderMenuMessages.borderStyle()}>{BORDER_LINE_STYLES.map(
                    (style) =>
                      (<Menu.Item key={style} icon={borderStyleIcon(style)} checkedRole="radio" checked={pen.style === style} onClick={(event) => {
                            swallowRestOfPress(event);
                            onPenChanged({
                              style,
                            });
                          }}>{borderStyleLabel(style)}</Menu.Item>),
                  )}</Menu.Group></Menu.Popup></Menu.Root></div><div className="sheet-border-choices">{([...BORDER_EDGE_CHOICES, 'clear'] satisfies BorderChoice[]).map(
          (choice) =>
            (<Button key={choice} {...(choice === 'all' && {
                  ref: allBordersRef,
                  ...barHint.ofButton,
                })} variant="ghost" iconOnly aria-label={borderEdgesLabel(choice)} tooltipSide="top" icon={borderChoiceIcon(choice)} onClick={() => onChosen(choice)} />),
        )}</div></div>;
}
export const BORDER_CHOICE_ICONS: Record<BorderChoice, IconName> = {
  all: 'BorderAll',
  inner: 'BorderInner',
  innerHorizontal: 'BorderInnerHorizontal',
  innerVertical: 'BorderInnerVertical',
  outer: 'BorderOuter',
  left: 'BorderLeft',
  top: 'BorderTop',
  right: 'BorderRight',
  bottom: 'BorderBottom',
  clear: 'BorderClear',
};
export const BORDER_PICTURE_MEDIUM: BorderPictureMetrics = {
  viewBox: 20,
  near: 3.125,
  far: 16.875,
  reach: 3.2,
  strokeWidth: 1.25,
};
export const BORDER_PICTURE_LARGE: BorderPictureMetrics = {
  viewBox: 24,
  near: 3.75,
  far: 20.25,
  reach: 4.2,
  strokeWidth: 1.5,
};
export const BORDER_CORNER_CURVE: [alongX: number, alongY: number][] = [
  [0.6497, 0],
  [0.4747, 0],
  [0.3413, 0.0678],
  [0.2234, 0.1278],
  [0.1278, 0.2234],
  [0.0678, 0.3413],
  [0, 0.4747],
  [0, 0.6497],
  [0, 1],
];
export const borderLineAt = ({ viewBox, near, far }: BorderPictureMetrics, edge: AreaBorderSide): BorderPictureLinePlace =>
  (
    ({
      top: {
        isAcross: true,
        at: near,
      },
      horizontal: {
        isAcross: true,
        at: viewBox / 2,
      },
      bottom: {
        isAcross: true,
        at: far,
      },
      left: {
        isAcross: false,
        at: near,
      },
      vertical: {
        isAcross: false,
        at: viewBox / 2,
      },
      right: {
        isAcross: false,
        at: far,
      },
    })
  )[edge];
export const BORDER_PICTURE_LINES: AreaBorderSide[] = ['top', 'bottom', 'left', 'right', 'horizontal', 'vertical'];
export const roundTo3 = (value: number): number => Number(value.toFixed(3));
export const borderCornerPath = ({ near, reach }: BorderPictureMetrics, x: number, y: number): string => {
  let [stepX, stepY] = [x === near ? reach : -reach, y === near ? reach : -reach];
  let controlPoints = BORDER_CORNER_CURVE.map(
    ([alongX, alongY]) => `${roundTo3(x + stepX * alongX)} ${roundTo3(y + stepY * alongY)}`,
  );
  return `M${roundTo3(x + stepX)} ${y}C${controlPoints.join(' ')}`;
};
export const borderLinesPath = (picture: BorderPictureMetrics, edges: AreaBorderSide[], strongEdges: AreaBorderSide[]): string =>
  edges
    .map((edge) => {
      let { viewBox, near, far, reach, strokeWidth } = picture;
      let { isAcross, at: position } = borderLineAt(picture, edge);
      let meetsStrongCorner = (otherEdge: AreaBorderSide) =>
        position !== viewBox / 2 && strongEdges.includes(otherEdge) === strongEdges.includes(edge);
      let meetsGap = (otherEdge: AreaBorderSide) => strongEdges.includes(otherEdge) && !strongEdges.includes(edge);
      let [middle, gap] = [viewBox / 2, 2 * strokeWidth];
      let [startEdge, crossEdge, endEdge]: AreaBorderSide[] = isAcross ? ['left', 'vertical', 'right'] : ['top', 'horizontal', 'bottom'];
      let start = near + (meetsStrongCorner(startEdge) ? reach : meetsGap(startEdge) ? gap : 0);
      let end = far - (meetsStrongCorner(endEdge) ? reach : meetsGap(endEdge) ? gap : 0);
      let linePath = (from: number, to: number) =>
        isAcross ? `M${roundTo3(from)} ${position}H${roundTo3(to)}` : `M${position} ${roundTo3(from)}V${roundTo3(to)}`;
      let path = meetsGap(crossEdge) ? linePath(start, middle - gap) + linePath(middle + gap, end) : linePath(start, end);
      if (!isAcross) return path;
      let corners = [
        meetsStrongCorner(startEdge) ? borderCornerPath(picture, near, position) : '',
        meetsStrongCorner(endEdge) ? borderCornerPath(picture, far, position) : '',
      ];
      return `${path}${corners.join('')}`;
    })
    .join('');
export const borderPictureIcon = (picture: BorderPictureMetrics, size: IconSizeChoice, name: string, path: string) =>
  <Icon customIcon={{
      name,
      viewBox: picture.viewBox,
      paths: [
        {
          d: path,
          strokeWidth: picture.strokeWidth,
        },
      ],
    }} size={size} />;
export const BorderPicture = React.memo(function ({ strong, size }: BorderPictureProps) {
  let picture = size === 'lg' ? BORDER_PICTURE_LARGE : BORDER_PICTURE_MEDIUM;
  if (strong.length === 0)
    return <span className="sheet-border-picture sheet-border-picture-none">{borderPictureIcon(picture, size, 'BordersNone', borderLinesPath(picture, BORDER_PICTURE_LINES, BORDER_PICTURE_LINES))}</span>;
  return <span className="sheet-border-picture">{strong.length < BORDER_PICTURE_LINES.length &&
        (<span className="sheet-border-picture-faint">{borderPictureIcon(
            picture,
            size,
            'BordersFaint',
            borderLinesPath(
              picture,
              BORDER_PICTURE_LINES.filter((line) => !strong.includes(line)),
              strong,
            ),
          )}</span>)}{borderPictureIcon(picture, size, 'BordersStrong', borderLinesPath(picture, strong, strong))}</span>;
});
export const BordersOfBlockIcon = React.memo(
  function ({ lines }: BordersOfBlockIconProps) {
    let size: IconSizeChoice = useCoarseBarIconSize() ?? 'auto';
    return <BorderPicture strong={BORDER_PICTURE_LINES.filter((line) => lines[line] === 'all')} size={size} />;
  },
  (before, after) =>
    BORDER_PICTURE_LINES.every((line) => before.lines[line] === after.lines[line]),
);
export const BORDER_STYLE_ICON_PATHS: Record<BorderStyle, IconPaths> = {
  thin: [
    {
      d: 'M1 7.5H15',
      strokeWidth: 1,
    },
  ],
  medium: [
    {
      d: 'M1 8H15',
      strokeWidth: 2,
    },
  ],
  thick: [
    {
      d: 'M1 7.5H15',
      strokeWidth: 3,
    },
  ],
  dashed: [
    {
      d: 'M1 7.5h3M6.5 7.5h3M12 7.5h3',
      strokeWidth: 1,
    },
  ],
  dotted: [
    {
      d: 'M1 7.5h1M4 7.5h1M7 7.5h1M10 7.5h1M13 7.5h1',
      strokeWidth: 1,
    },
  ],
  double: [
    {
      d: 'M1 6.5H15M1 8.5H15',
      strokeWidth: 1,
    },
  ],
};
export const borderStyleIcon = (style: BorderStyle) =>
  <Icon customIcon={{
      name: `BorderStyle-${style}`,
      viewBox: 16,
      paths: BORDER_STYLE_ICON_PATHS[style],
    }} size="sm" />;
export const BORDER_STYLE_POPUP_COLLISION: MenuPopupProps['collisionAvoidance'] = {
  fallbackAxisSide: 'end',
};
export const isFinePointerEvent = ({ pointerType, currentTarget }: React.PointerEvent): boolean =>
  pointerType !== 'touch' && currentTarget.ownerDocument.defaultView?.matchMedia('(pointer:coarse)').matches !== true;
