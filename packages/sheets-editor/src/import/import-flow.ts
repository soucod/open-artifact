import {
  planWithByHand,
  columnsLeftOutByHand,
  NOTHING_BY_HAND,
  columnsNamedInNote,
  byHandAfterNewPlan,
  linesWithByHand,
  changesByHand,
} from './by-hand.ts';
import { countFilledCellsToImport, makeUniqueSheetName, hasRoomForFilledCells } from '../model/workbook-room.ts';
import { isWorkbookOneUntouchedSheet } from './bring-in.ts';
import { readingsAsTheSheetHoldsFor } from './destination.tsx';
import { planWithAnswers, isSameJson, planWithAgentRecommendations, mergeImportQuestions, chosenAnswersOf } from './column-readings.ts';
import type { ImportLineChoice } from './column-readings.ts';
import { previewIntoSheet } from './into-sheet-preview.ts';
import { previewImportColumns, examplesOfQuestion } from './preview.ts';
import { isPromptDataTooLong, joinPrompts } from '../agent/prompt-text.ts';
import { withNoEffects } from '../state/transitions.ts';
import type { PageTransition } from '../state/transitions.ts';
import { profileImportFile } from './file-profile.ts';
import type { ImportFileProfile } from './file-profile.ts';
import {
  importDataForAgent,
  planForAgent,
  askForImportPlan,
  askWithWish,
  askAfterRefusedPlan,
  withWorkbookSheets,
  shortenPlanNames,
  planFromAnswer,
} from './agent-plan.ts';
import type { ImportPlanFromAnswer } from './agent-plan.ts';
import { planImportWithoutAgent } from './plan-without-agent.ts';
import { withoutImportUndoOffer } from './file-awaited.ts';
import { findImportPlaces, likeliestImportDestination, tableImportRequest } from './places.ts';
import { NEW_SHEET_DESTINATION } from './import-basics.ts';
import { NOTHING_STOOD, importPlanSoFar } from './import-review.ts';
import { colorOptionsAutomatically, withoutOptionColors } from '../chips/dropdown-colors.ts';
import type {
  AgentOfImport,
  ImportByHand,
  ImportChangeStood,
  ImportColumnByHand,
  ImportColumnPlan,
  ImportDestination,
  ImportFile,
  ImportIntoSheet,
  ImportNewSheet,
  ImportOfAFile,
  ImportPlan,
  ImportPlanSoFar,
  ImportReadingWords,
  ImportStood,
  PageState,
} from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
import type { NumberFormatReply } from '../format/custom-number-format.ts';
import type { WorkbookReads } from '../model/workbook.ts';
/** What of an import the plan as the person sees it is worked out from. */
export type ImportPlanParts = Pick<ImportOfAFile, 'plan' | 'byHand' | 'asTheSheetHolds' | 'table' | 'words' | 'answers'>;
/** An import before its preview is worked out: what refreshing the preview adds is still to come. */
export type ImportBeforePreview = Omit<ImportOfAFile, 'asTheSheetHolds' | 'preview' | 'intoSheet' | 'newSheet' | 'examples' | 'kinds'>;
/** What the agent is asked about an import, and how many times it has been asked so. */
export type ImportAsk = Pick<Extract<AgentOfImport, { kind: 'isAsked' }>, 'asked' | 'attempt' | 'wish' | 'isAskedAgain'>;
/** The profile of a file, and the locale it was worked out in. */
export interface ImportProfileTried {
  locale: string;
  tried: ImportFileProfile;
}
export function importPlanWithByHand({ plan, byHand, asTheSheetHolds, table, words }: ImportPlanParts) {
  let columns: Record<number, ImportColumnByHand> = {
    ...byHand.columns,
  };
  for (let [columnIndex, reading] of Object.entries(asTheSheetHolds)) {
    let byHandColumn = columns[Number(columnIndex)];
    columns[Number(columnIndex)] = {
      ...byHandColumn,
      reading: byHandColumn?.reading ?? reading,
    };
  }
  return planWithByHand(
    plan,
    {
      ...byHand,
      columns,
    },
    table,
    words.names,
  );
}
/** The destination the person chose, kept as it is unless the planned one goes to the same table of the sheet. */
export function refreshChosenDestination(planned: ImportDestination, chosen: ImportDestination): ImportDestination {
  if (chosen.kind === 'newSheet' || planned.kind === 'newSheet') return chosen;
  if (planned.sheetId !== chosen.sheetId) return chosen;
  let { how } = chosen;
  return how.kind === 'mergeByKey' && planned.intoColumns[how.keyColumnIndex] !== chosen.intoColumns[how.keyColumnIndex]
    ? chosen
    : {
        ...chosen,
        headerRowId: planned.headerRowId,
        intoColumns: planned.intoColumns,
      };
}
export function destinationWithColumnsLeftOut(importOfAFile: Pick<ImportOfAFile, 'plan' | 'destinationChosen' | 'byHand'>): ImportDestination {
  let destination = importDestinationOf(importOfAFile);
  if (destination.kind === 'newSheet') return destination;
  let { how, intoColumns } = destination;
  let leftOutIndexes = new Set(
    columnsLeftOutByHand(importOfAFile.byHand).filter((columnIndex) => how.kind !== 'mergeByKey' || columnIndex !== how.keyColumnIndex),
  );
  return {
    ...destination,
    intoColumns: intoColumns.map((intoColumn, index) => (leftOutIndexes.has(index) ? null : intoColumn)),
  };
}
export function withoutColumnsLeftOutByHand(intoSheet: ImportIntoSheet | null, importOfAFile: Pick<ImportOfAFile, 'byHand'>): ImportIntoSheet | null {
  if (intoSheet?.kind !== 'changes') return intoSheet;
  let leftOutByHand = new Set(columnsLeftOutByHand(importOfAFile.byHand));
  let columnsLeftOut = intoSheet.columnsLeftOut.filter(
    ({ columnIndexInTheFile }) => !leftOutByHand.has(columnIndexInTheFile),
  );
  return {
    ...intoSheet,
    columnsLeftOut,
  };
}
export function importPlanEssentials(importOfAFile: ImportPlanParts & Pick<ImportOfAFile, 'destinationChosen'>) {
  let { sheetName, headerLine, linesLeftOut, columns } = importPlanAsShown(importOfAFile);
  return {
    sheetName,
    headerLine,
    linesLeftOut,
    columns,
    destination: importDestinationOf(importOfAFile),
  };
}
export function newSheetForImport(importOfAFile: ImportPlanParts, reads: WorkbookReads, filledCellCountBefore: number | null): ImportNewSheet {
  let plan = importPlanAsShown(importOfAFile);
  let filledCellCount = filledCellCountBefore ?? countFilledCellsToImport(importOfAFile.table, plan, columnsLeftOutByHand(importOfAFile.byHand));
  return {
    name: makeUniqueSheetName(plan.sheetName, reads),
    comesFirst: isWorkbookOneUntouchedSheet(reads, importOfAFile.words.stemOfNewSheetNames),
    filledCellCount,
    hasRoom: hasRoomForFilledCells(filledCellCount, reads),
  };
}
export function refreshImportPreview(importOfAFile: ImportBeforePreview, reads: WorkbookReads, importBefore: ImportOfAFile | null): ImportOfAFile {
  let readingsHeld = readingsAsTheSheetHoldsFor(importOfAFile, reads);
  let asTheSheetHolds = readingsHeld ?? importBefore?.asTheSheetHolds ?? NOTHING_AS_THE_SHEET_HOLDS;
  let importNow = {
    ...importOfAFile,
    asTheSheetHolds,
  };
  let { table } = importNow;
  let previous =
    importBefore === null
      ? null
      : {
          plan: importPlanAsShown(importBefore),
          preview: importBefore.preview,
        };
  let planShown = importPlanWithByHand(importNow);
  let planAnswered = planWithAnswers(planShown, importNow.answers);
  let destination = destinationWithColumnsLeftOut(importNow);
  let isSameLines =
    previous !== null && previous.plan.headerLine === planAnswered.headerLine && isSameJson(previous.plan.linesLeftOut, planAnswered.linesLeftOut);
  let isSameByHand = importBefore?.byHand === importNow.byHand && isSameJson(importBefore.asTheSheetHolds, importNow.asTheSheetHolds);
  let intoSheet =
    destination.kind === 'newSheet' ? null : withoutColumnsLeftOutByHand(previewIntoSheet(table, planAnswered, destination, reads), importNow);
  return {
    ...importNow,
    preview: previewImportColumns(table, planAnswered, reads, previous, dropdownOptionsForImport),
    intoSheet: readingsHeld === null ? null : intoSheet,
    newSheet: destination.kind === 'newSheet' ? newSheetForImport(importNow, reads, null) : null,
    examples:
      importBefore !== null && isSameLines && importBefore.plan === importNow.plan && isSameByHand
        ? importBefore.examples
        : importNow.plan.questions.map((question) => {
            let questionAsShown = planShown.questions.find(({ id }) => id === question.id);
            return examplesOfQuestion(table, planShown, questionAsShown ?? question, reads);
          }),
    kinds:
      importBefore !== null &&
      isSameLines &&
      importDestinationOf(importBefore).kind === destination.kind &&
      importBefore.plan === importNow.plan &&
      importBefore.answers === importNow.answers &&
      isSameByHand
        ? importBefore.kinds
        : {},
  };
}
export function askAgentAboutImport(state: PageState, nextImport: ImportOfAFile, ask: ImportAsk): PageTransition {
  if (isPromptDataTooLong(ask.asked)) {
    let asking: AgentOfImport = {
      kind: 'hasFailed',
      wish: ask.wish,
    };
    return withNoEffects({
      ...state,
      importOfAFile: {
        ...nextImport,
        agent: asking,
        soFar: null,
      },
    });
  }
  let askCount = state.importAskCount + 1;
  return {
    state: {
      ...state,
      importAskCount: askCount,
      importOfAFile: {
        ...nextImport,
        agent: {
          kind: 'isAsked',
          askId: askCount,
          replyUnread: null,
          ...ask,
        },
        soFar: ask.wish === null ? (nextImport.soFar ?? startingImportSoFar(nextImport)) : null,
      },
    },
    effects: [
      {
        kind: 'askAgentAboutImport',
        askId: askCount,
        asked: ask.asked,
      },
    ],
  };
}
export function startImportOfAFile(state: PageState, reads: WorkbookReads, file: ImportFile, words: ImportReadingWords): PageTransition {
  let profiled = importProfileCache.get(file.lines);
  let profile = profiled?.locale === reads.locale ? profiled.tried : profileImportFile(file, reads);
  importProfileCache.set(file.lines, {
    locale: reads.locale,
    tried: profile,
  });
  let dataForAgent = importDataForAgent(file, profile, reads);
  let importOfAFile = refreshImportPreview(
    {
      table: file,
      words,
      dataForAgent: dataForAgent.whole,
      dataForAgentWithCountsAlone: dataForAgent.withCountsAlone,
      plan: planImportWithoutAgent(file, profile, reads, words),
      isPlanByAgent: false,
      plansOfAgent: [],
      readingsOfAgent: [],
      plansHeardCount: 0,
      answers: {},
      byHand: NOTHING_BY_HAND,
      columnsAnswered: [],
      columnsAskedFor: [],
      places: null,
      placesGone: [],
      destinationChosen: null,
      isAnAnswerInDoubt: false,
      isDiscardAsked: false,
      agent: {
        kind: 'isToBeAsked',
      },
      soFar: null,
    },
    reads,
    null,
  );
  return placeImportAndAskAgent(
    {
      ...state,
      pickForWorkbook: null,
      isListOfKeysOpen: false,
      cellHistory: null,
      lastDone: null,
      notice: null,
      undoOffer: withoutImportUndoOffer(state.undoOffer),
    },
    {
      ...importOfAFile,
      soFar: startingImportSoFar(importOfAFile),
    },
    reads,
  );
}
export function placeImportAndAskAgent(state: PageState, importOfAFile: ImportOfAFile, reads: WorkbookReads): PageTransition {
  let { table, plan } = importOfAFile;
  let places = findImportPlaces(table, plan, reads);
  let likeliestDestination = places === null || plan.questions.length > 0 ? NEW_SHEET_DESTINATION : likeliestImportDestination(places, table.columnCount);
  let changes = likeliestDestination.kind === 'newSheet' ? null : reads.whatATableChanges(tableImportRequest(likeliestDestination, table, plan));
  if (places === null || (likeliestDestination.kind === 'sheet' && changes === null))
    return withNoEffects({
      ...state,
      importOfAFile,
    });
  let planShownToAgent = planForAgent(plan, {}, places, null);
  let fitsInPrompt = (data: string) =>
    !isPromptDataTooLong(
      joinPrompts(joinPrompts(askForImportPlan(data), askWithWish(planShownToAgent, '', '')), askAfterRefusedPlan(JSON.parse(planShownToAgent), [])),
      IMPORT_PROMPT_HEADROOM,
    );
  let dataInWhole = withWorkbookSheets(importOfAFile.dataForAgent, places);
  let dataForAgent = fitsInPrompt(dataInWhole) ? dataInWhole : withWorkbookSheets(importOfAFile.dataForAgentWithCountsAlone, places);
  let asked = askForImportPlan(dataForAgent);
  let isAgentAskable = fitsInPrompt(dataForAgent);
  let placedImport = refreshImportPreview(
    {
      ...importOfAFile,
      places,
      dataForAgent,
      plan: {
        ...plan,
        destination: changes?.kind === 'refused' ? NEW_SHEET_DESTINATION : likeliestDestination,
      },
      agent:
        importOfAFile.agent.kind === 'wasStopped' && isAgentAskable
          ? importOfAFile.agent
          : {
              kind: 'isNotToBeHad',
              leftUndone: null,
              why: 'tooMuchToTell',
            },
      soFar: null,
    },
    reads,
    importOfAFile,
  );
  return importOfAFile.agent.kind === 'wasStopped' || !isAgentAskable
    ? withNoEffects({
        ...state,
        importOfAFile: placedImport,
      })
    : askAgentAboutImport(state, placedImport, {
        asked,
        attempt: 1,
        wish: null,
        isAskedAgain: false,
      });
}
export function receiveImportAnswer(state: PageState, reads: WorkbookReads, askId: number, reply: NumberFormatReply): PageTransition {
  const importOfAFile = state.importOfAFile;
  if (importOfAFile === null || importOfAFile.agent.kind !== 'isAsked' || importOfAFile.agent.askId !== askId) return withNoEffects(state);
  const { asked, attempt, wish, isAskedAgain } = importOfAFile.agent;
  let withAgent = (agent: AgentOfImport) =>
    withNoEffects({
      ...state,
      importOfAFile: {
        ...importOfAFile,
        agent,
        soFar: agent.kind === 'isAsked' ? importOfAFile.soFar : null,
      },
    });
  if (reply.kind === 'notToBeHad')
    return withAgent({
      kind: 'isNotToBeHad',
      leftUndone: wish === null ? (isAskedAgain ? 'firstPlan' : null) : 'wish',
      why: 'noAgent',
    });
  let failed: AgentOfImport = {
    kind: 'hasFailed',
    wish,
  };
  if (reply.kind !== 'answered') return withAgent(failed);
  const shownBefore = importPlanAsShown(importOfAFile);
  let isSameReadingAsShown = ({ reading }: ImportColumnPlan, columnIndex: number) =>
    isSameJson(reading, shownBefore.columns[columnIndex]?.reading);
  let columnsNamed = columnsNamedInNote(wish ?? '', shownBefore.columns);
  let plansBefore = [...importOfAFile.plansOfAgent, ...importOfAFile.plansOfAgent.map(planWithAgentRecommendations), shownBefore].flatMap(
    (planBefore) => [planBefore, shortenPlanNames(planBefore)],
  );
  let byHandUnder = (newPlan: ImportPlan) =>
    wish === null ? importOfAFile.byHand : byHandAfterNewPlan(importOfAFile.byHand, plansBefore, newPlan);
  let answered = planFromAnswer(reply.answer, importOfAFile.table, reads, {
    mostOptionsInADropdown: reads.mostOptionsInADropdown(),
    names: importOfAFile.words.names,
    followsAWish: wish !== null,
    linesLeftOutBefore: importPlanWithByHand(importOfAFile).linesLeftOut,
    shownBefore,
    linesToComeIn: (lines: ImportLineChoice) =>
      linesWithByHand(
        lines,
        byHandUnder({
          ...importOfAFile.plan,
          ...lines,
        }),
        importOfAFile.table,
      ),
    places: importOfAFile.places ?? [],
    destinationBefore: importDestinationOf(importOfAFile),
  });
  let keepReadingHeld = (column: ImportColumnPlan, columnIndex: number) =>
    importOfAFile.asTheSheetHolds[columnIndex] !== undefined && isSameReadingAsShown(column, columnIndex) && !columnsNamed.includes(columnIndex)
      ? {
          ...column,
          reading: importOfAFile.plan.columns[columnIndex]?.reading ?? column.reading,
        }
      : column;
  const checked: ImportPlanFromAnswer =
    answered.kind === 'plan' && wish !== null
      ? {
          ...answered,
          plan: {
            ...answered.plan,
            columns: answered.plan.columns.map(keepReadingHeld),
          },
        }
      : answered;
  if (checked.kind === 'notKnownYet')
    return withAgent({
      ...importOfAFile.agent,
      replyUnread: reply,
    });
  if (checked.kind === 'refused') {
    if (attempt >= MAX_IMPORT_ASK_ATTEMPTS) return withAgent(failed);
    return askAgentAboutImport(state, importOfAFile, {
      asked: joinPrompts(asked, askAfterRefusedPlan(reply.answer, checked.problems)),
      attempt: attempt + 1,
      wish,
      isAskedAgain,
    });
  }
  if (checked.kind === 'noChange')
    return withAgent(
      wish === null
        ? failed
        : {
            kind: 'hasChangedNothing',
            wish,
            why: checked.why,
            ...NOTHING_STOOD,
          },
    );
  let planShown = importPlanWithByHand(importOfAFile);
  let planAnswered = importPlanWithByHand({
    ...importOfAFile,
    plan: checked.plan,
    byHand: byHandUnder(checked.plan),
  });
  let isSameLines = planShown.headerLine === planAnswered.headerLine && isSameJson(planShown.linesLeftOut, planAnswered.linesLeftOut);
  let soFar = importPlanSoFar(importOfAFile);
  let keepsSummarySoFar =
    (wish === null || (checked.plan.summary ?? null) === null) &&
    soFar.summary !== null &&
    soFar.isSummaryWhole &&
    soFar.isTableFound &&
    soFar.plan.headerLine === planAnswered.headerLine &&
    isSameJson(soFar.plan.linesLeftOut, planAnswered.linesLeftOut);
  let importWithAnswer: ImportOfAFile = {
    ...importOfAFile,
    ...mergeImportQuestions(
      keepsSummarySoFar
        ? {
            ...checked.plan,
            summary: soFar.summary,
          }
        : checked.plan,
      chosenAnswersOf(planShown, importOfAFile.answers),
      wish !== null && isSameLines
        ? planShown.questions.filter(({ id: questionId }) => importOfAFile.answers[questionId] === undefined)
        : [],
    ),
    destinationChosen:
      importOfAFile.destinationChosen === null ? null : refreshChosenDestination(checked.plan.destination, importOfAFile.destinationChosen),
    byHand: byHandUnder(checked.plan),
    columnsAskedFor: [
      ...importOfAFile.columnsAskedFor,
      ...(wish === null || answered.kind !== 'plan' ? [] : answered.plan.columns).flatMap((column, columnIndex) => {
        let isNewReading =
          !['text', 'dropdown'].includes(column.reading.kind) &&
          plansBefore.every((plan) => !isSameJson(plan.columns[columnIndex]?.reading, column.reading));
        return isSameReadingAsShown(column, columnIndex) || (!columnsNamed.includes(columnIndex) && !isNewReading) ? [] : [columnIndex];
      }),
    ],
  };
  let readingsHeld = readingsAsTheSheetHoldsFor(importWithAnswer, reads);
  if (readingsHeld === null)
    return withAgent({
      ...importOfAFile.agent,
      replyUnread: reply,
    });
  const answeredImport: ImportOfAFile = {
    ...importWithAnswer,
    asTheSheetHolds: readingsHeld,
  };
  const isNothingChanged =
    wish !== null &&
    !answeredImport.isAnAnswerInDoubt &&
    isSameJson(importPlanEssentials(answeredImport), importPlanEssentials(importOfAFile)) &&
    isSameJson(importPlanEssentials(withoutAsTheSheetHolds(answeredImport)), importPlanEssentials(withoutAsTheSheetHolds(importOfAFile))) &&
    isSameJson(openImportQuestions(answeredImport), openImportQuestions(importOfAFile));
  let isDestinationMoved =
    answeredImport.destinationChosen !== null &&
    !isSameJson(destinationPlace(checked.plan.destination), destinationPlace(answeredImport.destinationChosen));
  let stood: ImportChangeStood[] =
    wish === null || answeredImport.isAnAnswerInDoubt
      ? []
      : [
          ...changesByHand(checked.plan, answeredImport.byHand, shortenPlanNames(shownBefore)).filter(
            (change) =>
              (change.kind !== 'sheetName' || importDestinationOf(answeredImport).kind === 'newSheet') &&
              (change.kind !== 'line' || answeredImport.byHand.lines[change.line] !== true || planShown.linesLeftOut.includes(change.line)),
          ),
          ...(isDestinationMoved
            ? [
                {
                  kind: 'destination',
                } satisfies ImportChangeStood,
              ]
            : []),
        ];
  let stoodByHand: ImportStood = {
    stood,
    namesOfStood: Object.fromEntries(
      stood.flatMap(
        (change): [number, string][] => (change.kind === 'column' ? [[change.columnIndex, planAnswered.columns[change.columnIndex]?.name ?? '']] : []),
      ),
    ),
    isStoodPointedAt: stood.length > 0,
  };
  if (isNothingChanged)
    return withNoEffects({
      ...state,
      importOfAFile: {
        ...importOfAFile,
        ...(isDestinationMoved && {
          plan: {
            ...importOfAFile.plan,
            destination: checked.plan.destination,
          },
        }),
        isAnAnswerInDoubt: false,
        agent: {
          kind: 'hasChangedNothing',
          wish,
          why: null,
          ...stoodByHand,
        },
      },
    });
  let withPlanByAgent: ImportOfAFile = {
    ...answeredImport,
    isAnAnswerInDoubt: answeredImport.isAnAnswerInDoubt && wish !== null,
    isPlanByAgent: true,
    plansOfAgent: [...importOfAFile.plansOfAgent, checked.plan],
    readingsOfAgent: checked.plan.columns.map(
      ({ reading }, index) =>
        wish !== null && isSameJson(reading, shownBefore.columns[index]?.reading) ? (importOfAFile.readingsOfAgent[index] ?? reading) : reading,
    ),
    plansHeardCount: importOfAFile.plansHeardCount + 1,
    agent: {
      kind: 'hasPlanned',
      ...stoodByHand,
    },
    soFar: null,
  };
  return withNoEffects({
    ...state,
    importOfAFile: refreshImportPreview(withPlanByAgent, reads, importOfAFile),
  });
}
export const MAX_IMPORT_ASK_ATTEMPTS = 2;
export const NOTHING_AS_THE_SHEET_HOLDS: Record<number, ImportReading> = {};
export const withoutAsTheSheetHolds = <Import extends ImportBeforePreview>(importOfAFile: Import) => ({
  ...importOfAFile,
  asTheSheetHolds: NOTHING_AS_THE_SHEET_HOLDS,
});
export const importPlanAsShown = (importOfAFile: ImportPlanParts) =>
  planWithAnswers(importPlanWithByHand(importOfAFile), importOfAFile.answers);
