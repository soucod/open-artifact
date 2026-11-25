import * as React from 'react';
import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { AgentMark } from './agent-mark.tsx';
import { cn } from './cn.ts';
import { useKitLabel } from './labels.tsx';
import { useLocale } from './theme.tsx';
import { Tooltip, TooltipGroup } from './tooltip.tsx';

export type AvatarSize = 'xs' | 'sm' | 'md';
/** `agent` stands for the agent rather than a person, and shows its mark; `neutral` is a person shown without color. */
export type AvatarVariant = 'default' | 'neutral' | 'agent';

const SIZE_CLASSES: Readonly<Record<AvatarSize, string>> = {
  xs: 'size-[var(--ui-avatar-xs)] text-[length:var(--ui-avatar-text-xs)]',
  sm: 'size-[var(--ui-avatar-sm)] text-[length:var(--ui-avatar-text-sm)]',
  md: 'size-[var(--ui-avatar-md)] text-[length:var(--ui-avatar-text-md)]',
};

const SURPLUS_SIZE_CLASSES: Readonly<Record<AvatarSize, string>> = {
  xs: 'h-[var(--ui-avatar-xs)] min-w-[var(--ui-avatar-xs)] text-[length:var(--ui-avatar-text-xs)] px-1',
  sm: 'h-[var(--ui-avatar-sm)] min-w-[var(--ui-avatar-sm)] text-[length:var(--ui-avatar-text-sm)] px-1.5',
  md: 'h-[var(--ui-avatar-md)] min-w-[var(--ui-avatar-md)] text-[length:var(--ui-avatar-text-md)] px-2',
};

const OVERLAP: Readonly<Record<AvatarSize, string>> = {
  xs: 'calc(var(--ui-avatar-xs) * -0.25)',
  sm: 'calc(var(--ui-avatar-sm) * -0.25)',
  md: 'calc(var(--ui-avatar-md) * -0.25)',
};

const VARIANT_CLASSES: Readonly<Record<AvatarVariant, string>> = {
  default: 'bg-fill-control text-primary',
  neutral: 'bg-neutral text-secondary',
  agent: 'bg-[var(--ui-agent-tint)] text-[var(--ui-on-brand)]',
};

const AvatarSizeContext = React.createContext<AvatarSize | null>(null);

/** One letter for the smallest size, else the first letters of the first and last names. */
export function avatarInitials(name: string, locale: string | undefined, letters: 1 | 2): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const firstLetter = (word: string | undefined): string => (word ? ([...word][0] ?? '') : '');
  const last = letters === 2 && words.length > 1 ? firstLetter(words.at(-1)) : '';
  return (firstLetter(words[0]) + last).toLocaleUpperCase(locale) || '?';
}

export interface AvatarProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The person's name: the avatar's accessible name and the source of its initials. */
  name: string;
  /** A picture of the person; initials show while it loads or if it fails. */
  src?: string | null;
  size?: AvatarSize;
  variant?: AvatarVariant;
}

/** A person's picture, or their initials, in a circle. */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, src, size, variant = 'default', className, ...rest },
  ref,
) {
  const stackSize = React.useContext(AvatarSizeContext);
  const resolved = stackSize ?? size ?? 'md';
  const locale = useLocale();
  const initials = React.useMemo(() => avatarInitials(name, locale, resolved === 'xs' ? 1 : 2), [name, locale, resolved]);
  return (
    <BaseAvatar.Root
      ref={ref}
      data-ui="Avatar"
      role="img"
      aria-label={name || undefined}
      {...rest}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-sans font-medium leading-none',
        SIZE_CLASSES[resolved],
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {src ? <BaseAvatar.Image src={src} alt="" draggable={false} className="size-full object-cover" /> : null}
      <BaseAvatar.Fallback className="contents">
        {variant === 'agent' ? <AgentMark size="60%" color="currentColor" /> : initials}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
});

