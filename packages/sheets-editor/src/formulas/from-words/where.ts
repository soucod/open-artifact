import type { DecimalSignName } from '@open-artifact/sheets-core';
import { rowSpansIn, mergedSpans, ownRowOrderOfSheet, rowIndexIn } from '../../model/line-ids.ts';
import { rowSpanOfArea, areaToA1, areaWithRowSpan, parseA1AreaAsSeen } from '../../model/a1-references.ts';
import { readsAsStored } from '../../model/workbook.ts';
import { holdsOfArea, squeezeSpaces, areAllNumbersIn } from './area-holds.ts';
import { headedColumnsOfPlainTable } from './plain-table.ts';
import { isAddressWordInSheet } from '../column-headings.ts';
import { cellValueOf } from '../../model/cell-values.ts';
import type { CellId, SheetRead, WorkbookReads } from '../../model/workbook.ts';
import type { LineSpan, OwnRowOrder } from '../../model/line-ids.ts';
import type { CellArea, CellPosition } from '../../selection/model.ts';
import type { AreaHolds, HeldKind } from './area-holds.ts';
import type { HeadedColumn } from './plain-table.ts';
/** Where a formula is written from words: the cell's place and sheet, the headed columns around it, and what the areas it may name hold. */
export interface FormulaWhere extends CellPosition {
  rowCount: number;
  columnCount: number;
  ownRowOrder: null;
  decimalSign: DecimalSignName;
  columns: HeadedColumn[];
  firstColumnIndexOfTable: number | null;
  areRecordsPeriods: boolean;
  isWordOfAHeading(word: string): boolean;
  headings: string[];
  countOfColumnsThatHold(text: string): number;
  textHeldIn(area: CellArea, text: string): string | null;
  isTextPartOfALongerOneIn(area: CellArea, text: string): boolean;
  textsWrittenOtherwiseIn(area: CellArea, text: string): string[];
  canBeAddedUpIn(area: CellArea, label: string, otherLabels: string[]): boolean;
  endsInZerosAloneIn(area: CellArea): boolean;
  mayTextBeHeldIn(area: CellArea, text: string): boolean;
  kindsHeldIn(area: CellArea): Set<HeldKind>;
  mayStartWithAHeading(area: CellArea): boolean;
  areTooManyToKnow(area: CellArea): boolean;
  holdsTextsApartBySpacesAlone(area: CellArea): boolean;
  holdsNumbersAlone(area: CellArea): boolean;
  isAnyBlankIn(area: CellArea): boolean;
  isAnyFilledAndBlankIn(area: CellArea): boolean;
  isEveryNumberWholeIn(area: CellArea): boolean;
  risesOrFallsThroughoutIn(area: CellArea): boolean;
  isAnyRepeatedIn(area: CellArea): boolean;
  numbersLieIn(area: CellArea): [number, number] | null;
  runsOnFromRowToRow(area: CellArea): boolean;
}
/** The last text split into label words, kept for the next call with the same text. */
export let lastLabelWords: { text: string; words: string[] };
export function areaToA1AsStored(area: CellArea, ownRowOrder: OwnRowOrder | null): string {
  let runs = rowSpansIn('stored', ownRowOrder, rowSpanOfArea(area));
  return [
    ...runs.slice(0, ROW_RUNS_SHOWN_IN_A1).map((run) => areaToA1(areaWithRowSpan(area, run))),
    ...(runs.length > ROW_RUNS_SHOWN_IN_A1 ? ['…'] : []),
  ].join(', ');
}
export function areasToA1AsStored(areas: CellArea[], ownRowOrder: OwnRowOrder | null): string {
  if (ownRowOrder === null) return areas.map(areaToA1).join(', ');
  let [firstArea] = areas;
  if (firstArea !== undefined && areas.length === 1) return areaToA1AsStored(firstArea, ownRowOrder);
  let byColumns = new Map<string, { like: CellArea; rows: LineSpan[] }>();
  for (let area of areas) {
    let key = `${area.leftColumnIndex} ${area.columnCount}`;
    let entry = byColumns.get(key) ?? {
      like: area,
      rows: [],
    };
    byColumns.set(key, entry);
    for (let run of rowSpansIn('stored', ownRowOrder, rowSpanOfArea(area))) entry.rows.push(run);
  }
  let storedAreas = [...byColumns.values()].flatMap(
    ({ like, rows }) => mergedSpans(rows).map((run) => areaWithRowSpan(like, run)),
  );
  let shownCount = Math.max(areas.length, ROW_RUNS_SHOWN_IN_A1);
  return [...storedAreas.slice(0, shownCount).map(areaToA1), ...(storedAreas.length > shownCount ? ['…'] : [])].join(', ');
}
export function areaPastHeading(area: CellArea): CellArea {
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = area;
  if (rowCount > 1)
    return {
      ...area,
      topRowIndex: topRowIndex + 1,
      rowCount: rowCount - 1,
    };
  return {
    ...area,
    leftColumnIndex: leftColumnIndex + 1,
    columnCount: columnCount - 1,
  };
}
export function headingSpotBefore(area: CellArea): CellArea | null {
  let { topRowIndex, leftColumnIndex, rowCount } = area;
  if (rowCount > 1)
    return topRowIndex === 0
      ? null
      : {
          ...area,
          topRowIndex: topRowIndex - 1,
          rowCount: 1,
        };
  return leftColumnIndex === 0
    ? null
    : {
        ...area,
        leftColumnIndex: leftColumnIndex - 1,
        columnCount: 1,
      };
}
export function holdsPeriods(holds: AreaHolds | null) {
  if (holds === null || holds.filledCount === 0) return false;
  if (holds.kinds.size === 1 && holds.kinds.has('date')) return true;
  let [lowest = 0, highest = 0] = holds.numbersLieIn ?? [];
  if (holds.numberCount === holds.filledCount && holds.isEveryNumberWhole && lowest >= 1900 && highest <= 2100) return true;
  return (
    holds.textCount === holds.filledCount &&
    Array.from(holds.spelled.keys()).every((text) => PERIOD_TEXT_PATTERN.test(text.trim()))
  );
}
export function isRunningTotalOfColumns(totals: number[], columns: number[][]) {
  let steps = totals.slice(1).map((total, index) => total - (totals[index] ?? 0));
  let stepsFollow = (stepAt: (index: number) => number) =>
    steps.every((step, index) => Math.abs(step - stepAt(index + 1)) < 0.000001);
  if (steps.length < MIN_STEPS_FOR_RUNNING_TOTAL || steps.every((step) => step === 0)) return false;
  return columns.some(
    (column) =>
      stepsFollow((index) => column[index] ?? 0) ||
      stepsFollow((index) => -(column[index] ?? 0)) ||
      columns.some(
        (otherColumn) =>
          otherColumn !== column && stepsFollow((index) => (column[index] ?? 0) - (otherColumn[index] ?? 0)),
      ),
  );
}
export function holdsWholeWord(text: string, word: string) {
  if (text.length <= word.length || (/^(?:not|non|no|never)[\s-]+$/.test(text.slice(0, -word.length)) && text.endsWith(word))) return false;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1))
    if (!isLetterOrDigit(text[at - 1]) && !isLetterOrDigit(text[at + word.length])) return true;
  return false;
}
export function endsInZerosAlone(numbers: number[]) {
  let firstZeroAt = numbers.indexOf(0);
  return (
    firstZeroAt > 0 &&
    numbers.slice(firstZeroAt).every((number) => number === 0) &&
    numbers.slice(0, firstZeroAt).every((number) => number > 0)
  );
}
export function isSubsequenceOf(short: string, long: string) {
  let matched = 0;
  for (let character of long) if (character === short[matched]) matched += 1;
  return matched === short.length;
}
export function isInflectedForm(stem: string, word: string) {
  let ending = word.slice(stem.length);
  return /^\p{L}?(?:ing|ed)$/u.test(ending) || /^(?:est|ern)$/.test(ending.startsWith(stem.at(-1) ?? '') ? ending.slice(1) : ending);
}
export function isLabelAbbreviationOf(label: string, word: string, isOneOfSeveralWords: boolean) {
  let stem = withoutTrailingDot(label);
  if (/\P{L}/u.test(stem + word)) return false;
  if (stem.length === 1) return word.startsWith(stem) && (word.length > 3 || !isOneOfSeveralWords);
  if (word.length < stem.length + 2) return false;
  let isShort = stem.length <= MAX_SHORT_ABBREVIATION_LENGTH;
  if (!word.startsWith(stem))
    return isShort && !/[aeiou]/.test(stem.slice(1)) && stem[0] === word[0] && stem.at(-1) === word.at(-1) && isSubsequenceOf(stem, word);
  if (isOneOfSeveralWords || label.endsWith('.')) return true;
  return isShort && word.length > stem.length + 2 && !isInflectedForm(stem, word);
}
export function isConsonantAbbreviationOf(label: string, word: string) {
  let stem = withoutTrailingDot(label);
  return (
    /^\p{L}{2,4}$/u.test(stem) && !/[aeiou]/.test(stem.slice(1)) && stem[0] === word[0] && stem.length < word.length && isSubsequenceOf(stem, word)
  );
}
export function isLikelyTypoOf(word: string, otherWord: string) {
  if (Math.min(word.length, otherWord.length) < MIN_TYPO_WORD_LENGTH || Math.abs(word.length - otherWord.length) > 1) return false;
  if (word[0] !== otherWord[0] || word.at(-1) !== otherWord.at(-1) || /\P{L}/u.test(word + otherWord)) return false;
  let sameUpTo = 0;
  while (sameUpTo < word.length && word[sameUpTo] === otherWord[sameUpTo]) sameUpTo += 1;
  let [rest, otherRest] = [word.slice(sameUpTo), otherWord.slice(sameUpTo)];
  return (
    rest.slice(1) === otherRest.slice(1) ||
    rest.slice(1) === otherRest ||
    rest === otherRest.slice(1) ||
    (rest[0] === otherRest[1] && rest[1] === otherRest[0] && rest.slice(2) === otherRest.slice(2))
  );
}
export function wordListsDifferByOneVariant(words: string[], otherWords: string[]) {
  let differences = words.flatMap((wordAt, index): [string, string][] => {
    let otherWordAt = otherWords[index] ?? '';
    return withoutTrailingDot(wordAt) === withoutTrailingDot(otherWordAt) ? [] : [[wordAt, otherWordAt]];
  });
  let [[word, otherWord] = ['', '']] = differences;
  if (words.length !== otherWords.length || differences.length !== 1) return false;
  let isWordShorter = withoutTrailingDot(word).length <= withoutTrailingDot(otherWord).length;
  let [shorter, longer] = isWordShorter ? [word, otherWord] : [otherWord, word];
  let [shorterStem, longerStem] = [withoutTrailingDot(shorter), withoutTrailingDot(longer)];
  return (
    longerStem === shorterStem + 's' ||
    longerStem === shorterStem + 'es' ||
    isLabelAbbreviationOf(shorter, longerStem, words.length > 1) ||
    isLikelyTypoOf(shorterStem, longerStem)
  );
}
export function isInitialsOf(text: string, words: string[]) {
  let initials = words.map((word) => (/^\p{N}/u.test(word) ? word : word.slice(0, 1))).join('');
  return words.length > 1 && text.startsWith(initials) && text.length <= initials.length + 1;
}
export function isWrittenOtherwise(label: string, words: string) {
  if (label === words) return false;
  let [labelCompacted, wordsCompacted] = [compactLabel(label), compactLabel(words)];
  let [shorter, longer] =
    labelCompacted.length <= wordsCompacted.length ? [labelCompacted, wordsCompacted] : [wordsCompacted, labelCompacted];
  if (shorter === '') return false;
  if (
    longer === shorter ||
    longer === shorter + 's' ||
    longer === shorter + 'es' ||
    (shorter.endsWith('y') && longer === shorter.slice(0, -1) + 'ies')
  )
    return true;
  if (shorter[0] !== longer[0] || shorter.replaceAll(/\P{N}/gu, '') !== longer.replaceAll(/\P{N}/gu, '')) return false;
  if (lastLabelWords.text !== words)
    lastLabelWords = {
      text: words,
      words: labelWords(words),
    };
  let [labelWordList, wordList] = [labelWords(label), lastLabelWords.words];
  let [fewerWords, moreWords] = labelWordList.length <= wordList.length ? [labelWordList, wordList] : [wordList, labelWordList];
  if (fewerWords.length === moreWords.length) return wordListsDifferByOneVariant(labelWordList, wordList);
  return (
    (fewerWords.length > 0 &&
      fewerWords.every((word, index) => withoutTrailingDot(word) === withoutTrailingDot(moreWords[index] ?? ''))) ||
    (fewerWords.length === 1 && isInitialsOf(withoutTrailingDot(fewerWords[0] ?? ''), moreWords))
  );
}
export function hasInflectedWordOf(label: string, words: string) {
  let wordList = labelWords(words);
  return labelWords(label).some((labelWord, index) => {
    let word = wordList[index] ?? '';
    let [shorter, longer] = labelWord.length <= word.length ? [labelWord, word] : [word, labelWord];
    return shorter !== '' && shorter !== longer && longer.startsWith(shorter) && isInflectedForm(shorter, longer);
  });
}
export function startsWithWordsOf(text: string, start: string) {
  let [textWords, startWords] = [labelWords(text), labelWords(start)];
  return (
    textWords.length > startWords.length &&
    startWords.every((word, index) => withoutTrailingDot(word) === withoutTrailingDot(textWords[index] ?? ''))
  );
}
export function canBeAddedUpWith(label: string, otherLabels: string[], labelsInColumn: string[]) {
  let labels = [label, ...otherLabels];
  let othersInColumn = labelsInColumn.filter((heldLabel) => !labels.includes(heldLabel));
  let longerLabels = otherLabels.filter((otherLabel) => compactLabel(otherLabel).length > compactLabel(label).length);
  return (
    !otherLabels.some(
      (otherLabel) =>
        startsWithWordsOf(otherLabel, label) ||
        startsWithWordsOf(label, otherLabel) ||
        hasInflectedWordOf(otherLabel, label) ||
        trailingSigns(otherLabel) !== trailingSigns(label) ||
        numbersInText(otherLabel) !== numbersInText(label),
    ) &&
    longerLabels.every(
      (longerLabel) =>
        longerLabels.every(
          (otherLongerLabel) => otherLongerLabel === longerLabel || isWrittenOtherwise(otherLongerLabel, longerLabel),
        ),
    ) &&
    !labels.some(
      (ownLabel) =>
        othersInColumn.some(
          (otherInColumn) =>
            holdsWholeWord(otherInColumn, ownLabel) ||
            isConsonantAbbreviationOf(otherInColumn, ownLabel) ||
            isWrittenOtherwise(otherInColumn, ownLabel),
        ),
    )
  );
}
export function formulaFromWordsWhereAt(
  reads: WorkbookReads,
  cellId: CellId,
  isRowShown: (rowIndex: number) => boolean,
  isTableLooked = true,
): FormulaWhere | null {
  let workbook = readsAsStored(reads);
  let { sheetId } = cellId;
  let position = workbook.positionOfCell(cellId);
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === sheetId);
  if (position === null || sheet === undefined) return null;
  let ownRowOrder = ownRowOrderOfSheet(reads, sheetId);
  let holdsOf = (area: CellArea) => holdsOfArea(workbook, sheetId, area);
  let columns = isTableLooked
    ? headedColumnsOfPlainTable(workbook, cellId, (rowIndex) => isRowShown(rowIndexIn('seen', ownRowOrder, rowIndex)))
    : [];
  let sheetAsItStands = workbook.sheetAsItStands(sheetId);
  let cached = sheetAsItStands === null ? undefined : formulaFromWordsWhereCache.get(sheetAsItStands);
  let isCacheFresh =
    cached?.cellId.rowId === cellId.rowId &&
    cached.cellId.columnId === cellId.columnId &&
    cached.where.decimalSign === workbook.decimalSign &&
    cached.where.columns.length === columns.length;
  if (cached !== undefined && isCacheFresh) return cached.where;
  let firstColumnArea = parseA1AreaAsSeen(columns[0]?.cells ?? '', sheet);
  let firstColumnIndex = Math.min(...workbook.columnIndexesOnShowIn(sheetId, 0));
  let recordsArea =
    firstColumnArea === null
      ? null
      : {
          ...firstColumnArea,
          leftColumnIndex: firstColumnIndex,
        };
  let columnAreas =
    firstColumnArea === null
      ? []
      : workbook.columnIndexesOnShowIn(sheetId, 0).map(
          (columnIndex): CellArea => ({
            topRowIndex: firstColumnArea.topRowIndex,
            rowCount: firstColumnArea.rowCount,
            leftColumnIndex: columnIndex,
            columnCount: 1,
          }),
        );
  let runsOnCache = new Map<number, boolean>();
  let risesOrFallsCache = new Map<string, boolean>();
  let where: FormulaWhere = {
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    ownRowOrder: null,
    ...position,
    decimalSign: workbook.decimalSign,
    columns,
    firstColumnIndexOfTable: recordsArea === null ? null : firstColumnIndex,
    areRecordsPeriods: holdsPeriods(recordsArea === null ? null : holdsOf(recordsArea)),
    isWordOfAHeading: (word) => isAddressWordInSheet(word, sheetId, workbook),
    headings: columnAreas.flatMap(({ leftColumnIndex }) => {
      let headingCellId = workbook.cellIdAt(sheetId, 0, leftColumnIndex);
      let value = headingCellId === null ? null : cellValueOf(workbook.cellOnShowIn(headingCellId));
      return value?.kind === 'text' ? [value.value] : [];
    }),
    countOfColumnsThatHold: (text) =>
      columnAreas.filter((columnArea) => holdsOf(columnArea).squeezed.has(squeezeSpaces(text))).length,
    textHeldIn: (area, text) =>
      holdsOf(area).squeezed.get(squeezeSpaces(text)) === text ? (holdsOf(area).spelled.get(text) ?? null) : null,
    isTextPartOfALongerOneIn: (area, text) =>
      Array.from(holdsOf(area).spelled.keys()).some((heldText) => holdsWholeWord(heldText, text)),
    textsWrittenOtherwiseIn: (area, text) =>
      Array.from(holdsOf(area).spelled).flatMap(
        ([lowered, spelled]) => (isWrittenOtherwise(lowered, text) ? [spelled] : []),
      ),
    canBeAddedUpIn: (area, label, otherLabels) =>
      canBeAddedUpWith(label, otherLabels, Array.from(holdsOf(area).spelled.keys())),
    endsInZerosAloneIn(area) {
      if (area.columnCount !== 1) return false;
      return endsInZerosAlone(
        Array.from(
          {
            length: area.rowCount,
          },
          (_, rowOffset) => {
            let rowCellId = workbook.cellIdAt(sheetId, area.topRowIndex + rowOffset, area.leftColumnIndex);
            return rowCellId === null ? undefined : holdsOf(area).byRow.get(rowCellId.rowId);
          },
        ).flatMap((value) => (typeof value === 'number' ? [value] : [])),
      );
    },
    mayTextBeHeldIn: (area, text) => holdsOf(area).isTooMany || holdsOf(area).squeezed.has(squeezeSpaces(text)),
    kindsHeldIn: (area) => holdsOf(area).kinds,
    mayStartWithAHeading(area) {
      let headingSpot = headingSpotBefore(area);
      if (headingSpot !== null && holdsOf(headingSpot).filledCount > 0) return false;
      let firstLine =
        area.rowCount > 1
          ? {
              ...area,
              rowCount: 1,
            }
          : {
              ...area,
              columnCount: 1,
            };
      return holdsOf(firstLine).isTooMany || holdsOf(firstLine).textCount > 0;
    },
    areTooManyToKnow: (area) => holdsOf(area).isTooMany,
    holdsTextsApartBySpacesAlone: (area) => Array.from(holdsOf(area).squeezed.values()).includes(null),
    holdsNumbersAlone(area) {
      let headingSpot = headingSpotBefore(area);
      let body = headingSpot === null || holdsOf(headingSpot).filledCount === 0 ? areaPastHeading(area) : area;
      let [holds, bodyHolds] = [holdsOf(area), holdsOf(body)];
      if (holds.isTooMany) return areAllNumbersIn(workbook, sheetId, body);
      return holds.numberCount > 0 && bodyHolds.numberCount === bodyHolds.filledCount;
    },
    isAnyBlankIn: (area) => holdsOf(area).filledCount < area.rowCount * area.columnCount,
    isAnyFilledAndBlankIn: (area) => holdsOf(area).isAnyFilledAndBlank,
    isEveryNumberWholeIn: (area) => holdsOf(area).isEveryNumberWhole,
    risesOrFallsThroughoutIn(area) {
      if (area.columnCount !== 1) return false;
      let cacheKey = [area.leftColumnIndex, area.topRowIndex, area.rowCount].join();
      let risesOrFalls = risesOrFallsCache.get(cacheKey);
      if (risesOrFalls !== undefined) return risesOrFalls;
      risesOrFalls = risesOrFallsThroughout(
        Array.from(
          {
            length: area.rowCount,
          },
          (_, rowOffset) => {
            let rowCellId = workbook.cellIdAt(sheetId, area.topRowIndex + rowOffset, area.leftColumnIndex);
            return rowCellId === null ? undefined : holdsOf(area).byRow.get(rowCellId.rowId);
          },
        ).flatMap((value) => (typeof value === 'number' ? [value] : [])),
      );
      risesOrFallsCache.set(cacheKey, risesOrFalls);
      return risesOrFalls;
    },
    isAnyRepeatedIn: (area) => holdsOf(area).isAnyRepeated,
    numbersLieIn: (area) => holdsOf(area).numbersLieIn,
    runsOnFromRowToRow(area) {
      let runsOn = runsOnCache.get(area.leftColumnIndex);
      if (runsOn !== undefined) return runsOn;
      let rowIds = Array.from(
        {
          length: area.rowCount,
        },
        (_, rowOffset) => workbook.cellIdAt(sheetId, area.topRowIndex + rowOffset, area.leftColumnIndex),
      ).flatMap((rowCellId) => (rowCellId === null ? [] : [rowCellId.rowId]));
      let numbersByRow = ({ byRow }: AreaHolds) => rowIds.map((rowId) => byRow.get(rowId) ?? 0);
      let otherColumns = columns.flatMap((column) => {
        let columnArea = parseA1AreaAsSeen(column.cells, sheet);
        return columnArea !== null && columnArea.leftColumnIndex !== area.leftColumnIndex && holdsOf(columnArea).numberCount > 0
          ? [numbersByRow(holdsOf(columnArea))]
          : [];
      });
      let isRunningTotal = holdsOf(area).numberCount === rowIds.length && isRunningTotalOfColumns(numbersByRow(holdsOf(area)), otherColumns);
      runsOnCache.set(area.leftColumnIndex, isRunningTotal);
      return isRunningTotal;
    },
  };
  if (sheetAsItStands !== null)
    formulaFromWordsWhereCache.set(sheetAsItStands, {
      cellId,
      where,
    });
  return where;
}
export const ROW_RUNS_SHOWN_IN_A1 = 3;
export const PERIOD_TEXT_PATTERN =
  /^(?:jan|feb|m[aä]r|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|h[12]|[1-4]q\d|[12]h\d|(?:cw|[wpmy])\d|fy|w(?:ee)?k|week|month|day|mon|tue|wed|thu|fri|sat|sun|(?:year|quarter|period|sprint|season|term|semester|spring|summer|fall|autumn|winter)(?![a-z])|(?:19|20)\d\d)/;
