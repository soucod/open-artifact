import { parseA1Area } from '../../model/a1-references.ts';
import { formulaArgumentSeparator } from '../../format/number-signs.ts';
import type { CellArea, CellPosition } from '../../selection/model.ts';
import type { FormulaWhere } from './where.ts';
import type { HeldKind } from './area-holds.ts';
export type WordPieceKind = 'quoted' | 'nth' | 'address' | 'number' | 'word' | 'sign';
/** A piece of the words typed: a quoted text, a word, a number, an address or a sign, and where in the text it is. */
export interface WordPiece {
  kind: WordPieceKind;
  /** The piece lower-cased, or a quoted text without its quotes. */
  typed: string;
  from: number;
  to: number;
}
/** Words typed for a formula, split into pieces, and where the formula is to be written. */
export interface WordsReading {
  text: string;
  pieces: WordPiece[];
  where: FormulaWhere;
}
/** What a slot of a words template was read as: cells, a number or words, and how each goes into the formula. */
export interface Said {
  written: string;
  typed: string;
  cells: CellArea | null;
  number: number | null;
  isByHeading?: boolean;
}
/** A slot read from where it starts: what was said, and the piece after it. */
export type SlotReading = [said: Said, end: number];
export type SlotReader = (reading: WordsReading, start: number) => SlotReading[];
/** One part of a words template: a slot to read, or phrases (each a list of words) one of which must be typed. */
export type TemplatePart = { slot: string } | { phrases: string[][]; isOptional: boolean };
/** A words template matched so far: what each of its slots was read as. */
export interface TemplateMatch {
  said: Said[];
  mayMeanTheTable: boolean;
}
/** A formula read from words: its text, or its text with another one that may stand beside it or instead of it. */
export type FormulaOfWords = string | [formula: string, other: string, otherStands: 'onlyBeside' | 'alone'];
/** What the slots of a template are written as, with the place it is written in. */
export interface FormulaBuilder {
  where: FormulaWhere;
  call: (name: string, ...args: (Said | string)[]) => string;
}
/** Builds a formula from what the slots of a template were read as, or gives null when they do not make one. */
export type WordsRuleBuild = (said: Said[], builder: FormulaBuilder) => FormulaOfWords | null;
/** A words template, with what builds its formula. */
export type WordsRule = [template: string, build: WordsRuleBuild];
export type WordsReader = (reading: WordsReading) => FormulaOfWords[];
export function splitIntoWordPieces(text: string): WordPiece[] | null {
  if (/\d,\d/.test(text)) return null;
  let pieces: WordPiece[] = [];
  for (let index = 0; index < text.length; ) {
    if (/\s/.test(text[index] ?? '')) {
      index += 1;
      continue;
    }
    let start = index;
    for (let [kind, pattern] of WORD_PIECE_PATTERNS) {
      pattern.lastIndex = start;
      let match = pattern.exec(text)?.[0];
      if (match === undefined) continue;
      let typed = kind === 'quoted' ? match.slice(1, -1) : match.toLowerCase();
      pieces.push({
        kind,
        typed,
        from: start,
        to: start + match.length,
      });
      index += match.length;
      break;
    }
    if (index === start) return null;
  }
  return pieces;
}
export function cellsSaidByAddress(address: string, typed: string, where: FormulaWhere): Said | null {
  let cells = parseA1Area(address, where);
  return cells === null || areaHoldsCell(cells, where)
    ? null
    : {
        written: address,
        typed,
        cells,
        number: null,
      };
}
export function textNamesHeading(text: string, heading: string) {
  let textWords = wordsInText(text).join(' ');
  return (
    pluralAndSingularForms(text).includes(normalizeHeadingText(heading).trim()) ||
    (textWords !== '' && pluralAndSingularForms(textWords).includes(wordsInText(heading).join(' ')))
  );
}
export function isInsideLongerHeading({ text, pieces, where }: WordsReading, from: number, to: number) {
  let [spanStart = 0, spanEnd = 0] = [pieces[from]?.from, pieces[to - 1]?.to];
  let neighborWords = new Set([
    wordsInText(text.slice(0, spanStart)).findLast(isNotFillerWord),
    wordsInText(text.slice(spanEnd)).find(isNotFillerWord),
  ]);
  neighborWords.delete(undefined);
  let spanWords = wordsInText(text.slice(spanStart, spanEnd));
  let lastWordForms = new Set(pluralAndSingularForms(spanWords.at(-1) ?? ''));
  let matchesSpanAt = (words: string[], at: number) =>
    spanWords.every(
      (word, offset) =>
        offset === spanWords.length - 1 ? lastWordForms.has(words[at + offset] ?? '') : words[at + offset] === word,
    );
  return where.headings.some((heading) => {
    let headingWords = wordsInText(heading);
    return headingWords.some(
      (word, at) =>
        matchesSpanAt(headingWords, at) && (neighborWords.has(headingWords[at - 1]) || neighborWords.has(headingWords[at + spanWords.length])),
    );
  });
}
export function nextPieceNamesColumn({ pieces, where }: WordsReading, at: number, cellsWritten: string) {
  let { typed = '' } = pieces[at] ?? {};
  let [kind, cells] = [KIND_NOUNS[typed], parseA1Area(cellsWritten, where)];
  if (kind === undefined || cells === null) return COLUMN_NOUNS.has(typed);
  let kinds = where.kindsHeldIn(cells);
  return kinds.size === 1 && kinds.has(kind);
}
export function headedColumnsSaidAt(reading: WordsReading, start: number) {
  let { pieces, where } = reading;
  let headingStart = ((index: number) => pieces[index]?.typed === 'column')(start) ? start + 1 : start;
  let found: [cellsWritten: string, end: number][] = [];
  for (let end = headingStart + 1; end <= Math.min(pieces.length, headingStart + MAX_HEADING_PIECES); end += 1) {
    let typed = typedTextOfPieces(reading, headingStart, end).toLowerCase();
    let column = where.columns.find(
      ({ heading }) =>
        pluralAndSingularForms(typed).includes(normalizeHeadingText(heading)) && !isFalseEsPlural(normalizeHeadingText(heading), typed),
    );
    let headingsNamed = where.headings.filter((heading) => textNamesHeading(typed, heading));
    if (column === undefined || headingsNamed.length > 1 || isInsideLongerHeading(reading, headingStart, end)) continue;
    found.push([column.cells, end]);
    if (headingStart === start && nextPieceNamesColumn(reading, end, column.cells)) found.push([column.cells, end + 1]);
  }
  let letters = pieces[headingStart]?.typed ?? '';
  if (headingStart > start && COLUMN_LETTERS_PATTERN.test(letters)) {
    let match = where.columns.find(
      ({ cells }) => cells.toLowerCase().startsWith(letters) && /^\d/.test(cells.slice(letters.length)),
    );
    if (match !== undefined) found.push([match.cells, headingStart + 1]);
  }
  return found;
}
export function isWithinAHeading(text: string, where: FormulaWhere) {
  if (namesAnyHeading(text, where)) return true;
  let words = wordsInText(text);
  if (words.length === 0) return false;
  let lastWordForms = new Set(pluralAndSingularForms(words.at(-1) ?? ''));
  return where.headings.some((heading) => {
    let headingWords = wordsInText(heading);
    return headingWords.some(
      (headingWord, at) =>
        words.every(
          (word, offset) =>
            offset === words.length - 1 ? lastWordForms.has(headingWords[at + offset] ?? '') : headingWords[at + offset] === word,
        ),
    );
  });
}
export function mayMeanTheTable(words: string, where: FormulaWhere) {
  let byWords = mayMeanTheTableCache.get(where);
  if (byWords === undefined) mayMeanTheTableCache.set(where, (byWords = new Map<string, boolean>()));
  let mayMean = byWords.get(words);
  if (mayMean === undefined) {
    mayMean = where.countOfColumnsThatHold(words) > 0 || namesAnyHeading(words, where);
    byWords.set(words, mayMean);
  }
  return mayMean;
}
export function slotReadingsAt(reader: SlotReader | undefined, reading: WordsReading, start: number): SlotReading[] {
  if (reader === undefined) return [];
  let byReader = slotReadingsCache.get(reading.pieces);
  if (byReader === undefined) slotReadingsCache.set(reading.pieces, (byReader = new Map<SlotReader, Map<number, SlotReading[]>>()));
  let byStart = byReader.get(reader);
  if (byStart === undefined) byReader.set(reader, (byStart = new Map<number, SlotReading[]>()));
  let readings = byStart.get(start);
  if (readings === undefined) byStart.set(start, (readings = reader(reading, start)));
  return readings;
}
export function* matchWordsTemplate(
  slotReaders: Record<string, SlotReader>,
  template: TemplatePart[],
  partIndex: number,
  reading: WordsReading,
  at: number,
  match: TemplateMatch,
): Generator<TemplateMatch, void, undefined> {
  let { pieces } = reading;
  let part = template[partIndex];
  if (part === undefined) {
    if (at === pieces.length) yield match;
    return;
  }
  let start = at;
  while (pieces[start]?.typed === 'the' && pieces[start]?.kind === 'word') start += 1;
  if ('slot' in part) {
    for (let [said, end] of slotReadingsAt(slotReaders[part.slot], reading, start))
      yield* matchWordsTemplate(slotReaders, template, partIndex + 1, reading, end, {
        ...match,
        said: [...match.said, said],
      });
    return;
  }
  let pieceMatches = (word: string, offset: number) =>
    pieces[start + offset]?.typed === word && pieces[start + offset]?.kind !== 'quoted';
  for (let phrase of part.phrases.filter((phraseWords) => phraseWords.every(pieceMatches))) {
    let mayMean = match.mayMeanTheTable || mayMeanTheTable(phrase.join(' '), reading.where);
    yield* matchWordsTemplate(slotReaders, template, partIndex + 1, reading, start + phrase.length, {
      ...match,
      mayMeanTheTable: mayMean,
    });
  }
  if (part.isOptional) yield* matchWordsTemplate(slotReaders, template, partIndex + 1, reading, at, match);
}
export function compileWordsRules(rules: WordsRule[], extraSlotReaders: Record<string, SlotReader> = {}): WordsReader {
  let slotReaders: Record<string, SlotReader> = {
    ...SLOT_READERS,
    ...extraSlotReaders,
  };
  let templates = rules.map(([template, build]): [TemplatePart[], WordsRuleBuild] => [parseWordsTemplate(template), build]);
  for (let [template] of templates)
    for (let part of template) if ('slot' in part && !(part.slot in slotReaders)) throw Error('no slot <' + part.slot + '>');
  return (reading) => {
    let separator = formulaArgumentSeparator(reading.where.decimalSign);
    let builder: FormulaBuilder = {
      where: reading.where,
      call: (name, ...args) => name + '(' + args.map(argumentFormulaText).join(separator) + ')',
    };
    let typedWords = new Set(reading.pieces.map((piece) => piece.typed));
    return templates.flatMap(([template, build]) => {
      if (!areTemplateWordsTyped(template, typedWords)) return [];
      return Array.from(matchWordsTemplate(slotReaders, template, 0, reading, 0, EMPTY_TEMPLATE_MATCH)).flatMap(
        (match) => {
          let formula = build(match.said, builder);
          if (formula !== null && match.mayMeanTheTable) return [AMBIGUOUS_READING];
          return formula === null ? [] : [formula];
        },
      );
    });
  };
}
export const WORD_PIECE_PATTERNS: [WordPieceKind, RegExp][] = [
  ['quoted', /"[^"]*"|“[^”]*”|'[^']*'(?![a-z])/iy],
  ['nth', /\d+(?:st|nd|rd|th)\b/iy],
  ['address', /\$?[a-z]{1,3}\$?[1-9]\d*\b/iy],
  ['number', /\$?(?:0|[1-9]\d*)(?:\.\d+)?%?(?:(?![\w.])|(?=[ap]m\b))/iy],
  ['word', /[a-z][a-z0-9']*|0\d+/iy],
  ['sign', /[<>]=|=[<>]|<>|[^\s\p{L}\p{N}]/uy],
];
export const NOTHING_SAID: Said = {
  written: '',
  typed: '',
  cells: null,
  number: null,
};
export const typedTextOfPieces = ({ text, pieces }: WordsReading, from: number, to: number): string =>
  text.slice(pieces[from]?.from, pieces[to - 1]?.to).replaceAll(/\s+/g, ' ');
export const areaHoldsCell = (area: CellArea, { rowIndex, columnIndex }: CellPosition): boolean =>
  rowIndex >= area.topRowIndex &&
  rowIndex < area.topRowIndex + area.rowCount &&
  columnIndex >= area.leftColumnIndex &&
  columnIndex < area.leftColumnIndex + area.columnCount;
export const QUARTER_OR_HALF_PATTERN = /^[qh][1-4]$/;
export const addressTypedAt = ({ pieces, where }: WordsReading, at: number): string | null => {
  let piece = pieces[at];
  if (piece?.kind !== 'address' || where.isWordOfAHeading(piece.typed.replaceAll('$', ''))) return null;
  let cells = QUARTER_OR_HALF_PATTERN.test(piece.typed) ? parseA1Area(piece.typed, where) : null;
  return cells !== null && where.kindsHeldIn(cells).size === 0 ? null : piece.typed.toUpperCase();
};
export const MAX_HEADING_PIECES = 6;
export const COLUMN_LETTERS_PATTERN = /^[a-z]{1,3}$/;
export const normalizeHeadingText = (text: string): string => text.toLowerCase().replaceAll(/\s+/g, ' ');
export const pluralAndSingularForms = (word: string): string[] =>
  [word, word.replace(/'?s$/, ''), word.replace(/es$/, ''), word.replace(/ies$/, 'y'), word + 's', word + 'es', word.replace(/y$/, 'ies')].filter(
    (form) => form !== '',
  );
export const SIBILANT_END_PATTERN = /(?:[sxz]|ch|sh)$/;
export const isFalseEsPlural = (heading: string, typed: string): boolean =>
  (typed === heading + 'es' && !SIBILANT_END_PATTERN.test(heading)) || (heading === typed + 'es' && !SIBILANT_END_PATTERN.test(typed));
export const wordsInText = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export const FILLER_WORDS = new Set(['the', 'of', 'for', 'in', 'from', 'all']);
export const isNotFillerWord = (word: string): boolean => !FILLER_WORDS.has(word);
export const COLUMN_NOUNS = new Set(['column', 'field', 'entry', 'entries']);
/** The nouns that name a kind of cells, to the kind they hold. */
export const KIND_NOUNS: Partial<Record<string, HeldKind>> = {
  name: 'text',
  names: 'text',
  date: 'date',
  dates: 'date',
};
export const RANGE_JOINING_WORDS = new Set(['to', 'through', 'thru', 'until', ':']);
export const ORDINAL_WORDS = 'zeroth first second third fourth fifth sixth seventh eighth ninth tenth'.split(' ');
export const saidNumber = (written: string, typed: string, number: number): Said => ({
  written,
  typed,
  cells: null,
  number,
});
export const SLOT_READERS: Record<'cells' | 'number' | 'nth' | 'words', SlotReader> = {
  cells: (reading, start) => {
    let { pieces, where } = reading;
    let isRangeJoined = RANGE_JOINING_WORDS.has(pieces[start + 1]?.typed ?? '');
    let end = start + (isRangeJoined ? 3 : 2);
    let [fromAddress, toAddress] = [addressTypedAt(reading, start), addressTypedAt(reading, end - 1)];
    let byAddress =
      fromAddress === null || toAddress === null
        ? null
        : cellsSaidByAddress(fromAddress + ':' + toAddress, typedTextOfPieces(reading, start, end), where);
    let { rowCount = 0, columnCount = 0 } = byAddress?.cells ?? {};
    let isLine = isRangeJoined || rowCount === 1 || columnCount === 1;
    let byHeading = headedColumnsSaidAt(reading, start).flatMap(([cellsWritten, headingEnd]): SlotReading[] => {
      let said = cellsSaidByAddress(cellsWritten, typedTextOfPieces(reading, start, headingEnd), where);
      return said === null
        ? []
        : [
            [
              {
                ...said,
                isByHeading: true,
              },
              headingEnd,
            ],
          ];
    });
    return [...(byAddress !== null && isLine ? [[byAddress, end] satisfies SlotReading] : []), ...byHeading];
  },
  number: ({ pieces, where }, start) => {
    let piece = pieces[start];
    let isNegative = piece?.typed === '-' && piece.to === pieces[start + 1]?.from;
    let numberPiece = pieces[isNegative ? start + 1 : start];
    if (numberPiece?.kind !== 'number' || (numberPiece.typed.includes('.') && where.decimalSign === 'comma')) return [];
    if (/^\$?[1-9]\d{0,2}\.\d{3}%?$/.test(numberPiece.typed)) return [];
    let written = (isNegative ? '-' : '') + numberPiece.typed.replace('$', '');
    let number = written.endsWith('%') ? Number(written.slice(0, -1)) / 100 : Number(written);
    return [[saidNumber(written, written, number), start + (isNegative ? 2 : 1)]];
  },
  nth: ({ pieces }, start) => {
    let { kind, typed = '' } = pieces[start] ?? {};
    let nth = kind === 'nth' ? Number.parseInt(typed, 10) : ORDINAL_WORDS.indexOf(typed);
    return nth < 1 ? [] : [[saidNumber(String(nth), typed, nth), start + 1]];
  },
  words: (reading, start) =>
    reading.pieces.slice(start).map((piece, offset): SlotReading => {
      let typed = typedTextOfPieces(reading, start, start + offset + 1);
      return [
        {
          written: quoteForFormula(typed),
          typed,
          cells: null,
          number: null,
        },
        start + offset + 1,
      ];
    }),
};
export const quoteForFormula = (text: string): string => '"' + text.replaceAll('"', '""') + '"';
export const AMBIGUOUS_READING = '?';
export const parseWordsTemplate = (template: string): TemplatePart[] =>
  template.split(' ').map((part): TemplatePart => {
    if (part.startsWith('<'))
      return {
        slot: part.slice(1, -1),
      };
    let isOptional = part.startsWith('[');
    return {
      phrases: (isOptional ? part.slice(1, -1) : part).split('/').map((phrase) => phrase.split('_')),
      isOptional,
    };
  });
export const namesAnyHeading = (text: string, where: FormulaWhere): boolean =>
  where.headings.some((heading) => textNamesHeading(text, heading));
export const mayMeanTheTableCache = new WeakMap<FormulaWhere, Map<string, boolean>>();
export const slotReadingsCache = new WeakMap<WordPiece[], Map<SlotReader, Map<number, SlotReading[]>>>();
export const areTemplateWordsTyped = (template: TemplatePart[], typedWords: Set<string>): boolean =>
  template.every(
    (part) =>
      'slot' in part ||
      part.isOptional ||
      part.phrases.some((phrase) => phrase.every((word) => typedWords.has(word))),
  );
export const argumentFormulaText = (argument: Said | string): string => (typeof argument === 'string' ? argument : argument.written);
export const EMPTY_TEMPLATE_MATCH: TemplateMatch = {
  said: [],
  mayMeanTheTable: false,
};
