import { isFormulaWrittenInWords } from '../fix-prompt.ts';
import { cellKeyOf } from '../error-tells.ts';
import { isFormulaText } from '../../chips/dropdown-pane-edits.ts';
import { MAX_FORMULA_FROM_WORDS_TEXT_LENGTH } from '../agent-prompt.ts';
import { activeAnchorCell } from '../../selection/model.ts';
import { formulaReadsAsWords } from '../word-tokens.ts';
import { keepsAgentsFormula } from '../../editor/commit-entry.ts';
import { refreshProposedFormula, cellOfFixNotice, withFixNoticeDown } from '../fix/ask.ts';
import { headedColumnsMatchingWord } from '../column-headings.ts';
import { highlightedReferences } from '../reference-pointing.ts';
import { findFormulaReferences } from '../references.ts';
import { withNoEffects } from '../../state/transitions.ts';
import type { EditingMode, PageEffect, PageTransition } from '../../state/transitions.ts';
import { layoutOfView } from '../../grid/layout.ts';
import { formulaFromWordsWhereAt } from './where.ts';
import { isLineShown } from '../../model/line-sizes.ts';
import { formulaOfWords, otherFormulaOfWords } from './rules.ts';
import { proposedFormulaResult } from '../proposed-result.ts';
import { isAreaWithin } from '../../selection/several-ranges.ts';
import type {
  AgentOfFormulaFromWords,
  FormulaFromWords,
  FormulaFromWordsStage,
  FormulaOffered,
  FormulaOfferRow,
  FormulaToWorkOut,
  FormulaWithResult,
  PageState,
  ReferenceInEntry,
} from '../../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
import type { ReadsWithTextMeasurer } from '../../state/controller.ts';
export function rememberOwnWords({ mode }: PageState, { state, effects }: PageTransition, workbook: WorkbookReads): PageState {
  if (mode.kind !== 'editing' || !isEntryFreshForWords(mode) || mode.holdsWhatWasNotTyped === true) return state;
  for (const effect of effects) {
    if (effect.kind !== 'queueEdit' || effect.edit.kind !== 'enter') continue;
    let { sheetId, cell, entry } = effect.edit;
    if (entry.kind !== 'text' || !entry.text.startsWith(mode.text)) continue;
    if (!isFormulaWrittenInWords(workbook, entry.text)) continue;
    let ownWords = new Map<string, string>(state.formulaFromWords.ownWords);
    ownWords.set(
      cellKeyOf({
        sheetId,
        rowId: cell.r,
        columnId: cell.c,
      }),
      entry.text,
    );
    return {
      ...state,
      formulaFromWords: {
        ...state.formulaFromWords,
        ownWords,
      },
    };
  }
  return state;
}
export function checkAgentWhenEntryStarts(step: PageTransition): PageTransition {
  const { mode, formulaFromWords } = step.state;
  let withAgent = (agent: AgentOfFormulaFromWords): PageState => ({
    ...step.state,
    formulaFromWords: {
      ...formulaFromWords,
      agent,
    },
  });
  if (mode.kind !== 'editing')
    return formulaFromWords.agent === 'unavailable'
      ? {
          ...step,
          state: withAgent('unchecked'),
        }
      : step;
  if (formulaFromWords.agent !== 'unchecked' || !isFormulaText(mode.text)) return step;
  return {
    state: withAgent('checking'),
    effects: [
      ...step.effects,
      {
        kind: 'checkAgentForFormulas',
      },
    ],
  };
}
export function checkAgentForFormulas(step: PageTransition): PageTransition {
  let { formulaFromWords } = step.state;
  if (formulaFromWords.agent !== 'unchecked') return step;
  return {
    state: {
      ...step.state,
      formulaFromWords: {
        ...formulaFromWords,
        agent: 'checking',
      },
    },
    effects: [
      ...step.effects,
      {
        kind: 'checkAgentForFormulas',
      },
    ],
  };
}
export function shouldOfferFormula(state: PageState, workbook: WorkbookReads): boolean {
  const { mode, formulaFromWords } = state;
  if (mode.kind !== 'editing' || formulaFromWords.isWavedOff) return false;
  if (workbook.calculationTookTooLong) return false;
  if (mode.text.length > MAX_FORMULA_FROM_WORDS_TEXT_LENGTH) return false;
  if (mode.text === mode.textAtStart && !canAskAgentForFormula(state)) return false;
  if (isListOpenBelowEntry(state)) return false;
  if (workbook.dropdownOf(activeAnchorCell(state, workbook)) !== null) return false;
  return formulaReadsAsWords(
    mode.text,
    workbook.listSheets().map(({ name }) => name),
    workbook.decimalSign,
  );
}
export function updateFormulaOffer(
  before: PageState,
  step: PageTransition,
  workbook: ReadsWithTextMeasurer,
  isOfferShut: boolean,
): PageTransition {
  const { state, effects } = step;
  const { mode, formulaFromWords } = state;
  const { stage, isWavedOff } = formulaFromWords;
  let effectsStoppingAsk = stage?.kind === 'asked' ? [...effects, ...STOP_ASKING_AGENT_EFFECTS] : effects;
  if (mode.kind !== 'editing' || isOfferShut)
    return stage === null && !isWavedOff && formulaFromWords.notOfferedWhileShut === null
      ? step
      : {
          state: withFormulaFromWordsStage(state, null, {
            isWavedOff: false,
            notOfferedWhileShut: null,
          }),
          effects: effectsStoppingAsk,
        };
  if (stage?.kind === 'proposed' && keepsAgentsFormula(step))
    return {
      ...step,
      state: withFormulaFromWordsStage(state, null),
    };
  let isWorkbookUnchanged = state.workbookChangeCount === before.workbookChangeCount;
  if (
    mode === before.mode &&
    formulaFromWords === before.formulaFromWords &&
    isWorkbookUnchanged &&
    isListOpenBelowEntry(state) === isListOpenBelowEntry(before)
  )
    return step;
  const isStageForThisText =
    stage !== null && stage.kind !== 'offered' && mode.text === (stage.kind === 'proposed' ? stage.formula : stage.words);
  if (isStageForThisText && stage.kind === 'proposed' && !isWorkbookUnchanged)
    return {
      ...step,
      state: refreshProposedFormula(state, workbook, stage),
    };
  if (isStageForThisText) return step;
  if (stage?.kind === 'proposed')
    return {
      ...step,
      state: withFormulaFromWordsStage(state, null),
    };
  if (isWavedOff && mode.text.length <= 1)
    return {
      ...step,
      state: withFormulaFromWordsStage(state, null, {
        isWavedOff: false,
      }),
    };
  const shouldOffer = shouldOfferFormula(state, workbook);
  const isAgentLeftOut = !canAskAgentForFormula(state);
  const isOfferStanding = stage?.kind === 'offered' && !(stage.hasCallFailed && mode !== before.mode);
  if (shouldOffer && isOfferStanding && (stage.isAgentLeftOut === true) !== isAgentLeftOut) {
    let { isAgentLeftOut: wasAgentLeftOut, ...stageWithAgent } = stage;
    return {
      ...step,
      state: withFormulaFromWordsStage(
        state,
        isAgentLeftOut
          ? {
              ...stage,
              isAgentLeftOut,
            }
          : stageWithAgent,
      ),
    };
  }
  if (!shouldOffer && stage === null && formulaFromWords.notOfferedWhileShut !== null)
    return {
      ...step,
      state: withFormulaFromWordsStage(state, null, {
        notOfferedWhileShut: null,
      }),
    };
  if (shouldOffer ? isOfferStanding : stage === null) return step;
  let stageBefore = before.formulaFromWords.stage;
  let { notOfferedWhileShut } = formulaFromWords;
  let notOfferedFields =
    notOfferedWhileShut === null
      ? {}
      : {
          formulaNotOffered: notOfferedWhileShut,
        };
  let isDrawn = isAgentLeftOut || (stageBefore !== null && (stageBefore.kind !== 'offered' || stageBefore.isDrawn));
  return {
    state: withFormulaFromWordsStage(
      state,
      shouldOffer
        ? {
            ...FRESH_FORMULA_OFFER,
            isDrawn,
            ...(isDrawn && {
              hasRested: true,
            }),
            ...(isAgentLeftOut && {
              isAgentLeftOut,
              ...notOfferedFields,
            }),
          }
        : null,
      {
        notOfferedWhileShut: null,
      },
    ),
    effects: effectsStoppingAsk,
  };
}
export function columnsNamedInWords(state: PageState, workbook: WorkbookReads, words: string): string[] {
  let activeCell = activeAnchorCell(state, workbook);
  let cellsNamed = [...words.matchAll(HEADING_WORD_PATTERN)].flatMap(({ 0: word, index }) => {
    let isWordFinished = index + word.length < words.length;
    return headedColumnsMatchingWord(word, activeCell, workbook)
      .filter(
        ({ heading }) =>
          (isWordFinished && word.length >= MIN_HEADING_WORD_LENGTH) ||
          heading.toLowerCase().match(HEADING_WORD_PATTERN)?.includes(word.toLowerCase()) === true,
      )
      .map(({ cells }) => cells);
  });
  return [...new Set(cellsNamed)];
}
export function withReferencesNamedInWords(before: PageState, state: PageState, workbook: WorkbookReads, isForced = false): PageState {
  const { mode, formulaFromWords, activeCell } = state;
  let stageKind = formulaFromWords.stage?.kind;
  if (mode.kind !== 'editing' || (stageKind !== 'offered' && stageKind !== 'asked')) {
    let typedReferences = state.referencesInEntry.filter(({ isNamedInWords }) => isNamedInWords !== true);
    return typedReferences.length === state.referencesInEntry.length
      ? state
      : {
          ...state,
          referencesInEntry: typedReferences,
        };
  }
  if (
    mode === before.mode &&
    stageKind === before.formulaFromWords.stage?.kind &&
    state.workbookChangeCount === before.workbookChangeCount &&
    !isForced
  )
    return state;
  let cellsNamed = columnsNamedInWords(state, workbook, mode.text.slice(1));
  if (cellsNamed.length === 0) return state;
  let typedReferenceCount = highlightedReferences(mode.text, activeCell.sheetId, workbook).length;
  let isQuoteOpen = findFormulaReferences(mode.text, workbook.decimalSign).quoted.some(
    ({ isClosed }) => !isClosed,
  );
  let textWithNames = `${mode.text}${isQuoteOpen ? '"' : ''} ${cellsNamed.join(' ')}`;
  let references: ReferenceInEntry[] = highlightedReferences(textWithNames, activeCell.sheetId, workbook);
  return {
    ...state,
    referencesInEntry: [
      ...references.slice(0, typedReferenceCount),
      ...references.slice(typedReferenceCount).map(
        ({ sheetId, area, pieces, hue }): ReferenceInEntry =>
          pieces === undefined
            ? {
                sheetId,
                area,
                hue,
                isNamedInWords: true,
              }
            : {
                sheetId,
                area,
                pieces,
                hue,
                isNamedInWords: true,
              },
      ),
    ],
  };
}
export function readFormulaForOffer(before: PageState, state: PageState, workbook: ReadsWithTextMeasurer): PageTransition {
  const { mode, formulaFromWords } = state;
  const { stage } = formulaFromWords;
  if (mode.kind !== 'editing' || stage?.kind !== 'offered') return withNoEffects(state);
  let stageBefore = before.formulaFromWords.stage;
  let isWorkbookUnchanged =
    state.workbookChangeCount === before.workbookChangeCount && state.formulasWorkedOutCount === before.formulasWorkedOutCount;
  if (
    mode.text === (before.mode.kind === 'editing' ? before.mode.text : null) &&
    stageBefore?.kind === 'offered' &&
    stageBefore.read === stage.read &&
    stageBefore.formulaNotOffered === stage.formulaNotOffered &&
    state.sheetPointedIn === before.sheetPointedIn &&
    isWorkbookUnchanged
  )
    return withNoEffects(state);
  let activeCell = activeAnchorCell(state, workbook);
  let { rowEdges } = layoutOfView(state, workbook);
  let where = formulaFromWordsWhereAt(
    workbook,
    activeCell,
    (rowIndex) => isLineShown(rowEdges, rowIndex),
    state.sheetPointedIn === null,
  );
  let formula = where === null ? null : formulaOfWords(mode.text.slice(1), where);
  let otherRead = where === null ? null : otherFormulaOfWords(mode.text.slice(1), where);
  let other = otherRead?.formula ?? null;
  let formulaBefore = stage.toWorkOut?.formula ?? stage.read?.formula ?? stage.formulaNotOffered ?? null;
  let otherBefore = stage.toWorkOut === undefined ? (stage.readOtherwise?.formula ?? stage.otherNotOffered ?? null) : stage.toWorkOut.other;
  if (formula === formulaBefore && other === otherBefore && isWorkbookUnchanged) return withNoEffects(state);
  let isTextChanged = mode.text !== (before.mode.kind === 'editing' ? before.mode.text : null);
  let {
    formulaNotOffered,
    otherNotOffered,
    toWorkOut: toWorkOutBefore,
    isLightMovedByPerson,
    readOtherwise,
    ...offered
  } = stage;
  let isLightKept = isLightMovedByPerson === true && !isTextChanged;
  let offeredKeepingLight = isLightKept
    ? {
        ...offered,
        isLightMovedByPerson,
      }
    : offered;
  let litIfItGoes = isReadingHighlighted(stage.highlighted) ? (stage.toWorkOut?.litIfItGoes ?? 'write') : stage.highlighted;
  if (formula === null)
    return withNoEffects(
      withFormulaFromWordsStage(state, {
        ...(isReadingHighlighted(stage.highlighted) ? offered : offeredKeepingLight),
        read: null,
        highlighted: litIfItGoes,
      }),
    );
  let leavesLitRow = stageBefore?.kind === 'asked' || stage.toWorkOut?.leavesLitRow === true;
  let isKeptOutOfRow =
    other === otherBefore && (formula === formulaNotOffered || (stage.toWorkOut?.isKeptOutOfRow === true && formula === stage.toWorkOut.formula));
  let isReadToLight =
    !isLightKept && (formula !== formulaReadForOffer(stage) || (isTextChanged && other !== otherBefore)) && !leavesLitRow && !isKeptOutOfRow;
  let isOtherUnchanged = formula === formulaBefore && other !== null && other === otherBefore;
  let isOtherNew = other !== null && !isOtherUnchanged;
  let isRowHeldForOther =
    (isOtherNew && formula !== stage.read?.formula) || (isOtherUnchanged && stage.toWorkOut?.isRowHeldForOther === true);
  let isOtherToLight = isOtherNew && (isReadToLight || (stage.highlighted === 'read' && !isLightKept));
  let isLitIfAlone = isOtherToLight || (other !== null && stage.toWorkOut?.isLitIfAlone === true);
  let wasOtherLit = stage.highlighted === 'readOtherwise' && !isOtherUnchanged;
  let isOtherTheirs = isOtherNew && !isTextChanged && ((wasOtherLit && isLightKept) || stage.toWorkOut?.isOtherTheirs === true);
  let toWorkOut: FormulaToWorkOut = {
    formula,
    leavesLitRow,
    isKeptOutOfRow,
    litIfItGoes,
    other,
    mustOtherStandToo: otherRead?.mustStandToo === true,
    isRowHeldForOther,
    isLitIfAlone,
    isOtherTheirs,
  };
  let highlighted = wasOtherLit ? litIfItGoes : stage.highlighted;
  return {
    state: withFormulaFromWordsStage(state, {
      ...(wasOtherLit ? offered : offeredKeepingLight),
      ...(isRowHeldForOther && {
        read: null,
      }),
      ...(isOtherUnchanged &&
        readOtherwise !== undefined && {
          readOtherwise,
        }),
      ...(isOtherUnchanged &&
        otherNotOffered !== undefined && {
          otherNotOffered,
        }),
      toWorkOut,
      highlighted: isOtherToLight ? litIfItGoes : isReadToLight ? 'read' : highlighted,
    }),
    effects: [
      {
        kind: 'workOutFormulaRead',
        formula,
      },
    ],
  };
}
export function takeWorkedOutFormula(state: PageState, workbook: WorkbookReads, formula: string): PageState {
  const { stage } = state.formulaFromWords;
  if (stage?.kind !== 'offered' || stage.toWorkOut?.formula !== formula) return state;
  let comesTo = proposedFormulaResult(workbook, activeAnchorCell(state, workbook), formula);
  let read: FormulaWithResult | null =
    comesTo !== null && typeof comesTo !== 'string' && comesTo.fillsOtherCells !== true
      ? {
          formula,
          value: comesTo,
        }
      : null;
  let {
    other,
    mustOtherStandToo,
    isLitIfAlone,
    isOtherTheirs,
    litIfItGoes,
  } = stage.toWorkOut;
  let otherComesTo = read === null || other === null ? null : proposedFormulaResult(workbook, activeAnchorCell(state, workbook), other);
  let readOtherwise: FormulaWithResult | null =
    other !== null &&
    otherComesTo !== null &&
    typeof otherComesTo !== 'string' &&
    otherComesTo.fillsOtherCells !== true &&
    otherComesTo.shown !== read?.value.shown
      ? {
          formula: other,
          value: otherComesTo,
        }
      : null;
  let readKept = mustOtherStandToo && readOtherwise === null ? null : read;
  let isLitRowGone =
    (readKept === null && stage.highlighted === 'read') || (readOtherwise === null && stage.highlighted === 'readOtherwise');
  let isLightMovedByPerson = stage.isLightMovedByPerson === true;
  let isReadToLight = readKept !== null && readOtherwise === null && isLitIfAlone && !isLightMovedByPerson;
  let isOtherToLight = readOtherwise !== null && isOtherTheirs && !isLightMovedByPerson;
  let isLightToMove = readOtherwise !== null && stage.highlighted === 'read' && !isLightMovedByPerson;
  let highlighted = isLitRowGone || isLightToMove ? litIfItGoes : stage.highlighted;
  let {
    toWorkOut,
    isLightMovedByPerson: lightMoved,
    readOtherwise: readOtherwiseBefore,
    otherNotOffered,
    ...offered
  } = stage;
  return withFormulaFromWordsStage(state, {
    ...offered,
    ...(((isLightMovedByPerson && !isLitRowGone) || isOtherToLight) && {
      isLightMovedByPerson: true,
    }),
    read: readKept,
    ...(readOtherwise !== null && {
      readOtherwise,
    }),
    highlighted: isOtherToLight ? 'readOtherwise' : isReadToLight ? 'read' : highlighted,
    ...(readKept === null && {
      formulaNotOffered: formula,
    }),
    ...(other !== null &&
      readOtherwise === null && {
        otherNotOffered: other,
      }),
  });
}
export function formulaReadForOffer(stage: FormulaFromWordsStage | null): string | null {
  if (stage?.kind !== 'offered') return null;
  return stage.toWorkOut !== undefined && !stage.toWorkOut.isKeptOutOfRow && !stage.toWorkOut.isRowHeldForOther
    ? stage.toWorkOut.formula
    : (stage.read?.formula ?? null);
}
export function formulaOfOfferRow(stage: FormulaFromWordsStage | null, highlighted: FormulaOfferRow): string | null {
  if (stage?.kind !== 'offered') return null;
  if (highlighted === 'read') return formulaReadForOffer(stage);
  return highlighted === 'readOtherwise' ? (stage.readOtherwise?.formula ?? null) : null;
}
export function shutEmptyOffer(state: PageState): PageState {
  const { stage } = state.formulaFromWords;
  return isOfferEmptyWithoutAgent(stage) && stage?.kind === 'offered' && stage.toWorkOut === undefined
    ? withFormulaFromWordsStage(state, null, {
        notOfferedWhileShut: stage.formulaNotOffered ?? null,
      })
    : state;
}
export function moveLightOffWrite(state: PageState): PageState {
  const { stage } = state.formulaFromWords;
  return stage?.kind === 'offered' && stage.isAgentLeftOut === true && stage.highlighted === 'write'
    ? withFormulaFromWordsStage(state, {
        ...stage,
        highlighted: 'keepTyping',
      })
    : state;
}
export function withReferencesOfHighlightedFormula(before: PageState, state: PageState, workbook: WorkbookReads): PageState {
  const { mode, activeCell } = state;
  let [formula, formulaBefore] = [highlightedOfferFormula(state), highlightedOfferFormula(before)];
  if (mode.kind !== 'editing' || (formula === null && formulaBefore === null)) return state;
  if (formula === formulaBefore && mode === before.mode && state.workbookChangeCount === before.workbookChangeCount) return state;
  let typedReferences: ReferenceInEntry[] = isFormulaText(mode.text) ? highlightedReferences(mode.text, activeCell.sheetId, workbook) : [];
  if (formula === null)
    return withReferencesNamedInWords(
      before,
      {
        ...state,
        referencesInEntry: typedReferences,
      },
      workbook,
      true,
    );
  let formulaReferences: ReferenceInEntry[] = highlightedReferences(formula, activeCell.sheetId, workbook);
  let smallestCovering = ({ area }: ReferenceInEntry) =>
    formulaReferences
      .filter(({ area: formulaArea }) => isAreaWithin(area, formulaArea))
      .reduce<ReferenceInEntry | undefined>(
        (smallest, reference) =>
          smallest === undefined || cellCountOfArea(reference.area) < cellCountOfArea(smallest.area) ? reference : smallest,
        undefined,
      );
  let typedKept = typedReferences.flatMap((reference): ReferenceInEntry[] => {
    let covering = smallestCovering(reference);
    let { sheetId, writtenAt } = reference;
    if (covering === undefined || writtenAt === undefined) return [];
    return [
      {
        sheetId,
        area: covering.area,
        hue: covering.hue,
        writtenAt,
      },
    ];
  });
  let namedInWords = formulaReferences
    .filter((reference) => !typedReferences.some((typed) => smallestCovering(typed) === reference))
    .map(
      ({ sheetId, area, hue }): ReferenceInEntry => ({
        sheetId,
        area,
        hue,
        isNamedInWords: true,
      }),
    );
  return {
    ...state,
    referencesInEntry: [...typedKept, ...namedInWords],
  };
}
export function stepFormulaFromWords(
  before: PageState,
  step: PageTransition,
  workbook: ReadsWithTextMeasurer,
  isOfferShut: boolean,
): PageTransition {
  let withOwnWords = {
    ...step,
    state: rememberOwnWords(before, step, workbook),
  };
  let checked = isOfferShut ? withOwnWords : checkAgentWhenEntryStarts(withOwnWords);
  let offerUpdated = updateFormulaOffer(before, checked, workbook, isOfferShut);
  let noticed = cellOfFixNotice(offerUpdated.state) === null ? withFixNoticeDown(offerUpdated.state) : offerUpdated.state;
  let read = readFormulaForOffer(before, noticed, workbook);
  return {
    state: withReferencesOfHighlightedFormula(
      before,
      withReferencesNamedInWords(before, moveLightOffWrite(shutEmptyOffer(read.state)), workbook),
      workbook,
    ),
    effects: [...offerUpdated.effects, ...read.effects],
  };
}
export const isReadingHighlighted = (highlighted: FormulaOfferRow): highlighted is 'read' | 'readOtherwise' =>
  highlighted === 'read' || highlighted === 'readOtherwise';
