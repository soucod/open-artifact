import { withNoEffects } from '../state/transitions.ts';
import { partialPlanFromAnswer, askForImportPlan, askWithWish, planForAgent } from './agent-plan.ts';
import {
  importPlanWithByHand,
  dropdownOptionsForImport,
  importPlacesLeft,
  importDestinationOf,
  refreshImportPreview,
  importPlanAsShown,
  newSheetForImport,
  placeImportAndAskAgent,
  receiveImportAnswer,
  askAgentAboutImport,
} from './import-flow.ts';
import { previewImportColumns } from './preview.ts';
import { columnsLeftOutByHand, withoutReadingsByHand, questionOptionOfReading, applyByHandChange } from './by-hand.ts';
import { withStopImportAskEffect, importRecordCount } from './bring-in.ts';
import { questionColumnIndexes, planWithAnswers, isSameJson, chosenAnswersOf } from './column-readings.ts';
import { readingKindsOfColumn, withoutDecimalPlacesDigits } from './reading-kinds.ts';
import { NEW_SHEET_DESTINATION } from './import-basics.ts';
import { matchHeadingsToColumns, fileHeadingsOf } from './places.ts';
import { joinPrompts } from '../agent/prompt-text.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type {
  AgentOfImport,
  ImportChangeStood,
  ImportDestination,
  ImportOfAFile,
  ImportPlanSoFar,
  ImportQuestion,
  ImportQuestionExample,
  ImportStood,
  PageState,
} from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { ImportChangeByHand, ImportDestinationPick } from '../state/event-reducer.ts';
import type { ColumnId, SheetId } from '@open-artifact/sheets-core';
/** The plan as far as it is known: the agent's so far while it writes, else the plan shown. */
export interface ImportPlanAsFarAsKnown extends ImportPlanSoFar {
  isAwaited: boolean;
}
/** A line of the file left out of the import, as the settings list it. */
export interface ImportLineLeftOut {
  line: number;
  isLeftOut: boolean;
  canComeBack: boolean;
}
export interface ImportLinesLeftOut {
  lines: ImportLineLeftOut[];
  /** Lines left out that are not listed. */
  moreCount: number;
}
export function receivePartialImportAnswer(state: PageState, reads: WorkbookReads, askId: number, partialAnswer: unknown): PageTransition {
  const importOfAFile = state.importOfAFile;
  if (importOfAFile === null || importOfAFile.agent.kind !== 'isAsked' || importOfAFile.agent.askId !== askId) return withNoEffects(state);
  let soFar = importOfAFile.soFar;
  if (soFar === null || importOfAFile.agent.attempt > 1) return withNoEffects(state);
  let partialPlan = partialPlanFromAnswer(partialAnswer, importOfAFile.table, importOfAFile.plan, importOfAFile.words.names);
  let shownPlan = importPlanWithByHand({
    ...importOfAFile,
    plan: {
      ...partialPlan.plan,
      summary: partialPlan.summary,
    },
  });
  let planRead = {
    ...partialPlan,
    plan: shownPlan,
    summary: shownPlan.summary ?? null,
  };
  if (!(planRead.columnsReadCount > soFar.columnsReadCount || (planRead.isTableFound && !soFar.isTableFound))) {
    let { summary, isSummaryWhole } = planRead;
    return summary === soFar.summary && isSummaryWhole === soFar.isSummaryWhole
      ? withNoEffects(state)
      : withNoEffects({
          ...state,
          importOfAFile: {
            ...importOfAFile,
            soFar: {
              ...soFar,
              summary,
              isSummaryWhole,
            },
          },
        });
  }
  let preview = previewImportColumns(importOfAFile.table, planRead.plan, reads, soFar, dropdownOptionsForImport);
  return withNoEffects({
    ...state,
    importOfAFile: {
      ...importOfAFile,
      soFar: {
        ...planRead,
        preview,
      },
    },
  });
}
export function importLinesLeftOut(importOfAFile: ImportOfAFile): ImportLinesLeftOut {
  let { plan, preview } = importPlanSoFar(importOfAFile);
  let isBelowHeadings = (line: number) => line > (plan.headerLine ?? 0);
  let linesByHand = Object.keys(importOfAFile.byHand.lines).map(Number).filter(isBelowHeadings);
  let linesLeftOut = [...new Set([...linesByHand, ...preview.linesLeftOut])]
    .toSorted((line, otherLine) => line - otherLine)
    .map(
      (line): ImportLineLeftOut => ({
        line,
        isLeftOut: !isBelowHeadings(line) || plan.linesLeftOut.includes(line),
        canComeBack: isBelowHeadings(line),
      }),
    );
  let listedCount = linesLeftOut.filter(({ isLeftOut }) => isLeftOut).length;
  return {
    lines: linesLeftOut,
    moreCount: preview.lineLeftOutCount - listedCount,
  };
}
export function importNotesToShow(importOfAFile: ImportOfAFile): string[] {
  if (!importOfAFile.isPlanByAgent) return [];
  let { whyThere, notes } = importOfAFile.plan;
  let notesSoFar = new Set(importPlanSoFar(importOfAFile).plan.notes);
  return [
    ...new Set([
      ...(importPlacesLeft(importOfAFile).length > 0 && whyThere !== null ? [whyThere] : []),
      ...notes.filter((note) => notesSoFar.has(note)),
    ]),
  ];
}
/** The columns whose reading depends on the option chosen for a question. */
export function columnsQuestionDecides({ options }: Pick<ImportQuestion, 'options'>): number[] {
  return [
    ...new Set(
      options.flatMap(({ readings }) => readings.map(({ columnIndex }) => columnIndex)),
    ),
  ].filter((columnIndex) => {
    let readingsOfColumn = options.map(
      ({ readings }) =>
        JSON.stringify(readings.find((reading) => reading.columnIndex === columnIndex)?.reading),
    );
    return new Set(readingsOfColumn).size > 1;
  });
}
export function openImportQuestionIds(importOfAFile: ImportOfAFile): string[] {
  let destination = importDestinationOf(importOfAFile);
  let keyColumnIndex = destination.kind === 'sheet' && destination.how.kind === 'mergeByKey' ? destination.how.keyColumnIndex : null;
  let columnsLeftOut = new Set(columnsLeftOutByHand(importOfAFile.byHand).filter((columnIndex) => columnIndex !== keyColumnIndex));
  return importPlanWithByHand(importOfAFile)
    .questions.filter(
      (question) =>
        importOfAFile.answers[question.id] === undefined &&
        columnsQuestionDecides(question).some((columnIndex) => !columnsLeftOut.has(columnIndex)),
    )
    .map(({ id }) => id);
}
export function stopAwaitingImportPlan(state: PageState): PageTransition {
  let importOfAFile = state.importOfAFile;
  if (importOfAFile === null) return withNoEffects(state);
  if (isImportPlanComing(importOfAFile)) {
    let stopped: ImportOfAFile = {
      ...importOfAFile,
      agent: {
        kind: 'wasStopped',
      },
      soFar: null,
    };
    return withStopImportAskEffect(
      state,
      withNoEffects({
        ...state,
        importOfAFile: stopped,
      }),
    );
  }
  if (importOfAFile.agent.kind !== 'isAsked') return withNoEffects(state);
  let agentFailed: AgentOfImport = {
    kind: 'hasFailed',
    wish: importOfAFile.agent.wish,
  };
  return withStopImportAskEffect(
    state,
    withNoEffects({
      ...state,
      importOfAFile: {
        ...importOfAFile,
        agent: agentFailed,
      },
    }),
  );
}
export function answerImportQuestion(state: PageState, reads: WorkbookReads, questionId: string, optionIndex: number): PageTransition {
  const importOfAFile = state.importOfAFile;
  if (importOfAFile === null) return withNoEffects(state);
  let question = importOfAFile.plan.questions.find(({ id }) => id === questionId);
  if (question?.options[optionIndex] === undefined) return withNoEffects(state);
  let areReadingsByHand = questionColumnIndexes(question).every(
    (columnIndex) => importOfAFile.byHand.columns[columnIndex]?.reading !== undefined,
  );
  if (importOfAFile.answers[questionId] === optionIndex && !areReadingsByHand) return withNoEffects(state);
  let answers = {
    ...importOfAFile.answers,
    [questionId]: optionIndex,
  };
  let byHand = areReadingsByHand ? withoutReadingsByHand(importOfAFile.byHand, questionColumnIndexes(question)) : importOfAFile.byHand;
  let questionsAnswered = importPlanWithByHand(importOfAFile).questions.filter(({ id }) => id === questionId);
  let columnsAnswered = [...importOfAFile.columnsAnswered, ...questionsAnswered.flatMap(questionColumnIndexes)];
  let withAnswer = {
    ...withStoodNotPointedAt(importOfAFile),
    answers,
    byHand,
    isAnAnswerInDoubt: false,
  };
  let refreshed = refreshImportPreview(
    {
      ...withAnswer,
      columnsAnswered,
    },
    reads,
    importOfAFile,
  );
  return withNoEffects({
    ...state,
    importOfAFile: refreshed,
  });
}
export function changeImportByHand(state: PageState, reads: WorkbookReads, change: ImportChangeByHand): PageTransition {
  let importOfAFile = state.importOfAFile;
  if (importOfAFile === null || isImportPlanComing(importOfAFile) || importOfAFile.agent.kind === 'isAsked') return withNoEffects(state);
  let optionOfReading =
    change.kind === 'column' && change.reading !== undefined && importOfAFile.asTheSheetHolds[change.columnIndex] === undefined
      ? questionOptionOfReading(importOfAFile.plan.questions, change.columnIndex, change.reading)
      : null;
  if (optionOfReading !== null) return answerImportQuestion(state, reads, optionOfReading.questionId, optionOfReading.optionIndex);
  let byHand = applyByHandChange(importOfAFile.byHand, change);
  if (
    (change.kind === 'line' || change.kind === 'headings') &&
    importRecordCount({
      ...importOfAFile,
      byHand,
    }) === 0 &&
    importRecordCount(importOfAFile) > 0
  )
    return withNoEffects(state);
  let isAnAnswerInDoubt = importOfAFile.isAnAnswerInDoubt && !('reading' in change);
  let nextImport = refreshImportPreview(
    {
      ...withStoodNotPointedAt(importOfAFile),
      byHand,
      isAnAnswerInDoubt,
    },
    reads,
    importOfAFile,
  );
  return withNoEffects({
    ...state,
    importOfAFile: dropDestinationIfSheetGone(nextImport, reads),
  });
}
export function loadImportColumnKinds(state: PageState, reads: WorkbookReads, columnIndex: number): PageTransition {
  let importOfAFile = state.importOfAFile;
  if (importOfAFile === null || importOfAFile.kinds[columnIndex] !== undefined) return withNoEffects(state);
  let mostOptions = reads.mostOptionsInADropdown();
  let plan = importPlanAsShown(importOfAFile);
  let readingsPlanned = [plan, planWithAnswers(importOfAFile.plan, importOfAFile.answers)].flatMap(
    ({ columns }) => columns[columnIndex]?.reading ?? [],
  );
  let fromAgent =
    importOfAFile.isPlanByAgent && importOfAFile.asTheSheetHolds[columnIndex] === undefined ? importOfAFile.readingsOfAgent[columnIndex] : undefined;
  let agentsPick = (readingsPlanned[1]?.kind === fromAgent?.kind ? readingsPlanned[1] : fromAgent) ?? null;
  let readingKinds = readingKindsOfColumn(importOfAFile.table, plan, columnIndex, readingsPlanned, agentsPick, reads, mostOptions);
  let kindsOfColumn = importDestinationOf(importOfAFile).kind === 'newSheet' ? readingKinds : readingKinds.map(withoutDecimalPlacesDigits);
  let kinds = {
    ...importOfAFile.kinds,
    [columnIndex]: kindsOfColumn,
  };
  return withNoEffects({
    ...state,
    importOfAFile: {
      ...importOfAFile,
      kinds,
    },
  });
}
export function importDestinationFor(importOfAFile: ImportOfAFile, chosen: ImportDestinationPick): ImportDestination | null {
  if (chosen.kind === 'newSheet') return NEW_SHEET_DESTINATION;
  let place = importPlacesLeft(importOfAFile).find(({ table }) => table.sheetId === chosen.sheetId);
  if (place === undefined) return null;
  let { destination: plannedDestination, destinationQuestion } = importOfAFile.plan;
  let destinationsOnSheet = [
    importDestinationOf(importOfAFile),
    plannedDestination,
    ...(destinationQuestion?.options ?? []).map((option) => option.destination),
  ].flatMap((destination) => (destination.kind === 'sheet' && destination.sheetId === chosen.sheetId ? [destination] : []));
  let { how } = chosen;
  let hasKeyColumn = (intoColumns: (ColumnId | null)[]) => how.kind !== 'mergeByKey' || (intoColumns[how.keyColumnIndex] ?? null) !== null;
  let intoColumns =
    (
      [
        ...destinationsOnSheet.slice(0, 1),
        ...destinationsOnSheet.filter((destination) => isSameJson(destination.how, how)),
        ...destinationsOnSheet,
      ].find((destination) => hasKeyColumn(destination.intoColumns)) ?? destinationsOnSheet[0]
    )?.intoColumns ?? matchHeadingsToColumns(fileHeadingsOf(importOfAFile.table, importPlanWithByHand(importOfAFile)), place.table.columns);
  if (!hasKeyColumn(intoColumns)) return null;
  let { sheetId, headerRowId } = place.table;
  return {
    kind: 'sheet',
    sheetId,
    headerRowId,
    intoColumns,
    how,
  };
}
export function chooseImportDestination(state: PageState, reads: WorkbookReads, choice: ImportDestinationPick): PageTransition {
  let importOfAFile = state.importOfAFile;
  if (importOfAFile === null || (importOfAFile.agent.kind === 'isAsked' && importOfAFile.agent.wish !== null)) return withNoEffects(state);
  let destination = importDestinationFor(importOfAFile, choice);
  if (destination === null) return withNoEffects(state);
  if (isSameJson(destination, importOfAFile.destinationChosen)) return withNoEffects(state);
  let nextImport = refreshImportPreview(
    {
      ...withStoodNotPointedAt(importOfAFile),
      destinationChosen: destination,
    },
    reads,
    importOfAFile,
  );
  return withNoEffects({
    ...state,
    importOfAFile: dropDestinationIfSheetGone(nextImport, reads),
  });
}
export function withImportPlacesGone(importOfAFile: ImportOfAFile, sheetIdsGone: SheetId[]): ImportOfAFile {
  let isOnSheetGone = (destination: ImportDestination | null) => destination?.kind === 'sheet' && sheetIdsGone.includes(destination.sheetId);
  let { plan } = importOfAFile;
  let isAskedAboutGone = plan.destinationQuestion?.options.some((option) => isOnSheetGone(option.destination));
  return {
    ...importOfAFile,
    placesGone: [...importOfAFile.placesGone, ...sheetIdsGone],
    destinationChosen: isOnSheetGone(importOfAFile.destinationChosen) ? null : importOfAFile.destinationChosen,
    plan:
      !isOnSheetGone(plan.destination) && isAskedAboutGone !== true
        ? plan
        : {
            ...plan,
            destination: isOnSheetGone(plan.destination) ? NEW_SHEET_DESTINATION : plan.destination,
            whyThere: isOnSheetGone(plan.destination) ? null : plan.whyThere,
            destinationQuestion: isAskedAboutGone === true ? null : plan.destinationQuestion,
          },
  };
}
export function dropDestinationIfSheetGone(importOfAFile: ImportOfAFile, reads: WorkbookReads): ImportOfAFile {
  let destination = importDestinationOf(importOfAFile);
  let { intoSheet } = importOfAFile;
  let isDestinationGone =
    intoSheet?.kind === 'refused' &&
    (intoSheet.refusal === 'unknownSheet' || intoSheet.refusal === 'unknownRow' || intoSheet.refusal === 'unknownColumn');
  return destination.kind === 'newSheet' || !isDestinationGone
    ? importOfAFile
    : refreshImportPreview(withImportPlacesGone(importOfAFile, [destination.sheetId]), reads, importOfAFile);
}
export function refreshImportNewSheet(importOfAFile: ImportOfAFile, reads: WorkbookReads): ImportOfAFile {
  if (importOfAFile.newSheet === null) return importOfAFile;
  let newSheet = newSheetForImport(importOfAFile, reads, importOfAFile.newSheet.filledCellCount);
  return isSameJson(newSheet, importOfAFile.newSheet)
    ? importOfAFile
    : {
        ...importOfAFile,
        newSheet,
      };
}
export function refreshImportOnWorkbookChange(state: PageState, reads: WorkbookReads): PageTransition {
  if (state.importOfAFile === null) return withNoEffects(state);
  let importOfAFile = refreshImportNewSheet(state.importOfAFile, reads);
  let stateWithImport =
    importOfAFile === state.importOfAFile
      ? state
      : {
          ...state,
          importOfAFile,
        };
  if (importOfAFile.places === null) return placeImportAndAskAgent(stateWithImport, importOfAFile, reads);
  if (importOfAFile.agent.kind === 'isAsked' && importOfAFile.agent.replyUnread !== null)
    return receiveImportAnswer(stateWithImport, reads, importOfAFile.agent.askId, importOfAFile.agent.replyUnread);
  let sheetIdsNow = new Set(reads.listSheets().map(({ sheetId }) => sheetId));
  let sheetIdsGone = importPlacesLeft(importOfAFile).flatMap(
    ({ table }) => (sheetIdsNow.has(table.sheetId) ? [] : [table.sheetId]),
  );
  if (sheetIdsGone.length === 0 && importDestinationOf(importOfAFile).kind === 'newSheet') return withNoEffects(stateWithImport);
  let nextImport = refreshImportPreview(withImportPlacesGone(importOfAFile, sheetIdsGone), reads, importOfAFile);
  return withNoEffects({
    ...stateWithImport,
    importOfAFile: dropDestinationIfSheetGone(nextImport, reads),
  });
}
export function sendImportWish(state: PageState, wish: string): PageTransition {
  let importOfAFile = state.importOfAFile;
  if (importOfAFile === null || wish.trim() === '') return withNoEffects(state);
  let mayAskAgent = importOfAFile.agent.kind !== 'isAsked' && importOfAFile.agent.kind !== 'isNotToBeHad';
  if (!importOfAFile.isPlanByAgent || !mayAskAgent) return withNoEffects(state);
  return askAgentAboutImport(state, importOfAFile, {
    asked: joinPrompts(
      askForImportPlan(importOfAFile.dataForAgent),
      askWithWish(
        planForAgent(importPlanWithByHand(importOfAFile), importOfAFile.answers, importOfAFile.places ?? [], importOfAFile.destinationChosen),
        wish.trim(),
        describeImportChoicesForAgent(importOfAFile),
      ),
    ),
    attempt: 1,
    wish: wish.trim(),
    isAskedAgain: false,
  });
}
export function askImportPlanAgain(state: PageState): PageTransition {
  let importOfAFile = state.importOfAFile;
  let isAskableAgain = importOfAFile?.agent.kind === 'hasFailed' || importOfAFile?.agent.kind === 'wasStopped';
  if (importOfAFile === null || !isAskableAgain || importOfAFile.isPlanByAgent) return withNoEffects(state);
  let asked = askForImportPlan(importOfAFile.dataForAgent);
  return askAgentAboutImport(state, importOfAFile, {
    asked,
    attempt: 1,
    wish: null,
    isAskedAgain: true,
  });
}
export const importPlanSoFar = (importOfAFile: ImportOfAFile): ImportPlanAsFarAsKnown =>
  importOfAFile.soFar === null
    ? {
        plan: importPlanAsShown(importOfAFile),
        preview: importOfAFile.preview,
        isTableFound: true,
        columnsReadCount: importOfAFile.plan.columns.length,
        summary: importOfAFile.isPlanByAgent ? (importPlanAsShown(importOfAFile).summary ?? null) : null,
        isSummaryWhole: true,
        isAwaited: false,
      }
    : {
        ...importOfAFile.soFar,
        isAwaited: true,
      };
