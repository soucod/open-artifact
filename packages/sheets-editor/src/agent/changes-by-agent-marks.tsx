import * as React from 'react';
import { AGENT_CHANGE_FADE_MS } from './changes-by-agent.ts';
import { agentFlagName } from '../i18n/menu-labels.ts';
import type { FlagStands } from '../presence/flags.ts';
/** The style that starts a sheen in step with every other sheen on the page. */
export type SheenDelayStyle = React.CSSProperties & { '--sheet-sheen-delay'?: string };
/** A sheen, and how far into its period it begins. */
interface SheenNow {
  sweeps: boolean;
  delayMs: number;
}
interface ChangeByAgentOutlineProps {
  /** When the outline begins to fade, on the page's clock; null while the agent still works on it. */
  fadeBeginsAtMs: number | null;
  /** Where the agent's name stands by the change; without it the change is outlined. */
  nameStands?: FlagStands;
  isWithoutSheen?: boolean;
}
interface ChangeByAgentMarkProps extends ChangeByAgentOutlineProps {
  keyOfMark: string;
  place: React.CSSProperties;
  isHidden?: boolean;
}
export function useSheenDelayStyle(sweeps: boolean): SheenDelayStyle {
  let [sheen, setSheen] = React.useState(
    (): SheenNow => ({
      sweeps,
      delayMs: sheenDelayMs(),
    }),
  );
  if (sheen.sweeps !== sweeps)
    setSheen({
      sweeps,
      delayMs: sheenDelayMs(),
    });
  return sweeps
    ? {
        '--sheet-sheen-delay': `${sheen.delayMs}ms`,
      }
    : {};
}
export function ChangeByAgentMark({ keyOfMark, place, isHidden = false, ...outlineProps }: ChangeByAgentMarkProps) {
  return <div aria-hidden className="sheet-room-of-change-by-agent" data-mark={keyOfMark} data-is-hidden={isHidden || undefined} style={place}><ChangeByAgentOutline key={outlineProps.fadeBeginsAtMs} {...outlineProps} /></div>;
}
export function ChangeByAgentOutline(props: ChangeByAgentOutlineProps) {
  let { fadeBeginsAtMs, nameStands, isWithoutSheen = false } = props;
  let [fadeDelayMs] = React.useState(() => (fadeBeginsAtMs === null ? null : fadeBeginsAtMs - performance.now()));
  let fadeStyle =
    fadeDelayMs === null
      ? {
          animationName: 'none',
        }
      : {
          animationDuration: `${AGENT_CHANGE_FADE_MS}ms`,
          animationDelay: `${fadeDelayMs}ms`,
        };
  let outlineStyle = {
    ...useSheenDelayStyle(fadeBeginsAtMs === null),
    ...fadeStyle,
  };
  if (nameStands === undefined)
    return <div className="sheet-outline-of-other sheet-change-by-agent" data-has-sheen={(fadeBeginsAtMs === null && !isWithoutSheen) || undefined} style={outlineStyle} />;
  return <div className="sheet-name-flags-of-others sheet-change-by-agent" data-stands={nameStands} style={fadeStyle}><div><span><bdi>{agentFlagName()}</bdi></span></div></div>;
}
export const SHEEN_PERIOD_MS = 2000;
export const sheenDelayMs = (): number => -(performance.now() % SHEEN_PERIOD_MS);