export const FORMULA_FROM_WORDS_START: FormulaFromWords = {
  agent: 'unchecked',
  hasAgentBeenMissed: false,
  askCount: 0,
  isWavedOff: false,
  actsHeld: 0,
  stage: null,
  notOfferedWhileShut: null,
  ownWords: new Map<string, string>(),
  fixThatCameToNothing: null,
};
export const withFormulaFromWordsStage = (
  state: PageState,
  stage: FormulaFromWordsStage | null,
  fields: Partial<FormulaFromWords> = {},
): PageState => ({
  ...state,
  formulaFromWords: {
    ...state.formulaFromWords,
    ...fields,
    stage,
  },
});
export const FRESH_FORMULA_OFFER: FormulaOffered = {
  kind: 'offered',
  highlighted: 'write',
  read: null,
  hasCallFailed: false,
  isDrawn: false,
};
export const STOP_ASKING_AGENT_EFFECTS: PageEffect[] = [
  {
    kind: 'stopAskingAgentForAFormula',
  },
];
export const isEntryFreshForWords = (mode: EditingMode): boolean =>
  mode.mayHoldTextOfOthers !== true &&
  mode.formulaOfAgent !== 'mayBeHeld' &&
  (mode.isTypedOverCell === true || mode.wasEmptied === true || mode.textAtStart === '') &&
  !mode.text.includes('!');
