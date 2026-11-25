import type { CellSelection } from '../selection/model.ts';
import type { ColumnId } from '@open-artifact/sheets-core';
import type { PageState } from './initial-state.ts';
import type { PageEvent } from './event-reducer.ts';
import type { StepReversedOutcome } from '../store/workbook-sync.ts';
import type { PageEffect, UndoOrRedoEffect } from './transitions.ts';
import type { IfQueued } from './event-reducer.ts';
import type { ColumnsWentTo } from '../tables/own-filters.ts';
import { givesNewRowsFormulas as givesNewRowsFormulasImported } from '../edits/insert-lines.ts';
/** Where the columns of a table went under an answered edit, or under the undo or redo of one (turned round for an undo). */
export function cellsOfColumnsWentToAfter(state: PageState, event: PageEvent): ColumnsWentTo | null {
  if (event.kind === 'editAnswered') return event.outcome.kind === 'editQueued' ? cellsOfColumnsWentToOfQueued(event.ifQueued) : null;
  if (event.kind !== 'undoOrRedoAnswered' || event.outcome.kind !== 'made') return null;
  let wentTo = noteOfStep(state, event.outcome.stepReversed)?.cellsOfColumnsWentTo ?? null;
  return wentTo === null || event.direction === 'redo'
    ? wentTo
    : {
        ...wentTo,
        wentTo: wentTo.wentTo.map(([from, to]): [ColumnId, ColumnId] => [to, from]),
      };
}
export function notesOfStepsAfter(state: PageState, event: PageEvent): NotesOfSteps {
  let { notesOfSteps, activeCell, selectionCorner } = state;
  if (event.kind === 'takeBackAnswered')
    return event.outcome.kind === 'made'
      ? {
          ...notesOfSteps,
          undone: [],
          latest: null,
        }
      : notesOfSteps;
  if (event.kind === 'editAnswered') {
    if (event.outcome.kind !== 'editQueued') return notesOfSteps;
    let { step = null } = event.outcome;
    let { undoSelects = null, isSelectionGivenUp } = event.ifQueued;
    let selected: SelectedAroundStep | null =
      undoSelects === null || isSelectionGivenUp === true
        ? null
        : {
            undo: undoSelects,
            redo: {
              activeCell,
              selectionCorner,
            },
          };
    let givesNewRowsFormulas = givesNewRowsFormulasImported(event.edit);
    let cellsOfColumnsWentTo = cellsOfColumnsWentToOfQueued(event.ifQueued);
    let notesWithLatest: NotesOfSteps = {
      ...notesOfSteps,
      undone: [],
      latest: step,
    };
    if (step === null || (selected === null && !givesNewRowsFormulas && cellsOfColumnsWentTo === null)) return notesWithLatest;
    let note: NoteOfStep = {
      step,
      selected,
      givesNewRowsFormulas,
      cellsOfColumnsWentTo,
    };
    return {
      ...notesWithLatest,
      notes: [...notesOfSteps.notes, note].slice(-MOST_NOTES_OF_STEPS),
    };
  }
  if (event.kind !== 'undoOrRedoAnswered') return notesOfSteps;
  let { direction, outcome } = event;
  if (outcome.kind === 'refused' || outcome.kind === 'nothingLeft') return notesOfSteps;
  let stepsReversed = outcome.kind === 'made' ? (outcome.stepReversed ?? []) : [];
  let undone = direction === 'undo' ? notesOfSteps.undone.concat(stepsReversed) : notesOfSteps.undone.slice(0, -1);
  return {
    ...notesOfSteps,
    undone,
    latest: null,
  };
}
export function answerAwaitedAfter(answerAwaited: AnswerAwaited, event: PageEvent, effects: readonly PageEffect[]): AnswerAwaited {
  for (let effect of effects) {
    if (effect.kind === 'undoOrRedo') return 'toUndoOrRedo';
    if (effect.kind === 'queueEdit' && effect.edit.kind === 'importTableAsNewSheet') return 'toImportAsNewSheet';
  }
  return event.kind === 'undoOrRedoAnswered' || (event.kind === 'editAnswered' && event.ifQueued.endsEntryAtOnce !== true) ? null : answerAwaited;
}
export function noteStepsAndAnswerAwaited(state: PageState, event: PageEvent, effects: readonly PageEffect[]): PageState {
  let notesOfSteps = notesOfStepsAfter(state, event);
  let answerAwaited = answerAwaitedAfter(state.answerAwaited, event, effects);
  return notesOfSteps === state.notesOfSteps && answerAwaited === state.answerAwaited
    ? state
    : {
        ...state,
        notesOfSteps,
        answerAwaited,
      };
}
export const NO_NOTES_OF_STEPS: NotesOfSteps = {
  notes: [],
  undone: [],
  latest: null,
};
export const MOST_NOTES_OF_STEPS = 100;
export const noteOfStep = ({ notesOfSteps }: Pick<PageState, 'notesOfSteps'>, step: string | undefined): NoteOfStep | null =>
  notesOfSteps.notes.find((note) => note.step === step) ?? null;
export const selectionOfStepReversed = (
  state: Pick<PageState, 'notesOfSteps'>,
  direction: UndoOrRedoEffect['direction'],
  { stepReversed }: Pick<StepReversedOutcome, 'stepReversed'>,
): SelectedAroundStep[UndoOrRedoEffect['direction']] | null =>
  noteOfStep(state, stepReversed)?.selected?.[direction] ?? null;
export const isRedoGivingNewRowsFormulas = (state: Pick<PageState, 'notesOfSteps'>): boolean =>
  noteOfStep(state, state.notesOfSteps.undone.at(-1))?.givesNewRowsFormulas === true;
export const cellsOfColumnsWentToOfQueued = ({ movesColumnsOfTable }: Pick<IfQueued, 'movesColumnsOfTable'>): ColumnsWentTo | null =>
  movesColumnsOfTable === undefined || movesColumnsOfTable.wentTo.length === 0
    ? null
    : {
        ofTableAt: movesColumnsOfTable.ofTableAt,
        wentTo: movesColumnsOfTable.wentTo,
      };
export interface SelectedAroundStep {
  undo: CellSelection;
  redo: Pick<CellSelection, 'activeCell' | 'selectionCorner'>;
}
export interface NoteOfStep {
  step: string;
  selected: SelectedAroundStep | null;
  givesNewRowsFormulas: boolean;
  /** Where the columns of a table went under the step, to carry the page's own filters along when it is undone or redone. */
  cellsOfColumnsWentTo: ColumnsWentTo | null;
}
export interface NotesOfSteps {
  notes: NoteOfStep[];
  undone: string[];
  latest: string | null;
}
export type AnswerAwaited = 'toUndoOrRedo' | 'toImportAsNewSheet' | null;
