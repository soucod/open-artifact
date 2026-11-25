import { Menu } from '../kit/menu.tsx';
import { Icon } from '../kit/icon.tsx';
import { Button } from '../kit/button.tsx';
import type { ButtonProps } from '../kit/button.tsx';
import type * as React from 'react';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { zoomPercent } from '../grid/zoom.ts';
export interface MenuCaretProps {
  /** Width and height of the caret, in pixels at the base rem. */
  room: number;
  className: string;
}
export function MenuCaret({ room, className }: MenuCaretProps) {
  const size = `calc(${room / 16}rem * var(--ui-rem-scale, 1))`;
  return <span className={`inline-flex shrink-0 items-center justify-center ${className}`} style={{
      width: size,
      height: size,
    }}><Icon customIcon={{
        name: 'caretDownSmall',
        viewBox: 16,
        paths: [
          {
            d: 'M6 7L8 9L10 7',
            strokeWidth: 1.25,
          },
        ],
      }} size="sm" /></span>;
}
export interface MenuTriggerButtonProps extends ButtonProps {
  ref?: React.Ref<HTMLElement>;
  children: React.ReactNode;
  chevron: keyof typeof MENU_CARETS;
}
export function MenuTriggerButton({ ref, id, children, chevron, ...buttonProps }: MenuTriggerButtonProps) {
  return <Menu.Trigger id={id} disabled={buttonProps.disabled} render={<Button ref={ref} {...buttonProps}>{children}{MENU_CARETS[chevron]}</Button>} />;
}
export interface ZoomPercentProps {
  zoom: number;
}
export function ZoomPercent({ zoom }: ZoomPercentProps) {
  return <span className="sheet-zoom-percent tabular-nums" data-widest={sheetMessages.zoomPercent(100)}>{sheetMessages.zoomPercent(zoomPercent(zoom))}</span>;
}
export const MENU_CARETS = {
  toolbar: MenuCaret({
    room: 12,
    className: '-mx-0.5 text-muted',
  }),
  barAtSelection: MenuCaret({
    room: 16,
    className: 'opacity-60',
  }),
  tab: MenuCaret({
    room: 12,
    className: 'text-muted',
  }),
  chipInCell: MenuCaret({
    room: 12,
    className: 'sheet-chip-caret align-top',
  }),
};
