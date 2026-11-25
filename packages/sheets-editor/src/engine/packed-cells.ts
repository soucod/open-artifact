import type { CellContents, ColumnId, Reference, RowId, StoredFormula } from '@open-artifact/sheets-core';

/** A block of cells as the engine packs them: the lists of numbers they are read from, and the texts those point into. */
export interface CellsPacked {
  lists: ArrayBuffer;
  texts: string;
}

/** The cells a block has made for one row, from the row's first cell on. */
interface CellsKeptOfARow {
  cells: (CellContents | undefined)[];
  count: { ofCells: number };
}

/** A row whose made cells are kept, so the oldest can be let go first. */
interface KeptRow {
  block: WeakRef<PackedCellBlock>;
  startOfRow: number;
  count: { ofCells: number };
}

/** A stored formula as the engine writes it, with `r: null` in references to the formula's own row. */
interface StoredFormulaWritten {
  textBetweenReferences: string[];
  references: JsonWritten;
}

/** A value as JSON writes it. */
type JsonWritten = string | number | boolean | null | JsonWritten[] | { [key: string]: JsonWritten };

/** The parts of a cell the engine writes as its extra text. */
type CellExtras = Partial<Omit<CellContents, 'r' | 'c'>>;

/** A cell while it is made: its input comes from the lists, or from its extra text. */
type CellBeingMade = Omit<CellContents, 'input'> & Partial<Pick<CellContents, 'input'>>;

export function withRowOfReferences(references: JsonWritten, rowId: RowId): unknown {
  if (Array.isArray(references)) return references.map((input) => withRowOfReferences(input, rowId));
  if (typeof references !== 'object' || references === null) return references;
  let copy: { [key: string]: unknown } = {};
  for (let key in references) copy[key] = key === 'r' && references.r === null ? rowId : withRowOfReferences(references[key], rowId);
  return copy;
}
export function parsedJsonCached<T>(json: string, textIndex: number, cache: Map<number, unknown>): T {
  // The cache holds what this same text parsed to, so it reads as the same shape.
  let parsed = cache.get(textIndex) as T | undefined;
  if (parsed === undefined) {
    parsed = JSON.parse(json);
    if (cache.size < 64) cache.set(textIndex, parsed);
  }
  return parsed as T;
}
export function forEachPackedRow(blocks: Iterable<CellsPacked>, onRow: (rowId: RowId, cells: PackedRowCells) => void): void {
  for (let packed of blocks) {
    let block = new PackedCellBlock(packed);
    let start = 0;
    block.rowIds().forEach((rowId, index) => {
      let end = block.rowEnds[index];
      onRow(rowId, new PackedRowCells(block, rowId, start, end));
      start = end;
    });
  }
}
export function rowsOfPackedCells(blocks: Iterable<CellsPacked>): Map<RowId, PackedRowCells> {
  let rows = new Map<RowId, PackedRowCells>();
  forEachPackedRow(blocks, (rowId, cells) => rows.set(rowId, cells));
  return rows;
}

export const NO_CELLS: readonly CellContents[] = Object.freeze([]);
export const copiedThroughJson = <T>(input: T): T => JSON.parse(JSON.stringify(input));
export const keptRows: (KeptRow | undefined)[] = [];
export let firstKeptRow: number, keptRowCount: number, keptCellCount: number;
[firstKeptRow, keptRowCount, keptCellCount] = [0, 0, 0];

