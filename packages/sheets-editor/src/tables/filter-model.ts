import type { Asked, CellCondition, ColumnId, Filter, IdRun, NumberOperand, RowId, ValueAskedFor } from '@open-artifact/sheets-core';
/** A line of a filter: tests of which any one lets a row through. */
export type FilterLine = Filter['allOf'][number];
/** A test of a filter line: what a column of the row is asked to hold. */
export type FilterTerm = FilterLine['anyOf'][number];
/** How two conditions on a column join: both must hold, or either. */
export type ConditionJoin = 'and' | 'or';
/** The conditions a filter holds on a column, and how they join. */
export interface ConditionFilter {
  conditions: CellCondition[];
  join: ConditionJoin;
}
export function conditionFilterOfColumn(
  filter: Filter | null,
  columnId: ColumnId,
  isUsable: (condition: CellCondition) => boolean,
): ConditionFilter {
  let conditionLists = (filter?.allOf ?? []).flatMap((line) => {
    let conditions = conditionsOfFilterEntry(line, columnId);
    return conditions?.every(isUsable) === true ? [conditions] : [];
  });
  let [onlyList] = conditionLists;
  if (conditionLists.length === 1 && onlyList?.length === 2)
    return {
      conditions: onlyList,
      join: 'or',
    };
  return {
    conditions: conditionLists
      .filter((conditions) => conditions.length === 1)
      .flat()
      .slice(0, 2),
    join: 'and',
  };
}
export function withConditionFilter(
  filter: Filter | null,
  columnId: ColumnId,
  knownConditions: readonly CellCondition[],
  { conditions, join }: ConditionFilter,
): Filter | null {
  let lines = filter?.allOf ?? [];
  let [first, ...rest] = conditions.map(
    (condition): FilterTerm => ({
      c: columnId,
      asked: {
        kind: 'meets',
        condition,
      },
    }),
  );
  let newLines =
    first === undefined
      ? []
      : join === 'or'
        ? [
            {
              anyOf: [first, ...rest],
            },
          ]
        : [first, ...rest].map(
            (term) => ({
              anyOf: [term],
            }),
          );
  let replacedIndex = lines.findIndex((line) => isConditionEntryAmong(line, columnId, knownConditions));
  if (replacedIndex === -1) return filterOfEntries([...lines, ...newLines]);
  return filterOfEntries(
    lines.flatMap(
      (line, index) =>
        index === replacedIndex ? newLines : isConditionEntryAmong(line, columnId, knownConditions) ? [] : [line],
    ),
  );
}
export function withValueFilter(filter: Filter | null, columnId: ColumnId, asked: Asked | null): Filter | null {
  let lines = filter?.allOf ?? [];
  let newLines = asked === null ? [] : [filterEntry(columnId, asked)];
  let replacedIndex = lines.findIndex((line) => isValueFilterOfColumn(line, columnId));
  if (replacedIndex === -1) return filterOfEntries([...lines, ...newLines]);
  return filterOfEntries(
    lines.flatMap(
      (line, index) => (index === replacedIndex ? newLines : isValueFilterOfColumn(line, columnId) ? [] : [line]),
    ),
  );
}
export function filterReplacingColumn(filter: Filter | null, columnId: ColumnId, asked: Asked): Filter {
  let newLine = filterEntry(columnId, asked);
  let [first, ...rest] = (filter?.allOf ?? []).filter(
    ({ anyOf }) => anyOf.some((term) => term.c !== columnId),
  );
  return {
    allOf: first === undefined ? [newLine] : [first, ...rest, newLine],
  };
}
export function withValueExcluded(filter: Filter | null, columnId: ColumnId, value: ValueAskedFor | null): Filter {
  let lines = filter?.allOf ?? [];
  let excludingIndex = lines
    .map((line) => isValueFilterOfColumn(line, columnId) && line.anyOf[0].asked.kind === 'isNoneOf')
    .lastIndexOf(true);
  let excluding = lines[excludingIndex]?.anyOf[0].asked;
  let newLine = filterEntry(columnId, {
    kind: 'isNoneOf',
    values: excluding?.kind === 'isNoneOf' ? [value, ...excluding.values] : [value],
  });
  let [first, ...rest] =
    excludingIndex === -1
      ? [...lines, newLine]
      : lines.map((line, index) => (index === excludingIndex ? newLine : line));
  return {
    allOf: [first ?? newLine, ...rest],
  };
}
export function columnsOfFilterItem({ c: columnId, asked }: FilterTerm): ColumnId[] {
  let condition = asked.kind === 'meets' ? asked.condition : null;
  let operands =
    condition?.kind === 'numberIs'
      ? [condition.operand]
      : condition?.kind === 'numberIsBetween' || condition?.kind === 'numberIsNotBetween'
        ? [condition.oneEnd, condition.otherEnd]
        : [];
  return [columnId, ...operands.flatMap((operand) => (operand.kind === 'sameRowInColumn' ? [operand.c] : []))];
}
export function mapFilterColumns(filter: Filter, mapColumn: (columnId: ColumnId) => ColumnId): Filter {
  let mapOperand = (operand: NumberOperand): NumberOperand =>
      operand.kind === 'sameRowInColumn'
        ? {
            ...operand,
            c: mapColumn(operand.c),
          }
        : operand,
    mapCondition = (condition: CellCondition): CellCondition =>
      condition.kind === 'numberIs'
        ? {
            ...condition,
            operand: mapOperand(condition.operand),
          }
        : condition.kind === 'numberIsBetween' || condition.kind === 'numberIsNotBetween'
          ? {
              ...condition,
              oneEnd: mapOperand(condition.oneEnd),
              otherEnd: mapOperand(condition.otherEnd),
            }
          : condition,
    mapClause = ({ c, asked }: FilterTerm): FilterTerm => ({
      c: mapColumn(c),
      asked:
        asked.kind === 'meets'
          ? {
              ...asked,
              condition: mapCondition(asked.condition),
            }
          : asked,
    }),
    mapItem = ({ anyOf: [first, ...rest] }: FilterLine): FilterLine => ({
      anyOf: [mapClause(first), ...rest.map(mapClause)],
    }),
    [firstItem, ...otherItems] = filter.allOf;
  return {
    allOf: [mapItem(firstItem), ...otherItems.map(mapItem)],
  };
}
export function rowIdsOutOfView(runs: readonly IdRun[]): RowId[] {
  let rowIds = [];
  for (let { base, first, count } of runs)
    for (let rowNumber = first; rowNumber < first + count; rowNumber += 1) rowIds.push(`${base}.${rowNumber}`);
  return rowIds;
}
export const isValueFilterOfColumn = ({ anyOf: [first, ...rest] }: FilterLine, columnId: ColumnId): boolean =>
  rest.length === 0 && first.c === columnId && first.asked.kind !== 'meets';
