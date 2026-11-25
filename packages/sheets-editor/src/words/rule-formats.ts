import type { Color, FontOfACondition, FormatOfACondition, Hue, Shade } from '@open-artifact/sheets-core';
import type { PhraseFound, TypedWord } from './tokens.ts';
import { wordsMatchAt } from './tokens.ts';
import { TABLE_SUBJECT_NOUNS, TASK_NOUNS, ROW_NOUNS } from './vocabulary.ts';
export type FontStyle = 'bold' | 'italic' | 'underline' | 'strikethrough';
/** A part of a format the words name: a font style, or a hue for the text, the fill, or both (`tint`). */
export type FormatPart = { kind: FontStyle } | { kind: 'text' | 'fill' | 'tint'; hue: Hue };
/** Format parts named at the start of the words, and where the words go on. */
export interface FormatReadingAtStart {
  from: number;
  parts: FormatPart[];
}
/** Format parts named at the end of the words, and where they start. */
export interface FormatReadingAtEnd {
  to: number;
  parts: FormatPart[];
}
/** Format parts named in the middle of the words, before a word like `where`, and the words that name them. */
export interface FormatReadingInMiddle {
  words: TypedWord[];
  parts: FormatPart[];
}
/** Words that could not be read as a rule, and whether they may still be on their way to one. */
export interface RuleWordsNotRead {
  kind: 'notRead';
  isOnItsWay: boolean;
}
export function readFormatPartAt(words: readonly TypedWord[], at: number): PhraseFound<FormatPart> | null {
  const [word, nextWord] = [words[at], words[at + 1]];
  if (!isUnquotedWord(word)) return null;
  for (const [phrase, style] of FONT_STYLE_PHRASES) {
    const phraseWords = phrase.split(' ');
    if (wordsMatchAt(words, at, phraseWords) && phraseWords.length === 2)
      return {
        meant: {
          kind: style,
        },
        wordCount: 2,
      };
  }
  const styleWord = FONT_STYLE_PHRASES.find(([phrase]) => phrase === word.plain);
  if (styleWord !== undefined)
    return {
      meant: {
        kind: styleWord[1],
      },
      wordCount: 1,
    };
  const nextPlain = isUnquotedWord(nextWord) ? nextWord.plain : '';
  if (TEXT_COLOR_WORDS.has(word.plain) || FILL_WORDS.has(word.plain)) {
    const hue = HUE_WORDS.get(nextPlain);
    const colorKind = TEXT_COLOR_WORDS.has(word.plain) ? 'text' : 'fill';
    return hue === undefined
      ? null
      : {
          meant: {
            kind: colorKind,
            hue,
          },
          wordCount: 2,
        };
  }
  const paleWordCount = PALE_WORDS.has(word.plain) ? 1 : 0;
  const hueWord = words[at + paleWordCount];
  const hue = isUnquotedWord(hueWord) ? HUE_WORDS.get(hueWord.plain) : undefined;
  if (hue === undefined) return null;
  const wordAfterHue = words[at + paleWordCount + 1];
  const plainAfterHue = isUnquotedWord(wordAfterHue) ? wordAfterHue.plain : '';
  const kind = TEXT_COLOR_WORDS.has(plainAfterHue) ? 'text' : FILL_WORDS.has(plainAfterHue) ? 'fill' : 'tint';
  return {
    meant: {
      kind,
      hue,
    },
    wordCount: paleWordCount + (kind === 'tint' ? 1 : 2),
  };
}
export function readFormatPartsAt(words: readonly TypedWord[], from: number): PhraseFound<FormatPart[]>[] {
  const readings: PhraseFound<FormatPart[]>[] = [];
  let [at, parts]: [number, FormatPart[]] = [from, []];
  for (;;) {
    const partAt = parts.length > 0 && FORMAT_PART_JOINERS.has(words[at]?.plain ?? '') ? at + 1 : at;
    const part = readFormatPartAt(words, partAt);
    if (part === null || parts.length === MOST_FORMAT_PARTS) return readings;
    [at, parts] = [partAt + part.wordCount, [...parts, part.meant]];
    readings.push({
      meant: parts,
      wordCount: at - from,
    });
  }
}
export function formatOfParts(parts: FormatPart[]): FormatOfACondition | null {
  const fillColors = parts.flatMap(
    (part) => (part.kind === 'tint' || part.kind === 'fill' ? [standardFormatColor(part.hue, 100)] : []),
  );
  const textColors = parts.flatMap(
    (part) =>
      part.kind === 'tint' ? [standardFormatColor(part.hue, 800)] : part.kind === 'text' ? [standardFormatColor(part.hue, 600)] : [],
  );
  const hasPart = (kind: FormatPart['kind']) => parts.some((part) => part.kind === kind);
  if (
    fillColors.length > 1 ||
    textColors.length > 1 ||
    new Set(parts.map(({ kind }) => kind)).size < parts.length
  )
    return null;
  const [[fillColor], [textColor]] = [fillColors, textColors];
  const font: FontOfACondition = {
    ...(textColor !== undefined && {
      color: textColor,
    }),
    ...(hasPart('bold') && {
      bold: true,
    }),
    ...(hasPart('italic') && {
      italic: true,
    }),
    ...(hasPart('underline') && {
      underline: 'single',
    }),
    ...(hasPart('strikethrough') && {
      strikethrough: true,
    }),
  };
  return {
    ...(fillColor !== undefined && {
      fillColor,
    }),
    ...(Object.keys(font).length > 0 && {
      font,
    }),
  };
}
export function formatPartsAtStart(words: readonly TypedWord[]): FormatReadingAtStart[] {
  let start = 0;
  for (let opening: string[] | undefined; (opening = POLITE_OPENINGS.find((phrase) => wordsMatchAt(words, start, phrase))) !== undefined; )
    start += opening.length;
  const readings: FormatReadingAtStart[] = [
    {
      from: start,
      parts: [],
    },
  ];
  const addReading = (from: number, parts: FormatPart[]) => {
    readings.push({
      from,
      parts,
    });
    if (CONDITION_OPENERS.has(words[from]?.plain ?? ''))
      readings.push({
        from: from + 1,
        parts,
      });
  };
  if (CONDITION_OPENERS.has(words[start]?.plain ?? ''))
    readings.push({
      from: start + 1,
      parts: [],
    });
  for (const { meant: parts, wordCount } of readFormatPartsAt(words, start)) addReading(start + wordCount, parts);
  for (const [verbPhrase, part] of FORMAT_VERB_PHRASES) if (wordsMatchAt(words, start, verbPhrase)) addReading(start + verbPhrase.length, [part]);
  const word = words[start];
  if (isUnquotedWord(word) && (FORMAT_VERBS.has(word.plain) || word.plain === 'fill')) {
    let afterVerb = start + 1;
    while (['the', 'it', 'them', 'all'].includes(words[afterVerb]?.plain ?? '')) afterVerb += 1;
    addReading(afterVerb, []);
    for (const { meant: parts, wordCount: partsWordCount } of readFormatPartsAt(words, afterVerb))
      addReading(afterVerb + partsWordCount, parts);
  }
  return readings;
}
export function formatPartsAtEnd(words: readonly TypedWord[]): FormatReadingAtEnd[] {
  let end = words.length;
  while (end > 0 && words[end - 1]?.plain === 'please') end -= 1;
  const readings: FormatReadingAtEnd[] = [
    {
      to: end,
      parts: [],
    },
  ];
  for (let at = end - 1; at >= 0; at -= 1)
    for (const { meant: parts, wordCount } of readFormatPartsAt(words, at)) {
      if (at + wordCount !== end) continue;
      readings.push({
        to: at,
        parts,
      });
      for (const leadIn of FORMAT_LEAD_INS)
        if (at >= leadIn.length && wordsMatchAt(words, at - leadIn.length, leadIn))
          readings.push({
            to: at - leadIn.length,
            parts,
          });
    }
  return readings;
}
export function formatPartsInMiddle(words: readonly TypedWord[]): FormatReadingInMiddle[] {
  const readings: FormatReadingInMiddle[] = [
    {
      words: [],
      parts: [],
    },
  ];
  for (let at = 1; at < words.length - 1; at += 1)
    for (const { meant: parts, wordCount } of readFormatPartsAt(words, at))
      if (RELATIVE_PRONOUNS.has(words[at + wordCount]?.plain ?? ''))
        readings.push({
          words: words.slice(at, at + wordCount),
          parts,
        });
  return readings;
}
export const FORMAT_PARTS_NOT_READ: RuleWordsNotRead = {
  kind: 'notRead',
  isOnItsWay: false,
};
export const HUE_WORDS = new Map<string, Hue>([
  ['gray', 'gray'],
  ['grey', 'gray'],
  ['red', 'red'],
  ['orange', 'orange'],
  ['yellow', 'yellow'],
  ['green', 'green'],
  ['teal', 'teal'],
  ['blue', 'blue'],
  ['purple', 'purple'],
  ['magenta', 'magenta'],
  ['pink', 'magenta'],
]);
export const FONT_STYLE_PHRASES: [phrase: string, style: FontStyle][] = [
  ['bold', 'bold'],
  ['bolded', 'bold'],
  ['italic', 'italic'],
  ['italics', 'italic'],
  ['underline', 'underline'],
  ['underlined', 'underline'],
  ['strikethrough', 'strikethrough'],
  ['strike through', 'strikethrough'],
  ['struck through', 'strikethrough'],
  ['crossed out', 'strikethrough'],
];
export const TEXT_COLOR_WORDS = new Set<string>(['text', 'font', 'letters']);
export const FILL_WORDS = new Set<string>(['background', 'fill', 'highlight']);
export const PALE_WORDS = new Set<string>(['light', 'pale']);
export const isUnquotedWord = (word: TypedWord | undefined): boolean => word !== undefined && !word.isInQuotes;
export const FORMAT_PART_JOINERS = new Set<string>(['and', ',', 'with']);
export const MOST_FORMAT_PARTS = 7;
export const standardFormatColor = (hue: Hue, shade: Shade): Color => ({
  kind: 'standard',
  hue,
  shade,
});
export const POLITE_OPENINGS = ['please', 'can you', 'could you', 'i want', 'i need', 'id like'].map(
  (phrase) => phrase.split(' '),
);
export const FORMAT_VERBS = new Set<string>('highlight color colour make turn mark flag shade paint format set'.split(' '));
export const FORMAT_VERB_PHRASES: [words: string[], part: FormatPart][] = [
  [
    ['bold'],
    {
      kind: 'bold',
    },
  ],
  [
    ['italicize'],
    {
      kind: 'italic',
    },
  ],
  [
    ['underline'],
    {
      kind: 'underline',
    },
  ],
  [
    ['strike', 'through'],
    {
      kind: 'strikethrough',
    },
  ],
  [
    ['strike', 'out'],
    {
      kind: 'strikethrough',
    },
  ],
  [
    ['cross', 'out'],
    {
      kind: 'strikethrough',
    },
  ],
  [
    ['gray', 'out'],
    {
      kind: 'tint',
      hue: 'gray',
    },
  ],
  [
    ['grey', 'out'],
    {
      kind: 'tint',
      hue: 'gray',
    },
  ],
];
export const CONDITION_OPENERS = new Set<string>(['if', 'when', 'whenever', 'where', 'for', 'on']);
export const FORMAT_LEAD_INS = [
  'then',
  'in',
  'in a',
  'as',
  'to',
  'with',
  'with a',
  'should be',
  'should turn',
  'should go',
  'then make it',
  'go',
  'goes',
  'turn',
  'turns',
  'get',
  'gets',
  'highlighted',
  'highlighted in',
  'colored',
  'colored in',
  'coloured',
  'coloured in',
  'shaded',
  'shaded in',
  'marked',
  'marked in',
  'filled with',
].map((phrase) => phrase.split(' '));
export const RELATIVE_PRONOUNS = new Set<string>(['where', 'whose', 'if', 'when', 'whenever', 'that', 'which']);
export const WHOLE_WORDS = new Set<string>(['whole', 'entire', 'full']);
export const RECORD_KIND_NOUNS = new Set<string>([...TABLE_SUBJECT_NOUNS, ...TASK_NOUNS]);
export const CELL_NOUNS = new Set<string>(['cell', 'cells', 'value', 'values']);
export const RULE_PREAMBLE_WORDS = new Set<string>([...ROW_NOUNS, ...WHOLE_WORDS, ...CONDITION_OPENERS, ...RELATIVE_PRONOUNS, 'the']);
