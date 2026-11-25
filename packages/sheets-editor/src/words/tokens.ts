import type { SignsOfNumbers } from '../model/workbook.ts';
/** A word of typed text, with what it reads as and what stands around it. */
export interface TypedWord {
  /** The word as typed. */
  said: string;
  /** The word as read: lower case, without apostrophes, abbreviations written out, symbols read as words. */
  plain: string;
  /** Its place among the words. */
  at: number;
  isAfterHyphen: boolean;
  isAfterBlank: boolean;
  /** The text between the word before and this one. */
  gap: string;
  /** The text after the word. */
  tail: string;
  isInQuotes: boolean;
}
/** The patterns that cut typed text into words. */
export interface WordPatterns {
  piece: RegExp;
  /** Also takes `w/` and `w/o` as words. */
  pieceOrWSlash: RegExp;
  /** A number whose signs are read the other way round, to be rewritten with a decimal point; `null` where none is. */
  numberToRewrite: RegExp | null;
}
/** A phrase as its words, and what it means. */
export type PhraseMeaning<Meant> = [words: string[], meant: Meant];
/** What a phrase found among the words means, and how many words it takes. */
export interface PhraseFound<Meant> {
  meant: Meant;
  wordCount: number;
}
export function wordPatternsOf(numberPattern: string, symbolGuard: string, numberToRewritePattern: string | null): WordPatterns {
  let source = String.raw`(?<![\p{L}\p{N}])-?(?:${numberPattern})(?![\p{L}\p{N}])|[\p{L}\p{N}'’]+|(?:(?!\.\p{N})${symbolGuard}[^\s\p{L}\p{N}'’])+`;
  return {
    piece: new RegExp(source, 'gu'),
    pieceOrWSlash: new RegExp(String.raw`(?<![\p{L}\p{N}])[wW]\/[oO]?(?![\p{L}\p{N}])|${source}`, 'gu'),
    numberToRewrite: numberToRewritePattern === null ? null : new RegExp(`^-?(?:${numberToRewritePattern})$`, 'u'),
  };
}
export function plainOfSymbol(symbol: string, charBefore: string | undefined, charAfter: string | undefined, dropsQuotes: boolean): string {
  let unquoted = dropsQuotes ? symbol.replace(quoteMarkPattern, '') : symbol;
  let unbracketed = unquoted.replace(/[()[\]]/g, '');
  let symbolText = /^,+$/.test(unbracketed) ? unbracketed : unquoted;
  if (symbolText === '') return '';
  if (/^[,;]+$/.test(symbolText)) return ',';
  if (symbolText === '/') return 'or';
  if (symbolText === '!=' || symbolText === '<>' || symbolText === '≠') return 'not';
  if (symbolText === '=' || symbolText === ':') return 'is';
  if (/^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(symbolText)) return '';
  let [isBlankBefore, isBlankAfter] = [isBlankOrEdgeCharacter(charBefore), isBlankOrEdgeCharacter(charAfter)];
  if (isBlankBefore && isBlankAfter && /^[–—]+$/.test(symbolText)) return '';
  if (isBlankBefore && isBlankAfter) return symbolText === '&' || symbolText === '+' ? 'and' : symbolText;
  if (isBlankBefore && (symbolText === '-' || symbolText === '!')) return 'not';
  return (!isBlankBefore && !isBlankAfter && /^[-._]$/.test(symbolText)) || /^[.?!"“”()[\]…]+$/.test(symbolText) ? '' : symbolText;
}
export function splitIntoWords(typed: string, readsSymbols: boolean = true, signs?: SignsOfNumbers): TypedWord[] {
  let words: TypedWord[] = [];
  let [lastEnd, quoteCount] = [0, 0];
  let {
    piece,
    pieceOrWSlash,
    numberToRewrite,
  } = signs === undefined ? wordPatternWithSlashAbbreviations : WORD_PATTERN(signs);
  for (let { 0: said, index: at } of typed.matchAll(/[wW]\//.test(typed) ? pieceOrWSlash : piece)) {
    let lowered =
      numberToRewrite?.test(said) === true ? said.replaceAll('.', '').replace(',', '.') : said.toLowerCase().replace(/['’]/g, '');
    let plain = /[\p{L}\p{N}]/u.test(said)
      ? (WORD_ABBREVIATIONS.get(lowered) ?? lowered)
      : plainOfSymbol(said, typed[at - 1], typed[at + said.length], readsSymbols);
    let isAfterHyphen = typed[at - 1] === '-' && !isBlankOrEdgeCharacter(typed[at - 2]);
    let isAfterBlank = isBlankOrEdgeCharacter(typed[at - 1]);
    if (plain === '') continue;
    let gap = typed.slice(lastEnd, at);
    quoteCount += (gap + (/[\p{L}\p{N}]/u.test(said) ? '' : said)).match(quoteMarkPattern)?.length ?? 0;
    let isInQuotes = quoteCount % 2 === 1;
    let lastWord = words.at(-1);
    if (lastWord !== undefined)
      words[words.length - 1] = {
        ...lastWord,
        tail: gap,
      };
    words.push({
      said,
      plain,
      at: words.length,
      isAfterHyphen,
      isAfterBlank,
      gap,
      tail: typed.slice(at + said.length),
      isInQuotes,
    });
    lastEnd = at + said.length;
  }
  return words;
}
export function longestPhraseAt<Meant>(
  phrases: readonly PhraseMeaning<Meant>[],
  words: readonly TypedWord[],
  at: number,
): PhraseFound<Meant> | null {
  let longest: PhraseFound<Meant> | null = null;
  for (let [phrase, meant] of phrases)
    if (phrase.length > (longest?.wordCount ?? 0) && wordsMatchAt(words, at, phrase))
      longest = {
        meant,
        wordCount: phrase.length,
      };
  return longest;
}
export const COMMA_NUMBER_AFTER_SIGN_GUARD = String.raw`(?!(?<=[(<>=≤≥$€£¥+-]),[0-9]+(?![\p{L}\p{N}]))`;
export const POINT_NUMBER_PATTERN = String.raw`\p{N}{1,3}(?:,\p{N}{3})+(?:\.\p{N}+)?|\p{N}+(?:\.\p{N}+)?|\.\p{N}+`;
export const wordPatternWithSlashAbbreviations = wordPatternsOf(POINT_NUMBER_PATTERN, '', null);
export const DOT_GROUPED_NUMBER_PATTERN = String.raw`[1-9][0-9]{0,2}(?:\.[0-9]{3})+(?:,[0-9]+)?`;
export const COMMA_DECIMAL_PATTERN = String.raw`[0-9]*,[0-9]+`;
export const COMMA_GROUPED_POINT_NUMBER_PATTERN = String.raw`[0-9]{1,3}(?:,[0-9]{3})+\.[0-9]+`;
export const wordPatternsOfPointGroups = wordPatternsOf(
  `${DOT_GROUPED_NUMBER_PATTERN}|${COMMA_GROUPED_POINT_NUMBER_PATTERN}|${COMMA_DECIMAL_PATTERN}|${POINT_NUMBER_PATTERN}`,
  COMMA_NUMBER_AFTER_SIGN_GUARD,
  `${DOT_GROUPED_NUMBER_PATTERN}|${COMMA_DECIMAL_PATTERN}`,
);
export const wordPatternsOfCommaDecimals = wordPatternsOf(
  `${COMMA_GROUPED_POINT_NUMBER_PATTERN}|${COMMA_DECIMAL_PATTERN}|${POINT_NUMBER_PATTERN}`,
  COMMA_NUMBER_AFTER_SIGN_GUARD,
  COMMA_DECIMAL_PATTERN,
);
export const WORD_PATTERN = ({ decimalSign, groupSign }: Pick<SignsOfNumbers, 'decimalSign' | 'groupSign'>): WordPatterns =>
  decimalSign === 'point' ? wordPatternWithSlashAbbreviations : groupSign === 'point' ? wordPatternsOfPointGroups : wordPatternsOfCommaDecimals;
export const quoteMarkPattern = /["“”]/g;
export const WORD_ABBREVIATIONS = new Map(
  Object.entries({
    'w/': 'with',
    'w/o': 'without',
    wk: 'week',
    wks: 'weeks',
    tmrw: 'tomorrow',
    tmw: 'tomorrow',
  }),
);
export const isBlankOrEdgeCharacter = (character: string | undefined): boolean => character === undefined || /\s/.test(character);
export const NO_WORD_TOKEN: TypedWord = {
  said: '',
  plain: '',
  at: -1,
  isAfterHyphen: false,
  isAfterBlank: true,
  gap: '',
  tail: '',
  isInQuotes: false,
};
export const plainWordsOf = (text: string): string[] => splitIntoWords(text).map(({ plain }) => plain);
export const wordsMatchAt = (words: readonly TypedWord[], at: number, phrase: readonly string[]): boolean =>
  phrase.every((plain, offset) => words[at + offset]?.plain === plain);
export const pluralEsPattern = /(?:[sxzo]|ch|sh|.{3}[dlnrj])$/;
export const isWordOrItsPlural = (word: string, singular: string): boolean =>
  word === singular ||
  (singular.length > 1 &&
    (word === `${singular}s` ||
      (pluralEsPattern.test(singular) && word === `${singular}es`) ||
      (singular.endsWith('y') && word === `${singular.slice(0, -1)}ies`)));
export const isSymbolForNotOrIs = ({ plain, said }: TypedWord): boolean =>
  (plain === 'not' || plain === 'is') && !/[\p{L}\p{N}]/u.test(said);
export const phrasesMeaning = <const Meant>(meaning: Meant, phrases: string): PhraseMeaning<Meant>[] =>
  phrases.split(', ').map((phrase): PhraseMeaning<Meant> => [phrase.split(' '), meaning]);
