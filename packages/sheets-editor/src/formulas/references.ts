import type { DecimalSignName, Reference, SheetId } from '@open-artifact/sheets-core';
import type { SheetSummary } from '../model/workbook.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import { areaAsSeen, areasAsSeen } from '../model/a1-references.ts';
/** A run of text between quotes, from the opening quote to after the closing one (or to the end, where none closes it). */
export interface QuotedSpan {
  start: number;
  end: number;
  isClosed: boolean;
}
/** A sheet's name written before `!`, and where the text after the `!` starts. */
export interface SheetPrefix {
  name: string;
  end: number;
}
/** One end of a reference as written (`$B$2`, `B` or `2`), perhaps after a sheet's name; `''` for a part not written. */
export interface WrittenReferenceEnd {
  sheetName: string | null;
  start: number;
  end: number;
  dollarOfColumn: string;
  letters: string;
  dollarOfRow: string;
  digits: string;
}
/** The rows or columns a written reference spans: `count` of them from `first`, or all from `first` on where `count` is `null`. */
export interface WrittenLineSpan {
  first: number;
  count: number | null;
}
/** A reference as written in a formula's text, and where it is in it. */
export interface WrittenReference {
  start: number;
  end: number;
  sheetName: string | null;
  otherSheetName: string | null;
  ends: [WrittenReferenceEnd] | [WrittenReferenceEnd, WrittenReferenceEnd];
  rows: WrittenLineSpan;
  columns: WrittenLineSpan;
}
/** What reads as a reference at a place in a formula: where it ends, and the reference (`null` for one that names no lines). */
export interface ReferenceParsed {
  end: number;
  reference: WrittenReference | null;
}
export interface FormulaReferencesFound {
  references: WrittenReference[];
  quoted: QuotedSpan[];
}
/** A written reference on its sheet: the area it covers as seen, and that area in pieces of rows as stored. */
export interface ResolvedReference {
  sheet: SheetSummary;
  area: CellArea;
  pieces: CellArea[];
}
export function execStickyAt(pattern: RegExp, text: string, position: number): RegExpExecArray | null {
  pattern.lastIndex = position;
  return pattern.exec(text);
}
export function quotedSpanAt(text: string, start: number, quote: string): QuotedSpan {
  let position = start + 1;
  while (position < text.length)
    if (text[position] !== quote) position += 1;
    else if (text[position + 1] === quote) position += 2;
    else
      return {
        start,
        end: position + 1,
        isClosed: true,
      };
  return {
    start,
    end: text.length,
    isClosed: false,
  };
}
export function sheetPrefixAt(text: string, start: number): SheetPrefix | null {
  let isQuoted = text[start] === "'";
  let nameEnd = isQuoted ? quotedSpanAt(text, start, "'").end : start + (execStickyAt(SHEET_NAME_AT, text, start)?.[0].length ?? 0);
  if (nameEnd === start || text[nameEnd] !== '!') return null;
  return {
    name: isQuoted ? text.slice(start + 1, nameEnd - 1).replaceAll("''", "'") : text.slice(start, nameEnd),
    end: nameEnd + 1,
  };
}
export function cellReferencePartsAt(text: string, start: number): WrittenReferenceEnd | null {
  let sheetPrefix = sheetPrefixAt(text, start);
  let match = execStickyAt(A1_REFERENCE_AT, text, sheetPrefix?.end ?? start);
  if (match === null) return null;
  let [matchedText, cellColumnDollar, cellLetters, cellRowDollar, cellDigits, ...otherGroups] = match;
  let [columnDollar, columnLetters, rowDollar, rowDigits] = otherGroups;
  let [letters, digits] = [cellLetters ?? columnLetters ?? '', cellDigits ?? rowDigits ?? ''];
  if (columnLettersToBigInt(letters) > MAX_REFERENCE_INDEX || BigInt(digits) > MAX_REFERENCE_INDEX) return null;
  return {
    sheetName: sheetPrefix?.name ?? null,
    start: match.index,
    end: match.index + matchedText.length,
    dollarOfColumn: cellColumnDollar ?? columnDollar ?? '',
    letters,
    dollarOfRow: cellRowDollar ?? rowDollar ?? '',
    digits,
  };
}
export function parseReferenceAt(formula: string, start: number): ReferenceParsed | null {
  let firstEnd = cellReferencePartsAt(formula, start);
  if (firstEnd === null) return null;
  let secondEnd = formula[firstEnd.end] === ':' ? cellReferencePartsAt(formula, firstEnd.end + 1) : null;
  let otherEnd = secondEnd !== null && endsReferenceAt(formula, secondEnd.end) ? secondEnd : null;
  let isCell = firstEnd.letters !== '' && firstEnd.digits !== '';
  if (otherEnd === null && !(isCell && endsReferenceAt(formula, firstEnd.end))) return null;
  let { end: lastEnd } = otherEnd ?? firstEnd;
  let rows = lineSpanOfEnds(rowIndexOfReferenceEnd(firstEnd), rowIndexOfReferenceEnd(otherEnd ?? firstEnd));
  let columns = lineSpanOfEnds(columnIndexOfReferenceEnd(firstEnd), columnIndexOfReferenceEnd(otherEnd ?? firstEnd));
  if (rows.count === null && columns.count === null)
    return {
      end: lastEnd,
      reference: null,
    };
  let parsed: WrittenReference = {
    start,
    end: lastEnd,
    sheetName: firstEnd.sheetName,
    otherSheetName: otherEnd?.sheetName ?? null,
    ends: otherEnd === null ? [firstEnd] : [firstEnd, otherEnd],
    rows,
    columns,
  };
  return {
    end: lastEnd,
    reference: parsed,
  };
}
export function commaDecimalsToDots(formula: string): string {
  let withDots = '';
  let lastChar: string | undefined;
  let index = 0;
  while (index < formula.length) {
    let char = formula.charAt(index);
    let numberText =
      ASCII_DIGIT.test(char) || lastChar === undefined || !OPERAND_END_CHAR.test(lastChar)
        ? execStickyAt(COMMA_DECIMAL_NUMBER_AT, formula, index)?.[0]
        : undefined;
    let pieceEnd =
      numberText !== undefined
        ? index + numberText.length
        : char === '"' || char === "'"
          ? quotedSpanAt(formula, index, char).end
          : Math.max(endOfNameChars(formula, index), index + 1);
    let piece = formula.slice(index, pieceEnd);
    withDots += numberText === undefined ? piece : piece.replace(',', '.');
    lastChar = LAST_NON_SPACE_CHAR.exec(piece)?.[0] ?? lastChar;
    index = pieceEnd;
  }
  return withDots;
}
export function findFormulaReferences(formula: string, decimalSign: DecimalSignName): FormulaReferencesFound {
  let dotted = decimalSign === 'comma' ? commaDecimalsToDots(formula) : formula;
  let references: WrittenReference[] = [];
  let quoted: QuotedSpan[] = [];
  let index = 0;
  while (index < dotted.length) {
    let parsed = parseReferenceAt(dotted, index);
    let char = dotted[index];
    if (parsed !== null) {
      if ((index === 0 || endOfNameChars(dotted, index - 1) === index - 1) && parsed.reference !== null) references.push(parsed.reference);
      index = parsed.end;
    } else if (char === '"' || char === "'") {
      let piece = quotedSpanAt(dotted, index, char);
      quoted.push(piece);
      index = piece.end;
    } else {
      let piece = index + (execStickyAt(DOT_DECIMAL_NUMBER_AT, dotted, index)?.[0].length ?? 0);
      index = piece > index ? piece : Math.max(endOfNameChars(dotted, index), index + 1);
    }
  }
  return {
    references,
    quoted,
  };
}
export function formulaMatchesOutsideReferences(formula: string, pattern: RegExp, decimalSign: DecimalSignName): boolean {
  if (!pattern.test(formula)) return false;
  let { references, quoted } = findFormulaReferences(formula, decimalSign);
  let spans = [...references, ...quoted];
  spans.sort((one, other) => other.start - one.start);
  return pattern.test(
    spans.reduce((text, { start, end }) => `${text.slice(0, start)},${text.slice(end)}`, formula),
  );
}
export function lineCountWithin({ first, count }: WrittenLineSpan, lineCount: number): number | null {
  let spanCount = count ?? lineCount - first;
  return spanCount > 0 && first + spanCount <= lineCount ? spanCount : null;
}
export function resolveFormulaReference(
  { sheetName, otherSheetName, rows, columns }: WrittenReference,
  ownSheetId: SheetId,
  sheets: readonly SheetSummary[],
): ResolvedReference | null {
  let sheet =
    sheetName === null ? sheets.find(({ sheetId }) => sheetId === ownSheetId) : findSheetNamed(sheetName, sheets);
  let isSameSheet = otherSheetName === null || findSheetNamed(otherSheetName, sheets) === sheet;
  if (sheet === undefined || !isSameSheet) return null;
  let rowCount = lineCountWithin(rows, sheet.rowCount);
  let columnCount = lineCountWithin(columns, sheet.columnCount);
  if (rowCount === null || columnCount === null) return null;
  let area = {
    topRowIndex: rows.first,
    leftColumnIndex: columns.first,
    rowCount,
    columnCount,
  };
  let { ownRowOrder } = sheet;
  return {
    sheet,
    area: areaAsSeen(area, ownRowOrder),
    pieces: areasAsSeen(area, ownRowOrder),
  };
}
export function formulaHasMoreReferencesThan(
  formula: string,
  decimalSign: DecimalSignName,
  ownSheetId: SheetId,
  sheets: readonly SheetSummary[],
  knownReferences: readonly Reference[],
): boolean {
  let resolved = findFormulaReferences(formula, decimalSign).references.filter(
    (reference) => resolveFormulaReference(reference, ownSheetId, sheets) !== null,
  );
  let knownWholeLines = knownReferences.filter(({ kind }) => kind === 'columns' || kind === 'rows');
  return resolved.length > knownReferences.length || resolved.filter(isWholeLineReference).length > knownWholeLines.length;
}
export const NAME_CHARS_AT = /[A-Za-z0-9_.$\u0080-\uffff]*/y;
export const SHEET_NAME_AT = /[A-Za-z_\u0080-\uffff][A-Za-z0-9_.\u0080-\uffff]*/y;
export const DOT_DECIMAL_NUMBER_AT = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?/y;
export const COMMA_DECIMAL_NUMBER_AT = /(?:[0-9]+(?:,[0-9]*)?|,[0-9]+)(?:[Ee][+-]?[0-9]+)?/y;
export const ASCII_DIGIT = /[0-9]/;
export const OPERAND_END_CHAR = /[A-Za-z0-9_.$\u0080-\uffff)}"'%!]/;
export const LAST_NON_SPACE_CHAR = /\S(?=\s*$)/;
export const A1_REFERENCE_AT = /(\$?)([A-Za-z]+)(\$?)([1-9][0-9]*)|(\$?)([A-Za-z]+)|(\$?)([1-9][0-9]*)/y;
export const REFERENCE_CALL_BRACKET_AT = /[ \t\n\r]*\(/y;
export const COLUMN_LETTER_RADIX = 26n;
export const MAX_REFERENCE_INDEX = 2n ** 64n - 1n;
export const endOfNameChars = (text: string, start: number): number =>
  start + (execStickyAt(NAME_CHARS_AT, text, start)?.[0].length ?? 0);
export const columnLettersToBigInt = (letters: string): bigint =>
  Array.from<string>(letters.toUpperCase()).reduce(
    (total: bigint, letter) => total * COLUMN_LETTER_RADIX + BigInt(letter.charCodeAt(0) - 64),
    0n,
  );
export const rowIndexOfReferenceEnd = ({ digits }: WrittenReferenceEnd): number | null => (digits === '' ? null : Number(digits) - 1);
export const columnIndexOfReferenceEnd = ({ letters }: WrittenReferenceEnd): number | null =>
  letters === '' ? null : Number(columnLettersToBigInt(letters)) - 1;
export const endsReferenceAt = (formula: string, index: number): boolean =>
  endOfNameChars(formula, index) === index && execStickyAt(REFERENCE_CALL_BRACKET_AT, formula, index) === null;
export const lineSpanOfEnds = (oneIndex: number | null, otherIndex: number | null): WrittenLineSpan =>
  oneIndex === null || otherIndex === null
    ? {
        first: oneIndex ?? otherIndex ?? 0,
        count: null,
      }
    : {
        first: Math.min(oneIndex, otherIndex),
        count: Math.abs(oneIndex - otherIndex) + 1,
      };
export const sheetPrefixForFormula = (sheetName: string): string =>
  execStickyAt(SHEET_NAME_AT, sheetName, 0)?.[0] === sheetName ? `${sheetName}!` : `'${sheetName.replaceAll("'", "''")}'!`;
export const lowerCaseAsciiLetters = (text: string): string =>
  text.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
export const findSheetNamed = (name: string, sheets: readonly SheetSummary[]): SheetSummary | undefined =>
  sheets.find((sheet) => sheet.name === name) ??
  sheets.find((sheet) => lowerCaseAsciiLetters(sheet.name) === lowerCaseAsciiLetters(name));
export const isWholeLineReference = ({ rows, columns }: WrittenReference): boolean => rows.count === null || columns.count === null;
export const isIndexInLineSpan = (index: number, { first, count }: WrittenLineSpan): boolean =>
  index >= first && (count === null || index < first + count);
export const referenceCoversCell = (
  { rows, columns }: WrittenReference,
  { rowIndex, columnIndex }: CellPosition,
): boolean => isIndexInLineSpan(rowIndex, rows) && isIndexInLineSpan(columnIndex, columns);
