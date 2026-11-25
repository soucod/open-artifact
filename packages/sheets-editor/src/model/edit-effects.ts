import type { CellEdit, Edit, Entry } from '@open-artifact/sheets-core';
import type { CellId } from './workbook.ts';
import type { CellSelection } from '../selection/model.ts';
import type { Dragging, PageState } from '../state/initial-state.ts';
import type { IfQueued } from '../state/event-reducer.ts';
import type { PageEffect, PageTransition, QueueEditEffect } from '../state/transitions.ts';
import { areaRefBetween, cellRefOf } from './workbook.ts';
/** An edit that enters something in one cell. */
export type EnterEdit = Extract<CellEdit, { kind: 'enter' }>;
/** What a queued edit carries besides the edit and what the page does once it is answered. */
export type MoreOfAQueuedEdit = Partial<Omit<QueueEditEffect, 'kind' | 'edit' | 'ifQueued'>>;
export function holdUntilAnswered(transition: PageTransition, held: Dragging): PageTransition {
  let [effect] = transition.effects;
  return effect?.kind === 'queueEdit'
    ? {
        ...transition,
        state: {
          ...transition.state,
          heldUntilAnswered: {
            held,
            edit: effect.edit,
          },
        },
      }
    : transition;
}
export function queueEdits(state: PageState, edits: readonly Edit[], ifQueued: IfQueued, { isEachPointedAt }: { isEachPointedAt: boolean }): PageTransition {
  let lastEdit = edits.at(-1);
  if (lastEdit === undefined)
    return {
      state,
      effects: [],
    };
  let editsBefore = edits.slice(0, -1).map(
    (edit) => ({
      edit,
      isPointedAt: isEachPointedAt,
    }),
  );
  return queueEdit(
    state,
    lastEdit,
    ifQueued,
    editsBefore.length === 0
      ? {}
      : {
          editsBefore,
        },
  );
}
export const IF_QUEUED_DEFAULTS = {
  foundBy: 'key',
  leavesEntryOpen: false,
  undoOffer: null,
  pasteOfTextInstead: null,
} satisfies Partial<IfQueued>;
export const IF_QUEUED_PLACE_CHANGED = {
  ...IF_QUEUED_DEFAULTS,
  select: 'placeChanged',
  done: null,
} satisfies IfQueued;
export const queueEdit = (state: PageState, edit: Edit, ifQueued: IfQueued, more: MoreOfAQueuedEdit = {}): PageTransition => ({
  state,
  effects: [
    {
      kind: 'queueEdit',
      edit,
      ifQueued,
      ...more,
    },
  ],
});
export const withIfQueued = (effect: PageEffect, ifQueued: Partial<IfQueued>): PageEffect =>
  effect.kind === 'queueEdit'
    ? {
        ...effect,
        ifQueued: {
          ...effect.ifQueued,
          ...ifQueued,
        },
      }
    : effect;
export const selectedRangeOf = ({ activeCell, selectionCorner }: Pick<CellSelection, 'activeCell' | 'selectionCorner'>) =>
  areaRefBetween(activeCell, selectionCorner);
export const enterEntryEdit = (cell: CellId, entry: Entry): EnterEdit => ({
  kind: 'enter',
  sheetId: cell.sheetId,
  cell: cellRefOf(cell),
  entry,
});
export const enterTextEdit = (cell: CellId, text: string): EnterEdit =>
  enterEntryEdit(cell, {
    kind: 'text',
    text,
  });