const STACK_ITEM_CLASSES = 'relative inline-flex rounded-full bg-[var(--ui-page-bg)] shadow-[0_0_0_var(--ui-avatar-stack-ring)_var(--ui-page-bg)]';
const MOST_SURPLUS_NAMES = 4;

function avatarName(child: React.ReactNode): string | undefined {
  if (!React.isValidElement<{ name?: unknown; children?: React.ReactNode }>(child)) return undefined;
  if (typeof child.props.name === 'string') return child.props.name;
  return React.isValidElement<{ name?: unknown }>(child.props.children) && typeof child.props.children.props.name === 'string'
    ? child.props.children.props.name
    : undefined;
}

export interface AvatarStackProps {
  /** The avatars, in order; those past `max` fold into a count. */
  children?: React.ReactNode;
  /** Most avatars to show before folding the rest. */
  max?: number;
  /** How many people there are, when more than the avatars given. */
  total?: number;
  size?: AvatarSize;
  /** Lists the folded people's names in a tooltip on the count. */
  surplusTooltip?: boolean;
  /** Names the group for assistive tech; the people count by default. */
  'aria-label'?: string;
  className?: string;
}

/** Avatars that overlap in a row, with a count for those that do not fit. */
export const AvatarStack = React.forwardRef<HTMLDivElement, AvatarStackProps>(function AvatarStack(
  { children, max = 5, total, size = 'md', surplusTooltip = true, 'aria-label': ariaLabel, className },
  ref,
) {
  const items = React.Children.toArray(children);
  const count = total ?? items.length;
  const shownCount = Math.max(0, Math.min(max, items.length));
  const shown = items.slice(0, shownCount);
  const surplus = Math.max(0, count - shownCount);
  const surplusNames = items
    .slice(shownCount)
    .map(avatarName)
    .filter((name): name is string => name !== undefined && name.length > 0)
    .slice(0, MOST_SURPLUS_NAMES);
  const othersCount = surplus - surplusNames.length;
  const othersLabel = useKitLabel('overflowCount', { count: othersCount });
  const surplusList =
    surplusNames.length === 0 ? undefined : othersCount > 0 ? [...surplusNames, othersLabel].join(', ') : surplusNames.join(', ');
  const groupLabel = useKitLabel('avatarGroup', { count, noun: '' }).trim();
  const surplusLabel = useKitLabel('overflowCount', { count: surplus }) + (surplusList ? `: ${surplusList}` : '');
  const itemCount = shown.length + (surplus > 0 ? 1 : 0);
  const stackStyle = (index: number): React.CSSProperties => ({
    marginInlineStart: index === 0 ? undefined : OVERLAP[size],
    zIndex: itemCount - index,
  });

  const surplusChip = (
    <span data-stack-item="" data-surplus="" className={STACK_ITEM_CLASSES} style={stackStyle(shown.length)}>
      <span
        role="img"
        aria-label={surplusLabel}
        className={cn(
          'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-fill-control font-sans font-medium leading-none text-secondary',
          SURPLUS_SIZE_CLASSES[size],
        )}
      >
        <span dir="ltr">+{surplus}</span>
      </span>
    </span>
  );

  return (
    <div
      ref={ref}
      data-ui="AvatarStack"
      role="group"
      aria-label={ariaLabel ?? groupLabel}
      className={cn('isolate inline-flex shrink-0 items-center', className)}
    >
      <AvatarSizeContext.Provider value={size}>
        <TooltipGroup>
          {shown.map((avatar, index) => (
            <span
              key={React.isValidElement(avatar) && avatar.key !== null ? avatar.key : index}
              data-stack-item=""
              className={STACK_ITEM_CLASSES}
              style={stackStyle(index)}
            >
              {avatar}
            </span>
          ))}
          {surplus > 0 && (surplusTooltip && surplusList ? <Tooltip content={surplusList}>{surplusChip}</Tooltip> : surplusChip)}
        </TooltipGroup>
      </AvatarSizeContext.Provider>
    </div>
  );
});
