import { Icon, resolveFilledIconName, type IconName } from '../kit/icon.tsx';
import { Button, type ButtonProps } from '../kit/button.tsx';
import type { TooltipSide } from '../kit/tooltip.tsx';
import * as React from 'react';
import { ToolbarTooltip } from './toolbar-tooltip.tsx';
import { disabledWithWhyNot } from './why-not.tsx';
import { useCoarsePointerMedia } from '../app/media-queries.ts';
export function useBarIcon() {
  let iconSize = useCoarseBarIconSize();
  return React.useCallback(
    (iconName: IconName, isPressed: boolean = false) =>
      iconSize === undefined
        ? iconName
        : <Icon name={isPressed ? resolveFilledIconName(iconName) : iconName} size={iconSize} />,
    [iconSize],
  );
}
export interface BarIconButtonProps extends Omit<ButtonProps, 'icon'> {
  icon: IconName;
  label: string;
  /** Why the button cannot be used now, or null when it can. */
  whyNot: string | null;
  tooltipSide: TooltipSide;
}
export function BarIconButton({ icon, label, whyNot, tooltipSide, ...buttonProps }: BarIconButtonProps) {
  let renderIcon = useBarIcon();
  return <ToolbarTooltip name={label} shortcut={buttonProps.shortcut} side={tooltipSide} isShut={whyNot !== null}><Button {...buttonProps} icon={renderIcon(icon, buttonProps.pressed)} variant="ghost" iconOnly aria-label={label} tooltip={false} {...disabledWithWhyNot(label, whyNot, tooltipSide)} /></ToolbarTooltip>;
}
export interface BarSeparatorProps {
  isHidden?: boolean;
}
export const BarSeparator = ({ isHidden = false }: BarSeparatorProps) =>
  <span aria-hidden data-line-in-bar hidden={isHidden} className="mx-0.5 h-[18px] flex-none border-l border-alpha-2" />;
export const useCoarseBarIconSize = (): 'lg' | undefined => (useCoarsePointerMedia() ? 'lg' : undefined);
export const useBarIconSize = (): 'lg' | 'md' => useCoarseBarIconSize() ?? 'md';
