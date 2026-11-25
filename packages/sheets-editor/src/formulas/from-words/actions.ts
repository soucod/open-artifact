import {
  isOfferLitOnItsOwn,
  isOfferEmptyWithoutAgent,
  takeWorkedOutFormula,
  withFormulaFromWordsStage,
  formulaReadForOffer,
  formulaOfOfferRow,
  isReadingHighlighted,
  STOP_ASKING_AGENT_EFFECTS,
} from './offer.ts';
import { withEntryFormulaText, askAgentForFormula } from './ask-agent.ts';
import { withNoEffects } from '../../state/transitions.ts';
import type { PageTransition } from '../../state/transitions.ts';
import { commitEntryInPlaceIfEditing } from '../../editor/commit-entry.ts';
import type { WorkbookReads } from '../../model/workbook.ts';
import type { FormulaFromWords, FormulaOfferRow, FormulaProposed, FormulaWithResult, PageState } from '../../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../../state/controller.ts';
import type { KeyStep } from '../../keys/key-acts.ts';
export function takeAgentAvailability(state: PageState, isAvailable: boolean): PageState {
  let { formulaFromWords } = state;
  if (formulaFromWords.agent !== 'checking') return state;
  const agentIfNot = state.mode.kind === 'editing' ? 'unavailable' : 'unchecked';
  return {
    ...state,
    formulaFromWords: {
      ...formulaFromWords,
      agent: isAvailable ? 'available' : agentIfNot,
      hasAgentBeenMissed: !isAvailable,
    },
  };
}
export function takeOfferLitAlone(state: PageState, workbook: WorkbookReads): PageState {
  const { stage } = state.formulaFromWords;
  return isOfferLitOnItsOwn(stage) && stage?.kind === 'offered' && stage.isDrawn && !isOfferEmptyWithoutAgent(stage) && stage.toWorkOut !== undefined
    ? takeWorkedOutFormula(state, workbook, stage.toWorkOut.formula)
    : state;
}
export function setOfferDrawn(state: PageState, isDrawn: boolean, hasRested = false): PageState {
  const { stage } = state.formulaFromWords;
  if (stage?.kind !== 'offered') return state;
  return stage.isDrawn === isDrawn && (!hasRested || stage.hasRested === true)
    ? state
    : withFormulaFromWordsStage(state, {
        ...stage,
        isDrawn,
        ...(hasRested && {
          hasRested,
        }),
      });
}
export function endProposalArrival(state: PageState): PageState {
  const { stage } = state.formulaFromWords;
  return stage?.kind === 'proposed' && stage.isArriving
    ? withFormulaFromWordsStage(state, {
        ...stage,
        isArriving: false,
      })
    : state;
}
export function pickProposedFix(state: PageState, workbook: ReadsWithTextMeasurer, formula: string): PageState | null {
  const { stage } = state.formulaFromWords;
  if (stage?.kind !== 'proposed' || stage.isArriving) return null;
  let fix = stage.fixes?.find(({ formula: fixOffered }) => fixOffered === formula);
  if (fix === undefined) return null;
  let { formula: fixFormula, value } = fix;
  let picked: FormulaProposed = {
    ...stage,
    formula: fixFormula,
    value,
    isDiscardHighlighted: false,
    lightsAtPart: {},
  };
  return fixFormula === stage.formula
    ? withFormulaFromWordsStage(state, picked)
    : withFormulaFromWordsStage(withEntryFormulaText(state, workbook, fixFormula, 'mayBeHeld'), picked);
}
export function moveOfferLight(state: PageState, workbook: ReadsWithTextMeasurer, step: KeyStep): PageState {
  const { stage } = state.formulaFromWords;
  if (stage?.kind === 'proposed' && stage.fixes !== undefined && !stage.isArriving) {
    let rowCount = stage.fixes.length + 1;
    let lit = stage.isDiscardHighlighted
      ? stage.fixes.length
      : stage.fixes.findIndex(({ formula }) => formula === stage.formula);
    let next = stage.fixes[(lit + step + rowCount) % rowCount];
    return next === undefined
      ? withFormulaFromWordsStage(state, {
          ...stage,
          isDiscardHighlighted: true,
        })
      : (pickProposedFix(state, workbook, next.formula) ?? state);
  }
  if (stage?.kind === 'proposed')
    return withFormulaFromWordsStage(state, {
      ...stage,
      isDiscardHighlighted: !stage.isDiscardHighlighted,
    });
  if (stage?.kind !== 'offered') return state;
  let rows: FormulaOfferRow[] = [
    ...(formulaReadForOffer(stage) === null ? [] : (['read'] satisfies FormulaOfferRow[])),
    ...(stage.readOtherwise === undefined ? [] : (['readOtherwise'] satisfies FormulaOfferRow[])),
    ...(stage.isAgentLeftOut === true ? [] : (['write'] satisfies FormulaOfferRow[])),
    'keepTyping',
  ];
  let litIndex = isOfferLitOnItsOwn(stage) ? (step === 1 ? -1 : 0) : rows.indexOf(stage.highlighted);
  let highlighted = rows[(litIndex + step + rows.length) % rows.length];
  return withFormulaFromWordsStage(state, {
    ...stage,
    highlighted: highlighted ?? stage.highlighted,
    isLightMovedByPerson: true,
  });
}
export function entryWithOfferRowFormula(state: PageState, workbook: ReadsWithTextMeasurer, row?: FormulaOfferRow): PageState | null {
  const { stage } = state.formulaFromWords;
  let highlighted: FormulaOfferRow = stage?.kind === 'offered' ? stage.highlighted : 'read';
  let formula = formulaOfOfferRow(stage, row ?? highlighted);
  if (formula === null) return null;
  let entered = withEntryFormulaText(state, workbook, formula);
  return (row ?? highlighted) === 'readOtherwise' && entered.mode.kind === 'editing'
    ? {
        ...entered,
        mode: {
          ...entered.mode,
          mayHoldTextOfOthers: true,
        },
      }
    : entered;
}
export function chooseOfferRow(state: PageState, workbook: ReadsWithTextMeasurer, row: FormulaOfferRow | null): PageTransition {
  const { stage } = state.formulaFromWords;
  if (stage?.kind !== 'offered') return withNoEffects(state);
  switch (row ?? stage.highlighted) {
    case 'read':
    case 'readOtherwise': {
      let entered = entryWithOfferRowFormula(state, workbook, row ?? stage.highlighted);
      return (entered === null ? null : commitEntryInPlaceIfEditing(entered, workbook)) ?? withNoEffects(state);
    }
    case 'write':
      return stage.isAgentLeftOut === true ? withNoEffects(state) : askAgentForFormula(state, workbook);
    case 'keepTyping':
      return withNoEffects(waveFormulaOfferOff(state));
  }
}
export function goBackToWords(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  const { stage } = state.formulaFromWords;
  if (stage?.kind !== 'proposed') return state;
  return withFormulaFromWordsStage(withEntryFormulaText(state, workbook, stage.words, 'wasHeld'), null);
}
export function formulaFromWordsPopup({ formulaFromWords: { stage } }: PageState) {
  switch (stage?.kind) {
    case 'offered':
      if (!stage.isDrawn || isOfferEmptyWithoutAgent(stage)) return null;
      if (stage.hasRested !== true) return isReadingHighlighted(stage.highlighted) ? 'formulaReadYetToRest' : 'formulaOfferYetToRest';
      return isReadingHighlighted(stage.highlighted) ? 'formulaRead' : 'formulaOffer';
    case 'asked':
      return 'formulaAsked';
    case 'proposed':
      if (stage.isDiscardHighlighted) return 'formulaToDiscard';
      return stage.isArriving ? 'formulaArriving' : 'formulaProposed';
    case 'cameToNothing':
      return 'formulaNote';
    case undefined:
      return null;
  }
}
export const waitForFormula = (state: PageState): PageState => ({
  ...state,
  formulaFromWords: {
    ...state.formulaFromWords,
    actsHeld: state.formulaFromWords.actsHeld + 1,
  },
});
export const stopAskingForFormula = (state: PageState): PageTransition =>
  state.formulaFromWords.stage?.kind === 'asked'
    ? {
        state: withFormulaFromWordsStage(state, null),
        effects: STOP_ASKING_AGENT_EFFECTS,
      }
    : withNoEffects(state);
export const waveFormulaOfferOff = (state: PageState): PageState =>
  state.formulaFromWords.stage?.kind === 'offered' || state.formulaFromWords.stage?.kind === 'cameToNothing'
    ? withFormulaFromWordsStage(state, null, {
        isWavedOff: true,
      })
    : state;
export const proposedFixesOf = ({ stage }: Pick<FormulaFromWords, 'stage'>): FormulaWithResult[] => (stage?.kind === 'proposed' ? (stage.fixes ?? []) : []);
export const isFormulaAskedOrProposed = ({ formulaFromWords: { stage } }: Pick<PageState, 'formulaFromWords'>): boolean =>
  stage?.kind === 'asked' || stage?.kind === 'proposed';
