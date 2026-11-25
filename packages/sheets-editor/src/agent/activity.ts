import type { AgentStatus } from '@open-artifact/runtime';

export interface AgentStatusSource {
  agentStatus(): AgentStatus | null;
  onAgentStatus(listener: (status: AgentStatus) => void): () => void;
}

export interface AgentActivity {
  isWorking(): boolean;
  hasShellAnswered(): boolean;
  isTurnSeenFromItsStart(): boolean;
  onChanged(listener: () => void): () => void;
  rest: { isKnown(): boolean; onKnown(listener: () => void): () => void };
}

/** Follows the agent's turns: it works while busy, and is at rest once it has been idle for a moment. */
export function createAgentActivityWatcher(source: AgentStatusSource, win: Pick<Window, 'setTimeout' | 'clearTimeout'> = window): AgentActivity {
  let isWorking = false;
  let hasAnswered = false;
  let watchedThroughIdle = false;
  let turnSeenFromStart = false;
  let settleTimer: number | undefined;
  const listeners = new Set<() => void>();
  const restListeners = new Set<() => void>();
  const isAtRest = (): boolean => watchedThroughIdle && !isWorking;
  const setWorking = (working: boolean): void => {
    if (working === isWorking) return;
    isWorking = working;
    if (isWorking) turnSeenFromStart = watchedThroughIdle;
    for (const listener of listeners) listener();
  };
  const hear = (status: AgentStatus): void => {
    win.clearTimeout(settleTimer);
    const wasAnswered = hasAnswered;
    hasAnswered = true;
    if (status.busy) {
      setWorking(true);
      if (!wasAnswered) for (const listener of listeners) listener();
      return;
    }
    settleTimer = win.setTimeout(() => {
      const wasAtRest = isAtRest();
      watchedThroughIdle = true;
      setWorking(false);
      if (!wasAtRest && isAtRest()) for (const listener of restListeners) listener();
    }, AGENT_ACTIVITY_SETTLE_MS);
  };
  source.onAgentStatus(hear);
  const known = source.agentStatus();
  if (known !== null) hear(known);
  return {
    isWorking: () => isWorking,
    hasShellAnswered: () => hasAnswered,
    isTurnSeenFromItsStart: () => turnSeenFromStart,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    rest: {
      isKnown: isAtRest,
      onKnown(listener) {
        restListeners.add(listener);
        return () => void restListeners.delete(listener);
      },
    },
  };
}

export function watchAgentActivity(
  activity: AgentActivity,
  afterNextPaint: (callback: () => void) => void,
  hear: (isWorking: boolean, isFirst: boolean, hasAnswered: boolean) => void,
): () => void {
  let stopped = false;
  let stopListening: (() => void) | null = null;
  afterNextPaint(() => {
    if (stopped) return;
    stopListening = activity.onChanged(() => hear(activity.isWorking(), false, activity.hasShellAnswered()));
    hear(activity.isWorking(), true, activity.hasShellAnswered());
  });
  return () => {
    stopped = true;
    stopListening?.();
  };
}

export const AGENT_ACTIVITY_SETTLE_MS = 2000;
