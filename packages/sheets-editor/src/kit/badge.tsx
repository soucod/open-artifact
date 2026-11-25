import * as React from 'react';
import { cn } from './cn.ts';

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const VARIANT_CLASSES: Readonly<Record<BadgeVariant, string>> = {
  neutral: 'bg-neutral text-secondary',
  accent: 'bg-[var(--ui-bg-tint-blue)] text-[var(--ui-text-tint-blue)]',
  success: 'bg-[var(--ui-bg-tint-green)] text-[var(--ui-text-tint-green)]',
  warning: 'bg-[var(--ui-bg-tint-yellow)] text-[var(--ui-text-tint-yellow)]',
  danger: 'bg-[var(--ui-bg-tint-red)] text-[var(--ui-text-tint-red)]',
};

/** `xxs` fits beside a tab's name. */
export type BadgeSize = 'sm' | 'xxs';

const SIZE_CLASSES: Readonly<Record<BadgeSize, string>> = {
  sm: 'h-control-nested px-sm text-footnote',
  xxs: 'h-[var(--ui-h-control-nested--xs)] px-1 text-caption',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

/** A short status label, tinted by what it says. */
export function Badge({ variant = 'neutral', size = 'sm', className, children, ...rest }: BadgeProps): React.ReactElement {
  return (
    <span
      data-ui="Badge"
      data-variant={variant}
      data-size={size}
      {...rest}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-chip align-middle font-medium',
        SIZE_CLASSES[size],
        'forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText]',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
