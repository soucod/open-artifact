import type { Wait } from './calculating-shown.ts';
export function longCalculationOnCalculating(told: LongCalculationTold): LongCalculationTold {
  if (told.kind === 'noCalculation')
    return {
      kind: 'noticeIsDue',
      wait: {
        ms: 850,
      },
    };
  return told.kind === 'toldAWhileLonger'
    ? {
        kind: 'told',
      }
    : told;
}
export function longCalculationOnCalculated(told: LongCalculationTold, tookTooLong: boolean): LongCalculationTold {
  if (told.kind === 'noticeIsDue' || tookTooLong) return NO_LONG_CALCULATION;
  return told.kind === 'told'
    ? {
        kind: 'toldAWhileLonger',
        wait: {
          ms: 500,
        },
      }
    : told;
}
export function longCalculationAfterWait(told: LongCalculationTold, wait: Wait): LongCalculationTold {
  if (longCalculationWait(told) !== wait) return told;
  return told.kind === 'noticeIsDue'
    ? {
        kind: 'told',
      }
    : NO_LONG_CALCULATION;
}
export const NO_LONG_CALCULATION: NoLongCalculation = {
  kind: 'noCalculation',
};
export const longCalculationWait = (told: LongCalculationTold): Wait | null =>
  told.kind === 'noticeIsDue' || told.kind === 'toldAWhileLonger' ? told.wait : null;
export const isLongCalculationTold = ({ kind }: LongCalculationTold): boolean => kind === 'told' || kind === 'toldAWhileLonger';
export interface NoLongCalculation {
  kind: 'noCalculation';
}
export type LongCalculationTold =
  | NoLongCalculation
  | { kind: 'noticeIsDue'; wait: Wait }
  | { kind: 'told' }
  | { kind: 'toldAWhileLonger'; wait: Wait };
