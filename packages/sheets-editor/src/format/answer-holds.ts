import type { AnswerHold, PageState } from '../state/initial-state.ts';
import type { HoldOfAgentsAnswer } from '../state/event-reducer.ts';
/** How an act at a held answer began: before the answer was seen, or not. */
export interface HowActBegan {
  hasBegunBeforeAnswerWasSeen?: true;
}
/** The answer that was seen, as the act count stood then. */
export interface AnswerSeen {
  answerId: number;
  actsHeld: number;
  sinceMs: number;
}
/** Where the page keeps one kind of hold. */
export interface AnswerHoldAccessor {
  get(state: PageState): AnswerHold | null;
  set(state: PageState, hold: AnswerHold): PageState;
}
/** The hold of each kind, or `null` where none is kept. */
export type HoldsOnAgentsAnswers = Record<HoldOfAgentsAnswer, AnswerHold | null>;
export function holdOneMoreAct(
  state: PageState,
  holdKind: HoldOfAgentsAnswer,
  { hasBegunBeforeAnswerWasSeen }: HowActBegan = {},
): PageState {
  let hold = answerHoldOf(state, holdKind);
  if (hold === null || (hold.stands === 'seen' && hasBegunBeforeAnswerWasSeen !== true)) return state;
  let landed = hold.stands === 'seen' ? asLandedHold(hold) : hold;
  return ANSWER_HOLD_ACCESSORS[holdKind].set(state, {
    ...landed,
    actsHeld: hold.actsHeld + 1,
  });
}
export function markHoldSeen(state: PageState, holdKind: HoldOfAgentsAnswer, { answerId, actsHeld, sinceMs }: AnswerSeen): PageState {
  let hold = answerHoldOf(state, holdKind);
  return hold?.stands === 'landed' && hold.answerId === answerId && hold.actsHeld === actsHeld
    ? ANSWER_HOLD_ACCESSORS[holdKind].set(state, {
        ...hold,
        stands: 'seen',
        seenSinceMs: sinceMs,
      })
    : state;
}
export const ANSWER_HOLD_KINDS: HoldOfAgentsAnswer[] = ['numberFormat', 'fixes', 'rowsAskedFor'];
export const newAwaitedHold = (answerId: number): AnswerHold => ({
  answerId,
  stands: 'awaited',
  actsHeld: 0,
  seenSinceMs: null,
});
export const asLandedHold = (hold: AnswerHold): AnswerHold => ({
  ...hold,
  stands: 'landed',
  seenSinceMs: null,
});
export const isHoldReleased = (hold: AnswerHold | null, { hasBegunBeforeAnswerWasSeen }: HowActBegan): boolean =>
  hold === null || (hold.stands === 'seen' && hasBegunBeforeAnswerWasSeen !== true);
export const isHoldInForce = (hold: AnswerHold | null, act: HowActBegan): boolean =>
  hold !== null && hold.stands !== 'awaited' && !isHoldReleased(hold, act);
export const ANSWER_HOLD_ACCESSORS: Record<HoldOfAgentsAnswer, AnswerHoldAccessor> = {
  numberFormat: {
    get: ({ customNumberFormat }) => customNumberFormat?.hold ?? null,
    set: (state, hold) =>
      state.customNumberFormat === null
        ? state
        : {
            ...state,
            customNumberFormat: {
              ...state.customNumberFormat,
              hold,
            },
          },
  },
  fixes: {
    get: ({ fixesOnCells }) => fixesOnCells.stage?.hold ?? null,
    set: (state, hold) =>
      state.fixesOnCells.stage === null
        ? state
        : {
            ...state,
            fixesOnCells: {
              ...state.fixesOnCells,
              stage: {
                ...state.fixesOnCells.stage,
                hold,
              },
            },
          },
  },
  rowsAskedFor: {
    get: ({ holdOnRowsFilteredByAgent }) => holdOnRowsFilteredByAgent,
    set: (state, hold) => ({
      ...state,
      holdOnRowsFilteredByAgent: hold,
    }),
  },
};
export const answerHoldOf = (state: PageState, holdKind: HoldOfAgentsAnswer): AnswerHold | null => ANSWER_HOLD_ACCESSORS[holdKind].get(state);
export const holdsOnAgentsAnswers = (state: PageState): HoldsOnAgentsAnswers => ({
  numberFormat: answerHoldOf(state, 'numberFormat'),
  fixes: answerHoldOf(state, 'fixes'),
  rowsAskedFor: answerHoldOf(state, 'rowsAskedFor'),
});
