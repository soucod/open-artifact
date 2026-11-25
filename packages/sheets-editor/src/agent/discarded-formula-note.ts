import type { PageState } from '../state/initial-state.ts';
export function carryFormulaOfAgentDiscarded(previousState: Pick<PageState, 'lastDone'>, state: PageState): PageState {
  let { lastDone } = state;
  return previousState.lastDone?.what === 'formulaOfAgentDiscarded' && lastDone?.what === 'sheetShown'
    ? {
        ...state,
        lastDone: {
          ...lastDone,
          isFormulaOfAgentDiscarded: true,
        },
      }
    : state;
}
export const dropFormulaOfAgentDiscarded = (state: PageState): PageState =>
  state.lastDone?.what === 'formulaOfAgentDiscarded'
    ? {
        ...state,
        lastDone: null,
      }
    : state;
