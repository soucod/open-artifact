import { canTellAgentSelection } from './view-context.ts';
import { hasOtherRanges } from '../selection/several-ranges.ts';
import { isSameCell } from '../selection/model.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageContext, PageEvent } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
export function settleAskOwedToAgent(
  { state, effects }: PageTransition,
  context: Pick<PageContext, 'revisionHeld'>,
  event: PageEvent,
): PageTransition {
  let canTellNow = canTellAgentSelection(state, context);
  if (effects.some(({ kind }) => kind === 'askAgentAboutSelection')) {
    if (canTellNow)
      return {
        state: {
          ...state,
          askOwedToAgent: null,
        },
        effects,
      };
    let { activeCell, selectionCorner, rangeWalked } = state;
    return {
      state: {
        ...state,
        askOwedToAgent: {
          activeCell,
          selectionCorner,
          rangeWalked,
        },
      },
      effects: effects.map(
        (effect) =>
          effect.kind === 'askAgentAboutSelection'
            ? {
                kind: 'oweAgentAnAsk',
              }
            : effect,
      ),
    };
  }
  if (state.askOwedToAgent === null)
    return {
      state,
      effects,
    };
  let stateWithoutAsk = {
    ...state,
    askOwedToAgent: null,
  };
  const isGivenUp = event.kind === 'askOwedToAgentGivenUp';
  if (isAskOwedToAgentStale(state) || (isGivenUp && event.by === 'person') || (isGivenUp && !canTellNow))
    return {
      state: stateWithoutAsk,
      effects: [
        ...effects,
        {
          kind: 'giveUpAskOwedToAgent',
        },
      ],
    };
  return canTellNow
    ? {
        state: stateWithoutAsk,
        effects: [
          ...effects,
          {
            kind: 'askAgentAboutSelection',
          },
        ],
      }
    : {
        state,
        effects,
      };
}
export const isAskOwedToAgentStale = (state: PageState): boolean =>
  state.askOwedToAgent === null ||
  state.mode.kind !== 'navigating' ||
  state.menu !== null ||
  hasOtherRanges(state) ||
  !isSameCell(state.activeCell, state.askOwedToAgent.activeCell) ||
  !isSameCell(state.selectionCorner, state.askOwedToAgent.selectionCorner) ||
  state.rangeWalked !== state.askOwedToAgent.rangeWalked;
