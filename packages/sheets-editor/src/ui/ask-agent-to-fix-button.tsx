import { AgentMark } from '../kit/agent-mark.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import type { FollowedValue } from '../state/followed-values.ts';
import type { FixedHere } from '../formulas/fix/errors-at-opening.tsx';
import { useFollowed } from '../state/followed-values.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { isWithinClickAfterUp, isWithinPressGuard } from './list-under-cell.tsx';
/** Whether the agent can be asked to fix errors, and whether the page fixes them itself, now or once it can. */
export type AgentFixState = 'notOffered' | 'inUse' | 'outOfUse' | 'fixesHere' | 'fixesHereOutOfUse';
/** Notes when a press went down, and tells whether the press that ends is taken. */
export interface PressGuard {
  noteDown: () => void;
  isTaken: () => boolean;
}
export interface AskAgentToFixButtonProps {
  agent: FollowedValue<AgentFixState>;
  onPress: (isFixedHere: boolean) => void;
}
export function usePressGuard(): PressGuard {
  let mountedAtRef = React.useRef(0);
  React.useLayoutEffect(() => {
    mountedAtRef.current = performance.now();
  }, []);
  let downAtRef = React.useRef<number | null>(null);
  return {
    noteDown: () => {
      downAtRef.current = performance.now();
    },
    isTaken: () => {
      let isTaken = isPressTaken(mountedAtRef.current, downAtRef.current, performance.now());
      downAtRef.current = null;
      return isTaken;
    },
  };
}
export function AskAgentToFixButton({ agent, onPress }: AskAgentToFixButtonProps) {
  let fixState = useFollowed(agent);
  let pressGuard = usePressGuard();
  if (fixState === 'notOffered') return null;
  let isUsable = fixState === 'inUse' || fixState === 'fixesHere';
  return <Button variant="secondary" size="sm" icon={<AgentMark size={14} {...(!isUsable && {
        color: 'currentColor',
      })} />} aria-disabled={!isUsable} className={isUsable ? '' : 'opacity-disabled'} onPointerDown={pressGuard.noteDown} onClick={() => {
      if (pressGuard.isTaken() && isUsable) onPress(fixState === 'fixesHere');
    }}>{fixState === 'fixesHere' || fixState === 'fixesHereOutOfUse' ? sheetMessages.fixErrors() : sheetMessages.askAgentToFix()}</Button>;
}
export const agentFixStateOf = (source: string | null, isAvailable: boolean, fixesHere: FixedHere = 'no'): AgentFixState => {
  if (fixesHere !== 'no') return fixesHere === 'now' ? 'fixesHere' : 'fixesHereOutOfUse';
  return source === null ? 'notOffered' : isAvailable ? 'inUse' : 'outOfUse';
};
export const isPressTaken = (mountedAtMs: number, downAtMs: number | null, nowMs: number): boolean =>
  downAtMs === null || !isWithinClickAfterUp(downAtMs, nowMs) || !isWithinPressGuard(mountedAtMs, downAtMs);
