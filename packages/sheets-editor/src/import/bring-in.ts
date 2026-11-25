import { isSameSelection } from '../selection/model.ts';
import { withNoEffects } from '../state/transitions.ts';
import type { PageTransition } from '../state/transitions.ts';
import { dropdownOptionsForImport, importPlanAsShown, destinationWithColumnsLeftOut, importDestinationOf, importPlacesLeft } from './import-flow.ts';
import { tableImportRequest } from './places.ts';
import { isImportPlanComing, importPlanSoFar, stopAwaitingImportPlan } from './import-review.ts';
import { MAX_PREVIEW_COLUMNS } from './preview.ts';
import { dataLineNumbers, importColumnTexts, readingFittingTexts, trueOrFalseTextOf } from './column-readings.ts';
import type { ImportLineChoice } from './column-readings.ts';
import { importedSheetLook } from './file-awaited.ts';
import { isDefaultSheetName } from '../grid/layout.ts';
import { queueEdit, IF_QUEUED_PLACE_CHANGED } from '../model/edit-effects.ts';
import { importMarksToCome } from './marks-of-import.ts';
import { changesByHand, columnsLeftOutByHand } from './by-hand.ts';
import { blankColumnsOf } from './blank-columns.ts';
import type { ColumnToImport, Edit, SheetId } from '@open-artifact/sheets-core';
import type {
  ImportOfAFile,
  ImportPlan,
  PageState,
  TableImportedAsNewSheetOffer,
  TableImportedIntoSheetOffer,
} from '../state/initial-state.ts';
import type { ImportReading, PageEvent, PlaceAreaChanged } from '../state/event-reducer.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { LinesAndColumnsUnfolded } from './import-picture.tsx';
/** How much of a new sheet to come is drawn: the records drawn at most, and the lines and columns drawn or left out besides. */
export interface ImportDrawing {
  mostRecords: number;
  linesDrawnAnyway: number[];
  columnsOut: number[];
}
export type ImportAsNewSheetEdit = Extract<Edit, { kind: 'importTableAsNewSheet' }>;
export type ImportTableEdit = Extract<Edit, { kind: 'importTableIntoSheet' }> | ImportAsNewSheetEdit;
export function narrowImportedArea(edit: Edit, selection: PlaceAreaChanged | null, reads: WorkbookReads): PlaceAreaChanged | null {
  if (edit.kind !== 'importTableIntoSheet' || selection === null || selection.area === null) return selection;
  let columnIndexes = edit.table.columns.flatMap(
    (column) => (column === null ? [] : (reads.columnIndexOf(selection.sheetId, column.column) ?? [])),
  );
  if (columnIndexes.length === 0) return selection;
  let firstColumnIndex = Math.min(...columnIndexes);
  let importedColumnCount = Math.max(...columnIndexes) - firstColumnIndex + 1;
  let hasImportShownInRow = (rowIndex: number) =>
    reads
      .columnIndexesOnShowIn(selection.sheetId, rowIndex)
      .some((columnIndex) => columnIndex >= firstColumnIndex && columnIndex < firstColumnIndex + importedColumnCount);
  let { topRowIndex } = selection.area;
  let { rowCount } = selection.area;
  while (rowCount > 1 && !hasImportShownInRow(topRowIndex + rowCount - 1)) rowCount -= 1;
  return {
    ...selection,
    area: {
      ...selection.area,
      leftColumnIndex: firstColumnIndex,
      columnCount: importedColumnCount,
      rowCount,
    },
  };
}
export function updateSelectionJustImported(stateBefore: PageState, stateAfter: PageState, event: PageEvent): PageState {
  let isEditQueued = event.kind === 'editAnswered' && event.outcome.kind === 'editQueued' && event.edit.kind === 'importTableAsNewSheet';
  let isSelectionUnmoved =
    stateBefore.isSelectionJustImported &&
    isSameSelection(stateBefore, stateAfter) &&
    stateBefore.scrollTop === stateAfter.scrollTop &&
    stateBefore.scrollLeft === stateAfter.scrollLeft;
  let isJustImported = isEditQueued || isSelectionUnmoved;
  return isJustImported === stateAfter.isSelectionJustImported
    ? stateAfter
    : {
        ...stateAfter,
        isSelectionJustImported: isJustImported,
      };
}
export function discardImport(state: PageState) {
  let hadImport = state.importOfAFile !== null;
  return closeImportOfAFile(
    hadImport
      ? {
          ...state,
          lastDone: {
            what: 'importDiscarded',
          },
        }
      : state,
  );
}
export function escapeImport(state: PageState, isWishTyped: boolean) {
  let importOfAFile = state.importOfAFile;
  return importOfAFile !== null && (isWishTyped || hasImportWorkToLose(importOfAFile))
    ? withNoEffects({
        ...state,
        importOfAFile: {
          ...importOfAFile,
          isDiscardAsked: true,
        },
      })
    : discardImport(state);
}
export function keepImport(state: PageState) {
  let importOfAFile = state.importOfAFile;
  return withNoEffects(
    importOfAFile === null
      ? state
      : {
          ...state,
          importOfAFile: {
            ...importOfAFile,
            isDiscardAsked: false,
          },
        },
  );
}
export function columnImportOfReading(
  reading: ImportReading,
  texts: string[],
  reads: Pick<WorkbookReads, 'labelsOfADropdownColumn'>,
): ColumnToImport {
  if (reading.kind === 'trueOrFalse')
    return {
      kind: 'asTyped',
    };
  if (reading.kind !== 'dropdown')
    return {
      kind: 'read',
      reading,
    };
  let [firstLabel, ...otherLabels] = dropdownOptionsForImport(reading, reads.labelsOfADropdownColumn(texts) ?? []);
  return firstLabel === undefined
    ? {
        kind: 'read',
        reading: {
          kind: 'text',
        },
      }
    : {
        kind: 'dropdown',
        options: [firstLabel, ...otherLabels],
      };
}
export function importEditOfPlan(importOfAFile: ImportOfAFile, afterSheet: SheetId | null, reads: WorkbookReads): ImportTableEdit {
  let { table } = importOfAFile;
  let plan = importPlanAsShown(importOfAFile);
  let destination = destinationWithColumnsLeftOut(importOfAFile);
  if (destination.kind === 'sheet')
    return {
      kind: 'importTableIntoSheet',
      table: tableImportRequest(destination, table, plan),
    };
  return newSheetImportEdit(importOfAFile, plan, afterSheet, reads, null);
}
export function importPreviewOnGrid(
  importOfAFile: ImportOfAFile,
  reads: WorkbookReads,
  mostRecords: number,
  drawnAnyway: LinesAndColumnsUnfolded = NOTHING_DRAWN_ANYWAY,
  columnsAsText: number | null = null,
) {
  if (importDestinationOf(importOfAFile).kind !== 'newSheet' && !isImportPlanComing(importOfAFile)) return null;
  let plan = withColumnsAsTextFrom(withLinesDrawnAnyway(importPlanSoFar(importOfAFile).plan, drawnAnyway), columnsAsText);
  return newSheetImportEdit(importOfAFile, plan, null, reads, {
    mostRecords,
    linesDrawnAnyway: drawnAnyway.lines,
    columnsOut: importColumnsOutOfDrawing(importOfAFile, drawnAnyway),
  });
}
export function importColumnsOverLimit(importOfAFile: ImportOfAFile) {
  let { plan } = importPlanSoFar(importOfAFile);
  let columnIndexes = new Set(importColumnsLeftOut(importOfAFile, plan));
  return plan.columns.flatMap(
    (column, index) => (index >= MAX_PREVIEW_COLUMNS && !columnIndexes.has(index) ? [index] : []),
  );
}
export function importDrawnPositions(importOfAFile: ImportOfAFile, drawnAnyway: LinesAndColumnsUnfolded, mostRecords: number) {
  let lines = withLinesDrawnAnyway(importPlanSoFar(importOfAFile).plan, drawnAnyway);
  let dataLines = drawnAnyway.lines.length === 0 ? [] : dataLineNumbers(importOfAFile.table, lines);
  let linesDrawn = recordIndexesToDraw(dataLines, mostRecords, drawnAnyway.lines).map((recordIndex) => dataLines[recordIndex]);
  let columnsOut = importColumnsOutOfDrawing(importOfAFile, drawnAnyway);
  return {
    rowNumbers: drawnAnyway.lines.flatMap((line) => {
      let recordIndex = linesDrawn.indexOf(line);
      return recordIndex < 0 ? [] : [recordIndex + 2];
    }),
    columnsDrawn: drawnAnyway.columns.map(
      (column) => column - columnsOut.filter((columnOut) => columnOut < column).length,
    ),
  };
}
export function importMergeKeyColumn(importOfAFile: Pick<ImportOfAFile, 'plan' | 'destinationChosen'>) {
  let destination = importDestinationOf(importOfAFile);
  return destination.kind === 'sheet' && destination.how.kind === 'mergeByKey' ? destination.how.keyColumnIndex : null;
}
export function newSheetImportEdit(
  importOfAFile: ImportOfAFile,
  plan: ImportPlan,
  afterSheet: SheetId | null,
  reads: WorkbookReads,
  drawing: ImportDrawing | null,
): ImportAsNewSheetEdit {
  let { table } = importOfAFile;
  let lineNumbers = dataLineNumbers(table, plan);
  let columns = plan.columns.map(({ reading }, index) => {
    let texts = importColumnTexts(table, lineNumbers, index);
    let fittingReading = readingFittingTexts(reading, texts);
    return {
      toImport: columnImportOfReading(fittingReading, texts, reads),
      texts:
        fittingReading.kind === 'trueOrFalse'
          ? texts.map((text) => trueOrFalseTextOf(text) ?? '')
          : texts,
    };
  });
  let columnsLeftOut = new Set(drawing?.columnsOut ?? importColumnsLeftOut(importOfAFile, plan));
  let recordsDrawn =
    drawing === null
      ? lineNumbers.map((lineNumber, index) => index)
      : recordIndexesToDraw(lineNumbers, drawing.mostRecords, drawing.linesDrawnAnyway);
  let withoutColumnsLeftOut = <Item>(items: Item[]) => items.filter((item, index) => !columnsLeftOut.has(index));
  let headerNames = withoutColumnsLeftOut(plan.columns).map(({ name }) => name);
  return {
    kind: 'importTableAsNewSheet',
    afterSheet,
    name: plan.sheetName,
    rows: [headerNames, ...recordsDrawn.map((recordIndex) => withoutColumnsLeftOut(columns).map(({ texts }) => texts[recordIndex] ?? ''))],
    headerRows: 1,
    columns: withoutColumnsLeftOut(columns).map(({ toImport }) => toImport),
    look: importedSheetLook(headerNames),
  };
}
export function importUndoOffer(importOfAFile: ImportOfAFile): TableImportedAsNewSheetOffer | TableImportedIntoSheetOffer | null {
  let destination = importDestinationOf(importOfAFile);
  let { intoSheet } = importOfAFile;
  if (destination.kind === 'newSheet') {
    let plan = importPlanAsShown(importOfAFile);
    return {
      kind: 'tableImportedAsNewSheet',
      sheetName: importOfAFile.newSheet?.name ?? plan.sheetName,
      rowCount: dataLineNumbers(importOfAFile.table, plan).length,
      isSaved: false,
    };
  }
  if (intoSheet?.kind !== 'changes') return null;
  let place = importPlacesLeft(importOfAFile).find(({ table }) => table.sheetId === destination.sheetId);
  let { isReplaced, addedCount, changedCount } = intoSheet;
  return {
    kind: 'tableImportedIntoSheet',
    sheetName: place?.table.name ?? '',
    isReplaced,
    addedCount,
    changedCount,
    isSaved: false,
  };
}
export function isWorkbookOneUntouchedSheet(reads: WorkbookReads, stem: string) {
  let [firstSheet, ...otherSheets] = reads.listSheets();
  return firstSheet !== undefined && otherSheets.length === 0 && reads.isSheetAsNew(firstSheet.sheetId) && isDefaultSheetName(firstSheet.name, stem);
}
export function confirmImport(state: PageState, reads: WorkbookReads, plansHeardCount: number) {
  let importOfAFile = state.importOfAFile;
  if (importOfAFile === null) return withNoEffects(state);
  if (isImportPlanComing(importOfAFile)) return withNoEffects(state);
  if (plansHeardCount !== importOfAFile.plansHeardCount) return withNoEffects(state);
  if (importOfAFile.agent.kind === 'isAsked') return stopAwaitingImportPlan(state);
  if (importDestinationOf(importOfAFile).kind === 'sheet' && importOfAFile.intoSheet?.kind !== 'changes') return withNoEffects(state);
  if (importOfAFile.newSheet?.hasRoom === false) return withNoEffects(state);
  if (importRecordCount(importOfAFile) === 0) return withNoEffects(state);
  let afterSheet = isWorkbookOneUntouchedSheet(reads, importOfAFile.words.stemOfNewSheetNames) ? null : state.sheetId;
  let edit = importEditOfPlan(importOfAFile, afterSheet, reads);
  return withStopImportAskEffect(
    state,
    queueEdit(
      {
        ...state,
        importOfAFile: null,
        marksOfImportToCome: importMarksToCome(edit, reads),
      },
      edit,
      {
        ...IF_QUEUED_PLACE_CHANGED,
        ...(edit.kind === 'importTableIntoSheet' && {
          isPlaceOnlyShown: true,
        }),
        undoOffer: importUndoOffer(importOfAFile),
      },
    ),
  );
}
export const withStopImportAskEffect = (state: PageState, transition: PageTransition): PageTransition =>
  state.importOfAFile?.agent.kind === 'isAsked'
    ? {
        ...transition,
        effects: [
          {
            kind: 'stopAskingAgentAboutImport',
          },
          ...transition.effects,
        ],
      }
    : transition;