export const valueFiltersOfColumn = (filter: Filter | null, columnId: ColumnId): Asked[] =>
  (filter?.allOf ?? []).flatMap((line) => (isValueFilterOfColumn(line, columnId) ? [line.anyOf[0].asked] : []));
export const MAX_FILTER_CONDITIONS = 2;
export const conditionsOfFilterEntry = ({ anyOf }: FilterLine, columnId: ColumnId): CellCondition[] | null =>
  anyOf.every((term) => term.c === columnId && term.asked.kind === 'meets')
    ? anyOf.flatMap(({ asked }) => (asked.kind === 'meets' ? [asked.condition] : []))
    : null;
export const isConditionEntryAmong = (line: FilterLine, columnId: ColumnId, conditions: readonly CellCondition[]): boolean =>
  conditionsOfFilterEntry(line, columnId)?.every((condition) => conditions.includes(condition)) === true;
export const mixedEntryIndexesOfColumn = (filter: Filter | null, columnId: ColumnId, conditions: readonly CellCondition[]): number[] =>
  (filter?.allOf ?? []).flatMap(
    (line, index) =>
      line.anyOf.some((term) => term.c === columnId) &&
      !isValueFilterOfColumn(line, columnId) &&
      !isConditionEntryAmong(line, columnId, conditions)
        ? [index]
        : [],
  );
export const filterForColumnValues = (filter: Filter | null, columnId: ColumnId): Filter | null =>
  filterOfEntries(
    (filter?.allOf ?? []).filter(
      (line) => isValueFilterOfColumn(line, columnId) || line.anyOf.every((term) => term.c !== columnId),
    ),
  );
export const isColumnFiltered = (filter: Filter | null, columnId: ColumnId): boolean =>
  filter?.allOf.some(({ anyOf }) => anyOf.some((term) => term.c === columnId)) === true;
export const filterOfEntries = ([first, ...rest]: readonly FilterLine[]): Filter | null =>
  first === undefined
    ? null
    : {
        allOf: [first, ...rest],
      };
export const filterEntry = (columnId: ColumnId, asked: Asked): FilterLine => ({
  anyOf: [
    {
      c: columnId,
      asked,
    },
  ],
});
export const filterWithoutEntry = (filter: Filter, index: number): Filter | null =>
  filterOfEntries(filter.allOf.filter((line, at) => at !== index));
export const keepFilterClausesWhereColumns = (filter: Filter, isKept: (columnId: ColumnId) => boolean): Filter | null =>
  filterOfEntries(
    filter.allOf.filter(
      ({ anyOf }) => anyOf.every((term) => columnsOfFilterItem(term).every(isKept)),
    ),
  );
