import type { DecimalSignName, SheetId } from '@open-artifact/sheets-core';
import { readsAsStored } from '../../model/workbook.ts';
import { lineRunsOfSheet } from '../../format/conditional/ask-agent.ts';
import { isSameJsonValue } from '../../model/same-json.ts';
import { acceptFormulaFromAgent, callsVolatileFunction, bringsNewCommaNumbers, addsVolatileFunction } from '../agent-answer-checks.ts';
import {
  checkFormulaResult,
  fillsOtherCells,
  differsFromResult,
  PLAIN_NUMBER_SHOWN_PATTERN,
  TWO_CURRENCY_SIGNS_PATTERN,
  quoteShownText,
} from '../from-words/ask-agent.ts';
import { cellsHangingOnFormulasWhere, areaTouchesHangingCells } from '../dependents.ts';
import { splitAreaAround, isAreaWithin } from '../../selection/several-ranges.ts';
import { areaOfPosition, isSameCell } from '../../selection/model.ts';
import { tableAreaWithHeaderAt, isFormulaWrittenInWords } from '../fix-prompt.ts';
import { findFormulaReferences, resolveFormulaReference } from '../references.ts';
import { isAddressWordInSheet } from '../column-headings.ts';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea, CellPosition } from '../../selection/model.ts';
import type { FixAwaited, FixFound, FixOfCopyAwaited } from '../../state/initial-state.ts';
import type { CellsHangingBySheet } from '../dependents.ts';
import type { ResolvedReference, WrittenLineSpan, WrittenReference } from '../references.ts';
/** An area a formula reads, with its sheet. */
export interface AreaRead {
  sheetId: SheetId;
  area: CellArea;
}
/** A block of filled cells that touch one another: the keys of their positions, and the area around them. */
export interface FilledBlock {
  cells: Set<string>;
  hull: CellArea;
}
export function checkFixAnswer(
  workbookSeen: WorkbookReads,
  {
    cellId,
    broken,
    linesAsTold,
    fewestCellsToRead,
    formulaBeforeASortOrMove,
    cameToBeforeASort,
    callsForNoNewCell,
    isLabelOrHeadingTold,
  }: FixOfCopyAwaited & Pick<FixAwaited, 'linesAsTold'>,
  answer: unknown,
): Pick<FixFound, 'formula' | 'shown'> | null {
  let workbook = readsAsStored(workbookSeen);
  let position = workbook.positionOfCell(cellId);
  let linesNow = lineRunsOfSheet(workbook, cellId.sheetId);
  if (position === null || !isSameJsonValue(linesNow, linesAsTold)) return null;
  let formula = acceptFormulaFromAgent(answer, workbook, cellId.sheetId, position);
  if (formula === null || isFixNoBetter(workbook, cellId, formula, broken, formulaBeforeASortOrMove, callsForNoNewCell, isLabelOrHeadingTold))
    return null;
  if ((countCellsRead(formula, workbook.decimalSign) ?? 1 / 0) < fewestCellsToRead) return null;
  let comesTo = checkFormulaResult(workbook, cellId, formula);
  if (typeof comesTo === 'string' || fillsOtherCells(comesTo)) return null;
  if (differsFromResult(comesTo, cameToBeforeASort)) return null;
  let isPlainNumberShown = PLAIN_NUMBER_SHOWN_PATTERN.test(comesTo.shown) && !TWO_CURRENCY_SIGNS_PATTERN.test(comesTo.shown);
  let isShownAsIs = comesTo.shown === '' || (comesTo.text === null && (comesTo.isTrueOrFalse === true || isPlainNumberShown));
  return {
    formula,
    shown: isShownAsIs ? comesTo.shown : quoteShownText(comesTo.shown),
  };
}
export function cellsHangingOnVolatiles(workbook: WorkbookReads): CellsHangingBySheet | null {
  let cached = volatileDependentsCache.get(workbook);
  if (cached !== undefined) return cached;
  let hanging = cellsHangingOnFormulasWhere(workbook, callsVolatileFunction);
  volatileDependentsCache.set(workbook, hanging);
  return hanging;
}
/** The areas the formula reads that none of the other formulas read, `null` for a reference it cannot resolve. */
export function areasReadOnlyBy(workbook: WorkbookReads, cellId: CellId, formula: string, otherFormulas: string[]): (AreaRead | null)[] {
  let readByOthers = otherFormulas.flatMap((otherFormula) => referencedAreasOf(workbook, cellId, otherFormula));
  return referencedAreasOf(workbook, cellId, formula).flatMap((referenced): (AreaRead | null)[] => {
    if (referenced === null) return [null];
    let { sheetId } = referenced.sheet;
    let areas = [referenced.area];
    for (const readByOther of readByOthers)
      if (readByOther?.sheet.sheetId === sheetId) areas = areas.flatMap((area) => splitAreaAround(area, readByOther.area, 'rows'));
    return areas.map(
      (area) => ({
        sheetId,
        area,
      }),
    );
  });
}
export function mayNameARange(workbook: WorkbookReads, cellId: CellId, formula: string): boolean {
  let bounded = referencesNotNamingHeadings(workbook, cellId, formula).filter(isBoundedReference);
  return bounded.length > 1 || bounded.some(({ rows, columns }) => rows.count !== 1 || columns.count !== 1);
}
export function readsBeyondTables(
  workbook: WorkbookReads,
  cellId: CellId,
  fixedFormula: string,
  brokenFormula: string,
  formulaBefore: string | null,
): boolean {
  let otherFormulas = [brokenFormula, ...(formulaBefore === null ? [] : [formulaBefore])];
  let newlyRead = areasReadOnlyBy(workbook, cellId, fixedFormula, otherFormulas);
  if (newlyRead.some((read) => read?.sheetId !== cellId.sheetId)) return true;
  let areasLeft = newlyRead.flatMap((read) => read?.area ?? []);
  let position = workbook.positionOfCell(cellId);
  let cornersRead = referencedAreasOf(workbook, cellId, brokenFormula)
    .flatMap((referenced) => (referenced?.sheet.sheetId === cellId.sheetId ? [referenced.area] : []))
    .flatMap(
      ({ topRowIndex, leftColumnIndex, rowCount, columnCount }) => [
        {
          rowIndex: topRowIndex,
          columnIndex: leftColumnIndex,
        },
        {
          rowIndex: topRowIndex + rowCount - 1,
          columnIndex: leftColumnIndex + columnCount - 1,
        },
      ],
    );
  let spots = [...(position === null ? [] : [position]), ...cornersRead];
  let spotsToCheck = spots
    .filter(
      (spot, index) =>
        spots.findIndex((other) => other.rowIndex === spot.rowIndex && other.columnIndex === spot.columnIndex) === index,
    )
    .slice(0, MOST_BLOCKS_CHECKED);
  let tables: CellArea[] = [];
  for (let spot of spotsToCheck) {
    if (areasLeft.length === 0) break;
    if (tables.some((tableFound) => isAreaWithin(areaOfPosition(spot), tableFound))) continue;
    let table = tableAreaWithHeaderAt(workbook, cellId.sheetId, spot);
    if (table === null) continue;
    tables.push(table);
    areasLeft = areasLeft.flatMap((area) => splitAreaAround(area, table, 'rows'));
  }
  return areasLeft.length > 0;
}
export function blockOfFilledCellsAt(filledKeys: Set<string>, start: CellPosition): FilledBlock | null {
  if (!filledKeys.has(positionKey(start))) return null;
  let block = new Set<string>([positionKey(start)]);
  let [topRowIndex, bottomRowIndex, leftColumnIndex, rightColumnIndex] = [
    start.rowIndex,
    start.rowIndex,
    start.columnIndex,
    start.columnIndex,
  ];
  let toVisit = [start];
  for (let position = toVisit.pop(); position !== undefined; position = toVisit.pop()) {
    let { rowIndex, columnIndex } = position;
    [topRowIndex, bottomRowIndex] = [Math.min(topRowIndex, rowIndex), Math.max(bottomRowIndex, rowIndex)];
    [leftColumnIndex, rightColumnIndex] = [Math.min(leftColumnIndex, columnIndex), Math.max(rightColumnIndex, columnIndex)];
    for (let neighbour of [
      {
        rowIndex: rowIndex - 1,
        columnIndex,
      },
      {
        rowIndex: rowIndex + 1,
        columnIndex,
      },
      {
        rowIndex,
        columnIndex: columnIndex - 1,
      },
      {
        rowIndex,
        columnIndex: columnIndex + 1,
      },
    ]) {
      if (!filledKeys.has(positionKey(neighbour)) || block.has(positionKey(neighbour))) continue;
      block.add(positionKey(neighbour));
      toVisit.push(neighbour);
    }
  }
  let hull = {
    topRowIndex,
    leftColumnIndex,
    rowCount: bottomRowIndex - topRowIndex + 1,
    columnCount: rightColumnIndex - leftColumnIndex + 1,
  };
  return block.size === 1
    ? null
    : {
        cells: block,
        hull,
      };
}
export function readsBeyondBlocks(
  workbook: WorkbookReads,
  cellId: CellId,
  fixedFormula: string,
  brokenFormula: string,
  formulaBefore: string | null,
): boolean {
  let brokenReferences = referencesNotNamingHeadings(workbook, cellId, brokenFormula);
  let boundedReferences = brokenReferences.filter(isBoundedReference);
  let formulaOfSpan = ({ start, end }: Pick<WrittenReference, 'start' | 'end'>) => `=${brokenFormula.slice(start, end)}`;
  let newlyRead = areasReadOnlyBy(workbook, cellId, fixedFormula, [
    ...brokenReferences.map(formulaOfSpan),
    ...(formulaBefore === null ? [] : [formulaBefore]),
    ...referencesSpanningWholeRanges(workbook, boundedReferences, fixedFormula).map(
      ({ start, end }) => `=${fixedFormula.slice(start, end)}`,
    ),
  ]);
  if (newlyRead.some((read) => read?.sheetId !== cellId.sheetId)) return true;
  let areas = newlyRead.flatMap((read) => read?.area ?? []);
  let sheet = workbook.listSheets().find(({ sheetId }) => sheetId === cellId.sheetId);
  if (areas.length === 0 || sheet === undefined) return areas.length > 0;
  let filledPositionsIn = (area: CellArea) => {
    let positions = workbook
      .filledCellsIn(cellId.sheetId, area)
      .flatMap((filledCellId) => (isSameCell(filledCellId, cellId) ? [] : (workbook.positionOfCell(filledCellId) ?? [])));
    positions.sort(
      (position, otherPosition) =>
        position.rowIndex === otherPosition.rowIndex ? position.columnIndex - otherPosition.columnIndex : position.rowIndex - otherPosition.rowIndex,
    );
    return positions;
  };
  let { rowCount, columnCount } = sheet;
  let filledKeys = new Set<string>(
    filledPositionsIn({
      topRowIndex: 0,
      leftColumnIndex: 0,
      rowCount,
      columnCount,
    }).map(positionKey),
  );
  let starts = findFormulaReferences(brokenFormula, workbook.decimalSign).references.some(
    (reference) =>
      reference.sheetName === null &&
      !referencedAreasOf(workbook, cellId, formulaOfSpan(reference)).includes(null) &&
      boundedLocalReferences(workbook, fixedFormula).some((span) => spansOverlap(span, reference)),
  )
    ? brokenReferences
        .flatMap((reference) => referencedAreasOf(workbook, cellId, formulaOfSpan(reference)))
        .flatMap((referenced) => (referenced === null ? [] : filledPositionsIn(referenced.area)))
    : areas.flatMap(filledPositionsIn).slice(0, 1);
  let blocks: FilledBlock[] = [];
  for (let start of starts) {
    if (blocks.length === MOST_BLOCKS_CHECKED) break;
    if (blocks.some(({ cells }) => cells.has(positionKey(start)))) continue;
    let block = blockOfFilledCellsAt(filledKeys, start);
    if (block !== null) blocks.push(block);
  }
  return areas.some((area) => {
    let positions = filledPositionsIn(area);
    return !blocks.some(
      ({ cells, hull }) =>
        isAreaWithin(area, hull) && positions.every((position) => cells.has(positionKey(position))),
    );
  });
}
export function readsCellsHangingOnVolatiles(workbook: WorkbookReads, cellId: CellId, fixedFormula: string, brokenFormula: string): boolean {
  let newlyRead = areasReadOnlyBy(workbook, cellId, fixedFormula, [brokenFormula]);
  if (newlyRead.length === 0) return false;
  let hangingOnVolatiles = cellsHangingOnVolatiles(workbook);
  if (hangingOnVolatiles === null || hangingOnVolatiles.size === 0) return hangingOnVolatiles === null;
  return newlyRead.some((read) => read === null || areaTouchesHangingCells(hangingOnVolatiles, read.sheetId, read.area));
}
export function onlyDropsRefErrors(fixedFormula: string, brokenFormula: string, isLabelOrHeadingTold: boolean): boolean {
  let [broken = '', fixed = ''] = [brokenFormula, fixedFormula].map(
    (formula) => formula.replaceAll(REFERENCE_NOISE_PATTERN, '').toUpperCase(),
  );
  let brokenWithoutRefErrors = broken.replaceAll(isLabelOrHeadingTold ? /\/#REF!/g : /[*/]#REF!|#REF!\*/g, '');
  return brokenWithoutRefErrors !== broken && brokenWithoutRefErrors === fixed;
}
export function countCellsRead(formula: string, decimalSign: DecimalSignName): number | null {
  let cellKeys = new Set<string>();
  for (let { rows, columns, sheetName } of findFormulaReferences(formula, decimalSign).references) {
    if (sheetName !== null) continue;
    if (rows.count === null || columns.count === null) return null;
    if (cellKeys.size + rows.count * columns.count > MOST_CELLS_COUNTED_AS_READ) return null;
    for (let rowOffset = 0; rowOffset < rows.count; rowOffset += 1)
      for (let columnOffset = 0; columnOffset < columns.count; columnOffset += 1)
        cellKeys.add(`${rows.first + rowOffset}/${columns.first + columnOffset}`);
  }
  return cellKeys.size;
}
export const volatileDependentsCache = new WeakMap<WorkbookReads, CellsHangingBySheet | null>();
export const referencedAreasOf = (workbook: WorkbookReads, cellId: CellId, formula: string): (ResolvedReference | null)[] =>
  findFormulaReferences(formula, workbook.decimalSign).references.map(
    (reference) => resolveFormulaReference(reference, cellId.sheetId, workbook.listSheets()),
  );
export const lastOfSpan = ({ first, count }: WrittenLineSpan): number => (count === null ? 1 / 0 : first + count - 1);
export const spansStartTogether = (span: WrittenReference, otherSpan: WrittenReference): boolean =>
  span.rows.first === otherSpan.rows.first && span.columns.first === otherSpan.columns.first;
export const spansEndTogether = (span: WrittenReference, otherSpan: WrittenReference): boolean =>
  lastOfSpan(span.rows) === lastOfSpan(otherSpan.rows) && lastOfSpan(span.columns) === lastOfSpan(otherSpan.columns);
export const spansOverlap = (span: WrittenReference, otherSpan: WrittenReference): boolean =>
  span.rows.first <= lastOfSpan(otherSpan.rows) &&
  otherSpan.rows.first <= lastOfSpan(span.rows) &&
  span.columns.first <= lastOfSpan(otherSpan.columns) &&
  otherSpan.columns.first <= lastOfSpan(span.columns);
export const spanHolds = (span: WrittenReference, otherSpan: WrittenReference): boolean =>
  span.rows.first <= otherSpan.rows.first &&
  span.columns.first <= otherSpan.columns.first &&
  lastOfSpan(otherSpan.rows) <= lastOfSpan(span.rows) &&
  lastOfSpan(otherSpan.columns) <= lastOfSpan(span.columns);
export const isBoundedReference = ({ rows, columns }: WrittenReference): boolean => rows.count !== null && columns.count !== null;
export const boundedLocalReferences = (workbook: WorkbookReads, formula: string): WrittenReference[] =>
  findFormulaReferences(formula, workbook.decimalSign).references.filter(
    (reference) => reference.sheetName === null && isBoundedReference(reference),
  );
export const referencesNotNamingHeadings = (workbook: WorkbookReads, cellId: CellId, formula: string): WrittenReference[] =>
  findFormulaReferences(formula, workbook.decimalSign).references.filter(
    ({ sheetName, ends }) =>
      sheetName === null &&
      !ends.some(({ start, end }) => isAddressWordInSheet(formula.slice(start, end), cellId.sheetId, workbook)),
  );
export const referencesSpanningWholeRanges = (workbook: WorkbookReads, bounded: WrittenReference[], formula: string): WrittenReference[] =>
  boundedLocalReferences(workbook, formula).filter(
    (reference) =>
      bounded.some(
        (boundedReference) => spanHolds(reference, boundedReference) && spansStartTogether(reference, boundedReference),
      ) &&
      bounded.some((boundedReference) => spanHolds(reference, boundedReference) && spansEndTogether(reference, boundedReference)),
  );
export const MOST_BLOCKS_CHECKED = 12;
export const positionKey = ({ rowIndex, columnIndex }: CellPosition): string => `${rowIndex}/${columnIndex}`;
export const withoutSpaces = (formula: string): string => formula.replaceAll(' ', '');
export const REFERENCE_NOISE_PATTERN = /[\s$()]/g;
export const isFixNoBetter = (
  workbook: WorkbookReads,
  cellId: CellId,
  fixedFormula: string,
  brokenFormula: string,
  formulaBefore: string | null,
  callsForNoNewCell: boolean,
  isLabelOrHeadingTold: boolean,
  areOwnWords = false,
): boolean =>
  withoutSpaces(fixedFormula) === withoutSpaces(brokenFormula) ||
  (workbook.decimalSign === 'comma' && bringsNewCommaNumbers(fixedFormula, [brokenFormula])) ||
  onlyDropsRefErrors(fixedFormula, brokenFormula, isLabelOrHeadingTold) ||
  (findFormulaReferences(fixedFormula, workbook.decimalSign).references.length === 0 &&
    (findFormulaReferences(brokenFormula, workbook.decimalSign).references.length > 0 || brokenFormula.includes('#REF!'))) ||
  (/^=(?:IFERROR|IFNA)\(/i.test(fixedFormula) && withoutSpaces(fixedFormula).includes(withoutSpaces(brokenFormula).slice(1))) ||
  (callsForNoNewCell &&
    areasReadOnlyBy(workbook, cellId, fixedFormula, formulaBefore === null ? [brokenFormula] : [brokenFormula, formulaBefore]).length > 0) ||
  (!areOwnWords &&
    (addsVolatileFunction(fixedFormula, brokenFormula, workbook.decimalSign) ||
      (isFormulaWrittenInWords(workbook, brokenFormula)
        ? readsBeyondBlocks(workbook, cellId, fixedFormula, brokenFormula, formulaBefore)
        : readsBeyondTables(workbook, cellId, fixedFormula, brokenFormula, formulaBefore)) ||
      readsCellsHangingOnVolatiles(workbook, cellId, fixedFormula, brokenFormula)));
export const MOST_CELLS_COUNTED_AS_READ = 1e5;
