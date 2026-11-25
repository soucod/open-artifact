/** A dot and a word for the owner session's state, shared by the Shell and the home page. */

import { cn } from '@open-artifact/ui';
import { t, type MessageKey } from '../lib/i18n.ts';

/** The owner session's state as the badge draws it. */
export type BadgeState = 'none' | 'working' | 'idle' | 'waiting' | 'offline';

const LABEL: Record<BadgeState, MessageKey> = {
  none: 'statusNone',
  working: 'statusWorking',
  idle: 'statusIdle',
  waiting: 'statusWaiting',
  offline: 'statusOffline',
};

/** Props of {@link StatusDot}. */
export interface StatusDotProps {
  state: BadgeState;
  className?: string;
}

/** Just the dot: green when live, accent and pulsing while working, grey otherwise. */
export function StatusDot({ state, className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        state === 'working' ? 'animate-pulse bg-accent motion-reduce:animate-none' : state === 'idle' || state === 'waiting' ? 'bg-success' : 'bg-fg-subtle',
        className,
      )}
    />
  );
}

/** Props of {@link OwnerBadge}. */
export interface OwnerBadgeProps {
  state: BadgeState;
  /** Shown before the state word, e.g. the harness name. */
  prefix?: string;
  /** The state word, when not the session's (a cloud host's agent: "Connected", "No agent"). */
  label?: string;
  className?: string;
}

/** A dot and "Idle" / "Working" / "Offline" / "No session". */
export function OwnerBadge({ state, prefix, label, className }: OwnerBadgeProps) {
  const word = label ?? t(LABEL[state]);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-muted', className)}>
      <StatusDot state={state} />
      <span className="truncate">{prefix ? `${prefix} · ${word}` : word}</span>
    </span>
  );
}