export const MIN_STEPS_FOR_RUNNING_TOTAL = 3;
/** The last place a formula was written from words in each sheet, and what was found there. */
export const formulaFromWordsWhereCache = new WeakMap<SheetRead, { cellId: CellId; where: FormulaWhere }>();
export const isLetterOrDigit = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}]/u.test(character);
export const risesOrFallsThroughout = (numbers: number[]) =>
  numbers.length > 2 &&
  (numbers.every((number, index) => index === 0 || number > (numbers[index - 1] ?? number)) ||
    numbers.every((number, index) => index === 0 || number < (numbers[index - 1] ?? number)));
export const compactLabel = (label: string): string =>
  label
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(/[^\p{L}\p{N}]+/gu, '');
export const labelWords = (text: string): string[] =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(/[\p{M}'’]+|\.(?=[\p{L}\p{N}.])/gu, '')
    .split(/[^\p{L}\p{N}.]+/u)
    .filter((word) => word !== '' && word !== '.');
export const withoutTrailingDot = (word: string): string => (word.endsWith('.') ? word.slice(0, -1) : word);
export const MAX_SHORT_ABBREVIATION_LENGTH = 4;
export const MIN_TYPO_WORD_LENGTH = 6;
lastLabelWords = {
  text: '',
  words: [],
};
export const trailingSigns = (label: string): string => /[+\-#]+$/.exec(label.trim())?.[0] ?? '';
export const numbersInText = (label: string): string => (label.match(/\p{N}+/gu) ?? []).join(' ');
