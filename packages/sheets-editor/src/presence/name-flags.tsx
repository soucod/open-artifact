import * as React from 'react';
import type { ReactNode } from 'react';
import { PEER_FLAG_REST_AFTER_MS } from './flags.ts';
export interface FlagsAtRestProps {
  /** When the flags last moved; they come to rest a while after. */
  lastMoveAtMs: number;
  /** The flags stay up even once at rest. */
  isKeptUp: boolean;
  children: ReactNode;
}
export function FlagsAtRest(props: FlagsAtRestProps) {
  return <FlagsAtRestInner key={props.lastMoveAtMs} {...props} />;
}
export function FlagsAtRestInner({ lastMoveAtMs, isKeptUp, children }: FlagsAtRestProps) {
  let restsAtMs = lastMoveAtMs + PEER_FLAG_REST_AFTER_MS;
  let [isAtRest, setIsAtRest] = React.useState(() => performance.now() >= restsAtMs);
  React.useEffect(() => {
    if (isAtRest) return;
    let timer = setTimeout(() => setIsAtRest(true), restsAtMs - performance.now());
    return () => clearTimeout(timer);
  }, [isAtRest, restsAtMs]);
  return <div data-are-at-rest={(isAtRest && !isKeptUp) || undefined}>{children}</div>;
}
