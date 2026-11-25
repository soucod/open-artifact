/**
 * What an interactive's code reads and writes, without a document: its sources as rows, `setCells` as the cells it
 * writes, and the inputs as they show while writes wait for the page's answer.
 */
import { ChartFault, isObject } from '../chart-frame/chart-runtime.ts';
import type { ChartCell, ChartInputs, ChartRow } from '../chart-frame/messages.ts';
import type { InteractiveRawWrite, InteractiveWrittenValue } from './messages.ts';
import {
  MAX_INTERACTIVE_INDEX,
  MAX_INTERACTIVE_TEXT_LENGTH,
  MAX_INTERACTIVE_WRITES,
} from '../charts/interactive-frame-talk.ts';

/** The source the page puts the controls' one object in. */
export const INTERACTIVE_SOURCE = 'interactive';
const CHART_SIZE_SOURCE = 'chartSize';
const MOST_ROWS_OF_AN_INPUT = 2000;
const INPUT_REF = /^input\/(.+)$/;

/** What `interactive.at(0)` is: whether the person may write now, and the write itself. */
export interface ControlsOfInteractive {
  readonly canWrite: boolean;
  readonly setCells: (cells: unknown) => void;
}

export interface WhatTheCodeIsTold {
  inputs: ChartInputs;
  controls: ControlsOfInteractive;
  size: { width: number; height: number };
}

const isCellsAdapter = (adapter: unknown): boolean => isObject(adapter) && Object.keys(adapter).join() === 'kind' && adapter.kind === 'cells';
const rowsOrOneBlank = (rows: readonly ChartRow[]): readonly ChartRow[] =>
  rows[0] === undefined || rows[0].length === 0 ? [[{ value: null, text: '' }]] : rows;

/** The rows of one source of <sheet.Visualize>, as a chart's code gets them, and the controls for `interactive`. */
export function rowsOfSource(name: string, source: unknown, { inputs, controls, size }: WhatTheCodeIsTold): readonly unknown[] {
  if (!isObject(source)) throw new ChartFault('notDrawnInSheets');
  if (source.kind === 'data') {
    if (!Array.isArray(source.data)) throw new ChartFault('notDrawnInSheets');
    if (name === INTERACTIVE_SOURCE) return [controls];
    if (name === CHART_SIZE_SOURCE && source.data.length === 1 && size.width * size.height > 0) return [{ ...size }];
    return source.data;
  }
  const inputName = typeof source.ref === 'string' ? INPUT_REF.exec(source.ref)?.[1] : undefined;
  if (source.kind !== 'ref' || inputName === undefined || !isCellsAdapter(source.adapter)) throw new ChartFault('notDrawnInSheets');
  const rows = Object.hasOwn(inputs, inputName) ? inputs[inputName] : undefined;
  if (rows === undefined) throw new ChartFault('inputMissing');
  if (rows.length > MOST_ROWS_OF_AN_INPUT) throw new ChartFault('tooManyRows');
  return rowsOrOneBlank(rows);
}

const isWrittenValue = (value: unknown): value is InteractiveWrittenValue =>
  value === null ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && value.length <= MAX_INTERACTIVE_TEXT_LENGTH);

/**
 * The cells `setCells` asks for: each name an input, its value one cell (the input's top left) or rows of cells from
 * there. A name that is no input, or the controls' own, is passed over; anything else the page would not take throws.
 */
export function cellsAskedFor(asked: unknown, inputs: ChartInputs): InteractiveRawWrite[] {
  if (!isObject(asked) || Array.isArray(asked)) throw new TypeError('setCells takes an object of inputs and their values');
  const cells: InteractiveRawWrite[] = [];
  for (const [input, value] of Object.entries(asked)) {
    if (input === INTERACTIVE_SOURCE || !Object.hasOwn(inputs, input)) continue;
    const rows: unknown[] = Array.isArray(value) ? value : [[value]];
    rows.forEach((row, rowAt) => {
      if (!Array.isArray(row)) throw new TypeError(`setCells: each row of ${input} is a list of values`);
      row.forEach((cell: unknown, columnAt) => {
        if (!isWrittenValue(cell)) throw new TypeError(`setCells: ${input} takes numbers, texts, booleans and null`);
        if (rowAt >= MAX_INTERACTIVE_INDEX || columnAt >= MAX_INTERACTIVE_INDEX) throw new RangeError(`setCells: ${input} reaches too far`);
        cells.push([input, rowAt, columnAt, cell]);
      });
    });
  }
  if (cells.length > MAX_INTERACTIVE_WRITES) throw new RangeError(`setCells writes ${String(MAX_INTERACTIVE_WRITES)} cells at most`);
  return cells;
}

/** What a written cell shows until the page sends it back as the sheet holds it. */
export function cellAsWritten(value: InteractiveWrittenValue): ChartCell {
  if (value === null) return { value: null, text: '' };
  if (typeof value === 'boolean') return { value, text: value ? 'TRUE' : 'FALSE' };
  return { value, text: String(value) };
}

/** A write sent to the page and not answered yet. */
export interface WriteAwaited {
  nth: number;
  cells: readonly InteractiveRawWrite[];
}

/** The inputs with the writes still awaited laid over them, in the order they were made. */
export function inputsWithWritesAwaited(inputs: ChartInputs, awaited: readonly WriteAwaited[]): ChartInputs {
  if (awaited.length === 0) return inputs;
  const laid: Record<string, ChartCell[][]> = {};
  for (const { cells } of awaited)
    for (const [input, row, column, value] of cells) {
      const rows = (laid[input] ??= (inputs[input] ?? []).map((cellsOfRow) => [...cellsOfRow]));
      const width = Math.max(column + 1, rows[0]?.length ?? 0);
      while (rows.length <= row) rows.push([]);
      for (const cellsOfRow of rows) while (cellsOfRow.length < width) cellsOfRow.push({ value: null, text: '' });
      const cellsOfRow = rows[row];
      if (cellsOfRow !== undefined) cellsOfRow[column] = cellAsWritten(value);
    }
  return { ...inputs, ...laid };
}
