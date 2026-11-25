import type { EngineRun, Mark, Paragraph } from '@open-artifact/sheets-core';
import { decodeHtmlEntities } from './html-reading.ts';
import type { HtmlAttributes, HtmlTag } from './html-reading.ts';
import type { CellFont } from './css-looks.ts';
import { acceptedEncodedLinkUrl, runsWithLinksOnWords } from '../links/text-links.ts';
import { isSameLook, fontMarksWhere } from '../editor/text-looks.ts';

/** A stretch of a pasted cell's HTML text, as written there, with the looks of the tags around it. */
export interface PastedTextPart {
  written: string;
  marks: Mark[];
  link: string | null;
}

/** The marks drawn along the text's line, which an inner tag keeps from the tags around it. */
export type LineMarks = Pick<CellFont, 'underline' | 'strikethrough'>;

export interface OpenHtmlTag {
  name: string;
  font: CellFont;
  lines: LineMarks;
  link: string | null;
}

/** A pasted cell's HTML read so far: the tags still open, and its text parts (`null` once it cannot be read). */
export interface RichTextReading {
  open: OpenHtmlTag[];
  parts: PastedTextPart[] | null;
}

export interface RichTextOfPastedCell {
  paragraphs: Paragraph[];
}

export function readTagIntoRichText(
  reading: RichTextReading,
  { name, isClosing, attributes, writtenBefore }: HtmlTag,
  fontOfAttributes: (attributes: HtmlAttributes) => CellFont,
): void {
  let { open: openTags, parts } = reading;
  let innermostTag = openTags.at(-1);
  if (parts === null || innermostTag === undefined) return;
  let text = decodeHtmlEntities(writtenBefore);
  if (text === null) {
    reading.parts = null;
    return;
  }
  if (text !== '')
    parts.push({
      written: text,
      marks: marksOfFont(innermostTag.font),
      link: innermostTag.link,
    });
  if (isClosing || name === 'a') {
    const openIndex = openTags.findLastIndex((openTag) => openTag.name === name);
    if (openIndex > 0) openTags.length = openIndex;
  }
  let openTag = openTags.at(-1);
  if (isClosing || openTag === undefined) return;
  if (openTags.length > MOST_OPEN_HTML_TAGS) reading.parts = null;
  if (openTags.length > MOST_OPEN_HTML_TAGS || VOID_HTML_TAGS.has(name)) return;
  let tagFont = {
    ...FONT_OF_HTML_TAGS.get(name),
    ...fontOfAttributes(attributes),
  };
  let lineMarks = {
    ...openTag.lines,
    ...lineMarksOfFont(tagFont),
  };
  let href = name === 'a' ? attributes.get('href') : undefined;
  let link = href === undefined ? openTag.link : acceptedEncodedLinkUrl(href);
  openTags.push({
    name,
    font: {
      ...openTag.font,
      ...tagFont,
      ...lineMarks,
    },
    lines: lineMarks,
    link,
  });
}
export function runsMatchingShownText(shownText: string, parts: readonly PastedTextPart[]): EngineRun[] | null {
  const runs: EngineRun[] = [];
  let addRun = (text: string, part: PastedTextPart) => {
    let lastRun = runs.at(-1);
    if (text === '') return;
    if (lastRun !== undefined && isSameLook(lastRun, part)) lastRun.text += text;
    else
      runs.push({
        text,
        marks: [...part.marks],
        link: part.link,
      });
  };
  let readIndex = 0;
  let lastPart: PastedTextPart | null = null;
  let blankPartBefore: PastedTextPart | null = null;
  for (let part of parts) {
    let letters = part.written.replaceAll(/\s+/g, '');
    if (letters === '') {
      blankPartBefore = part;
      continue;
    }
    let runStart = readIndex;
    while (isWhitespaceCharacter(shownText[runStart])) runStart += 1;
    let partForSpaces =
      lastPart !== null && isWhitespaceCharacter(lastPart.written.at(-1))
        ? lastPart
        : isWhitespaceCharacter(part.written[0])
          ? part
          : blankPartBefore;
    addRun(shownText.slice(readIndex, runStart), partForSpaces ?? part);
    let runEnd = runStart;
    for (let letterIndex = 0; letterIndex < letters.length; letterIndex += 1) {
      while (isWhitespaceCharacter(shownText[runEnd])) runEnd += 1;
      if (shownText[runEnd] !== letters[letterIndex]) return null;
      runEnd += 1;
    }
    addRun(shownText.slice(runStart, runEnd), part);
    readIndex = runEnd;
    lastPart = part;
    blankPartBefore = null;
  }
  if (lastPart === null || /\S/.test(shownText.slice(readIndex))) return null;
  addRun(shownText.slice(readIndex), lastPart);
  return runs;
}
export function richTextOfPastedCell(shownText: string, { open: openTags, parts }: RichTextReading): RichTextOfPastedCell | null {
  let runs = parts === null || shownText.length > MOST_RICH_TEXT_LENGTH ? null : runsMatchingShownText(shownText, parts);
  if (runs === null || runs.length > MOST_PASTED_RUNS_IN_CELL) return null;
  let runsWithLinks = runsWithLinksOnWords(shownText, runs);
  let plainLook = {
    marks: marksOfFont(openTags[0]?.font ?? {}),
    link: null,
  };
  if (runsWithLinks.every((run) => isSameLook(run, plainLook))) return null;
  return {
    paragraphs: [
      {
        list: {
          kind: 'none',
        },
        runs: runsWithLinks,
      },
    ],
  };
}
export const emptyRichTextReading = (font: CellFont): RichTextReading => ({
  open: [
    {
      name: '',
      font,
      lines: {},
      link: null,
    },
  ],
  parts: [],
});
export const FONT_OF_HTML_TAGS = new Map<string, CellFont>([
  [
    'b',
    {
      bold: true,
    },
  ],
  [
    'strong',
    {
      bold: true,
    },
  ],
  [
    'i',
    {
      italic: true,
    },
  ],
  [
    'em',
    {
      italic: true,
    },
  ],
  [
    'u',
    {
      underline: 'single',
    },
  ],
  [
    'ins',
    {
      underline: 'single',
    },
  ],
  [
    's',
    {
      strikethrough: true,
    },
  ],
  [
    'strike',
    {
      strikethrough: true,
    },
  ],
  [
    'del',
    {
      strikethrough: true,
    },
  ],
]);
export const lineMarksOfFont = ({ underline = 'none', strikethrough }: CellFont): LineMarks => ({
  ...(underline !== 'none' && {
    underline,
  }),
  ...(strikethrough === true && {
    strikethrough,
  }),
});
export const VOID_HTML_TAGS = new Set('br col hr img input link meta wbr'.split(' '));
export const MOST_OPEN_HTML_TAGS = 50;
export const marksOfFont = (font: CellFont): Mark[] =>
  fontMarksWhere((mark) => (mark === 'underline' ? (font.underline ?? 'none') !== 'none' : font[mark] === true));
export const isWhitespaceCharacter = (character: string | undefined): boolean => character !== undefined && !/\S/.test(character);
export const MOST_PASTED_RUNS_IN_CELL = 300;
export const MOST_RICH_TEXT_LENGTH = 40000;
