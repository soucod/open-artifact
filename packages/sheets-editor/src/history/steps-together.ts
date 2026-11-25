import { dropUnfinishedTestBeingAdded } from '../format/conditional/pane-state.ts';
import { isNothingOpenButPane } from '../state/edit-refusals.ts';
import { hasUnsavedSidePaneTyping } from '../chips/dropdown-pane-edits.ts';
import { undoFormatAsTableChosenLast } from '../tables/format-as-table.ts';
import { undoOwnSortChoice } from '../tables/own-filters.ts';
import { withNoEffects, type PageEffect, type PageTransition, type QueueEditEffect } from '../state/transitions.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageContext, PageEvent } from '../state/event-reducer.ts';
import type { ViewOnlyBecause } from '../view/page-view.ts';

/** Why undo or redo cannot be chosen now: no steps are left, or something else is under way. */
export type WhyStepUnavailable = 'nothingLeft' | 'somethingUnderWay';
/** Whether undo and redo can be chosen; null when the workbook is only to be viewed. */
export type UndoAndRedoAvailability = { undo: WhyStepUnavailable | null; redo: WhyStepUnavailable | null } | null;

export function stepsToRedoAfterEvent(stepsToRedo: number, event: PageEvent): number {
  if (event.kind === 'editAnswered' && event.edit.kind === 'writeFromInteractive') return stepsToRedo;
  if (event.kind === 'editAnswered') return event.outcome.kind === 'editQueued' ? 0 : stepsToRedo;
  if (event.kind === 'takeBackAnswered') return event.outcome.kind === 'made' ? 0 : stepsToRedo;
  if (event.kind === 'editsDropped') return 0;
  if (event.kind !== 'undoOrRedoAnswered') return stepsToRedo;
  let { direction, outcome } = event;
  if (outcome.kind === 'made') return direction === 'undo' ? stepsToRedo + 1 : Math.max(0, stepsToRedo - 1);
  if (direction === 'undo' || outcome.kind === 'refused') return stepsToRedo;
  return outcome.kind === 'nothingLeft' ? 0 : Math.max(0, stepsToRedo - 1);
}
export function whyUndoRedoUnavailable(state: PageState, viewOnlyBecause: ViewOnlyBecause | null): UndoAndRedoAvailability {
  if (viewOnlyBecause !== null) return null;
  let whyUnavailable = (hasSteps: boolean): WhyStepUnavailable | null =>
    !hasSteps ? 'nothingLeft' : isSomethingUnderWay(state) ? 'somethingUnderWay' : null;
  return {
    undo: whyUnavailable(
      state.stepsToUndo > 0 ||
        state.areStepsToUndoLost ||
        state.entriesUnanswered.length > 0 ||
        dropUnfinishedTestBeingAdded(state) !== null ||
        state.ownSortChosenLast !== null ||
        state.formatAsTableChosenLast !== null,
    ),
    redo: whyUnavailable(state.stepsToRedo > 0),
  };
}
export const isQueueEditOfOneAct = (effect: PageEffect): effect is QueueEditEffect => effect.kind === 'queueEdit';
export const isSomethingUnderWay = (state: PageState): boolean =>
  state.mode.kind === 'editing' || !isNothingOpenButPane(state) || hasUnsavedSidePaneTyping(state);
export const undoFormatAsTableIfChosenLast = (state: PageState, reads: ReadsWithTextMeasurer): PageTransition | null => {
  let undone = undoOwnSortChoice(state, reads) ?? undoFormatAsTableChosenLast(state, reads);
  return undone === null ? null : withNoEffects(undone);
};
export const undoOrRedo = (state: PageState, direction: 'undo' | 'redo', context: PageContext): PageTransition =>
  (direction === 'undo' ? (dropUnfinishedTestBeingAdded(state) ?? undoFormatAsTableIfChosenLast(state, context.reads)) : null) ?? {
    state,
    effects: [
      {
        kind: 'undoOrRedo',
        direction,
      },
    ],
  };
export const undoOrRedoIfFree = (state: PageState, direction: 'undo' | 'redo', context: PageContext): PageTransition =>
  isSomethingUnderWay(state) ? withNoEffects(state) : undoOrRedo(state, direction, context);
