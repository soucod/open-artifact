import type { CellConditionKind, ColumnId, FormatOfACondition, KindOfAColumn } from '@open-artifact/sheets-core';
import type { TableHolds } from '../state/initial-state.ts';
import type { TypedWord } from './tokens.ts';
import type { ColumnTest, RuleWordsSituation, TestsNotRead } from './rule-tests.ts';
import type { FormatPart, RuleWordsNotRead } from './rule-formats.ts';
import { wordsMatchAt, plainWordsOf, splitIntoWords } from './tokens.ts';
import { columnNamedAt, isColumnOfFewValues } from './column-names.ts';
import { measureOfColumn } from './column-holds.ts';
import {
  hasNumbersAsText,
  isRankLikeColumn,
  readWordsAsTests,
  rewriteWords,
  NO_WORD_REWRITES,
  columnHasText,
  isSameAsJson,
  isAfterTextTest,
  onlySelectedColumn,
  TEXT_TEST_KINDS,
  plainTextOfWords,
  foreignNumberPattern,
  crossMarkPattern,
  leaveOutPattern,
  thousandsRangePattern,
  monthYearPattern,
  IS_ARE_WORDS,
  isSameTextIgnoringCase,
  STARTS_ENDS_WORDS,
  isTextTestAt,
  ruleWordRewrites,
  columnAfterWord,
  MOST_RULE_READINGS,
  isBeforeTodayTest,
  hasStatusLikeColumns,
  testsNotDone,
  operandsOfCondition,
} from './rule-tests.ts';
import {
  isUnquotedWord,
  RELATIVE_PRONOUNS,
  HUE_WORDS,
  FORMAT_PARTS_NOT_READ,
  RECORD_KIND_NOUNS,
  CELL_NOUNS,
  WHOLE_WORDS,
  formatPartsAtStart,
  formatPartsAtEnd,
  formatPartsInMiddle,
  formatOfParts,
  FONT_STYLE_PHRASES,
  TEXT_COLOR_WORDS,
  FILL_WORDS,
  PALE_WORDS,
  FORMAT_VERBS,
  FORMAT_VERB_PHRASES,
  FORMAT_LEAD_INS,
} from './rule-formats.ts';
import {
  MOST_CHARACTERS_OF_WORDS,
  NUMBER_CONDITION_WORDS,
  VAGUE_NOUNS,
  NO_WITHOUT_WORDS,
  ROW_NOUNS,
  TEXT_TEST_WORDS,
  CHECKED_RULE_WORDS,
  DATE_CONDITION_WORDS,
} from './vocabulary.ts';
import { RULE_WORD_REWRITES, UNCHECKED_RULE_WORDS } from './rule-tests-values.ts';
/** A column named in words, and the words that name it (`from` up to `to`). */
export interface ColumnNamedIn {
  c: ColumnId;
  from: number;
  to: number;
}
/** Tests read for a rule, with the column the rule colors where the words say which. */
export type TestsForRule =
  | {
      kind: 'read';
      allOf: ColumnTest[];
      c?: ColumnId;
      /** The column to color was named apart from the tests. */
      isPaintNamed?: true;
      /** The tests were read as about the selected columns. */
      isAboutSelected?: true;
    }
  | TestsNotRead;
