import { importDestinationOf, withByHandNamesOnly, importPlanOf } from './import-flow.ts';
import { isImportPlanComing, importPlanSoFar, openImportQuestionIds, columnsQuestionDecides, importQuestionExamples } from './import-review.ts';
import { importColumnsLeftOut, blankColumnsLeftOutOnGrid } from './bring-in.ts';
import { MAX_TEXTS_RECHECKED } from './reading-kinds.ts';
import { isLargeImportFile } from './places.ts';
import type { ImportIntoSheetChanges, ImportOfAFile, ImportReadingKind } from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
/** Whether the import changes a sheet there is, or makes a sheet to come. */
export type ImportDestinationSort = 'changesToASheet' | 'sheetToCome';
/** A question of the plan about columns that come in, as the settings show it. */
export interface ImportColumnQuestion {
  questionId: string;
  names: string[];
  columns: number[];
  isOpen: boolean;
  about: 'date' | 'number' | 'other';
  example: string | null;
}
/** What the settings of an import ask the person to look at. */
export interface ImportSettingsToCheck {
  questions: ImportColumnQuestion[];
  columns: number[];
  textColumnsYetToLookInto: number[];
  columnsLeftOut: number[];
  columnsThatAreEmpty: number[];
  linesLeftOut: number[];
}
export function importDestinationSort(open: ImportOfAFile): ImportDestinationSort {
  if (importDestinationOf(open).kind === 'sheet' && !isImportPlanComing(open) && open.intoSheet !== null) return 'changesToASheet';
  return !isImportPlanComing(open) && open.newSheet?.hasRoom === false ? 'changesToASheet' : 'sheetToCome';
}
export function importColumnsComingInCount(open: ImportOfAFile) {
  let { plan } = importPlanSoFar(open);
  let leftOutCount = importColumnsLeftOut(open, plan).length + columnsLeftOutOfSheetChanges(open).length;
  return plan.columns.length - leftOutCount;
}
export function openColumnQuestions(open: ImportOfAFile): ImportColumnQuestion[] {
  let { plan } = importPlanSoFar(open);
  let openQuestionIds = new Set(openImportQuestionIds(open));
  let columnsLeftOut = new Set(importColumnsLeftOut(open, plan));
  return plan.questions.flatMap(({ id, options }): ImportColumnQuestion[] => {
    let columns = columnsQuestionDecides({
      options,
    }).filter((columnIndex) => !columnsLeftOut.has(columnIndex));
    if (columns.length === 0) return [];
    let readingKinds = new Set(
      options
        .flatMap(({ readings }) => readings)
        .filter(({ columnIndex, reading }) => columns.includes(columnIndex) && reading.kind !== 'text')
        .map(({ reading }) => reading.kind),
    );
    let isAllOf = (...kinds: ImportReading['kind'][]) =>
      readingKinds.size > 0 && [...readingKinds].every((kind) => kinds.includes(kind));
    return [
      {
        questionId: id,
        names: columns.map((columnIndex) => plan.columns[columnIndex]?.name ?? ''),
        columns,
        isOpen: openQuestionIds.has(id),
        about: isAllOf('date', 'dateAndTime') ? 'date' : isAllOf('number', 'currency', 'percent') ? 'number' : 'other',
        example: importQuestionExamples(open, id)[0]?.[0]?.text ?? null,
      },
    ];
  });
}
/** A reading worth offering for a column read as text, if one fits most of its fields. */
export function betterReadingForTextColumn(kinds: ImportReadingKind[] | undefined): ImportReadingKind | null {
  if (kinds === undefined) return null;
  if (kinds.some(({ reading, digits }) => reading.kind === 'text' && digits.length > 0)) return null;
  let numberFitting = kinds.find(({ reading }) => reading.kind === 'number')?.fitting ?? 0;
  let [best] = kinds
    .filter(({ reading: { kind }, fitting, notFitting }) => {
      let fitRatio = kind === 'number' ? OFFER_FIT_RATIO_NUMBER : OFFER_FIT_RATIO_OTHER;
      let fittingBeyondNumber = isPercentOrCurrency(kind) ? fitting - numberFitting : fitting;
      return (
        READINGS_WORTH_OFFERING.has(kind) &&
        ((kind !== 'number' && !isPercentOrCurrency(kind)) || fitting + notFitting <= MAX_TEXTS_RECHECKED) &&
        fittingBeyondNumber >= 2 &&
        notFitting > 0 &&
        fittingBeyondNumber * fitRatio >= fitting + notFitting
      );
    })
    .toSorted((first, second) => second.fitting - first.fitting);
  return best ?? null;
}
export function importSettingsToCheck(open: ImportOfAFile): ImportSettingsToCheck {
  let withNamesOnly = withByHandNamesOnly(open);
  let planWithNamesOnly = importPlanOf(withNamesOnly);
  let plan = importPlanSoFar(open).plan;
  let columnsLeftOut = new Set(importColumnsLeftOut(open, plan));
  let questions = openColumnQuestions(open);
  let columnsInQuestions = new Set(
    planWithNamesOnly.questions.flatMap((question) => columnsQuestionDecides(question)),
  );
  let columnsThatAreEmpty = blankColumnsLeftOutOnGrid(withNamesOnly, planWithNamesOnly);
  let columnsKeptAsText = new Set(
    importPlanSoFar(open).preview.columns.flatMap(
      ({ columnIndex, keptAsTextCount }) => (keptAsTextCount > 0 ? [columnIndex] : []),
    ),
  );
  let textColumns = importPlanSoFar(open).preview.columns.flatMap(
    ({ columnIndex, reading }) =>
      reading.kind === 'text' && !columnsLeftOut.has(columnIndex) ? [columnIndex] : [],
  );
  let textColumnsWithBetterReading = new Set(
    textColumns.filter(
      (columnIndex) =>
        open.byHand.columns[columnIndex]?.reading === undefined && betterReadingForTextColumn(open.kinds[columnIndex]) !== null,
    ),
  );
  let isChangesToASheet = importDestinationSort(open) === 'changesToASheet';
  let linesLeftOut = plan.linesLeftOut.filter((line) => line > (plan.headerLine ?? 0));
  let columnsLeftOutSorted = [...columnsLeftOut].toSorted((first, second) => first - second);
  return {
    questions,
    columns: planWithNamesOnly.columns.flatMap(
      (column, columnIndex) =>
        (columnsInQuestions.has(columnIndex) ||
          columnsKeptAsText.has(columnIndex) ||
          textColumnsWithBetterReading.has(columnIndex) ||
          (isChangesToASheet && open.byHand.columns[columnIndex]?.isLeftOut === false)) &&
        !columnsLeftOut.has(columnIndex)
          ? [columnIndex]
          : [],
    ),
    textColumnsYetToLookInto: isLargeImportFile(open.table)
      ? []
      : textColumns.filter((columnIndex) => open.kinds[columnIndex] === undefined),
    columnsLeftOut: columnsLeftOutSorted,
    columnsThatAreEmpty,
    linesLeftOut,
  };
}
export const columnsLeftOutOfSheetChanges = (open: ImportOfAFile): ImportIntoSheetChanges['columnsLeftOut'] =>
  importDestinationOf(open).kind === 'sheet' && open.intoSheet?.kind === 'changes' ? open.intoSheet.columnsLeftOut : [];
export const questionsNotAboutColumns = (questions: ImportColumnQuestion[], columnIndexes: number[]) =>
  questions.filter(
    ({ columns }) => !columns.some((columnIndex) => columnIndexes.includes(columnIndex)),
  );
export const READINGS_WORTH_OFFERING = new Set<ImportReading['kind']>(['number', 'currency', 'percent', 'date', 'dateAndTime', 'timeOfDay']);
export const OFFER_FIT_RATIO_OTHER = 4;
export const OFFER_FIT_RATIO_NUMBER = 2;
export const isPercentOrCurrency = (kind: ImportReading['kind']) => kind === 'percent' || kind === 'currency';
