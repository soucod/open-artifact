import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { toolSearchWords, toolLabelWithValue } from '../../tools/search-words.ts';
import { BORDER_LINE_STYLES, BORDER_EDGE_CHOICES } from '../../format/borders.ts';
import { borderStyleLabel, borderEdgesLabel, cellColorName } from '../../i18n/format-labels.ts';
import { colorCommandChoices, colorCommandKey, colorSwatchIcon, fontSizeCommand } from './bar-commands.tsx';
import { toolSearchMessages } from '../../messages/tool-search-words.ts';
import { borderChoiceIcon } from '../../format/borders-picker.tsx';
import { normalizeHexColor } from '../../format/hsb-colors.ts';
import { colorsEqual } from '../../model/colors.ts';
import { fontSizesMatchingTyped, FONT_SIZE_CHOICES } from '../../format/toolbar-size-choices.ts';
import { translateMessage } from '../../i18n/messages.ts';
import { trimWordQuotes } from './matching.ts';
import { optionColorName } from '../../i18n/chip-labels.ts';
import type { BorderStyle, Color, Edges } from '@open-artifact/sheets-core';
import type { MenuCommand } from './matching.ts';
import type { SearchMenuBarActions, SearchMenuBarState } from './bar-commands.tsx';
import type { BorderChoice, BorderLine } from '../../format/borders.ts';
import type { ColorProperty } from '../../i18n/format-labels.ts';
/** The words the search menu reads borders from, in the words of the page. */
export type BordersVocabulary = ReturnType<typeof buildBordersVocabulary>;
/** The vocabulary of borders, and the name of the borders tool it was built for. */
export interface BordersVocabularyCache {
  forToolNamed: string;
  vocabulary: BordersVocabulary;
}
/** What the commands of borders typed in the search menu do. */
export interface BorderCommandsActions {
  onBordersChosen: (choice: BorderChoice, pen: Partial<BorderLine>) => void;
}
export let bordersVocabularyCache: BordersVocabularyCache | null;
export function buildBordersVocabulary() {
  let borderWordList = wordSetOf([
    sheetMessages.borders(),
    ...singleWords(toolSearchWords('borders', 'borderInTheSingular')),
    ...borderWords.line(),
  ]);
  let outerWords = wordSetOf(borderWords.outer());
  let passedOver = new Set([...borderWordList, ...wordSetOf(borderWords.passedOver())]);
  let styleWords = BORDER_LINE_STYLES.map(
    (style) => ({
      style,
      words: wordSetOf(singleWords([borderStyleLabel(style), ...borderWords[style]()])),
    }),
  );
  let colorWords = colorCommandChoices('textColor').flatMap(
    (color) =>
      color.kind === 'none'
        ? []
        : [
            {
              color,
              words: wordSetOf(singleWords([textColorName(color), ...toolSearchWords(`color.${colorCommandKey(color)}`)])),
            },
          ],
  );
  let edgeNames = new Map<Edges, string[][]>(
    BORDER_EDGE_CHOICES.map(
      (edgesKind) => [
        edgesKind,
        wordsOfText(borderEdgesLabel(edgesKind))
          .filter((word) => !passedOver.has(word))
          .map((word) => [word])
          .concat(toolSearchWords(`borders.${edgesKind}`).map(wordsOfText)),
      ],
    ),
  );
  return {
    passedOver,
    styleSaidBy: (word: string) => styleWords.find(({ words }) => words.has(word))?.style ?? null,
    colorSaidBy: (word: string) => colorWords.find(({ words }) => words.has(word))?.color ?? null,
    saysItIsABorder: borderWordList,
    saysOuterByItself: outerWords,
    wordsOfPen: [
      ...styleWords,
      ...colorWords,
      {
        words: borderWordList,
      },
    ]
      .flatMap(({ words }) => Array.from(words))
      .filter((word) => !outerWords.has(word)),
    namesOfEdges: (edges: Edges) => edgeNames.get(edges) ?? [],
  };
}
export function bordersVocabulary() {
  let borderToolName = sheetMessages.borders();
  if (bordersVocabularyCache?.forToolNamed !== borderToolName)
    bordersVocabularyCache = {
      forToolNamed: borderToolName,
      vocabulary: buildBordersVocabulary(),
    };
  return bordersVocabularyCache.vocabulary;
}
export function borderCommandsFromWords(
  text: string,
  situation: Pick<SearchMenuBarState, 'whyNoToolForCells'>,
  actions: BorderCommandsActions,
) {
  let {
    passedOver,
    saysItIsABorder: borderWordList,
    saysOuterByItself: outerWords,
    wordsOfPen: penWords,
    styleSaidBy,
    colorSaidBy,
    namesOfEdges,
  } = bordersVocabulary();
  let pen: { style: BorderStyle | null; color: Color | null } = {
    style: null,
    color: null,
  };
  let edgeWords: string[] = [];
  let words = wordsOfText(text);
  for (let word of words) {
    let [styleOfWord, colorOfWord] = [styleSaidBy(word), colorSaidBy(word)];
    if (styleOfWord !== null) {
      if (pen.style !== null) return [];
      pen.style = styleOfWord;
    } else if (colorOfWord !== null) {
      if (pen.color !== null) return [];
      pen.color = colorOfWord;
    } else edgeWords.push(word);
  }
  let { style, color } = pen;
  let saysBorder = edgeWords.some((word) => borderWordList.has(word));
  if (style === null && (color === null || !saysBorder)) return [];
  let needsAnotherWordSet = wordSetOf(borderWords.needsAnotherWord());
  let needsAnotherWord = words.some((word) => needsAnotherWordSet.has(word));
  let lastEdgeWord = edgeWords.at(-1) ?? '';
  let isLastWordTyped = lastEdgeWord === words.at(-1) && !needsAnotherWord;
  let isWordUnfinished = isLastWordTyped && lastEdgeWord.length > 1 && !borderWordList.has(lastEdgeWord);
  let isStartOfPenWord = isWordUnfinished && penWords.some((penWord) => penWord.startsWith(lastEdgeWord));
  let isStartOfEdgeName = isWordUnfinished && !isStartOfPenWord;
  let wordsMatchedAt = (edgeName: readonly string[], at: number) => {
    for (let [offset, word] of edgeName.entries()) {
      let typed = edgeWords[at + offset] ?? '';
      if (typed === word) continue;
      if (at + offset !== edgeWords.length - 1 || !word.startsWith(typed)) return 0;
      return (offset > 0 ? isStartOfEdgeName || (isLastWordTyped && borderWordList.has(typed)) : isStartOfEdgeName && edgeName.length === 1)
        ? offset + 1
        : 0;
    }
    return edgeName.length;
  };
  let edgesSaidBy = (end: number, allowsLeftover: boolean) => {
    let coversWords = (names: readonly string[][]) => {
      if (end <= 0) return true;
      let reachable: boolean[] = [];
      reachable[end] = true;
      for (let at = end - 1; at >= 0; at -= 1)
        reachable[at] =
          names.some((name) => {
            let matched = wordsMatchedAt(name, at);
            return matched > 0 && at + matched <= end && reachable[at + matched] === true;
          }) ||
          (passedOver.has(edgeWords[at] ?? '') && (allowsLeftover || at < edgeWords.length - 1) && reachable[at + 1] === true);
      return reachable[0] === true;
    };
    return BORDER_EDGE_CHOICES.filter((edgesKind) => coversWords(namesOfEdges(edgesKind)));
  };
  let isStillTyping =
    !isSomeEdges(edgesSaidBy(edgeWords.length - 1, true)) &&
    (isStartOfPenWord ||
      (isStartOfEdgeName &&
        BORDER_EDGE_CHOICES.some(
          (edgesKind) => namesOfEdges(edgesKind).some((edgeName) => wordsMatchedAt(edgeName, edgeWords.length - 1) > 0),
        )));
  let edges = edgesSaidBy(edgeWords.length, !isStillTyping);
  let meansOuter = !isSomeEdges(edges) && edgeWords.some((word) => outerWords.has(word));
  let littleWords = toolSearchMessages.littleWords();
  let saysSomething =
    saysBorder || color !== null || edgeWords.some((word) => !littleWords.has(word) && !passedOver.has(word));
  if (needsAnotherWord && !saysSomething) return [];
  let penLabel = borderWords.penInWords(style === null ? null : borderStyleLabel(style), color === null ? null : textColorName(color));
  return (meansOuter ? (['outer'] satisfies Edges[]) : edges).map(
    (edgesKind): MenuCommand => ({
      id: `bar.borders.#.${[edgesKind, style ?? '', color === null ? '' : colorCommandKey(color)].join('-')}`,
      label: toolLabelWithValue(borderEdgesLabel(edgesKind), penLabel),
      icon: borderChoiceIcon(edgesKind),
      actsOn: 'cells',
      whyNot: situation.whyNoToolForCells,
      run: () =>
        actions.onBordersChosen(edgesKind, {
          ...(style !== null && {
            style,
          }),
          ...(color !== null && {
            color,
          }),
        }),
    }),
  );
}
export function hexColorCommands(
  text: string,
  situation: Pick<SearchMenuBarState, 'whyNoToolForCells' | 'formatOfSelection'>,
  actions: Pick<SearchMenuBarActions, 'onFormatChosen'>,
) {
  let trimmed = text.trim();
  let hex = trimmed.startsWith('#') ? normalizeHexColor(trimmed) : null;
  if (hex === null) return [];
  let color: Color = {
    kind: 'rgb',
    hex,
  };
  let { shared: sharedFormat } = situation.formatOfSelection;
  let colorCommand = (property: ColorProperty, toolName: string, colorOfCells: Color | null): MenuCommand => ({
    id: `bar.${property}.${hex}`,
    label: toolLabelWithValue(toolName, cellColorName(property, color)),
    otherWords: [trimmed.slice(1)],
    icon: colorSwatchIcon(property, color),
    isTicked: colorOfCells !== null && colorsEqual(colorOfCells, color),
    actsOn: 'cells',
    whyNot: situation.whyNoToolForCells,
    run: () =>
      actions.onFormatChosen(
        property === 'fillColor'
          ? {
              fillColor: color,
            }
          : {
              textColor: color,
            },
      ),
  });
  return [
    colorCommand('fillColor', sheetMessages.cellColor(), sharedFormat.fillColor),
    colorCommand('textColor', sheetMessages.textColor(), sharedFormat.font.color),
  ];
}
export function typedFontSizeCommands(
  typed: string,
  barState: Pick<SearchMenuBarState, 'formatOfSelection' | 'whyNoToolForCells'>,
  actions: Pick<SearchMenuBarActions, 'onFormatChosen'>,
): MenuCommand[] {
  let normalized = typed.normalize('NFKC').trim().toLowerCase();
  let { name = '', size = '' } = (FONT_SIZE_AFTER_NAME.exec(normalized) ?? FONT_SIZE_BEFORE_NAME.exec(normalized))?.groups ?? {};
  let [matchedSize] = fontSizesMatchingTyped(size);
  if (matchedSize !== Number(size) || FONT_SIZE_CHOICES.some((choice) => choice === matchedSize)) return [];
  let toolName = name.replace(':', '').trim();
  return [sheetMessages.fontSize(), ...toolSearchWords('fontSize')].some((word) => word.toLowerCase() === toolName)
    ? [
        {
          ...fontSizeCommand(matchedSize, barState, actions),
          id: `bar.fontSize.#${matchedSize}`,
        },
      ]
    : [];
}
export const splitWordList = (list: string) =>
  list
    .split(/[,،、，]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
export const borderWords = {
  thin: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'thinner, hairline',
        id: '3/OSCQXW8l',
      }),
    ),
  medium: (): string[] => [],
  thick: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'thicker',
        id: 'DNt15WT+K/',
      }),
    ),
  dashed: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'dash, dashes',
        id: 'rmwH3oNx22',
      }),
    ),
  dotted: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'dots, doted',
        id: '342xm9bhLn',
      }),
    ),
  double: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'doubled, dubble',
        id: 'ARG/owu9RA',
      }),
    ),
  passedOver: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'a, an, the, and, with, in, of, on, at',
        id: 'i+2LYApDbk',
      }),
    ),
  line: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'line',
        id: 'mp2lM8sTwa',
      }),
    ),
  outer: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'outline, frame',
        id: 'wJ/9s3bAT+',
      }),
    ),
  needsAnotherWord: () =>
    splitWordList(
      translateMessage({
        defaultMessage: 'medium',
        id: '+knp4PS5mD',
      }),
    ),
  penInWords: (style: string | null, color: string | null) =>
    style !== null && color !== null
      ? translateMessage(
          {
            defaultMessage: '{style}, {color}',
            id: 'oyYiS3z2OJ',
          },
          {
            style,
            color,
          },
        )
      : (style ?? color ?? ''),
};
export const wordsOfText = (text: string) =>
  text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('’', "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map(trimWordQuotes)
    .filter((word) => word !== '');
export const wordSetOf = (texts: readonly string[]) => new Set(texts.flatMap(wordsOfText));
export const singleWords = (texts: readonly string[]) => texts.filter((text) => wordsOfText(text).length === 1);
export const textColorName = (color: Color) =>
  color.kind === 'standard' ? optionColorName(color) : cellColorName('textColor', color);
bordersVocabularyCache = null;
export const isSomeEdges = (edges: readonly Edges[]) => edges.length < BORDER_EDGE_CHOICES.length;
export const FONT_SIZE_AFTER_NAME = /^(?<name>\D*[\s:])(?<size>\d+)\s*(?:pt)?$/u;
export const FONT_SIZE_BEFORE_NAME = /^(?<size>\d+)(?<name>\D+)$/u;
