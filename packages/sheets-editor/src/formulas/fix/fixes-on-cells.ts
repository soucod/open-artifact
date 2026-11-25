import type { Edit, TextThatNoCellShows } from '@open-artifact/sheets-core';
import { checkAgentForFormulas } from '../from-words/offer.ts';
import { findCellsHangingOn, areaTouchesHangingCells } from '../dependents.ts';
import type { CellsHangingBySheet } from '../dependents.ts';
import { withNoEffects, NAVIGATING_MODE } from '../../state/transitions.ts';
import type { PageEffect, PageTransition } from '../../state/transitions.ts';
import { fixAskFor, askAgentToFixFormula, fewestCellsToReadAt, formulaBeforeSortOrMove, cameToBeforeASortAt, formulaLostToLastAct } from './ask.ts';
import { shiftFormulaRows, withFixesOnCells, STOP_FIX_ASKS_EFFECTS, NO_FIXES_ON_CELLS } from './cells-to-fix.ts';
import { newAwaitedHold, asLandedHold, holdOneMoreAct, isHoldReleased, answerHoldOf } from '../../format/answer-holds.ts';
import type { HowActBegan } from '../../format/answer-holds.ts';
import { readsAsStored } from '../../model/workbook.ts';
import { mightFormulaSpill } from '../agent-answer-checks.ts';
import { findFormulaReferences, resolveFormulaReference } from '../references.ts';
import { isNonNullObject } from '../../utils/objects.ts';
import { checkFixAnswer } from './answer-checks.ts';
import { whyCallFailed } from '../from-words/ask-agent.ts';
import { withoutStaleOffer, errorsOfferShown, resetBaselineOfOffer } from './errors-offer.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../../model/edit-effects.ts';
import { isSameCell, mergedAreaOrCellOf, scrollToShowSelection, activeAnchorCell } from '../../selection/model.ts';
import type { CellArea } from '../../selection/model.ts';
import { areaToA1AsStored } from '../from-words/where.ts';
import { ownRowOrderOfSheet } from '../../model/line-ids.ts';
import { cellUnderPoint, isCellInSight, cellKeyText, isExplainingBlocked } from '../../state/explained-under-cell.ts';
import { escapeInCellsDoes } from '../../state/escape.ts';
import { layoutOfView } from '../../grid/layout.ts';
import { isLineShown } from '../../model/line-sizes.ts';
import { isEffectAnEdit } from '../../state/edit-refusals.ts';
import { isSameJson } from '../../import/column-readings.ts';
import { cellKeyOf } from '../error-tells.ts';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type {
  FixAwaited,
  FixesBeingMade,
  FixesOnCells,
  FixFound,
  FormulaFromWords,
  PageState,
} from '../../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../../state/controller.ts';
import type { KeyPressed, PageEvent } from '../../state/event-reducer.ts';
import type { GridPoint } from '../../grid/geometry.ts';
import type { NumberFormatReply } from '../../format/custom-number-format.ts';
/** What a key does to the fix at the active cell, and how the act began. */
export interface FixKeyAction {
  does: 'keeps' | 'discards' | 'nothing' | 'bringsPill';
  fix: FixFound;
  how: HowActBegan;
}
/** The stage of the fixes the bar over the sheet shows, and how many fixes it tells of. */
export interface FixesBarStage {
  stage: 'asked' | 'waiting' | 'undecided' | 'offered';
  count: number;
}
/** An area of cells drawn as fixed by one ask of the agent: one cell, or several cells below one another. */
export interface FixAreaToDraw extends CellArea {
  key: string;
  askId: number;
}
/** Which fixes to ask for: those offered for the sheet, or those offered for the selection. */
export type FixesAskedFor = Extract<keyof FixesOnCells, 'toOffer' | 'toOfferInSelection'>;
export function checkAgentWhenOfferGone(state: PageState, transition: PageTransition): PageTransition {
  let [fixesAfter, fixesBefore] = [transition.state.fixesOnCells, state.fixesOnCells];
  return (fixesAfter.toOffer !== null && fixesAfter.toOffer !== fixesBefore.toOffer) ||
    (fixesAfter.toOfferInSelection !== null && fixesAfter.toOfferInSelection !== fixesBefore.toOfferInSelection)
    ? checkAgentForFormulas(transition)
    : transition;
}
export function hangingCellsOf(reads: WorkbookReads, cellIds: CellId[]): CellsHangingBySheet | null {
  let entry = hangingCellsCache.get(cellIds);
  let hangingCells = entry?.reads === reads ? entry.hanging : findCellsHangingOn(reads, cellIds);
  hangingCellsCache.set(cellIds, {
    reads,
    hanging: hangingCells,
  });
  return hangingCells;
}
export function askAgentForFixes(state: PageState, reads: ReadsWithTextMeasurer, which: FixesAskedFor = 'toOffer'): PageTransition {
  let { [which]: fixes, stage } = state.fixesOnCells;
  if (state.mode.kind === 'editing' || stage !== null) return withNoEffects(state);
  if (fixes === null || fixes === 'yetToBeKnown') return withNoEffects(state);
  let [firstFix, ...otherFixes] = fixes;
  if (firstFix === undefined) return withNoEffects(state);
  let asks = fixes.flatMap((fix) => {
    let ask = fixAskFor(state, reads, fix, fix.copies.at(-1));
    return ask === null || typeof ask === 'string'
      ? []
      : [
          {
            ...ask,
            cellId: fix.origin,
            cellsOfCopies: fix.copies,
          },
        ];
  });
  if (asks.length < fixes.length) return withNoEffects(fixesCameToNothing(state));
  if (otherFixes.length === 0 && firstFix.copies.length === 0) return askAgentToFixFormula(state, reads, firstFix.origin);
  let cellsAsked = fixes.flatMap(({ origin, copies }) => [origin].concat(copies));
  if (hangingCellsOf(reads, cellsAsked) === null) return withNoEffects(fixesCameToNothing(state));
  let firstAskId = state.fixesOnCells.askCount + 1;
  let awaited = new Map<number, FixAwaited>(
    asks.map((ask, index) => {
      let {
        cellId,
        broken,
        linesAsTold,
        fewestCellsToRead,
        formulaBeforeASortOrMove,
      } = ask;
      let { callsForNoNewCell, isLabelOrHeadingTold } = ask;
      let copies = ask.cellsOfCopies.flatMap((cell) => {
        let formulaText = reads.cellOf(cell)?.formulaText;
        if (formulaText === undefined) return [];
        let fewestCellsToReadOfCopy = fewestCellsToReadAt(state, cell, reads.decimalSign);
        let formulaBeforeOfCopy = formulaBeforeSortOrMove(state, cell);
        return [
          {
            cellId: cell,
            broken: formulaText,
            fewestCellsToRead: fewestCellsToReadOfCopy,
            formulaBeforeASortOrMove: formulaBeforeOfCopy,
            cameToBeforeASort: cameToBeforeASortAt(state, cell),
            callsForNoNewCell,
            isLabelOrHeadingTold,
          },
        ];
      });
      let formulaAsItWas = formulaLostToLastAct(state, cellId)?.text ?? broken;
      let movesWithItsRow = shiftFormulaRows(formulaAsItWas, 1, reads.decimalSign) !== formulaAsItWas;
      return [
        firstAskId + index,
        {
          cellId,
          broken,
          linesAsTold,
          fewestCellsToRead,
          formulaBeforeASortOrMove,
          cameToBeforeASort: ask.cameToBeforeASort,
          callsForNoNewCell,
          isLabelOrHeadingTold,
          copies,
          movesWithItsRow,
        },
      ];
    }),
  );
  let { sheetId, workbookChangeCount } = state;
  return {
    state: withFixesOnCells(state, {
      stage: {
        sheetId,
        atChangeCount: workbookChangeCount,
        tableBeingDeclared: null,
        awaited,
        fixes: [],
        whyACallFailed: null,
        asked: cellsAsked,
        isOfSelection: which === 'toOfferInSelection',
        isKept: false,
        pointedAt: null,
        hasPersonLeft: state.isWindowLeft,
        stoodAt: state.activeCell,
        hold: newAwaitedHold(firstAskId),
      },
      askCount: firstAskId + asks.length - 1,
      offerDueBackOn: state.fixesOnCells.offerDueBackOn.filter((dueOn) => dueOn !== sheetId),
    }),
    effects: asks.map(
      ({ asked }, index) => ({
        kind: 'askAgentForAFix',
        askId: firstAskId + index,
        asked,
      }),
    ),
  };
}
export function doesFixReachHangingCells(workbook: WorkbookReads, { asked }: Pick<FixesBeingMade, 'asked'>, cell: CellId, formula: string): boolean {
  let reads = readsAsStored(workbook);
  let hangingCells = hangingCellsOf(reads, asked);
  if (hangingCells === null) return true;
  if (mightFormulaSpill(formula, reads.decimalSign)) return true;
  return findFormulaReferences(formula, reads.decimalSign).references.some((reference) => {
    let resolved = resolveFormulaReference(reference, cell.sheetId, reads.listSheets());
    return resolved === null || areaTouchesHangingCells(hangingCells, resolved.sheet.sheetId, resolved.area);
  });
}
export function fixesOfCopies(
  workbook: WorkbookReads,
  stage: Pick<FixesBeingMade, 'asked'>,
  { cellId, copies, linesAsTold, movesWithItsRow }: FixAwaited,
  answer: unknown,
  askId: number,
): FixFound[] {
  let reads = readsAsStored(workbook);
  let formula = isNonNullObject(answer) ? answer.formula : null;
  if (typeof formula !== 'string') return [];
  let position = reads.positionOfCell(cellId);
  return copies.flatMap((copy) => {
    let positionOfCopy = reads.positionOfCell(copy.cellId);
    let formulaOfCopy = position === null || positionOfCopy === null ? null : shiftFormulaRows(formula, positionOfCopy.rowIndex - position.rowIndex, 'point');
    let checked = checkFixAnswer(
      reads,
      {
        ...copy,
        linesAsTold,
      },
      {
        formula: formulaOfCopy,
      },
    );
    return checked !== null && (formulaOfCopy !== formula) === movesWithItsRow && !doesFixReachHangingCells(reads, stage, copy.cellId, checked.formula)
      ? [
          {
            cellId: copy.cellId,
            ...checked,
            askId,
          },
        ]
      : [];
  });
}
export function receiveFixAnswer(state: PageState, reads: WorkbookReads, askId: number, reply: NumberFormatReply): PageTransition {
  let { stage } = state.fixesOnCells;
  let asked = stage?.awaited.get(askId);
  if (stage === null || asked === undefined) return withNoEffects(state);
  if (reply.kind === 'notToBeHad') {
    let stopped = stopAwaitingFixes(state);
    let stateStopped = stopped.state.fixesOnCells.stage === null ? fixesCameToNothing(stopped.state) : stopped.state;
    let formulaFromWords: FormulaFromWords = {
      ...state.formulaFromWords,
      agent: 'notToBeHad',
    };
    return {
      ...stopped,
      state: {
        ...stateStopped,
        formulaFromWords,
      },
    };
  }
  let answer = reply.kind === 'answered' ? reply.answer : null;
  let checked = answer === null ? null : checkFixAnswer(reads, asked, answer);
  let fixFound = checked !== null && doesFixReachHangingCells(reads, stage, asked.cellId, checked.formula) ? null : checked;
  let whyThisCallFailed = reply.kind === 'failed' ? whyCallFailed(reply) : null;
  let whyACallFailed = stage.whyACallFailed === 'rateLimited' ? 'rateLimited' : (whyThisCallFailed ?? stage.whyACallFailed);
  let awaited = new Map(stage.awaited);
  awaited.delete(askId);
  let fixes =
    fixFound === null
      ? stage.fixes
      : [
          ...stage.fixes,
          {
            cellId: asked.cellId,
            ...fixFound,
            askId,
          },
          ...fixesOfCopies(reads, stage, asked, answer, askId),
        ];
  return withNoEffects(
    awaited.size === 0 && fixes.length === 0
      ? fixesCameToNothing(state, whyACallFailed)
      : withFixesOnCells(state, {
          stage: {
            ...stage,
            awaited,
            fixes,
            whyACallFailed,
            hold: awaited.size === 0 ? asLandedHold(stage.hold) : stage.hold,
          },
        }),
  );
}
export function endFixes(state: PageState): PageTransition {
  let { stage } = state.fixesOnCells;
  if (stage === null) return withNoEffects(state);
  return {
    state: {
      ...withFixesOnCells(state, {
        stage: null,
      }),
      errorsOffered: withoutStaleOffer(state.errorsOffered),
    },
    effects: stage.awaited.size > 0 ? STOP_FIX_ASKS_EFFECTS : [],
  };
}
export function stopAwaitingFixes(state: PageState): PageTransition {
  let { stage } = state.fixesOnCells;
  if (stage === null || stage.fixes.length === 0) return endFixes(state);
  let stageStopped = {
    ...stage,
    awaited: new Map<number, FixAwaited>(),
    hold: asLandedHold(stage.hold),
  };
  return {
    state: withFixesOnCells(state, {
      stage: stageStopped,
    }),
    effects: STOP_FIX_ASKS_EFFECTS,
  };
}
export function discardFixes(state: PageState, how: HowActBegan): PageTransition {
  let { stage } = state.fixesOnCells;
  if (stage === null || stage.isKept) return withNoEffects(state);
  let held = holdOneMoreAct(state, 'fixes', how);
  if (stage.awaited.size > 0) return stopAwaitingFixes(held);
  if (!isHoldReleased(stage.hold, how)) return withNoEffects(held);
  let { state: heldState, effects: heldEffects } = endFixes(state);
  let fixCount = fixesNotKept(stage).length;
  if (fixCount === 0)
    return {
      state: heldState,
      effects: heldEffects,
    };
  return {
    state: {
      ...heldState,
      lastDone: {
        what: 'fixesDiscarded',
        count: fixCount,
      },
    },
    effects: heldEffects,
  };
}
export function keepFixes(state: PageState, reads: WorkbookReads, how: HowActBegan): PageTransition {
  let { stage } = state.fixesOnCells;
  if (stage === null || stage.isKept) return withNoEffects(state);
  if (!isHoldReleased(stage.hold, how)) return withNoEffects(holdOneMoreAct(state, 'fixes', how));
  if (!hasFixesNotKept(stage)) return withNoEffects(state);
  let fixesLeft = fixesNotKept(stage);
  return queueEdit(
    withFixesOnCells(withErrorsOfferReset(state), {
      stage: {
        ...stage,
        isKept: true,
      },
    }),
    pasteFixesEdit(stage, reads, fixesLeft),
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'fixesKept',
        count: fixesLeft.length,
      },
      thenEvent: {
        kind: 'fixesKeptAnswered',
      },
    },
  );
}
export function fixAtCell({ fixesOnCells: { stage } }: Pick<PageState, 'fixesOnCells'>, cellId: CellId): FixFound | null {
  if (stage === null || stage.awaited.size > 0 || stage.isKept) return null;
  return fixesNotKept(stage).find((fix) => isSameCell(fix.cellId, cellId)) ?? null;
}
export function keepFix(state: PageState, reads: WorkbookReads, cellId: CellId): PageTransition {
  let { stage } = state.fixesOnCells;
  let fix = fixAtCell(state, cellId);
  let area = mergedAreaOrCellOf(reads, cellId);
  if (stage === null || fix === null || area === null) return withNoEffects(state);
  let fixes = stage.fixes.map(
    (fixOfCell) =>
      fixOfCell === fix
        ? {
            ...fixOfCell,
            isKept: true as const,
          }
        : fixOfCell,
  );
  return queueEdit(
    withFixesOnCells(withErrorsOfferReset(state), {
      stage: {
        ...stage,
        fixes,
      },
    }),
    pasteFixesEdit(stage, reads, [fix]),
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'fixKept',
        cells: areaToA1AsStored(area, ownRowOrderOfSheet(reads, cellId.sheetId)),
      },
      thenEvent: {
        kind: 'fixKeptAnswered',
        cellId,
      },
    },
  );
}
export function takeBackKeptFix(state: PageState, cellId: CellId): PageTransition {
  let { stage } = state.fixesOnCells;
  let isKept = stage?.fixes.some((fix) => fix.isKept === true && isSameCell(fix.cellId, cellId));
  return stage === null || isKept !== true ? withNoEffects(state) : dropFixAtCell(state, stage, cellId);
}
export function discardFix(state: PageState, cellId: CellId): PageTransition {
  let { stage } = state.fixesOnCells;
  if (stage === null || fixAtCell(state, cellId) === null) return withNoEffects(state);
  let { state: nextState, effects } = dropFixAtCell(state, stage, cellId);
  return {
    state: {
      ...nextState,
      lastDone: {
        what: 'fixDiscarded',
      },
    },
    effects,
  };
}
export function pointAtFix(state: PageState, reads: ReadsWithTextMeasurer, point: GridPoint | null): PageState {
  let { stage } = state.fixesOnCells;
  if (stage === null) return state;
  let pointedAt = point === null ? null : cellUnderPoint(state, reads, point);
  let cellId = pointedAt !== null && fixAtCell(state, pointedAt) !== null ? pointedAt : null;
  return cellId === stage.pointedAt || (cellId !== null && stage.pointedAt !== null && isSameCell(cellId, stage.pointedAt))
    ? state
    : withFixesOnCells(state, {
        stage: {
          ...stage,
          pointedAt: cellId,
        },
      });
}
export function fixPointedAt(state: PageState, reads: ReadsWithTextMeasurer): FixFound | null {
  let pointedAt = state.fixesOnCells.stage?.pointedAt ?? null;
  return pointedAt !== null && isCellInSight(state, reads, pointedAt) ? fixAtCell(state, pointedAt) : null;
}
export function fixPillShown(state: PageState, reads: ReadsWithTextMeasurer): FixFound | null {
  if (isFixPillBlocked(state)) return null;
  let pointedAt = fixPointedAt(state, reads);
  if (pointedAt !== null || !isFixAtSelectionShown(state)) return pointedAt;
  let atActiveCell = fixAtActiveCell(state, reads);
  return atActiveCell !== null && isCellInSight(state, reads, atActiveCell.cellId) ? atActiveCell : null;
}
export function fixPillOfActiveCell(state: PageState, reads: ReadsWithTextMeasurer): FixFound | null {
  let fix = fixAtActiveCell(state, reads);
  let hasPersonLeft = state.fixesOnCells.stage?.hasPersonLeft === true;
  return fix !== null && !hasPersonLeft && fixPillShown(state, reads) === fix ? fix : null;
}
export function fixKeyAction(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  { key, pillOfFixSeen, isReadLate, ...event }: KeyPressed,
): FixKeyAction | null {
  let fix = key === 'Enter' || key === 'Escape' || key === 'F2' ? fixAtActiveCell(state, reads) : null;
  if (fix === null || (key === 'Escape' && escapeInCellsDoes(state) !== 'stepsOut')) return null;
  let hasPill = fixPillOfActiveCell(state, reads) !== null;
  let isPillSeenAndFree = pillOfFixSeen === cellKeyText(fix.cellId) && isHoldReleased(answerHoldOf(state, 'fixes'), event);
  if (hasPill && key !== 'F2' && isPillSeenAndFree)
    return {
      does: key === 'Enter' ? 'keeps' : 'discards',
      fix,
      how: event,
    };
  if (key === 'Escape')
    return hasPill
      ? {
          does: 'nothing',
          fix,
          how: event,
        }
      : null;
  return {
    does: isReadLate === true && state.fixesOnCells.stage?.hasPersonLeft === true ? 'nothing' : 'bringsPill',
    fix,
    how: event,
  };
}
export function actOnFixKey(state: PageState, reads: ReadsWithTextMeasurer, { does, fix, how }: FixKeyAction): PageTransition {
  let held = holdOneMoreAct(state, 'fixes', how);
  let { stage } = held.fixesOnCells;
  if (does === 'keeps') return keepFix(held, reads, fix.cellId);
  if (does === 'discards') return discardFix(held, fix.cellId);
  if (does === 'nothing' || stage === null) return withNoEffects(held);
  return withNoEffects({
    ...scrollToShowSelection(
      withFixesOnCells(held, {
        stage: {
          ...stage,
          pointedAt: null,
          stoodAt: null,
        },
      }),
      reads,
    ),
    explainedUnderCell: {
      ...held.explainedUnderCell,
      isSelectionByMouse: false,
    },
    lastDone: {
      what: 'fixOffered',
      formula: fix.formula,
      shown: fix.shown,
    },
  });
}
export function dropFixesTakenBack(state: PageState, reads: WorkbookReads, takenBack: TextThatNoCellShows[]): PageTransition {
  let { stage } = state.fixesOnCells;
  if (stage?.isKept !== true) return withNoEffects(state);
  let fixesLeft = stage.fixes.filter(
    ({ cellId, formula }) =>
      !takenBack.some(({ r, c, written }) => written === formula || (r === cellId.rowId && c === cellId.columnId)),
  );
  return fixesLeft.length === 0 || fixesLeft.length === stage.fixes.length
    ? withNoEffects(fixesCameToNothing(endFixes(state).state))
    : keepFixes(
        withFixesOnCells(state, {
          stage: {
            ...stage,
            fixes: fixesLeft,
            isKept: false,
          },
        }),
        reads,
        {},
      );
}
export function areCellsInSight(state: PageState, reads: ReadsWithTextMeasurer, cellIds: CellId[]): boolean {
  let { rowEdges, columnEdges } = layoutOfView(state, reads);
  return cellIds.every((cellId) => {
    let position = reads.positionOfCell(cellId);
    return position !== null && isLineShown(rowEdges, position.rowIndex) && isLineShown(columnEdges, position.columnIndex);
  });
}
export function endFixesToldDuringAct({ state, effects }: PageTransition, event: PageEvent): PageState {
  let isEndingAct = event.kind === 'editAnswered' || event.kind === 'undoOrRedoAnswered' || event.kind === 'takeBackAnswered';
  if (!state.fixesOnCells.isEndToldDuringAct || isEndingAct || !effects.some(isEffectAnEdit)) return state;
  return {
    ...withFixesOnCells(state, {
      isEndToldDuringAct: false,
    }),
    notice: state.notice?.kind === 'fixesGoneWithChange' ? null : state.notice,
  };
}
export function updateFixPresence(state: PageState, event: PageEvent): PageState {
  let { stage } = state.fixesOnCells;
  if (stage === null) return state;
  let isPressByTouch = event.kind === 'pointerPressed' && event.isByMouse !== true;
  let stageNow =
    stage.stoodAt !== null && (isPressByTouch || !isSameCell(state.activeCell, stage.stoodAt))
      ? {
          ...stage,
          stoodAt: null,
        }
      : stage;
  if (event.kind === 'windowCaretChanged' && !event.hasCaret)
    return withFixesOnCells(state, {
      stage: {
        ...stageNow,
        hasPersonLeft: true,
        pointedAt: null,
      },
    });
  let hasPersonActed = (event.kind === 'keyPressed' && event.isReadLate !== true) || event.kind === 'pointerPressed';
  if (stageNow.hasPersonLeft && hasPersonActed)
    return withFixesOnCells(state, {
      stage: {
        ...stageNow,
        hasPersonLeft: false,
      },
    });
  return stageNow === stage
    ? state
    : withFixesOnCells(state, {
        stage: stageNow,
      });
}
export function followTableBeingDeclared(state: PageState, reads: WorkbookReads, effects: PageEffect[], event: PageEvent): PageState {
  let { stage } = state.fixesOnCells;
  if (stage === null) return state;
  let declared = effects.find(
    (effect): effect is Extract<PageEffect, { kind: 'declareCellTable' }> => effect.kind === 'declareCellTable',
  );
  if (declared !== undefined && declared.sheetId === stage.sheetId)
    return withFixesOnCells(state, {
      stage: {
        ...stage,
        tableBeingDeclared: declared.cellTable,
      },
    });
  let { tableBeingDeclared, atChangeCount } = stage;
  if (tableBeingDeclared === null || event.kind !== 'workbookChanged' || event.isUnasked) return state;
  let tablesNow = reads.cellTables(stage.sheetId);
  let isTableDeclared =
    Array.isArray(tablesNow) && tablesNow.some(({ cellTable }) => isSameJson(cellTable, tableBeingDeclared));
  return withFixesOnCells(state, {
    stage: {
      ...stage,
      tableBeingDeclared: null,
      atChangeCount: isTableDeclared ? state.workbookChangeCount : atChangeCount,
    },
  });
}
export function updateFixesOnCellsAfterEvent(
  transition: PageTransition,
  reads: ReadsWithTextMeasurer,
  isInAct: boolean,
  event: PageEvent,
): PageTransition {
  let { effects } = transition;
  let presence = updateFixPresence(endFixesToldDuringAct(transition, event), event);
  let isFixKept = effects.some((effect) => effect.kind === 'queueEdit' && effect.ifQueued.isKeepOfAgentsFix === true);
  let following = followTableBeingDeclared(isFixKept ? withErrorsOfferReset(presence) : presence, reads, effects, event);
  let { stage } = following.fixesOnCells;
  if (stage === null)
    return {
      state: following,
      effects,
    };
  let notEditing =
    following.mode.kind === 'editing'
      ? {
          ...following,
          mode: NAVIGATING_MODE,
        }
      : following;
  let areFixesInSight =
    errorsOfferShown(notEditing, reads) !== null &&
    !isInAct &&
    areCellsInSight(
      following,
      reads,
      cellsOfFixes(following).map(({ cellId }) => cellId),
    );
  if (following.workbookChangeCount === stage.atChangeCount && areFixesInSight)
    return {
      state: following,
      effects,
    };
  let isAskedChange = event.kind === 'workbookChanged' && !event.isUnasked;
  let isAnyFixKept = stage.fixes.some(({ isKept }) => isKept === true);
  if (isAskedChange && isAnyFixKept && hasFixesNotKept(stage) && areFixesInSight)
    return {
      state: withFixesOnCells(following, {
        stage: {
          ...stage,
          atChangeCount: following.workbookChangeCount,
        },
      }),
      effects,
    };
  let ended = endFixes(following);
  let endedOnSheet =
    following.sheetId === stage.sheetId
      ? ended
      : {
          ...ended,
          state: withFixesOnCells(ended.state, {
            offerDueBackOn: [...ended.state.fixesOnCells.offerDueBackOn, stage.sheetId],
          }),
        };
  return {
    state:
      following.workbookChangeCount !== stage.atChangeCount && !stage.isKept && !isInAct && (stage.fixes.length === 0 || hasFixesNotKept(stage))
        ? {
            ...withFixesOnCells(endedOnSheet.state, {
              isEndToldDuringAct: following.notice === null && (isAskedChange || isAnyFixKept),
            }),
            notice: following.notice ?? {
              kind: 'fixesGoneWithChange',
            },
          }
        : endedOnSheet.state,
    effects: [...endedOnSheet.effects, ...effects],
  };
}
export function fixesBarStage({ fixesOnCells, formulaFromWords }: Pick<PageState, 'fixesOnCells' | 'formulaFromWords'>): FixesBarStage | null {
  let { toOffer, stage } = fixesOnCells;
  if (stage !== null)
    return stage.awaited.size > 0
      ? {
          stage: 'asked',
          count: stage.asked.length,
        }
      : {
          stage: 'waiting',
          count: (hasFixesNotKept(stage) ? fixesNotKept(stage) : stage.fixes).length,
        };
  let { agent: agentOnWords } = formulaFromWords;
  if (toOffer === null) return null;
  if (toOffer === 'yetToBeKnown' || agentOnWords === 'checking')
    return {
      stage: 'undecided',
      count: 0,
    };
  let fixCount = toOffer.reduce((count, { copies }) => count + 1 + copies.length, 0);
  return agentOnWords === 'available'
    ? {
        stage: 'offered',
        count: fixCount,
      }
    : null;
}
export function fixesInSelectionStage({
  fixesOnCells: { toOfferInSelection, stage },
  formulaFromWords: { agent: agentOnWords, hasAgentBeenMissed },
}: Pick<PageState, 'fixesOnCells' | 'formulaFromWords'>): 'undecided' | 'offered' | null {
  if (stage !== null || toOfferInSelection === null) return null;
  if ((agentOnWords === 'checking' || agentOnWords === 'unchecked') && !hasAgentBeenMissed) return 'undecided';
  if (agentOnWords !== 'available') return null;
  return toOfferInSelection === 'yetToBeKnown' ? 'undecided' : 'offered';
}
export function cellsOfFixes({ fixesOnCells: { stage } }: Pick<PageState, 'fixesOnCells'>) {
  if (stage === null) return [];
  if (stage.awaited.size === 0)
    return stage.fixes.map(
      ({ cellId, formula, askId, shown, isKept }) => ({
        cellId,
        formula,
        askId,
        shownWhileItWaits: stage.isKept || isKept === true ? null : shown,
      }),
    );
  let awaitedCells = [...stage.awaited].flatMap(
    ([askId, { cellId: firstCell, copies }]) =>
      [firstCell, ...copies.map((copy) => copy.cellId)].map(
        (cellId) => ({
          cellId,
          askId,
        }),
      ),
  );
  return [...stage.fixes, ...awaitedCells].map(
    ({ cellId, askId }) => ({
      cellId,
      askId,
      formula: null,
      shownWhileItWaits: null,
    }),
  );
}
export function fixAreasToDraw(state: Pick<PageState, 'fixesOnCells'>, reads: WorkbookReads): FixAreaToDraw[] {
  let areas: FixAreaToDraw[] = [];
  for (let { cellId, askId } of cellsOfFixes(state)) {
    let area = mergedAreaOrCellOf(reads, cellId);
    let last = areas.at(-1);
    if (area === null) continue;
    if (last?.askId === askId && last.leftColumnIndex === area.leftColumnIndex && last.topRowIndex + last.rowCount === area.topRowIndex)
      areas[areas.length - 1] = {
        ...last,
        rowCount: last.rowCount + area.rowCount,
      };
    else
      areas.push({
        ...area,
        key: cellKeyOf(cellId),
        askId,
      });
  }
  return areas;
}
export const fixesCameToNothing = (state: PageState, reason: FixesBeingMade['whyACallFailed'] = null): PageState =>
  reason === null
    ? {
        ...withFixesOnCells(state, {
          stage: null,
          cameToNothingAt: state.workbookChangeCount,
        }),
        notice: state.notice ?? {
          kind: 'fixesCameToNothing',
        },
      }
    : {
        ...withFixesOnCells(state, {
          stage: null,
        }),
        notice: state.notice ?? {
          kind: 'callsForFixesFailed',
          why: reason,
        },
      };
