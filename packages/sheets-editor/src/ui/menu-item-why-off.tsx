import { ContextMenu } from '../kit/context-menu.tsx';
import { Tooltip } from '../kit/tooltip.tsx';
import type { TooltipProps, TooltipSide } from '../kit/tooltip.tsx';
import type { MenuItemProps } from '../kit/menu.tsx';
import * as React from 'react';
/** Where the reason a menu row is off is shown: beside the row, or above the menus. */
export type WhyOffSide = 'beside' | 'above';
export type BoxSides = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
export interface WhyOffBounds {
  row: DOMRect;
  menu: DOMRect;
  otherMenus: DOMRect[];
  widthOfWindow: number;
  heightOfTooltip: number;
}
export interface WhyOffPlacement {
  side: WhyOffSide;
  mostWidth: number;
}
type WhyOffCollisionAvoidance = NonNullable<TooltipProps['collisionAvoidance']>;
export interface WhyOffPositioning {
  side: TooltipSide;
  collisionAvoidance: WhyOffCollisionAvoidance;
  anchor: NonNullable<TooltipProps['anchor']>;
}
export function boundsOfRowAndMenus(side: WhyOffSide, { row, menu, otherMenus }: Pick<WhyOffBounds, 'row' | 'menu' | 'otherMenus'>): BoxSides {
  const anchorBox = side === 'beside' ? row : menu;
  const left = Math.min(anchorBox.left, ...otherMenus.map((box) => box.left));
  const right = Math.max(anchorBox.right, ...otherMenus.map((box) => box.right));
  if (side === 'beside')
    return {
      left,
      right,
      top: row.top,
      bottom: row.bottom,
    };
  const top = Math.min(menu.top, ...otherMenus.map((box) => box.top));
  return {
    left,
    right,
    top,
    bottom: top,
  };
}
export function whyOffTooltipPlacement(bounds: WhyOffBounds): WhyOffPlacement | null {
  const { widthOfWindow, heightOfTooltip } = bounds;
  const { left, right } = boundsOfRowAndMenus('beside', bounds);
  const widthBeside = Math.max(left, widthOfWindow - right) - WHY_OFF_SIDE_OFFSET - WHY_OFF_EDGE_MARGIN;
  if (widthBeside >= WHY_OFF_MIN_SIDE_WIDTH)
    return {
      side: 'beside',
      mostWidth: Math.min(widthBeside, WHY_OFF_TOOLTIP_MAX_WIDTH),
    };
  if (
    boundsOfRowAndMenus('above', bounds).top - WHY_OFF_SIDE_OFFSET - WHY_OFF_EDGE_MARGIN >= heightOfTooltip &&
    widthOfWindow >= WHY_OFF_TOOLTIP_MAX_WIDTH + 2 * WHY_OFF_EDGE_MARGIN
  )
    return {
      side: 'above',
      mostWidth: WHY_OFF_TOOLTIP_MAX_WIDTH,
    };
  return widthBeside >= WHY_OFF_NARROW_SIDE_WIDTH
    ? {
        side: 'beside',
        mostWidth: widthBeside,
      }
    : null;
}
export function measureWhyOffTooltip(rowElement: HTMLElement | null, textElement: HTMLElement | null): WhyOffBounds | null {
  const menuElement = closestMenuElement(rowElement);
  if (rowElement === null || menuElement === null || textElement === null) return null;
  const ownerDocument = rowElement.ownerDocument;
  return {
    row: rowElement.getBoundingClientRect(),
    menu: menuElement.getBoundingClientRect(),
    otherMenus: [...ownerDocument.querySelectorAll('[role=menu]')]
      .filter((otherMenu) => otherMenu !== menuElement)
      .map((otherMenu) => otherMenu.getBoundingClientRect())
      .filter((box) => box.width > 0),
    widthOfWindow: ownerDocument.documentElement.clientWidth,
    heightOfTooltip: textElement.offsetHeight,
  };
}
export interface WhyOffTooltipTextProps {
  mostWidth: number;
}
export function WhyOffTooltipText({ mostWidth }: WhyOffTooltipTextProps) {
  const whyOff = React.use(WhyOffContext);
  const [lastWhyOff, setLastWhyOff] = React.useState(whyOff);
  if (whyOff !== null && whyOff !== lastWhyOff) setLastWhyOff(whyOff);
  return <span {...(mostWidth < WHY_OFF_TOOLTIP_MAX_WIDTH && {
      className: 'block',
      style: {
        maxWidth: `calc(${mostWidth}px - 1rem)`,
      },
    })}>{whyOff ?? lastWhyOff}</span>;
}
export interface MenuItemWithWhyOffProps extends MenuItemProps {
  /** Why the row is off, shown in a tooltip while the row is disabled. */
  whyOff: string | null;
  isPointerCoarse?: boolean;
}
export function MenuItemWithWhyOff({ whyOff, isPointerCoarse = false, ...itemProps }: MenuItemWithWhyOffProps) {
  const describedById = React.useId();
  const rowRef = React.useRef<HTMLDivElement>(null);
  const textRef = React.useRef<HTMLSpanElement>(null);
  const [positioning, setPositioning] = React.useState(DEFAULT_WHY_OFF_POSITIONING);
  const showsWhyOff = whyOff !== null && itemProps.disabled === true;
  return <WhyOffContext value={whyOff}><Tooltip content={showsWhyOff && !isPointerCoarse
          ? () => {
              const [rowElement, textElement] = [rowRef.current, textRef.current];
              const measure = () => measureWhyOffTooltip(rowElement, textElement);
              const bounds = measure();
              const placement = bounds === null ? null : whyOffTooltipPlacement(bounds);
              if (placement === null) return null;
              setPositioning(
                whyOffTooltipPositioning(placement.side, measure, placement.side === 'above' ? closestMenuElement(rowElement) : rowElement),
              );
              return <WhyOffTooltipText mostWidth={placement.mostWidth} />;
            }
          : undefined} multiline closeOnClick={false} sideOffset={WHY_OFF_SIDE_OFFSET} {...positioning}><div ref={rowRef} role="none"><ContextMenu.Item {...itemProps} {...(showsWhyOff && {
              'aria-describedby': describedById,
            })} />{showsWhyOff &&
            (<span className="invisible fixed size-0 overflow-hidden"><span ref={textRef} id={describedById} className="absolute w-max px-2 py-1.5 text-[0.8125rem]/[1.125rem] break-words" style={{
                  maxWidth: WHY_OFF_TOOLTIP_MAX_WIDTH,
                }}>{whyOff}</span></span>)}</div></Tooltip></WhyOffContext>;
}
export const WHY_OFF_TOOLTIP_MAX_WIDTH = 240;
export const WHY_OFF_MIN_SIDE_WIDTH = 136;
export const WHY_OFF_NARROW_SIDE_WIDTH = 96;
export const WHY_OFF_SIDE_OFFSET = 4;
export const WHY_OFF_EDGE_MARGIN = 8;
export const closestMenuElement = (element: Element | null) => element?.closest('[role=menu]') ?? null;
export const WHY_OFF_BESIDE_COLLISION_AVOIDANCE: WhyOffCollisionAvoidance = {
  fallbackAxisSide: 'none',
};
export const WHY_OFF_ABOVE_COLLISION_AVOIDANCE: WhyOffCollisionAvoidance = {
  side: 'none',
  align: 'shift',
  fallbackAxisSide: 'none',
};
export const whyOffTooltipPositioning = (
  side: WhyOffSide,
  boundsOf: () => WhyOffBounds | null,
  contextElement: Element | null,
): WhyOffPositioning => ({
  side: side === 'above' ? 'top' : 'inline-end',
  collisionAvoidance: side === 'above' ? WHY_OFF_ABOVE_COLLISION_AVOIDANCE : WHY_OFF_BESIDE_COLLISION_AVOIDANCE,
  anchor: {
    ...(contextElement !== null && {
      contextElement,
    }),
    getBoundingClientRect() {
      const bounds = boundsOf();
      const {
        left,
        right,
        top,
        bottom,
      } = bounds === null
        ? {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }
        : boundsOfRowAndMenus(side, bounds);
      return {
        left,
        right,
        top,
        bottom,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
    },
  },
});
export const DEFAULT_WHY_OFF_POSITIONING = whyOffTooltipPositioning('beside', () => null, null);
export const WhyOffContext = React.createContext<string | null>(null);