/** What a rule read from words does: color a scale, or format the cells that pass every test (in a look given or not). */
export type RuleSaid = { kind: 'colorScale' } | { kind: 'formatWhere'; allOf: ColumnTest[]; format: FormatOfACondition | null };
/** A rule read from words: the column it is about, whether it colors whole rows, and what it does. */
export interface RuleRead {
  kind: 'read';
  c: ColumnId;
  isForRows: boolean;
  /** The rule covers the selected columns. */
  isAboutSelected: boolean;
  rule: RuleSaid;
}
/** What the words of a rule were read as. */
export type RuleWordsRead = RuleRead | RuleWordsNotRead;
export function readColorScaleRule(
  words: readonly TypedWord[],
  holds: TableHolds,
  { selected }: Pick<RuleWordsSituation, 'selected'>,
): RuleRead | null {
  let start = 0;
  while (SCALE_LEAD_WORDS.has(words[start]?.plain ?? '')) start += 1;
  let scalePhraseLength = (at: number): number =>
    COLOR_SCALE_PHRASES.find((phrase) => wordsMatchAt(words, at, phrase))?.length ?? 0;
  let columnNamedFrom = (at: number) => columnNamedAt(holds, words, at, true);
  let colorScaleRule = (c: ColumnId, isAboutSelected: boolean): RuleRead | null => {
    let column = holds.columns.find((eachColumn) => eachColumn.c === c);
    return column === undefined || measureOfColumn(column) === null || hasNumbersAsText(column) || isRankLikeColumn(column)
      ? null
      : {
          kind: 'read',
          c: column.c,
          isForRows: false,
          isAboutSelected,
          rule: {
            kind: 'colorScale',
          },
        };
  };
  if (scalePhraseLength(start) > 0) {
    let at = start + scalePhraseLength(start);
    if (at === words.length) return selected.length === 1 ? colorScaleRule(selected[0] ?? null, true) : null;
    if (SCALE_PREPOSITIONS.has(words[at]?.plain ?? '')) at += 1;
    if (words[at]?.plain === 'the') at += 1;
    let named = columnNamedFrom(at);
    return named !== null && at + named.wordCount === words.length ? colorScaleRule(named.column.c, false) : null;
  }
  let firstNamed = columnNamedFrom(start);
  if (firstNamed === null) return null;
  let afterName = start + firstNamed.wordCount;
  return scalePhraseLength(afterName) > 0 && afterName + scalePhraseLength(afterName) === words.length
    ? colorScaleRule(firstNamed.column.c, false)
    : null;
}
export function valueWordsOfTable(holds: TableHolds): Map<string, string[][]> {
  let cached = valueWordsCache.get(holds);
  if (cached !== undefined) return cached;
  let wordLists = holds.columns.flatMap(
    (column) => [
      ...(isShortEnoughToRead(column.name ?? '') ? plainWordsOf(column.name ?? '') : []).map((word) => [word]),
      ...(isColumnOfFewValues(column)
        ? [
            ...column.values.flatMap(
              ({ value, userIds }) =>
                value?.kind !== 'text' ? [] : [value.value, ...(userIds.length > 0 ? plainWordsOf(value.value).slice(0, 1) : [])],
            ),
            ...(column.optionsOfDropdown ?? []),
          ]
            .filter(isShortEnoughToRead)
            .map(plainWordsOf)
        : []),
    ],
  );
  let byWord = new Map<string, string[][]>();
  for (let wordList of wordLists)
    for (let word of new Set<string>(wordList)) {
      let lists = byWord.get(word);
      if (lists === undefined) byWord.set(word, [wordList]);
      else lists.push(wordList);
    }
  valueWordsCache.set(holds, byWord);
  return byWord;
}
export function columnsNamedIn(words: readonly TypedWord[], holds: TableHolds): ColumnNamedIn[] {
  let named: ColumnNamedIn[] = [];
  for (let at = 0; at < words.length; ) {
    let found = isUnquotedWord(words[at]) ? columnNamedAt(holds, words, at, true) : null;
    if (found !== null)
      named.push({
        c: found.column.c,
        from: at,
        to: at + found.wordCount,
      });
    at += found?.wordCount ?? 1;
  }
  return named;
}
export function readTestsForRule(
  typed: string,
  holds: TableHolds,
  viewerId: string | null,
  situation: RuleWordsSituation,
  takesSelectionAsIs: boolean,
): TestsForRule {
  let words = splitIntoWords(typed);
  let columnsNamed = columnsNamedIn(words, holds);
  let [firstNamed] = columnsNamed;
  let isNameThenWhere = firstNamed !== undefined && firstNamed.from === 0 && RELATIVE_PRONOUNS.has(words[firstNamed.to]?.plain ?? '');
  let read = readWordsAsTests(typed, holds, viewerId, situation);
  if (isNameThenWhere) {
    const readAfterPronoun =
      firstNamed.to + 1 >= words.length
        ? null
        : readWordsAsTests(rewriteWords(words, firstNamed.to + 1, words.length, NO_WORD_REWRITES, /\s$/.test(typed)), holds, viewerId, situation);
    if (
      readAfterPronoun?.kind === 'read' &&
      columnsNamed.slice(1).every(({ c }) => readAfterPronoun.allOf.flatMap(columnsOfConditionClause).includes(c))
    )
      return {
        ...readAfterPronoun,
        c: firstNamed.c,
        isPaintNamed: true,
      };
  }
  if (read.kind === 'read') {
    let testedCs = new Set<ColumnId>(read.allOf.flatMap(columnsOfConditionClause));
    let untested = columnsNamed.filter(({ c: namedC }) => !testedCs.has(namedC));
    let [onlyUntested, ...moreUntested] = untested;
    let isFirstColumnAtEnd =
      onlyUntested !== undefined &&
      moreUntested.length === 0 &&
      onlyUntested.c === holds.columns[0]?.c &&
      onlyUntested.to === words.length &&
      onlyUntested.from > 0 &&
      !SCALE_PREPOSITIONS.has(words[onlyUntested.from - 1]?.plain ?? '');
    if (untested.length > 0 && !isFirstColumnAtEnd)
      return {
        kind: 'notRead',
        isOnItsWay: false,
      };
    if (isFirstColumnAtEnd)
      return {
        ...read,
        c: onlyUntested.c,
        isPaintNamed: true,
      };
    let clauseOfNamed = read.allOf.find(({ c: testedC }) => columnsNamed.some((named) => named.c === testedC));
    let { c } = clauseOfNamed ?? read.allOf[0];
    if (!situation.areSeveralCellsSelected || columnsNamed.length > 0)
      return {
        ...read,
        c,
      };
    if (!situation.selected.includes(c))
      return {
        kind: 'notRead',
        isOnItsWay: false,
      };
    return [1, holds.columns.length].includes(situation.selected.length) || takesSelectionAsIs
      ? {
          ...read,
          c,
        }
      : {
          kind: 'notRead',
          isOnItsWay: false,
        };
  }
  let [onlyNamed, ...moreNamed] = columnsNamed;
  if (onlyNamed !== undefined && moreNamed.length === 0 && onlyNamed.from > 0 && onlyNamed.to === words.length) {
    let wordsBeforeEnd = ['in', 'of', 'for', 'on'].includes(words[onlyNamed.from - 1]?.plain ?? '') ? onlyNamed.from - 1 : onlyNamed.from;
    let readNameFirst = readWordsAsTests(
      rewriteWords(words, onlyNamed.from, onlyNamed.to, NO_WORD_REWRITES, true) + rewriteWords(words, 0, wordsBeforeEnd, NO_WORD_REWRITES, true),
      holds,
      viewerId,
      situation,
    );
    if (readNameFirst.kind === 'read' && readNameFirst.allOf.every(({ c }) => c === onlyNamed.c))
      return {
        ...readNameFirst,
        c: onlyNamed.c,
      };
  }
  if (columnsNamed.length > 0 || situation.selected.length > MOST_SELECTED_COLUMNS) return read;
  if (!isUnplaceableStart(read.firstNotPlaced ?? '')) return read;
  let readWithName = (c: ColumnId): ColumnTest[] => {
    let name = holds.columns.find((column) => column.c === c)?.name ?? null;
    let readOfName =
      name === null || name.length > MOST_CHARACTERS_OF_WORDS ? null : readWordsAsTests(name + ' ' + typed, holds, viewerId, situation);
    return readOfName?.kind === 'read' && readOfName.allOf[0].c === c ? readOfName.allOf : [];
  };
  let readsOfSelected = situation.selected
    .map(readWithName)
    .map((clauses) => (clauses.length === 1 || situation.selected.length === 1 ? clauses : []));
  let [[firstClause, ...moreClauses] = [], ...otherReads] = readsOfSelected;
  let selectedKinds = new Set<KindOfAColumn | undefined>(
    situation.selected.map((c) => holds.columns.find((column) => column.c === c)?.kind),
  );
  let saysLateWithSeveralDates =
    words.some(({ plain }) => LATE_WORDS.has(plain)) &&
    holds.columns.filter(({ kind }) => kind === 'date').length > 1;
  let valueStandsElsewhere =
    firstClause?.condition.kind === 'textIs' &&
    !situation.areSeveralCellsSelected &&
    holds.columns.some(
      (column) =>
        column.c !== firstClause.c && 'text' in firstClause.condition && columnHasText(column, firstClause.condition.text),
    );
  return firstClause !== undefined &&
    !saysLateWithSeveralDates &&
    !valueStandsElsewhere &&
    selectedKinds.size === 1 &&
    otherReads.every(([clause]) => clause !== undefined && isSameAsJson(clause.condition, firstClause.condition)) &&
    (situation.areSeveralCellsSelected || !CELL_TEST_KINDS.has(firstClause.condition.kind))
    ? {
        kind: 'read',
        allOf: [firstClause, ...moreClauses],
        c: firstClause.c,
        isAboutSelected: true,
      }
    : read;
}
export function wordsWithDateNamed(typed: string, holds: TableHolds, situation: RuleWordsSituation): string | null {
  let words = splitIntoWords(typed);
  let nameSaysDate = (c: ColumnId): boolean =>
    plainWordsOf(holds.columns.find((column) => column.c === c)?.name ?? '').some(
      (word) => word.startsWith('date'),
    );
  let columnsNamed = columnsNamedIn(words, holds).filter(
    ({ c, from, to }) => to - from > 1 || !dateWordPattern.test(words[from]?.plain ?? '') || nameSaysDate(c),
  );
  let saysColumnLetter = words.some(
    (word, index) =>
      (word.plain === 'column' || word.plain === 'col') && situation.columnLettered(words[index + 1]?.plain ?? '') !== null,
  );
  let dateWord = words.find(
    (word, index) =>
      isUnquotedWord(word) &&
      dateWordPattern.test(word.plain) &&
      !isAfterTextTest(words, index) &&
      !columnsNamed.some(({ from, to }) => from <= index && index < to),
  );
  const selectedDateColumn = holds.columns.find(
    ({ c, kind }) => kind === 'date' && situation.selected.length === 1 && situation.selected[0] === c,
  );
  if (dateWord !== undefined && selectedDateColumn === undefined && columnsNamed.length === 0 && !saysColumnLetter) return null;
  if (dateWord === undefined || selectedDateColumn === undefined || columnsNamed.some(({ c }) => c !== selectedDateColumn.c))
    return typed;
  let isNamedAlready = selectedDateColumn.c === onlySelectedColumn(situation) || columnsNamed.length > 0;
  let rewrites = new Map<TypedWord, string>([[dateWord, isNamedAlready ? '' : (selectedDateColumn.name ?? '')]]);
  return rewriteWords(words, 0, words.length, rewrites, /\s$/.test(typed));
}
export function isColorPartOfValue(words: readonly TypedWord[], clause: ColumnTest | undefined, { columns }: TableHolds): boolean {
  let hueWords = words.filter(({ plain }) => HUE_WORDS.has(plain));
  if (hueWords.length === 0 || clause === undefined || !TEXT_TEST_KINDS.has(clause.condition.kind)) return false;
  let text = 'text' in clause.condition ? clause.condition.text : '';
  return (
    SHADE_WORDS.has(plainWordsOf(text).at(-1) ?? '') ||
    columns.some(
      ({ c, values }) =>
        c === clause.c &&
        values.some(
          ({ value }) =>
            value?.kind === 'text' &&
            isShortEnoughToRead(value.value) &&
            hueWords.some(({ plain }) => plainTextOfWords(value.value).includes(plainTextOfWords(text) + ' ' + plain)),
        ),
    )
  );
}
export function readRuleFromWords(typed: string, holds: TableHolds, viewerId: string | null, situation: RuleWordsSituation): RuleWordsRead {
  let read = readRuleWords(typed, holds, viewerId, situation);
  let withDateNamed = wordsWithDateNamed(typed, holds, situation);
  let wordsRead = read.kind === 'read' ? typed : (withDateNamed ?? typed);
  let readOfWords = wordsRead === typed ? read : readRuleWords(wordsRead, holds, viewerId, situation);
  if (readOfWords.kind === 'notRead') return read;
  let testedCs = readOfWords.rule.kind === 'formatWhere' ? readOfWords.rule.allOf.map(({ c }) => c) : [readOfWords.c];
  if (withDateNamed === null && holds.columns.some(({ c, kind }) => kind === 'date' && testedCs.includes(c)))
    return FORMAT_PARTS_NOT_READ;
  let words = splitIntoWords(wordsRead);
  let textWithout = (dropped: TypedWord): string =>
    words.map((word) => word.gap + (word === dropped ? ' ' : word.said)).join('') + (words.at(-1)?.tail ?? '');
  return words.some(
    (word) =>
      isUnquotedWord(word) &&
      RECORD_KIND_NOUNS.has(word.plain) &&
      columnNamedAt(holds, words, word.at, true) === null &&
      isSameAsJson(readOfWords, readRuleWords(textWithout(word), holds, viewerId, situation)),
  )
    ? FORMAT_PARTS_NOT_READ
    : readOfWords;
}
export function readRuleWords(typed: string, holds: TableHolds, viewerId: string | null, situation: RuleWordsSituation): RuleWordsRead {
  if (typed.length > MOST_CHARACTERS_OF_WORDS) return FORMAT_PARTS_NOT_READ;
  let countOf = (mark: string): number => typed.split(mark).length - 1;
  if (countOf('"') % 2 === 1 || countOf('“') !== countOf('”'))
    return {
      kind: 'notRead',
      isOnItsWay: true,
    };
  if (
    [foreignNumberPattern, crossMarkPattern, leaveOutPattern, thousandsRangePattern, monthYearPattern].some(
      (pattern) => pattern.test(typed),
    )
  )
    return FORMAT_PARTS_NOT_READ;
  let words = splitIntoWords(expandThousands(typed, situation));
  let isInColumnNameAt = (at: number, amongWords: readonly TypedWord[]): boolean =>
    columnsNamedIn(amongWords, holds).some(
      ({ c, from, to }) =>
        from <= at &&
        at < to &&
        (to - from > 1 ||
          (!FORMAT_WORDS.has(amongWords[at]?.plain ?? '') &&
            !STATE_WORDS.has(amongWords[at]?.plain ?? '') &&
            (!situation.areSeveralCellsSelected || onlySelectedColumn(situation) === c) &&
            !WORDS_AFTER_DATE_NAME.has(amongWords[to]?.plain ?? '') &&
            [NUMBER_CONDITION_WORDS, IS_ARE_WORDS].some((wordSet) => wordSet.has(amongWords[to]?.plain ?? '')))),
    );
  if (
    words.some(
      (word, at) =>
        isUnquotedWord(word) && (FILTER_VERBS.has(word.plain) || VAGUE_NOUNS.has(word.plain)) && !isInColumnNameAt(at, words),
    )
  )
    return FORMAT_PARTS_NOT_READ;
  let isValueTextAt = (word: TypedWord, at: number, amongWords: readonly TypedWord[]): boolean => {
    let nameEnd = amongWords[at - 1]?.plain === 'not' ? at - 2 : at - 1;
    return (
      !STATE_WORDS.has(word.plain) &&
      IS_ARE_WORDS.has(amongWords[nameEnd]?.plain ?? '') &&
      columnsNamedIn(amongWords, holds).some(
        ({ c, to }) =>
          to === nameEnd &&
          holds.columns.some(
            (column) =>
              column.c === c &&
              column.values.some(({ value }) => value?.kind === 'text' && isSameTextIgnoringCase(value.value, word.plain)),
          ),
      )
    );
  };
  let isKnownValueWord = (word: TypedWord, at: number, amongWords: readonly TypedWord[]): boolean =>
    isUnquotedWord(word) &&
    RULE_KNOWN_WORDS.has(word.plain) &&
    !isValueTextAt(word, at, amongWords) &&
    !isInColumnNameAt(at, amongWords) &&
    (!STARTS_ENDS_WORDS.has(word.plain) || isTextTestAt(amongWords, at)) &&
    wordForms(word.plain)
      .flatMap((form) => valueWordsOfTable(holds).get(form) ?? [])
      .some(
        (valueWords) =>
          valueWords.every(
            (valueWord) => amongWords.some(({ plain }) => wordForms(plain).includes(valueWord)),
          ),
      );
  if (words.some(isKnownValueWord)) return FORMAT_PARTS_NOT_READ;
  let rewritten = rewriteWords(words, 0, words.length, ruleWordRewrites(words, holds, situation), /\s$/.test(typed));
  if (rewritten.length > MOST_CHARACTERS_OF_WORDS) return FORMAT_PARTS_NOT_READ;
  let rewrittenWords = splitIntoWords(rewritten);
  if (rewrittenWords.some(isKnownValueWord)) return FORMAT_PARTS_NOT_READ;
  let plainWords = rewrittenWords.filter(isUnquotedWord);
  if (
    plainWords.some((word) => {
      if (!NO_WITHOUT_WORDS.has(word.plain)) return false;
      let named = columnAfterWord(holds, rewrittenWords, word);
      return named === null || IS_ARE_WORDS.has(rewrittenWords[named.end]?.plain ?? '');
    })
  )
    return FORMAT_PARTS_NOT_READ;
  let colorScale = plainWords.length < rewrittenWords.length ? null : readColorScaleRule(rewrittenWords, holds, situation);
  if (colorScale !== null) return colorScale;
  let wordsOf = (nouns: ReadonlySet<string>): TypedWord[] =>
    plainWords.filter((word) => nouns.has(word.plain) && !isInColumnNameAt(word.at, rewrittenWords));
  let [rowWords, cellWords] = [wordsOf(ROW_NOUNS), wordsOf(CELL_NOUNS)];
  if (rowWords.length > 0 && cellWords.length > 0) return FORMAT_PARTS_NOT_READ;
  let dropped = new Map<TypedWord, string>(
    [
      ...cellWords,
      ...rowWords.flatMap(
        ({ at }) =>
          rewrittenWords.slice(Math.max(at - 1, 0), at).filter((word) => WHOLE_WORDS.has(word.plain)),
      ),
    ].map((word): [TypedWord, string] => [word, ' ']),
  );
  let ruleWords = rewrittenWords.filter((word) => !dropped.has(word) && !rowWords.includes(word));
  let endsWithSpace = /\s$/.test(typed);
  let readings = new Map<string, RuleRead>();
  let testsByText = new Map<string, TestsForRule>();
  let isOnItsWay = false;
  let [starts, ends, middles] = [formatPartsAtStart(ruleWords), formatPartsAtEnd(ruleWords), formatPartsInMiddle(ruleWords)];
  if (starts.length * ends.length * middles.length > MOST_RULE_READINGS) return FORMAT_PARTS_NOT_READ;
  for (let start of starts)
    for (let end of ends)
      for (let middle of middles) {
        if (start.from >= end.to) continue;
        let [middleFirst, middleLast] = [middle.words[0], middle.words.at(-1)];
        let indexOf = (word: TypedWord): number => ruleWords.indexOf(word);
        if (middleFirst !== undefined && middleLast !== undefined && (indexOf(middleFirst) <= start.from || indexOf(middleLast) >= end.to - 1))
          continue;
        let saysFill = ruleWords.slice(0, start.from).some((word) => word.plain === 'fill');
        let parts = [...start.parts, ...middle.parts, ...end.parts].map(
          (part): FormatPart =>
            saysFill && part.kind === 'tint'
              ? {
                  kind: 'fill',
                  hue: part.hue,
                }
              : part,
        );
        let format = parts.length === 0 ? null : formatOfParts(parts);
        if (parts.length > 0 && format === null) continue;
        let [firstWord, lastWord] = [ruleWords[start.from], ruleWords[end.to - 1]];
        if (firstWord === undefined || lastWord === undefined) continue;
        if (parts.length === 0 && plainWords.some((word) => word.plain === SHOW_WORD)) continue;
        let rewrites = new Map<TypedWord, string>([...dropped, ...middle.words.map((word): [TypedWord, string] => [word, ' '])]);
        let testText = rewriteWords(
          rewrittenWords,
          firstWord.at,
          lastWord.at + 1,
          rewrites,
          endsWithSpace || lastWord !== rewrittenWords.at(-1),
        );
        let tests = testsByText.get(testText) ?? readTestsForRule(testText, holds, viewerId, situation, rowWords.length > 0);
        testsByText.set(testText, tests);
        if (tests.kind === 'notRead') {
          isOnItsWay ||= tests.isOnItsWay && parts.length === 0 && end.to === ruleWords.length;
          continue;
        }
        if (isColorPartOfValue(ruleWords.slice(end.to), tests.allOf.at(-1), holds)) return FORMAT_PARTS_NOT_READ;
        if (rowWords.length > 0 && tests.isPaintNamed === true) continue;
        let reading: RuleRead = {
          kind: 'read',
          c: tests.c ?? tests.allOf[0].c,
          isForRows: rowWords.length > 0,
          isAboutSelected: tests.isAboutSelected === true,
          rule: {
            kind: 'formatWhere',
            allOf: tests.allOf,
            format,
          },
        };
        readings.set(JSON.stringify(reading), reading);
      }
  let [onlyReading, ...otherReadings] = readings.values();
  if (onlyReading === undefined || otherReadings.length > 0)
    return {
      kind: 'notRead',
      isOnItsWay: readings.size === 0 && isOnItsWay,
    };
  let clauses = onlyReading.rule.kind === 'formatWhere' ? onlyReading.rule.allOf : [];
  return clauses.some(isBeforeTodayTest) &&
    !words.some((word, at) => isUnquotedWord(word) && word.plain === 'today' && !isAfterTextTest(words, at)) &&
    hasStatusLikeColumns(holds) &&
    !clauses.some((clause) => testsNotDone(clause, holds))
    ? FORMAT_PARTS_NOT_READ
    : onlyReading;
}
export const COLOR_SCALE_PHRASES = ['color scale', 'colour scale', 'color gradient', 'heat map', 'heatmap', 'gradient'].map(
  (phrase) => phrase.split(' '),
);
export const SCALE_LEAD_WORDS = new Set<string>('add apply put make show a an the'.split(' '));
export const SCALE_PREPOSITIONS = new Set<string>('on of for to in over across'.split(' '));
export const FILTER_VERBS = new Set<string>(
  'hide filter filtered only keep find list display see sort sorted order ordered remove delete clear except exclude excluding skip ignore omit'.split(
    ' ',
  ),
);
export const SHOW_WORD = 'show';
export const monthOrWeekdayPattern = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon(?!th)|tue|wed|thu|fri|sat|sun)/;
export const FORMAT_WORDS = new Set<string>([
  ...HUE_WORDS.keys(),
  ...FONT_STYLE_PHRASES.map(([phrase]) => phrase.replace(/ .*/, '')),
  ...TEXT_COLOR_WORDS,
  ...FILL_WORDS,
  ...PALE_WORDS,
  ...FORMAT_VERBS,
  ...FORMAT_VERB_PHRASES.map(([[firstWord = '']]) => firstWord),
]);
export const RULE_KNOWN_WORDS = new Set<string>([
  ...HUE_WORDS.keys(),
  ...FONT_STYLE_PHRASES.flatMap(([phrase]) => phrase.split(' ')),
  ...TEXT_COLOR_WORDS,
  ...FILL_WORDS,
  ...PALE_WORDS,
  ...FORMAT_VERBS,
  ...FORMAT_VERB_PHRASES.flatMap(([words]) => words),
  ...FORMAT_LEAD_INS.flat().filter((word) => word.length > 5),
  ...ROW_NOUNS,
  ...CELL_NOUNS,
  ...WHOLE_WORDS,
  ...[...NUMBER_CONDITION_WORDS, ...TEXT_TEST_WORDS].filter(
    (word) => /^\p{L}{3,}$/u.test(word) && !['than', 'from', 'with', 'not', 'does', 'more', 'and'].includes(word),
  ),
  ...RULE_WORD_REWRITES.flatMap(
    ([phraseWords]) => phraseWords.filter((word) => word.length > 4 || word === 'zero' || word === 'past'),
  ),
  ...CHECKED_RULE_WORDS,
  ...UNCHECKED_RULE_WORDS,
  ...'blank blanks empty none nothing filled any anything overdue late past today tomorrow yesterday scale gradient heatmap heat'.split(' '),
  ...'max min maximum minimum average mean median unique weekend weekends weekday weekdays people person everyone staff'.split(' '),
  ...[...DATE_CONDITION_WORDS].filter((word) => monthOrWeekdayPattern.test(word)),
]);
export const wordForms = (word: string): string[] => [word, word + 's', word.replace(/s$/, '')];
export const isShortEnoughToRead = (text: string): boolean => text.length <= MOST_CHARACTERS_OF_WORDS;
export const valueWordsCache = new WeakMap<TableHolds, Map<string, string[][]>>();
export const namesAColumn = (text: string, holds: TableHolds): boolean => columnsNamedIn(splitIntoWords(text), holds).length > 0;
export const MOST_SELECTED_COLUMNS = 24;
export const LATE_WORDS = new Set<string>(['overdue', 'late']);
export const CELL_TEST_KINDS = new Set<CellConditionKind>(['appearsMoreThanOnce', 'isAnError', 'isBlank', 'isNotBlank']);
export const BLANK_FILLED_WORDS = new Set<string>('blank blanks empty none nothing filled any anything'.split(' '));
export const STATE_WORDS = new Set<string>([
  ...BLANK_FILLED_WORDS,
  ...'missing checked ticked unchecked unticked overdue late past today tomorrow yesterday'.split(' '),
]);
export const isUnplaceableStart = (text: string): boolean => {
  let [firstWord = ''] = plainWordsOf(text);
  return (
    !/^\p{L}/u.test(firstWord) ||
    [NUMBER_CONDITION_WORDS, DATE_CONDITION_WORDS, TEXT_TEST_WORDS, BLANK_FILLED_WORDS, IS_ARE_WORDS].some(
      (wordSet) => wordSet.has(firstWord),
    ) ||
    firstWord === 'not'
  );
};
export const columnsOfConditionClause = ({ c, condition }: ColumnTest): ColumnId[] => [
  c,
  ...operandsOfCondition(condition).flatMap((operand) => (operand.kind === 'sameRowInColumn' ? [operand.c] : [])),
];
export const thousandsSuffixPattern = /(?<![\p{L}\p{N}.,])(\d{1,6}(?:\.\d{1,3})?)k(?![\p{L}\p{N}])/giu;
export const expandThousands = (typed: string, { signsOfNumbers }: Pick<RuleWordsSituation, 'signsOfNumbers'>): string =>
  /["“”]/.test(typed) ||
  splitIntoWords(typed).some((word, at, words) => isTextTestAt(words, at)) ||
  signsOfNumbers.decimalSign === 'comma'
    ? typed
    : typed.replaceAll(thousandsSuffixPattern, (match: string, thousands: string) => String(Math.round(Number(thousands) * 1000)));
export const dateWordPattern = /^dates?$/i;
export const WORDS_AFTER_DATE_NAME = new Set<string>('and or to from no'.split(' '));
export const SHADE_WORDS = new Set<string>('light dark pale navy hot sky bright'.split(' '));