export const hangingCellsCache = new WeakMap<CellId[], { reads: WorkbookReads; hanging: CellsHangingBySheet | null }>();
export const pasteFixesEdit = ({ sheetId }: Pick<FixesBeingMade, 'sheetId'>, reads: WorkbookReads, fixes: FixFound[]): Edit => ({
  kind: 'pasteTexts',
  sheetId,
  cells: fixes.map(
    ({ cellId: { rowId, columnId }, formula }) => ({
      r: rowId,
      c: columnId,
      text: formula,
    }),
  ),
  pastedTextIs: 'asTyped',
  localeOfTexts: reads.locale,
});
export const fixesNotKept = ({ fixes }: Pick<FixesBeingMade, 'fixes'>): FixFound[] => fixes.filter(({ isKept }) => isKept !== true);
export const hasFixesNotKept = (stage: Pick<FixesBeingMade, 'fixes'>): boolean => fixesNotKept(stage).length > 0;
export const areFixesWaiting = ({ fixesOnCells: { stage } }: Pick<PageState, 'fixesOnCells'>): boolean => stage !== null && hasFixesNotKept(stage);
export const withErrorsOfferReset = (state: PageState): PageState => ({
  ...state,
  errorsOffered: resetBaselineOfOffer(state.errorsOffered),
});
export const dropFixAtCell = (state: PageState, stage: FixesBeingMade, cellId: CellId): PageTransition => {
  let fixesLeft = stage.fixes.filter((fix) => !isSameCell(fix.cellId, cellId));
  return fixesLeft.length === 0
    ? endFixes(state)
    : withNoEffects(
        withFixesOnCells(state, {
          stage: {
            ...stage,
            fixes: fixesLeft,
          },
        }),
      );
};
export const isFixPillBlocked = (state: PageState): boolean =>
  isExplainingBlocked({
    ...state,
    fixesOnCells: NO_FIXES_ON_CELLS,
    isSteppedOutOfCells: false,
  });
export const fixAtActiveCell = (state: PageState, reads: WorkbookReads): FixFound | null =>
  isFixPillBlocked(state) ? null : fixAtCell(state, activeAnchorCell(state, reads));
export const isFixAtSelectionShown = ({ explainedUnderCell, fixesOnCells }: Pick<PageState, 'explainedUnderCell' | 'fixesOnCells'>): boolean =>
  !explainedUnderCell.isSelectionByMouse && fixesOnCells.stage?.hasPersonLeft !== true && fixesOnCells.stage?.stoodAt === null;