export const closeImportOfAFile = (state: PageState) =>
  withStopImportAskEffect(
    state,
    withNoEffects({
      ...state,
      importOfAFile: null,
      fileAwaited: null,
    }),
  );
export const hasImportWorkToLose = (importOfAFile: ImportOfAFile) =>
  changesByHand(importOfAFile.plan, importOfAFile.byHand).length > 0 ||
  Object.values(importOfAFile.byHand.columns).some(({ isLeftOut }) => isLeftOut !== undefined) ||
  Object.keys(importOfAFile.answers).length > 0 ||
  importOfAFile.destinationChosen !== null ||
  importOfAFile.plansOfAgent.length > 1 ||
  ((importOfAFile.agent.kind === 'isAsked' || importOfAFile.agent.kind === 'hasFailed') && importOfAFile.agent.wish !== null);
export const withColumnsAsTextFrom = (plan: ImportPlan, columnsAsText: number | null): ImportPlan =>
  columnsAsText === null
    ? plan
    : {
        ...plan,
        columns: plan.columns.map(
          (column, index) =>
            index < columnsAsText
              ? column
              : {
                  ...column,
                  reading: {
                    kind: 'text',
                  },
                },
        ),
      };
export const NOTHING_DRAWN_ANYWAY: LinesAndColumnsUnfolded = {
  lines: [],
  columns: [],
};
export const withLinesDrawnAnyway = (plan: ImportPlan, { lines }: LinesAndColumnsUnfolded): ImportPlan =>
  lines.length === 0
    ? plan
    : {
        ...plan,
        linesLeftOut: plan.linesLeftOut.filter((line) => !lines.includes(line)),
      };
