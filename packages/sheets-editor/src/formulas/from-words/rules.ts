import {
  splitIntoWordPieces,
  AMBIGUOUS_READING,
  NOTHING_SAID,
  mayMeanTheTable,
  isWithinAHeading,
  quoteForFormula,
  compileWordsRules,
} from './reading.ts';
import {
  AGGREGATE_WORDS,
  aggregateFormula,
  conditionalAggregateFormula,
  OF_RANGE_TEMPLATE,
  OF_VALUES_TEMPLATE,
  CONDITIONAL_AGGREGATE_FUNCTIONS,
  isCleanCellsSaid,
  isAggregateSensible,
  AGGREGATE_FUNCTION_ALIASES,
  canAddUpTextVariants,
  CRITERIA_SYNTAX_PATTERN,
  isPeriodInDateCells,
  conditionsSlotReader,
} from './aggregates.ts';
import { parseA1Area } from '../../model/a1-references.ts';
import type { FormulaOfWords, Said, WordPiece, WordsRule, WordsRuleBuild } from './reading.ts';
import type { Aggregate } from './aggregates.ts';
import type { FormulaWhere } from './where.ts';
/** A formula read from words, with the other formula that may be offered beside it. */
export interface FormulaReadFromWords {
  formula: string;
  other: OtherFormulaOfWords | null;
}
/** Another formula the words may mean, and whether it is offered only beside the first one. */
export interface OtherFormulaOfWords {
  formula: string;
  mustStandToo: boolean;
}
export function trimRequestPieces(pieces: WordPiece[]) {
  let start = 0;
  for (let skipped = -1; skipped !== 0; start += skipped) {
    let isPhraseAt = (phrase: string[]) =>
      phrase.every((word, offset) => pieces[start + offset]?.typed === word && pieces[start + offset]?.kind === 'word');
    skipped = Math.max(0, ...REQUEST_OPENING_PHRASES.filter(isPhraseAt).map((phrase) => phrase.length));
  }
  let end = pieces.length;
  while (end > start && TRAILING_REQUEST_WORDS.has(pieces[end - 1]?.typed ?? '') && pieces[end - 1]?.kind !== 'quoted') end -= 1;
  return pieces.slice(start, end);
}
export function readFormulaFromWords(text: string, where: FormulaWhere) {
  let byText = formulaFromWordsCache.get(where);
  if (byText === undefined) formulaFromWordsCache.set(where, (byText = new Map<string, FormulaReadFromWords | null>()));
  let result = byText.get(text);
  if (result !== undefined) return result;
  let pieces = splitIntoWordPieces(text);
  result = null;
  if (pieces !== null && pieces.length <= MAX_WORD_PIECES) {
    let reading = {
      text,
      pieces: trimRequestPieces(pieces),
      where,
    };
    let formulas = new Map(
      FORMULA_FROM_WORDS_READERS.flatMap((reader) => reader(reading)).map(
        (formula): [string, FormulaOfWords] => [JSON.stringify(formula), formula],
      ),
    );
    let [onlyFormula] = formulas.values();
    if (formulas.size === 1 && onlyFormula !== undefined && onlyFormula !== AMBIGUOUS_READING)
      result =
        typeof onlyFormula === 'string'
          ? {
              formula: onlyFormula,
              other: null,
            }
          : {
              formula: onlyFormula[0],
              other: {
                formula: onlyFormula[1],
                mustStandToo: onlyFormula[2] === 'onlyBeside',
              },
            };
  }
  byText.set(text, result);
  return result;
}
export function formulaOfWords(text: string, where: FormulaWhere): string | null {
  let result = readFormulaFromWords(text, where);
  return result === null ? null : '=' + result.formula;
}
export function otherFormulaOfWords(text: string, where: FormulaWhere): OtherFormulaOfWords | null {
  let other = readFormulaFromWords(text, where)?.other ?? null;
  return other === null
    ? null
    : {
        ...other,
        formula: '=' + other.formula,
      };
}
export const AGGREGATE_NAMES: Aggregate[] = [
  'SUM',
  'TOTAL',
  'AVERAGE',
  'COUNT',
  'HOW_MANY',
  'MIN',
  'MAX',
  'LOWEST',
  'HIGHEST',
  'SMALLEST',
  'LARGEST',
  'MEDIAN',
  'MODE',
  'STDEV',
  'VAR',
  'STDEVP',
  'VARP',
];
export const AGGREGATE_VOCABULARY = new Set([
  ...Object.values(AGGREGATE_WORDS).flatMap((words) => words.split(/[/_]/)),
  'variance',
  'blank',
  'blanks',
  'empty',
  'unique',
]);
export const FORMULA_FROM_WORDS_RULES: WordsRule[] = [
  ...AGGREGATE_NAMES.flatMap((aggregate): WordsRule[] => {
    let plain: WordsRuleBuild = ([cells = NOTHING_SAID], builder) => aggregateFormula(aggregate, cells, builder);
    let withConditions: WordsRuleBuild = ([cells = NOTHING_SAID, conditions = NOTHING_SAID], builder) =>
      conditionalAggregateFormula(aggregate, cells, conditions, builder);
    return [
      [AGGREGATE_WORDS[aggregate] + ' ' + OF_RANGE_TEMPLATE + ' <cells>', plain],
      [
        AGGREGATE_WORDS[aggregate] + ' ' + OF_VALUES_TEMPLATE + ' <cells>',
        ([cells = NOTHING_SAID], builder) =>
          cells.isByHeading === true ? null : aggregateFormula(aggregate, cells, builder),
      ],
      ...(aggregate === 'SUM' || aggregate === 'TOTAL' || aggregate === 'AVERAGE' || aggregate === 'MEDIAN'
        ? ([['<cells> ' + AGGREGATE_WORDS[aggregate], plain]] satisfies WordsRule[])
        : []),
      ...(aggregate in CONDITIONAL_AGGREGATE_FUNCTIONS
        ? ([
            [AGGREGATE_WORDS[aggregate] + ' ' + OF_RANGE_TEMPLATE + ' <cells> <conditions>', withConditions],
            [
              AGGREGATE_WORDS[aggregate] + ' ' + OF_VALUES_TEMPLATE + ' <cells> <conditions>',
              (said, builder) => (said[0]?.isByHeading === true ? null : withConditions(said, builder)),
            ],
          ] satisfies WordsRule[])
        : []),
    ];
  }),
  ...AGGREGATE_NAMES.filter((aggregate) => aggregate !== 'HOW_MANY').map(
    (aggregate): WordsRule => [
      AGGREGATE_WORDS[aggregate] + ' [of] [above/this_column/column_above/cells_above/numbers_above]',
      (said, builder) => {
        let { where } = builder;
        let columnsAbove = where.columns.flatMap(({ heading, cells: cellsWritten }): Said[] => {
          let cells = parseA1Area(cellsWritten, where);
          if (cells === null || cells.leftColumnIndex !== where.columnIndex) return [];
          let belowCells = cells.topRowIndex + cells.rowCount;
          let gap = {
            ...cells,
            topRowIndex: belowCells,
            rowCount: where.rowIndex - belowCells,
          };
          return gap.rowCount >= 0 && where.kindsHeldIn(gap).size === 0
            ? [
                {
                  ...NOTHING_SAID,
                  written: cellsWritten,
                  typed: heading,
                  cells,
                  isByHeading: true,
                },
              ]
            : [];
        });
        let [above] = columnsAbove;
        return above === undefined ? null : aggregateFormula(aggregate, above, builder);
      },
    ],
  ),
  ...(['SUM', 'AVERAGE', 'COUNT'] satisfies Aggregate[]).map(
    (aggregate): WordsRule => [
      aggregate.toLowerCase() + 'if/' + aggregate.toLowerCase() + 'ifs ' + OF_RANGE_TEMPLATE + ' <cells> <conditionsBegun>',
      ([cells = NOTHING_SAID, conditions = NOTHING_SAID], builder) =>
        conditionalAggregateFormula(aggregate, cells, conditions, builder),
    ],
  ),
  [
    'counta ' + OF_RANGE_TEMPLATE + ' <cells>',
    ([cells = NOTHING_SAID], { call, where }) =>
      isCleanCellsSaid(cells, where) ? call('COUNTA', cells) : null,
  ],
  [
    'count/how_many/number_of [of] filled/non-blank/nonblank/non-empty/nonempty/non_blank/non_empty [cells] [in/of] <cells>',
    ([cells = NOTHING_SAID], { call, where }) =>
      isCleanCellsSaid(cells, where) ? call('COUNTA', cells) : null,
  ],
  [
    'countblank/count_blank/count_blanks/count_empty/how_many_blank/how_many_blanks/how_many_empty/number_of_blank/number_of_blanks/number_of_empty [cells] [in/of] <cells>',
    ([cells = NOTHING_SAID], { call, where }) =>
      ['blank', 'blanks', 'empty'].some((word) => mayMeanTheTable(word, where)) ? AMBIGUOUS_READING : call('COUNTBLANK', cells),
  ],
  [
    'count/how_many/number_of [of] unique/distinct/different [values/entries] [in/of] <cells>',
    ([cells = NOTHING_SAID], { call, where }) =>
      cells.cells?.columnCount !== 1 ||
      where.isAnyBlankIn(cells.cells) ||
      !isCleanCellsSaid(cells, where) ||
      where.kindsHeldIn(cells.cells).has('severalPeople') ||
      where.holdsTextsApartBySpacesAlone(cells.cells) ||
      where.areTooManyToKnow(cells.cells)
        ? null
        : call('ROWS', call('UNIQUE', cells)),
  ],
  ...(['MAX', 'HIGHEST', 'LARGEST', 'MIN', 'LOWEST', 'SMALLEST'] satisfies Aggregate[]).map(
    (aggregate): WordsRule => [
      '<nth> ' + AGGREGATE_WORDS[aggregate] + ' ' + OF_RANGE_TEMPLATE + ' <cells>',
      ([nth = NOTHING_SAID, cells = NOTHING_SAID], { call, where }) =>
        isAggregateSensible(aggregate, cells, where) && cells.cells !== null && !where.isAnyRepeatedIn(cells.cells)
          ? call((AGGREGATE_FUNCTION_ALIASES[aggregate] ?? aggregate) === 'MAX' ? 'LARGE' : 'SMALL', cells, nth)
          : null,
    ],
  ),
  [
    '<nth> percentile ' + OF_RANGE_TEMPLATE + ' <cells>',
    ([nth = NOTHING_SAID, cells = NOTHING_SAID], { call, where }) =>
      (nth.number ?? 100) < 100 && where.decimalSign === 'point' && isAggregateSensible('HIGHEST', cells, where)
        ? call('PERCENTILE', cells, String((nth.number ?? 0) / 100))
        : null,
  ],
  [
    '<nth> quartile ' + OF_RANGE_TEMPLATE + ' <cells>',
    ([nth = NOTHING_SAID, cells = NOTHING_SAID], { call, where }) =>
      (nth.number ?? 4) < 4 && isAggregateSensible('HIGHEST', cells, where) ? call('QUARTILE', cells, nth) : null,
  ],
  [
    'count/how_many/number_of [is/are] <words>',
    ([words = NOTHING_SAID], { call, where }) => {
      let matches = where.columns.flatMap(({ cells: columnCellsWritten }): [string, string, string[]][] => {
        let cells = parseA1Area(columnCellsWritten, where);
        let typedLower = words.typed.toLowerCase();
        let columnTextHeld = cells === null || AGGREGATE_VOCABULARY.has(typedLower) ? null : where.textHeldIn(cells, typedLower);
        if (cells !== null && typedLower.startsWith('not ') && where.textHeldIn(cells, typedLower.slice(4)) !== null) return [];
        return columnTextHeld === null ||
          cells === null ||
          !where.isAnyRepeatedIn(cells) ||
          where.kindsHeldIn(cells).has('severalPeople') ||
          where.isTextPartOfALongerOneIn(cells, typedLower) ||
          !canAddUpTextVariants(typedLower, where.textsWrittenOtherwiseIn(cells, typedLower), cells, where) ||
          where.isAnyBlankIn(cells) ||
          CRITERIA_SYNTAX_PATTERN.test(columnTextHeld)
          ? []
          : [[columnCellsWritten, columnTextHeld, where.textsWrittenOtherwiseIn(cells, typedLower)]];
      });
      let typed = words.typed.toLowerCase();
      if (matches.length > 0 && (isWithinAHeading(typed, where) || where.countOfColumnsThatHold(typed) > 1)) return AMBIGUOUS_READING;
      if (
        where.columns.some(({ cells: columnCellsWritten }) => {
          let cells = parseA1Area(columnCellsWritten, where);
          return (
            cells !== null && !AGGREGATE_VOCABULARY.has(typed) && where.textHeldIn(cells, typed) !== null && isPeriodInDateCells(typed, cells, where)
          );
        })
      )
        return AMBIGUOUS_READING;
      let [[cellsWritten, textHeld, otherSpellings] = ['', '', []]] = matches;
      if (matches.length !== 1) return null;
      let countIf = (text: string) => call('COUNTIF', cellsWritten, quoteForFormula(text));
      return otherSpellings.length === 0
        ? countIf(textHeld)
        : [countIf(textHeld), [textHeld, ...otherSpellings].map(countIf).join('+'), 'onlyBeside'];
    },
  ],
];
export const formulaFromWordsReader = compileWordsRules(FORMULA_FROM_WORDS_RULES, {
  conditions: conditionsSlotReader(false),
  conditionsBegun: conditionsSlotReader(true),
});
export const FORMULA_FROM_WORDS_READERS = [formulaFromWordsReader];
export const REQUEST_OPENING_PHRASES =
  "what is, what's, whats, what are, what was, how much is, calculate, compute, work out, figure out, get, get me, show, show me, give me, tell me, find me, i want, i need, i'd like, can you, could you, please"
    .split(', ')
    .map((phrase) => phrase.split(' '));
export const TRAILING_REQUEST_WORDS = new Set(['?', '.', '!', 'please']);
export const MAX_WORD_PIECES = 30;
export const formulaFromWordsCache = new WeakMap<FormulaWhere, Map<string, FormulaReadFromWords | null>>();
