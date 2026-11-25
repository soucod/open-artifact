import type { Edit } from '@open-artifact/sheets-core';
import type { CopiedCells, PageState } from './initial-state.ts';
import type { PageEvent } from './event-reducer.ts';
import type { PageEffect } from './transitions.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import { editsOfQueued } from '../engine/cause-of-error-cache.ts';
import { selectedArea, selectionKeepsItsCells } from '../selection/model.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
export function doesEffectDropCopiedCells(effect: PageEffect, { cutToken }: Pick<CopiedCells, 'cutToken'>): boolean {
  if (effect.kind === 'copyLinkToSheet') return true;
  if (effect.kind === 'undoOrRedo' || effect.kind === 'queueEditsThatTakeBack') return cutToken !== null;
  if (effect.kind !== 'queueEdit' || effect.ifQueued.askOfChart !== undefined) return false;
  let keepsCut =
    editsOfQueued(effect).every(({ kind }) => EDITS_THAT_KEEP_CUT.has(kind)) || effect.ifQueued.leavesLineRoundCopy === true;
  return cutToken === null ? !keepsCut : effect.ifQueued.movesCut === undefined;
}
export function letGoOfCopiedCells(state: PageState, reads: WorkbookReads, keepCut: boolean): PageState {
  let { copiedCells } = state;
  let area = copiedCells === null ? null : selectedArea(copiedCells, reads);
  let nextState = {
    ...state,
    copiedCells: null,
    lastDone: null,
  };
  if (copiedCells === null || area === null) return nextState;
  let cutLeaves: CopiedCellsLeft = keepCut ? 'cutCanceledAndPasteCopies' : 'cutCanceled';
  let leaves: CopiedCellsLeft = copiedCells.cutToken === null ? 'stillCopied' : cutLeaves;
  return {
    ...nextState,
    lastDone: {
      what: 'copiedCellsLetGo',
      leaves,
      cells: areaToA1AsStored(area, ownRowOrderOfSheet(reads, state.activeCell.sheetId)),
    },
  };
}
export function updateCopiedCells(state: PageState, effects: readonly PageEffect[], event: PageEvent, reads: WorkbookReads): PageState {
  let pasteEffect = effects.find((effect): effect is PutOnClipboardEffect => effect.kind === 'putOnClipboard');
  if (pasteEffect !== undefined) {
    let { activeCell, selectionCorner, rangeWalked } = state;
    let { cutToken } = pasteEffect;
    return {
      ...state,
      copiedCells: {
        activeCell,
        selectionCorner,
        rangeWalked,
        cutToken,
      },
      cutJustMoved: null,
    };
  }
  if (effects.some((effect) => effect.kind === 'putNothingOnClipboard'))
    return {
      ...state,
      copiedCells: null,
      cutJustMoved: null,
    };
  let cutMoved = event.kind === 'editAnswered' && event.outcome.kind === 'editQueued' ? (event.ifQueued.movesCut ?? null) : null;
  let isWorkbookEdited = effects.some(
    (effect) => effect.kind === 'queueEdit' || effect.kind === 'undoOrRedo' || effect.kind === 'queueEditsThatTakeBack',
  );
  let cutJustMoved = cutMoved ?? (isWorkbookEdited ? null : state.cutJustMoved);
  let { copiedCells } = state;
  let areCopiedCellsDropped =
    copiedCells !== null &&
    (effects.some((effect) => doesEffectDropCopiedCells(effect, copiedCells)) ||
      (cutMoved !== null && cutMoved.token === copiedCells.cutToken) ||
      event.kind === 'linkAddressCopied' ||
      event.kind === 'otherThanCellsCopied' ||
      (event.kind === 'workbookChanged' && !selectionKeepsItsCells(copiedCells, event.readsBefore, reads)));
  if (!areCopiedCellsDropped && cutJustMoved === state.cutJustMoved) return state;
  return {
    ...state,
    copiedCells: areCopiedCellsDropped ? null : copiedCells,
    cutJustMoved,
  };
}
export const EDITS_THAT_KEEP_CUT = new Set<Edit['kind']>(['pasteCopiedCells', 'pasteValuesOfCopiedCells', 'clearCells']);
type PutOnClipboardEffect = Extract<PageEffect, { kind: 'putOnClipboard' }>;
/** What letting go of copied cells leaves: still copied, or a cut called off (its paste then copying). */
export type CopiedCellsLeft = 'stillCopied' | 'cutCanceled' | 'cutCanceledAndPasteCopies';
/** What was done last when the page let go of copied cells: told to screen readers. */
export interface CopiedCellsLetGo {
  what: 'copiedCellsLetGo';
  leaves: CopiedCellsLeft;
  cells: string;
}