export const byHandNamesOnly = (byHand: ImportByHand): ImportByHand => ({
  ...byHand,
  lines: {},
  columns: Object.fromEntries(
    Object.entries(byHand.columns).flatMap(
      ([columnIndex, { name }]): [string, ImportColumnByHand][] =>
        name === undefined
          ? []
          : [
              [
                columnIndex,
                {
                  name,
                },
              ],
            ],
    ),
  ),
});
export const withByHandNamesOnly = (importOfAFile: ImportOfAFile): ImportOfAFile => ({
  ...importOfAFile,
  byHand: byHandNamesOnly(importOfAFile.byHand),
});
export const importPlanOf = (importOfAFile: ImportPlanParts) => importPlanAsShown(importOfAFile);
export const importDestinationOf = ({ plan, destinationChosen }: Pick<ImportOfAFile, 'plan' | 'destinationChosen'>) =>
  destinationChosen ?? plan.destination;
export const destinationPlace = (destination: ImportDestination) =>
  destination.kind === 'newSheet'
    ? destination
    : {
        sheetId: destination.sheetId,
        how: destination.how,
      };
export const openImportQuestions = (importOfAFile: ImportOfAFile) => [
  ...importPlanWithByHand(importOfAFile).questions.flatMap(
    ({ id: questionId, ask, options }) =>
      importOfAFile.answers[questionId] === undefined
        ? [
            {
              ask,
              options,
            },
          ]
        : [],
  ),
  ...(importOfAFile.destinationChosen === null && importOfAFile.plan.destinationQuestion !== null ? [importOfAFile.plan.destinationQuestion] : []),
];
export const dropdownOptionsForImport = ({ isColored }: Extract<ImportReading, { kind: 'dropdown' }>, labels: string[]) => {
  let options = labels.map(
    (label) => ({
      label,
    }),
  );
  return isColored ? colorOptionsAutomatically(options) : withoutOptionColors(options);
};
export const startingImportSoFar = (importOfAFile: ImportOfAFile): ImportPlanSoFar => ({
  plan: importPlanAsShown(importOfAFile),
  preview: importOfAFile.preview,
  isTableFound: false,
  columnsReadCount: 0,
  summary: null,
  isSummaryWhole: false,
});
/** The profile last worked out for a file, by the file's lines. */
export const importProfileCache = new WeakMap<string[][], ImportProfileTried>();
export const IMPORT_PROMPT_HEADROOM = 4096;
export const importPlacesLeft = ({ places, placesGone }: Pick<ImportOfAFile, 'places' | 'placesGone'>) =>
  (places ?? []).filter(({ table }) => !placesGone.includes(table.sheetId));