export const areOwnWordsOfCell = ({ formulaFromWords: { ownWords } }: PageState, cellId: CellId, text: string): boolean =>
  ownWords.get(cellKeyOf(cellId))?.toUpperCase() === text.toUpperCase();
export const isListOpenBelowEntry = (state: PageState): boolean =>
  state.menu !== null ||
  state.peopleList !== null ||
  state.timeList !== null ||
  state.dropdown !== null ||
  state.calendar !== null ||
  state.formulaHelp.list !== null;
export const canAskAgentForFormula = ({ mode, formulaFromWords }: PageState): boolean =>
  mode.kind === 'editing' && formulaFromWords.agent === 'available' && isEntryFreshForWords(mode);
export const HEADING_WORD_PATTERN = /\p{L}[\p{L}\p{N}]*/gu;
export const MIN_HEADING_WORD_LENGTH = 3;
export const isOfferLitOnItsOwn = (stage: FormulaFromWordsStage | null): boolean =>
  stage?.kind === 'offered' &&
  stage.toWorkOut?.isLitIfAlone === true &&
  !stage.toWorkOut.mustOtherStandToo &&
  stage.isLightMovedByPerson !== true &&
  !isReadingHighlighted(stage.highlighted);
export const isOfferEmptyWithoutAgent = (stage: FormulaFromWordsStage | null): boolean =>
  stage?.kind === 'offered' && stage.isAgentLeftOut === true && formulaReadForOffer(stage) === null;
export const cellCountOfArea = ({ rowCount, columnCount }: CellArea): number => rowCount * columnCount;
export const highlightedOfferFormula = ({ formulaFromWords: { stage } }: PageState): string | null =>
  stage?.kind === 'offered' && stage.isDrawn ? formulaOfOfferRow(stage, stage.highlighted) : null;