export const NO_STOOD_CHANGES: ImportChangeStood[] = [];
export const NOTHING_STOOD: ImportStood = {
  stood: [],
  namesOfStood: {},
  isStoodPointedAt: false,
};
export const stoodByHandChanges = ({ agent }: Pick<ImportOfAFile, 'agent'>): ImportChangeStood[] =>
  (agent.kind === 'hasChangedNothing' || agent.kind === 'hasPlanned') && agent.isStoodPointedAt ? agent.stood : NO_STOOD_CHANGES;
export const withStoodNotPointedAt = (importOfAFile: ImportOfAFile): ImportOfAFile =>
  importOfAFile.agent.kind === 'hasChangedNothing' || importOfAFile.agent.kind === 'hasPlanned'
    ? {
        ...importOfAFile,
        agent: {
          ...importOfAFile.agent,
          isStoodPointedAt: false,
        },
      }
    : importOfAFile;
export const whyNoAgentForImport = ({ agent, isPlanByAgent }: Pick<ImportOfAFile, 'agent' | 'isPlanByAgent'>) =>
  !isPlanByAgent && agent.kind === 'isNotToBeHad' && agent.leftUndone === null ? agent.why : null;
export const wasQuestionAskedBefore = ({ plansOfAgent }: Pick<ImportOfAFile, 'plansOfAgent'>, { ask }: Pick<ImportQuestion, 'ask'>) =>
  plansOfAgent.some(({ questions }) => questions.some((question) => question.ask === ask));
export const isDestinationQuestionOpen = (importOfAFile: ImportOfAFile) =>
  importOfAFile.plan.destinationQuestion !== null && importOfAFile.destinationChosen === null;
export const openImportQuestionCount = (importOfAFile: ImportOfAFile) =>
  openImportQuestionIds(importOfAFile).length + (isDestinationQuestionOpen(importOfAFile) ? 1 : 0);
export const isImportPlanComing = ({ soFar }: Pick<ImportOfAFile, 'soFar'>) => soFar !== null;
export const describeImportChoicesForAgent = (importOfAFile: ImportOfAFile) =>
  [
    ...chosenAnswersOf(importPlanWithByHand(importOfAFile), importOfAFile.answers).map(
      ({ question: { ask, options }, chosenIndex }) =>
        `To "${ask}" they answered "${options[chosenIndex]?.label ?? ''}".`,
    ),
    ...(importOfAFile.destinationChosen === null ? [] : ['They chose the destination in that plan themselves.']),
  ].join(' ');
export const importQuestionExamples = (importOfAFile: ImportOfAFile, questionId: string): ImportQuestionExample[][] =>
  importOfAFile.examples[importOfAFile.plan.questions.findIndex(({ id }) => id === questionId)] ?? [];
