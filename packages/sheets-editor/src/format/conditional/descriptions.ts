import type {
  CellCondition,
  ColumnId,
  Matches,
  NumberOperand,
  RangeCorners,
  RuleInIds,
  SheetId,
  TableWithColumns,
  Test,
} from '@open-artifact/sheets-core';
import { tableBoundsOf, rowRangeOfTable } from '../../tables/finding.ts';
import { cellValueOf } from '../../model/cell-values.ts';
import { columnLetters } from '../../model/a1-references.ts';
import { numberFormatOfCell, tableAtCellIfAny } from '../../model/workbook.ts';
import { withDecimalSign } from '../number-signs.ts';
import { areRangesOneSameColumn, isWholeRowRule, testedColumnOf, firstColumnOfRule } from './conditions.ts';
import { areasToA1AsStored } from '../../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../../model/line-ids.ts';
import type { CellId, SheetRead, WorkbookReads } from '../../model/workbook.ts';
import type { KindedNumberFormat } from '../../model/cell-format.ts';
import type { CellArea, CellPosition } from '../../selection/model.ts';
import type {
  RuleColumn,
  RuleCondition,
  RuleDescription,
  RuleEntry,
  RuleOperand,
  RuleTest,
} from '../../messages/conditional-format.ts';
/** Where a rule's words are read from: its sheet, the top row of its cells, and those cells. */
export interface RulePlace {
  reads: WorkbookReads;
  sheetId: SheetId;
  topRowIndex: number | null;
  areas?: CellArea[];
}
/** A cell that holds something, with where it is. */
export interface FilledCellAt extends CellPosition {
  cellId: CellId;
}
export function areaOfRuleRange(reads: WorkbookReads, sheetId: SheetId, { topLeft, bottomRight }: RangeCorners): CellArea | null {
  let topLeftPosition = reads.positionOfCell({
    sheetId,
    rowId: topLeft.r,
    columnId: topLeft.c,
  });
  let bottomRightPosition = reads.positionOfCell({
    sheetId,
    rowId: bottomRight.r,
    columnId: bottomRight.c,
  });
  if (topLeftPosition === null || bottomRightPosition === null) return null;
  let [topRowIndex, leftColumnIndex] = [
    Math.min(topLeftPosition.rowIndex, bottomRightPosition.rowIndex),
    Math.min(topLeftPosition.columnIndex, bottomRightPosition.columnIndex),
  ];
  return {
    topRowIndex,
    leftColumnIndex,
    rowCount: Math.abs(topLeftPosition.rowIndex - bottomRightPosition.rowIndex) + 1,
    columnCount: Math.abs(topLeftPosition.columnIndex - bottomRightPosition.columnIndex) + 1,
  };
}
export function tableOfCells(reads: WorkbookReads, sheetId: SheetId, cells: FilledCellAt[]): TableWithColumns | null {
  let sheet = reads.sheetAsItStands(sheetId);
  let knownTables = (sheet === null ? undefined : tablesFoundBySheet.get(sheet)) ?? [];
  let tableHasCell = ({ table }: TableWithColumns, { rowIndex, columnIndex }: CellPosition) => {
    let shape = tableBoundsOf(table, reads);
    if (shape === null) return false;
    let [rows, { columns }] = [rowRangeOfTable(shape), shape];
    return rowIndex >= rows.first && rowIndex <= rows.last && columnIndex >= columns.first && columnIndex <= columns.last;
  };
  for (let cell of cells) {
    let table = knownTables.find((known) => tableHasCell(known, cell));
    if (table !== undefined) return table;
  }
  for (let { cellId: cell } of cells) {
    let table = tableAtCellIfAny(reads, cell);
    if (table === null) continue;
    if (sheet !== null && !knownTables.includes(table)) tablesFoundBySheet.set(sheet, [...knownTables, table]);
    return table;
  }
  return null;
}
export function columnNameInTable(
  reads: WorkbookReads,
  { table, columns }: TableWithColumns,
  columnId: ColumnId,
  columnIndex: number,
): string | null {
  let header = tableBoundsOf(table, reads)?.header ?? null;
  if (header === null) return null;
  let headerValues = Array.from(
    {
      length: header.last - header.first + 1,
    },
    (_, offset) => {
      let cellId = reads.cellIdAt(table.sheetId, header.first + offset, columnIndex);
      return cellId === null ? null : cellValueOf(reads.cellOnShowIn(cellId));
    },
  ).filter((value) => value !== null);
  let knownName = columns.find(({ c }) => c === columnId)?.name ?? null;
  if (headerValues.some(({ kind }) => kind !== 'text')) return knownName;
  let headerTexts = headerValues
    .flatMap((value) => (value.kind === 'text' ? [value.value.trim().replaceAll(/\s+/g, ' ')] : []))
    .filter((text) => text !== '');
  return knownName !== null && (headerTexts.includes(knownName) || headerTexts.join(' · ') === knownName) ? knownName : (headerTexts.at(-1) ?? null);
}
export function tableColumnNameOf({ reads, sheetId, topRowIndex, areas = [] }: RulePlace, c: ColumnId): { name: string | null } | null {
  let columnIndex = reads.columnIndexOf(sheetId, c);
  if (columnIndex === null || topRowIndex === null) return null;
  let { topRowIndex: areaTop, rowCount: areaRowCount } = areas.find(
    ({ leftColumnIndex, columnCount }) =>
      columnIndex >= leftColumnIndex && columnIndex < leftColumnIndex + columnCount,
  ) ??
    areas.find((area) => area.topRowIndex === topRowIndex) ?? {
      topRowIndex,
      rowCount: 1,
    };
  let topCells = Array.from(
    {
      length: Math.min(areaRowCount, MAX_ROWS_SCANNED_FOR_TABLE),
    },
    (_, offset): FilledCellAt[] => {
      let cellId = reads.cellIdAt(sheetId, areaTop + offset, columnIndex);
      return cellId === null || cellValueOf(reads.cellOnShowIn(cellId)) === null
        ? []
        : [
            {
              cellId,
              rowIndex: areaTop + offset,
              columnIndex,
            },
          ];
    },
  ).flat();
  let table = tableOfCells(reads, sheetId, topCells.slice(0, MAX_CELLS_FOR_TABLE));
  return table === null
    ? null
    : {
        name: columnNameInTable(reads, table, c, columnIndex),
      };
}
export function describeColumn(place: RulePlace, c: ColumnId): RuleColumn {
  let { reads, sheetId, topRowIndex } = place;
  let columnIndex = reads.columnIndexOf(sheetId, c);
  if (columnIndex === null)
    return {
      kind: 'gone',
    };
  let lettered: RuleColumn = {
    kind: 'lettered',
    letters: columnLetters(columnIndex),
  };
  let inTable = tableColumnNameOf(place, c);
  if (inTable !== null)
    return inTable.name === null
      ? lettered
      : {
          kind: 'named',
          name: inTable.name,
        };
  let shownValueAt = (rowIndex: number) => {
    let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
    return cellId === null ? null : cellValueOf(reads.cellOnShowIn(cellId));
  };
  let hasValueAbove = (rowIndex: number) => rowIndex > 0 && shownValueAt(rowIndex - 1) !== null;
  let startRow = topRowIndex ?? 0;
  let headingRow = startRow;
  while (startRow - headingRow < MAX_ROWS_UP_TO_HEADING && hasValueAbove(headingRow)) headingRow -= 1;
  let headingValue = headingRow === startRow || hasValueAbove(headingRow) ? null : shownValueAt(headingRow);
  let headingText = headingValue?.kind === 'text' ? headingValue.value.trim() : '';
  return headingText === ''
    ? lettered
    : {
        kind: 'named',
        name: headingText,
      };
}
export function numberFormatAtTopOfColumn({ reads, sheetId, topRowIndex }: RulePlace, c: ColumnId | null): KindedNumberFormat | null {
  let columnIndex = c === null ? null : reads.columnIndexOf(sheetId, c);
  let cellId = columnIndex === null || topRowIndex === null ? null : reads.cellIdAt(sheetId, topRowIndex, columnIndex);
  return cellId === null ? null : numberFormatOfCell(reads, cellId);
}
export function showNumberInColumnFormat(place: RulePlace, number: number, c: ColumnId | null): string {
  let pattern = numberFormatAtTopOfColumn(place, c)?.pattern ?? 'General';
  return (
    place.reads.shownWithRoomForAll(
      {
        kind: 'number',
        value: number,
      },
      pattern,
    ) ?? withDecimalSign(String(number), place.reads.decimalSign)
  );
}
export function describeOperand(place: RulePlace, operand: NumberOperand, c: ColumnId | null): RuleOperand {
  switch (operand.kind) {
    case 'sameRowInColumn':
      return {
        kind: 'column',
        column: describeColumn(place, operand.c),
      };
    case 'daysFromToday':
      if (operand.days === 0)
        return {
          kind: 'today',
        };
      return {
        kind: operand.days > 0 ? 'daysFromToday' : 'daysAgo',
        days: Math.abs(operand.days),
      };
    case 'number':
      return {
        kind: 'shown',
        text: showNumberInColumnFormat(place, operand.number, c),
      };
  }
}
export function describeCondition(place: RulePlace, condition: CellCondition, c: ColumnId | null): RuleCondition {
  switch (condition.kind) {
    case 'numberIs':
      return {
        ...condition,
        operand: describeOperand(place, condition.operand, c),
      };
    case 'numberIsBetween':
    case 'numberIsNotBetween':
      return {
        ...condition,
        oneEnd: describeOperand(place, condition.oneEnd, c),
        otherEnd: describeOperand(place, condition.otherEnd, c),
      };
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
    case 'isAnError':
    case 'textIs':
    case 'textIsNot':
    case 'textContains':
    case 'textDoesNotContain':
    case 'textStartsWith':
    case 'textEndsWith':
    case 'booleanIs':
    case 'isAmongTheLargest':
    case 'isAmongTheSmallest':
      return condition;
  }
}
export function describeRuleTest(place: RulePlace, test: Test, rangeColumn: ColumnId | null, isAcrossColumns: boolean): RuleTest {
  let c = test.tested.kind === 'theCellItself' ? rangeColumn : test.tested.c;
  let formatKind = numberFormatAtTopOfColumn(place, c)?.kind;
  return {
    column:
      c === null || (test.tested.kind === 'theCellItself' && isAcrossColumns)
        ? {
            kind: 'eachCell',
          }
        : describeColumn(place, c),
    isOfDates: formatKind === 'date' || formatKind === 'dateAndTime' || isRelativeDateCondition(test.condition),
    condition: describeCondition(place, test.condition, c),
  };
}
export function describeColumnCondition(place: RulePlace, c: ColumnId, column: RuleColumn, condition: CellCondition): RuleTest {
  let formatKind = numberFormatAtTopOfColumn(place, c)?.kind;
  return {
    column,
    isOfDates: formatKind === 'date' || formatKind === 'dateAndTime' || isRelativeDateCondition(condition),
    condition: describeCondition(place, condition, c),
  };
}
export function describeRule(reads: WorkbookReads, sheetId: SheetId, rule: RuleInIds, matches: Matches | null): RuleDescription {
  let areas = areasOfRuleRanges(reads, sheetId, rule.ranges);
  let topRowIndex = areas.length === 0 ? null : Math.min(...areas.map((area) => area.topRowIndex));
  let place: RulePlace = {
    reads,
    sheetId,
    topRowIndex,
    areas,
  };
  let isAcrossColumns = !areRangesOneSameColumn(rule.ranges);
  let rangeColumn = rule.ranges[0]?.topLeft.c ?? null;
  let { effect } = rule;
  let [firstTest, ...moreTests] = effect.kind === 'formatWhere' ? effect.allOf : [];
  return {
    cells: areasToA1AsStored(areas, ownRowOrderOfSheet(reads, sheetId)),
    isWholeRow: isWholeRowRule(rule),
    matches,
    outOf: {
      cells: areas.reduce((total, { rowCount, columnCount }) => total + rowCount * columnCount, 0),
      rows: areas.reduce((total, { rowCount }) => total + rowCount, 0),
    },
    does:
      effect.kind === 'formatWhere' && firstTest !== undefined
        ? {
            kind: 'formatWhere',
            tests: [
              describeRuleTest(place, firstTest, rangeColumn, isAcrossColumns),
              ...moreTests.map((test) => describeRuleTest(place, test, rangeColumn, isAcrossColumns)),
            ],
            format: effect.format,
          }
        : {
            kind: 'colorScale',
            column:
              rangeColumn === null || isAcrossColumns
                ? {
                    kind: 'eachCell',
                  }
                : describeColumn(place, rangeColumn),
            colors:
              effect.kind === 'colorScale'
                ? [effect.lowest, effect.middle, effect.highest].flatMap((point) => (point === null ? [] : [point.color]))
                : [],
          },
  };
}
export function oneColorPerTextColumn(rules: RuleInIds[]): ColumnId | null {
  let testedColumns = rules.map((rule) => {
    let { effect } = rule;
    if (effect.kind !== 'formatWhere' || effect.allOf.length > 1) return null;
    let [test] = effect.allOf;
    return test.condition.kind === 'textIs' && effect.format.fillColor !== undefined ? testedColumnOf(test, firstColumnOfRule(rule)) : null;
  });
  let [firstColumn = null] = testedColumns;
  return testedColumns.every((c) => c === firstColumn) ? firstColumn : null;
}
export function describeRules(reads: WorkbookReads, sheetId: SheetId, rules: RuleInIds[], matches: Matches | null): RuleEntry {
  let firstDescribed = describeRule(reads, sheetId, rules[0], matches);
  if (rules.length === 1)
    return {
      kind: 'one',
      rule: firstDescribed,
    };
  let areas = rules.flatMap(({ ranges }) => areasOfRuleRanges(reads, sheetId, ranges));
  let cells = areasToA1AsStored(
    areas.filter(
      (area, areaIndex) =>
        !areas.some(
          (otherArea, otherIndex) =>
            isRuleAreaWithin(area, otherArea) && (otherIndex < areaIndex || !isRuleAreaWithin(otherArea, area)),
        ),
    ),
    ownRowOrderOfSheet(reads, sheetId),
  );
  if (oneColorPerTextColumn(rules) === null || firstDescribed.does.kind !== 'formatWhere')
    return {
      kind: 'several',
      first: firstDescribed,
      cells,
      ruleCount: rules.length,
    };
  return {
    kind: 'oneColorForEach',
    column: firstDescribed.does.tests[0].column,
    isWholeRow: firstDescribed.isWholeRow,
    cells,
    fills: rules.flatMap(
      ({ effect }) =>
        effect.kind === 'formatWhere' && effect.format.fillColor !== undefined ? [effect.format.fillColor] : [],
    ),
    ruleCount: rules.length,
  };
}
export const areasOfRuleRanges = (reads: WorkbookReads, sheetId: SheetId, ranges: readonly RangeCorners[]): CellArea[] =>
  ranges.flatMap((range) => {
    let area = areaOfRuleRange(reads, sheetId, range);
    return area === null ? [] : [area];
  });
export const MAX_ROWS_UP_TO_HEADING = 200;
export const MAX_ROWS_SCANNED_FOR_TABLE = 10;
export const MAX_CELLS_FOR_TABLE = 3;
export const tablesFoundBySheet = new WeakMap<SheetRead, TableWithColumns[]>();
export const isRelativeDateCondition = (condition: CellCondition): boolean =>
  (condition.kind === 'numberIs' && condition.operand.kind === 'daysFromToday') ||
  ((condition.kind === 'numberIsBetween' || condition.kind === 'numberIsNotBetween') &&
    (condition.oneEnd.kind === 'daysFromToday' || condition.otherEnd.kind === 'daysFromToday'));
export const isRuleAreaWithin = (area: CellArea, outer: CellArea): boolean =>
  area.topRowIndex >= outer.topRowIndex &&
  area.leftColumnIndex >= outer.leftColumnIndex &&
  area.topRowIndex + area.rowCount <= outer.topRowIndex + outer.rowCount &&
  area.leftColumnIndex + area.columnCount <= outer.leftColumnIndex + outer.columnCount;