export const importColumnsOutOfDrawing = (importOfAFile: ImportOfAFile, { columns }: LinesAndColumnsUnfolded) =>
  [...importColumnsLeftOut(importOfAFile, importPlanSoFar(importOfAFile).plan), ...importColumnsOverLimit(importOfAFile)]
    .filter((columnIndex) => !columns.includes(columnIndex))
    .toSorted((columnIndex, otherIndex) => columnIndex - otherIndex);
export const recordIndexesToDraw = (records: number[], mostRecords: number, drawnAnyway: number[]) =>
  records.flatMap((record, index) => (index < mostRecords || drawnAnyway.includes(record) ? [index] : []));
export const importColumnsLeftOut = (importOfAFile: ImportOfAFile, plan: ImportLineChoice) =>
  [...new Set([...columnsLeftOutByHand(importOfAFile.byHand), ...blankColumnsLeftOutOnGrid(importOfAFile, plan)])].filter(
    (columnIndex) => columnIndex !== importMergeKeyColumn(importOfAFile),
  );
export const blankColumnsLeftOutOnGrid = (importOfAFile: ImportOfAFile, plan: ImportLineChoice) =>
  importDestinationOf(importOfAFile).kind === 'newSheet'
    ? blankColumnsOf(importOfAFile.table, plan).filter((columnIndex) => importOfAFile.byHand.columns[columnIndex]?.isLeftOut !== false)
    : [];
export const importRecordCount = (importOfAFile: ImportOfAFile) =>
  dataLineNumbers(importOfAFile.table, importPlanSoFar(importOfAFile).plan).length;