/** One block of packed cells: its rows, its columns, and the cells it makes when they are asked for. */
export type PackedCellBlock = InstanceType<typeof PackedCellBlock>;
export const PackedCellBlock = class PackedCellBlock {
  #self: WeakRef<PackedCellBlock> = new WeakRef(this);
  #keptByRowStart = new Map<number, CellsKeptOfARow>();
  #parsedJson = new Map<number, unknown>();
  #texts: string;
  #values: Float64Array;
  #rowTexts: Uint32Array;
  #textEnds: Uint32Array;
  #shownTexts: Uint32Array;
  #editedTexts: Uint32Array;
  #formulas: Uint32Array;
  #extras: Uint32Array;
  #columnIdOfNumber = new Map<number, ColumnId>();
  #numberOfColumnId = new Map<ColumnId, number>();
  declare rowEnds: Uint32Array;
  declare columns: Uint32Array;
  declare forms: Uint8Array;
  constructor({ lists, texts }: CellsPacked) {
    let [rowCount, columnCount, cellCount, textCount] = new Uint32Array(lists, 0, 4);
    let offset = 4 * Uint32Array.BYTES_PER_ELEMENT;
    let take = <View extends { byteLength: number }>(
      View: new (buffer: ArrayBuffer, byteOffset: number, length: number) => View,
      count: number,
    ): View => {
      let view = new View(lists, offset, count);
      offset += view.byteLength;
      return view;
    };
    this.#texts = texts;
    this.#values = take(Float64Array, cellCount);
    this.#rowTexts = take(Uint32Array, rowCount);
    this.rowEnds = take(Uint32Array, rowCount);
    let columnTexts = take(Uint32Array, columnCount);
    let columnNumbers = take(Uint32Array, columnCount);
    this.#textEnds = take(Uint32Array, textCount);
    this.columns = take(Uint32Array, cellCount);
    this.#shownTexts = take(Uint32Array, cellCount);
    this.#editedTexts = take(Uint32Array, cellCount);
    this.#formulas = take(Uint32Array, cellCount);
    this.#extras = take(Uint32Array, cellCount);
    this.forms = take(Uint8Array, cellCount);
    this.#textsAt(columnTexts).forEach((columnId, index) => {
      this.#columnIdOfNumber.set(columnNumbers[index], columnId);
      this.#numberOfColumnId.set(columnId, columnNumbers[index]);
    });
  }
  #text(index: number): string {
    let start = index === 1 ? 0 : this.#textEnds[index - 2];
    return this.#texts.substring(start, this.#textEnds[index - 1]);
  }
  #textsAt(indexes: Uint32Array): string[] {
    return copiedThroughJson(Array.from(indexes, (index) => this.#text(index)));
  }
  rowIds(): RowId[] {
    return this.#textsAt(this.#rowTexts);
  }
  #formulaInput(textIndex: number, rowId: RowId): { kind: 'formula'; formula: StoredFormula } {
    let [json, cache] = [this.#text(textIndex), this.#parsedJson];
    let formula: StoredFormula | undefined;
    return {
      kind: 'formula',
      get formula(): StoredFormula {
        if (formula === undefined) {
          let { textBetweenReferences, references } = parsedJsonCached<StoredFormulaWritten>(json, textIndex, cache);
          formula = {
            textBetweenReferences,
            // The written references, with the formula's own row put in, are the formula's references.
            references: withRowOfReferences(references, rowId) as Reference[],
          };
        }
        return formula;
      },
    };
  }
  columnIdAt(index: number): ColumnId {
    // Every cell's column number is one of the block's columns.
    return this.#columnIdOfNumber.get(this.columns[index])!;
  }
  indexOf(columnId: ColumnId, start: number, end: number): number {
    let number = this.#numberOfColumnId.get(columnId);
    if (number === undefined) return -1;
    let { columns } = this;
    let guess = start + number - columns[start];
    if (guess < start) return -1;
    if (guess < end && columns[guess] === number) return guess;
    let [low, high] = [start, end - 1];
    while (low <= high) {
      let middle = (low + high) >>> 1;
      if (columns[middle] === number) return middle;
      if (columns[middle] < number) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }
  keptCellAt(index: number, startOfRow: number): CellContents | undefined {
    return this.#keptByRowStart.get(startOfRow)?.cells[index - startOfRow];
  }
  static #forgetOldestRow(): void {
    // Only called while some row is kept.
    let { block, startOfRow, count } = keptRows[firstKeptRow]!;
    let blockKept = block.deref();
    if (blockKept !== undefined) blockKept.#keptByRowStart.delete(startOfRow);
    keptRows[firstKeptRow] = undefined;
    firstKeptRow = (firstKeptRow + 1) % 4096;
    keptRowCount -= 1;
    keptCellCount -= count.ofCells;
  }
  keepCell(cell: CellContents, index: number, startOfRow: number): CellContents {
    while (keptCellCount >= 65536) PackedCellBlock.#forgetOldestRow();
    let kept = this.#keptByRowStart.get(startOfRow);
    if (kept === undefined) {
      if (keptRowCount === 4096) PackedCellBlock.#forgetOldestRow();
      kept = {
        cells: [],
        count: {
          ofCells: 0,
        },
      };
      this.#keptByRowStart.set(startOfRow, kept);
      keptRows[(firstKeptRow + keptRowCount) % 4096] = {
        block: this.#self,
        startOfRow,
        count: kept.count,
      };
      keptRowCount += 1;
    }
    kept.cells[index - startOfRow] = cell;
    kept.count.ofCells += 1;
    keptCellCount += 1;
    return cell;
  }
  #isSameText(textIndex: number, other: PackedCellBlock, otherTextIndex: number): boolean {
    if (textIndex === 0 || otherTextIndex === 0) return textIndex === otherTextIndex;
    return this.#text(textIndex) === other.#text(otherTextIndex);
  }
  isCellAsIn(index: number, other: PackedCellBlock, otherIndex: number): boolean {
    let form = this.forms[index];
    if (form !== other.forms[otherIndex]) return false;
    let value = this.#values[index];
    let otherValue = other.#values[otherIndex];
    let valueIsText = (form & 7) === 1 || (form & 24) === 16;
    let sameTextIn = (texts: Uint32Array, otherTexts: Uint32Array): boolean =>
      this.#isSameText(texts[index], other, otherTexts[otherIndex]);
    return (
      (valueIsText ? this.#isSameText(value, other, otherValue) : Object.is(value, otherValue)) &&
      sameTextIn(this.#shownTexts, other.#shownTexts) &&
      sameTextIn(this.#editedTexts, other.#editedTexts) &&
      sameTextIn(this.#formulas, other.#formulas) &&
      sameTextIn(this.#extras, other.#extras)
    );
  }
  newCellAt(index: number, rowId: RowId): CellContents {
    let form = this.forms[index];
    let value = this.#values[index];
    let editedText = this.#editedTexts[index];
    let columnId = this.columnIdAt(index);
    let cell: CellBeingMade;
    switch (form & 7) {
      case 0:
        cell = {
          r: rowId,
          c: columnId,
          input: {
            kind: 'number',
            value,
          },
        };
        if (editedText !== 0) cell.numberIsEditedAs = this.#text(editedText);
        break;
      case 1:
        cell = {
          r: rowId,
          c: columnId,
          input: {
            kind: 'text',
            value: this.#text(value),
          },
        };
        break;
      case 2:
        cell = {
          r: rowId,
          c: columnId,
          input: {
            kind: 'boolean',
            value: value === 1,
          },
        };
        break;
      case 3:
        cell = {
          r: rowId,
          c: columnId,
          input: this.#formulaInput(this.#formulas[index], rowId),
        };
        if (editedText !== 0) cell.formulaText = this.#text(editedText);
        break;
      default:
        cell = {
          r: rowId,
          c: columnId,
        };
    }
    if ((form & 32) !== 0) cell.textIsEditedAfterTheMark = true;
    switch (form & 24) {
      case 8:
        cell.value = {
          kind: 'number',
          value,
        };
        break;
      case 16:
        cell.value = {
          kind: 'text',
          value: this.#text(value),
        };
        break;
      case 24:
        cell.value = {
          kind: 'boolean',
          value: value === 1,
        };
        break;
    }
    let [shownText, extra] = [this.#shownTexts[index], this.#extras[index]];
    if (shownText !== 0)
      cell.shown = {
        kind: 'text',
        text: this.#text(shownText),
        textColor: null,
      };
    // A cell whose input is none of the four kinds above has it in its extra text.
    if (extra === 0) return cell as CellContents;
    let rest = parsedJsonCached<CellExtras>(this.#text(extra), extra, this.#parsedJson);
    return Object.assign(cell, rest) as CellContents;
  }
};

/** A row of a block's cells, read as a map from column ids to cells; each cell is made when it is first asked for. */
export type PackedRowCells = InstanceType<typeof PackedRowCells>;
export const PackedRowCells = class PackedRowCells implements ReadonlyMap<ColumnId, CellContents> {
  #block: PackedCellBlock;
  #rowId: RowId;
  #start: number;
  #end: number;
  constructor(block: PackedCellBlock, rowId: RowId, start: number, end: number) {
    this.#block = block;
    this.#rowId = rowId;
    this.#start = start;
    this.#end = end;
  }
  #cellAt(index: number): CellContents {
    return this.#block.keptCellAt(index, this.#start) ?? this.#block.newCellAt(index, this.#rowId);
  }
  #mapIndexes<T>(map: (index: number) => T): T[] {
    let mapped: T[] = [];
    for (let index = this.#start; index < this.#end; index += 1) mapped.push(map(index));
    return mapped;
  }
  #anyFormHas(bits: number): boolean {
    let { forms } = this.#block;
    for (let index = this.#start; index < this.#end; index += 1) if ((forms[index] & bits) !== 0) return true;
    return false;
  }
  get size(): number {
    return this.#end - this.#start;
  }
  get(columnId: ColumnId): CellContents | undefined {
    let index = this.#block.indexOf(columnId, this.#start, this.#end);
    if (index === -1) return;
    return (
      this.#block.keptCellAt(index, this.#start) ??
      this.#block.keepCell(this.#block.newCellAt(index, this.#rowId), index, this.#start)
    );
  }
  has(columnId: ColumnId): boolean {
    return this.#block.indexOf(columnId, this.#start, this.#end) !== -1;
  }
  keys(): MapIterator<ColumnId> {
    return this.#mapIndexes((index) => this.#block.columnIdAt(index)).values();
  }
  values(): MapIterator<CellContents> {
    return this.#mapIndexes((index) => this.#cellAt(index)).values();
  }
  entries(): MapIterator<[ColumnId, CellContents]> {
    return Array.from(this.values(), (cell): [ColumnId, CellContents] => [cell.c, cell]).values();
  }
  [Symbol.iterator](): MapIterator<[ColumnId, CellContents]> {
    return this.entries();
  }
  forEach(
    callback: (cell: CellContents, columnId: ColumnId, row: ReadonlyMap<ColumnId, CellContents>) => void,
    thisArg?: unknown,
  ): void {
    for (let [columnId, cell] of this) callback.call(thisArg, cell, columnId, this);
  }
  hasAnError(): boolean {
    return this.#anyFormHas(128);
  }
  cellsWithUsersARichTextOrASpill(): readonly CellContents[] {
    if (!this.#anyFormHas(64)) return NO_CELLS;
    let { forms } = this.#block;
    let isMarked = (index: number): boolean => (forms[index] & 64) !== 0;
    return this.#mapIndexes((index) => index)
      .filter(isMarked)
      .map((index) => this.#cellAt(index));
  }
  columnsThatReadOtherwiseIn(other: ReadonlyMap<ColumnId, CellContents>): ColumnId[] {
    if (!(#block in other) || other.#rowId !== this.#rowId) return [...this.keys()];
    let columnIds: ColumnId[] = [];
    for (let index = this.#start; index < this.#end; index += 1) {
      let columnId = this.#block.columnIdAt(index);
      let otherIndex = other.#block.indexOf(columnId, other.#start, other.#end);
      if (otherIndex === -1 || !this.#block.isCellAsIn(index, other.#block, otherIndex)) columnIds.push(columnId);
    }
    return columnIds;
  }
  goesOnAs(other: PackedRowCells): boolean {
    let isSame = this.size === other.size && this.columnsThatReadOtherwiseIn(other).length === 0;
    if (isSame) {
      this.#block = other.#block;
      this.#start = other.#start;
      this.#end = other.#end;
    }
    return isSame;
  }
};
