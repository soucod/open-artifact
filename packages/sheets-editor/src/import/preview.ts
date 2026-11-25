import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import {
  trueOrFalseTextOf,
  readingFittingTexts,
  dataLineNumbers,
  isSameJson,
  importColumnTexts,
  fitOfReading,
  questionColumnIndexes,
} from './column-readings.ts';
import { parseBooleanText } from '../model/cell-text.ts';
import { truncateToCleanText } from './import-basics.ts';
import type { Color, NumberFormatIn, ReadInput } from '@open-artifact/sheets-core';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ImportFile, ImportPlanSoFar, ImportPreview, ImportPreviewCell, ImportPreviewColumn, ImportQuestion, ImportQuestionExample } from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
import type { ImportLineChoice } from './column-readings.ts';
/** A text of the file as a reading would put it in a cell, and what the cell would hold. */
export interface ImportPreviewCellRead {
  cell: ImportPreviewCell;
  /** What the cell holds: the value read, the text kept, the cell itself for true or false, nothing when blank. */
  held: ImportPreviewCell | ReadInput | string | null;
  hasAFormatOfItsOwn: boolean;
}
/** The options of a dropdown made for labels, with their colors. */
export type DropdownOptionsOfLabels = (labels: string[]) => { label: string; color: Color }[];
/** The lines a plan reads from the file and how it reads each column. */
export type ImportTablePlan = ImportLineChoice & Pick<ImportPlanSoFar['plan'], 'columns'>;
/** The cells of one column under each option of a question. */
interface ExamplesOfColumn {
  texts: string[];
  underEach: ImportPreviewCellRead[][];
  differsIn(key: 'held' | 'cell', index: number): boolean;
}
export function previewCellOfValue(value: ReadInput, numberFormat: NumberFormatIn | null, reads: WorkbookReads): ImportPreviewCell {
  if (value.kind === 'number') {
    let pattern = (numberFormat ?? DEFAULT_CELL_FORMAT.numberFormat).pattern;
    return {
      kind: 'number',
      shown: reads.shownWithRoomForAll(value, pattern) ?? '',
    };
  }
  return {
    kind: 'text',
    shown: value.kind === 'text' ? value.value : '',
  };
}
export function previewCellsUnderReading(reading: ImportReading, texts: string[], reads: WorkbookReads): ImportPreviewCellRead[] {
  if (reading.kind === 'trueOrFalse')
    return texts.map((text) => {
      let trueOrFalseText = trueOrFalseTextOf(text) ?? '';
      let shownCell: ImportPreviewCell =
        parseBooleanText(trueOrFalseText) === null
          ? {
              kind: 'keptAsText',
              shown: text,
            }
          : {
              kind: 'trueOrFalse',
              shown: trueOrFalseText,
            };
      let cell: ImportPreviewCell =
        trueOrFalseText === ''
          ? {
              kind: 'blank',
            }
          : shownCell;
      return {
        cell,
        held: cell,
        hasAFormatOfItsOwn: false,
      };
    });
  let read = reads.textsUnderAColumnReading(reading, texts);
  return texts.map((text, index): ImportPreviewCellRead => {
    let readText = read?.read[index];
    if (readText?.kind === 'blank')
      return {
        cell: {
          kind: 'blank',
        },
        held: null,
        hasAFormatOfItsOwn: false,
      };
    if (readText?.kind === 'fits') {
      let numberFormat = readText.numberFormat ?? read?.numberFormat ?? null;
      return {
        cell: previewCellOfValue(readText.input, numberFormat, reads),
        held: readText.input,
        hasAFormatOfItsOwn: readText.numberFormat !== null,
      };
    }
    return {
      cell: {
        kind: 'keptAsText',
        shown: text,
      },
      held: text,
      hasAFormatOfItsOwn: false,
    };
  });
}
/** A short example of a value the reading makes of the texts, if it reads any. */
export function exampleOfReading(reading: ImportReading, texts: string[], reads: WorkbookReads): string | null {
  let sampleTexts: string[] = [];
  for (let text of texts) if (text.trim() !== '' && sampleTexts.push(text) === EXAMPLE_TEXTS_TRIED) break;
  let example = previewCellsOf(readingFittingTexts(reading, texts), sampleTexts, reads).find(
    (cell): cell is Exclude<ImportPreviewCell, { kind: 'blank' }> => cell.kind !== 'blank' && cell.kind !== 'keptAsText',
  );
  return example === undefined
    ? null
    : shortenInMiddle(truncateToCleanText(example.shown, example.shown.length), EXAMPLE_MAX_GRAPHEMES, EXAMPLE_TAIL_GRAPHEMES);
}
export function shortenInMiddle(text: string, maxLength: number, tailLength: number) {
  let graphemes =
    'Segmenter' in Intl
      ? Array.from(
          new Intl.Segmenter(undefined, {
            granularity: 'grapheme',
          }).segment(text),
          ({ segment }) => segment,
        )
      : Array.from(text);
  if (graphemes.length <= maxLength) return text;
  return `${graphemes
    .slice(0, maxLength - tailLength - 1)
    .join('')
    .trimEnd()}…${graphemes.slice(-tailLength).join('')}`;
}
export function shortenImportLabel(text: string) {
  let clipped =
    text.length <= LABEL_MAX_GRAPHEMES * 8 ? text : text.slice(0, LABEL_MAX_GRAPHEMES * 4) + text.slice(-LABEL_TAIL_GRAPHEMES * 4);
  return shortenInMiddle(truncateToCleanText(clipped, clipped.length), LABEL_MAX_GRAPHEMES, LABEL_TAIL_GRAPHEMES);
}
export function withDropdownOptionCells(
  cells: ImportPreviewCell[],
  texts: string[],
  reads: WorkbookReads,
  colorsOf: DropdownOptionsOfLabels,
): ImportPreviewCell[] {
  let labels = reads.labelsOfADropdownColumn(texts) ?? [];
  let options = colorsOf(labels);
  return cells.map((cell): ImportPreviewCell => {
    if (cell.kind !== 'text') return cell;
    let labelsAfterCell = (reads.labelsOfADropdownColumn([cell.shown, ...labels]) ?? []).slice(1);
    let option = options[labels.findIndex((label, index) => labelsAfterCell[index] !== label)];
    return option === undefined
      ? cell
      : {
          kind: 'option',
          shown: option.label,
          color: option.color,
        };
  });
}
export function previewImportColumns(
  file: ImportFile,
  plan: ImportTablePlan,
  reads: WorkbookReads,
  previous: Pick<ImportPlanSoFar, 'plan' | 'preview'> | null,
  colorsOf: (reading: Extract<ImportReading, { kind: 'dropdown' }>, labels: string[]) => ReturnType<DropdownOptionsOfLabels>,
): ImportPreview {
  let records = dataLineNumbers(file, plan);
  const isSameLines =
    previous !== null && previous.plan.headerLine === plan.headerLine && isSameJson(previous.plan.linesLeftOut, plan.linesLeftOut);
  let columns = plan.columns
    .slice(0, MAX_PREVIEW_COLUMNS)
    .map(({ name, reading }, columnIndex): ImportPreviewColumn => {
      let previousColumn = isSameLines ? previous.preview.columns[columnIndex] : undefined;
      if (previousColumn !== undefined && isSameJson(previousColumn.reading, reading)) {
        let { reading: previousReading } = previousColumn;
        let { cells, keptAsTextCount, optionCount } = previousColumn;
        return previousColumn.name === name
          ? previousColumn
          : {
              columnIndex,
              name,
              reading: previousReading,
              cells,
              keptAsTextCount,
              optionCount,
            };
      }
      let texts = importColumnTexts(file, records, columnIndex);
      const fittingReading = readingFittingTexts(reading, texts);
      let fit = fitOfReading(fittingReading, texts, reads);
      let previewCells = previewCellsOf(fittingReading, texts.slice(0, PREVIEW_ROW_COUNT), reads);
      return {
        columnIndex,
        name,
        reading: fittingReading,
        cells:
          fittingReading.kind === 'dropdown'
            ? withDropdownOptionCells(previewCells, texts, reads, (labels) => colorsOf(fittingReading, labels))
            : previewCells,
        keptAsTextCount: fit?.notFitting ?? 0,
        optionCount: fit?.options ?? null,
      };
    });
  let linesIn = new Set(plan.headerLine === null ? records : [plan.headerLine, ...records]);
  let linesLeftOut = file.lines.flatMap(
    (line, index) =>
      !linesIn.has(index + 1) && line.some((cell) => cell.trim() !== '') ? [index + 1] : [],
  );
  return {
    columns,
    columnCount: plan.columns.length,
    linesOfFirstRows: records.slice(0, PREVIEW_ROW_COUNT),
    rowCount: records.length,
    lineLeftOutCount: linesLeftOut.length,
    linesLeftOut: linesLeftOut.slice(0, MAX_LINES_LEFT_OUT_LISTED),
  };
}
/** Examples of texts of the file and what each option of a question makes of them, by option. */
export function examplesOfQuestion(file: ImportFile, plan: ImportTablePlan, question: ImportQuestion, reads: WorkbookReads): ImportQuestionExample[][] {
  let records = dataLineNumbers(file, plan);
  let examplesOfColumn = (columnIndex: number): ExamplesOfColumn => {
    let columnTexts = importColumnTexts(file, records, columnIndex);
    let sampledTexts = [
      ...new Set(columnTexts.slice(0, QUESTION_TEXTS_SAMPLED).filter((text) => text.trim() !== '')),
    ];
    let underEachOption = question.options.map(({ readings }) => {
      let reading: ImportReading = readings.find((optionReading) => optionReading.columnIndex === columnIndex)?.reading ??
        plan.columns[columnIndex]?.reading ?? {
          kind: 'text',
        };
      return previewCellsUnderReading(readingFittingTexts(reading, columnTexts), sampledTexts, reads);
    });
    return {
      texts: sampledTexts,
      underEach: underEachOption,
      differsIn: (key, index) =>
        underEachOption.some((cells) => !isSameJson(cells[index]?.[key], underEachOption[0]?.[index]?.[key])),
    };
  };
  let chosen: ExamplesOfColumn | undefined;
  for (let columnIndex of questionColumnIndexes(question).slice(0, QUESTION_COLUMNS_TRIED)) {
    let columnExamples = examplesOfColumn(columnIndex);
    chosen ??= columnExamples;
    if (columnExamples.texts.some((text, index) => columnExamples.differsIn('held', index))) {
      chosen = columnExamples;
      break;
    }
  }
  if (chosen === undefined) return question.options.map(() => []);
  let { texts, underEach, differsIn } = chosen;
  let distinctHeldCount = (index: number) =>
    new Set(underEach.map((cells) => JSON.stringify(cells[index]?.held))).size;
  let ranks = texts.map(
    (text, index) => (differsIn('held', index) ? -distinctHeldCount(index) : differsIn('cell', index) ? 0 : 1),
  );
  let shownIndexes = texts
    .map((text, index) => index)
    .toSorted((a, b) => (ranks[a] ?? 0) - (ranks[b] ?? 0))
    .slice(0, QUESTION_EXAMPLES_SHOWN);
  return underEach.map(
    (cells) =>
      shownIndexes.map((index) => {
        const cell = cells[index]?.cell;
        const isRead = cell !== undefined && cell.kind !== 'blank' && cell.kind !== 'keptAsText';
        return {
          text: truncateToCleanText(texts[index] ?? '', QUESTION_EXAMPLE_LENGTH),
          becomes: isRead ? truncateToCleanText(cell.shown, QUESTION_EXAMPLE_LENGTH) : null,
        };
      }),
  );
}
export const PREVIEW_ROW_COUNT = 50;
export const MAX_PREVIEW_COLUMNS = 100;
export const MAX_LINES_LEFT_OUT_LISTED = 40;
export const previewCellsOf = (reading: ImportReading, texts: string[], reads: WorkbookReads) =>
  previewCellsUnderReading(reading, texts, reads).map(({ cell }) => cell);
export const EXAMPLE_TEXTS_TRIED = 5;
export const EXAMPLE_MAX_GRAPHEMES = 14;
export const EXAMPLE_TAIL_GRAPHEMES = 7;
export const LABEL_MAX_GRAPHEMES = 60;
export const LABEL_TAIL_GRAPHEMES = 20;
export const QUESTION_TEXTS_SAMPLED = 200;
export const QUESTION_EXAMPLES_SHOWN = 2;
export const QUESTION_EXAMPLE_LENGTH = 40;
export const QUESTION_COLUMNS_TRIED = 8;
