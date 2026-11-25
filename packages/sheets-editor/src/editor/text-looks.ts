import type { Entry, ListLine, Paragraph, SharedCellFormat } from '@open-artifact/sheets-core';
import type { EntryLooks, EntryLooksInHistory, EntryLooksKept, FontMark, StretchOfLooks } from '../state/initial-state.ts';
import type { EditingMode, UndoOrRedoEffect } from '../state/transitions.ts';
import type { KeyPress } from '../state/event-reducer.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellFormatChoice } from '../i18n/change-labels.ts';
/** The font marks of a format: as a cell has them, or as the selected cells share them (`null` where they differ). */
export interface FormatWithFontMarks {
  font: Pick<SharedCellFormat['font'], FontMark>;
}
/** The look of a stretch of text, without its length. */
export type Look = Pick<StretchOfLooks, 'marks' | 'link'>;
/** What changed between two texts: `written` took the place of `from` to `to` of the text before. */
export interface TextDiff {
  from: number;
  to: number;
  written: string;
}
/** A line of an entry: the list it is a line of, and the looks of its text. */
export interface LineOfLooks {
  list: ListLine;
  stretches: StretchOfLooks[];
}
/** Where a link runs in the text of an entry. */
export interface LinkSpan {
  start: number;
  end: number;
  link: string;
}
/** A line of a list, at a level. */
export type LineInList = Exclude<ListLine, { kind: 'none' }>;
/** A kind of list a line can be in. */
export type ListKind = LineInList['kind'];
/** An entry of text with looks, as an edit enters it. */
export type EntryWithLooks = Extract<Entry, { kind: 'textWithLooks' }>;
/** Which way a step through the history of looks goes. */
export type StepInLooksHistory = UndoOrRedoEffect['direction'];
/** Where the caret stands among the lists of an entry. */
export interface ListAtCaret {
  line: number;
  list: ListLine;
  isAtStart: boolean;
  isEmpty: boolean;
}
/** The key that turns a font mark on or off, with the modifier key. */
export interface FontMarkShortcut {
  letter: string;
  isWithShift: boolean;
}
export function isFontMarkOn(mark: FontMark, { font }: FormatWithFontMarks): boolean {
  switch (mark) {
    case 'bold':
    case 'italic':
    case 'strikethrough':
      return font[mark] === true;
    case 'underline':
      return font.underline === 'single' || font.underline === 'double';
  }
}
export function fontMarkFormat(mark: FontMark, isOn: boolean): Pick<CellFormatChoice, FontMark> {
  switch (mark) {
    case 'bold':
      return {
        bold: isOn,
      };
    case 'italic':
      return {
        italic: isOn,
      };
    case 'strikethrough':
      return {
        strikethrough: isOn,
      };
    case 'underline':
      return {
        underline: isOn ? 'single' : 'none',
      };
  }
}
export function toggledFontMark(mark: FontMark, format: FormatWithFontMarks) {
  return fontMarkFormat(mark, !isFontMarkOn(mark, format));
}
export function diffShiftedToCaret(shift: number, { from, to, written }: TextDiff, before: string, after: string): TextDiff | null {
  if (shift <= 0 || shift > from || (from !== to && written !== '')) return null;
  let [text, distance]: [string, number] = from === to ? [after, written.length] : [before, to - from];
  for (let index = from - shift; index < from; index += 1) if (text[index] !== text[index + distance]) return null;
  let shiftedFrom = from - shift;
  return {
    from: shiftedFrom,
    to: to - shift,
    written: after.slice(shiftedFrom, shiftedFrom + written.length),
  };
}
export function diffTexts(before: string, after: string, caret?: number): TextDiff {
  let shorterLength = Math.min(before.length, after.length);
  let from = 0;
  while (from < shorterLength && before[from] === after[from]) from += 1;
  if (isHighSurrogate(before[from - 1])) from -= 1;
  let sameAtEnd = 0;
  while (sameAtEnd < shorterLength - from && before.at(-1 - sameAtEnd) === after.at(-1 - sameAtEnd)) sameAtEnd += 1;
  if (sameAtEnd > 0 && isLowSurrogate(before.at(-sameAtEnd))) sameAtEnd -= 1;
  let diff = {
    from,
    to: before.length - sameAtEnd,
    written: after.slice(from, after.length - sameAtEnd),
  };
  if (caret === undefined) return diff;
  return diffShiftedToCaret(diff.from + diff.written.length - caret, diff, before, after) ?? diff;
}
export function mergeLookRuns(runs: readonly StretchOfLooks[]): StretchOfLooks[] {
  let merged: StretchOfLooks[] = [];
  for (let run of runs) {
    let last = merged.at(-1);
    if (run.length === 0) continue;
    if (last !== undefined && isSameLook(last, run))
      merged[merged.length - 1] = {
        ...last,
        length: last.length + run.length,
      };
    else merged.push(run);
  }
  return merged;
}
export function sliceLookRuns(runs: readonly StretchOfLooks[], from: number, to: number): StretchOfLooks[] {
  let position = 0;
  return runs.flatMap((run) => {
    let [start, end] = [Math.max(from, position), Math.min(to, position + run.length)];
    position += run.length;
    return end > start
      ? [
          {
            ...run,
            length: end - start,
          },
        ]
      : [];
  });
}
export function joinLookLines(lines: readonly (readonly StretchOfLooks[])[], marksIfEmpty: FontMark[]): StretchOfLooks[] {
  let { marks: firstMarks } = lines.flat()[0] ?? {
    marks: marksIfEmpty,
  };
  let runs: StretchOfLooks[] = [];
  for (let [lineIndex, lineRuns] of lines.entries()) {
    if (lineIndex > 0)
      runs.push({
        length: 1,
        marks: runs.at(-1)?.marks ?? firstMarks,
        link: null,
      });
    runs.push(...lineRuns);
  }
  return mergeLookRuns(runs);
}
export function lookRunsByLine(runs: readonly StretchOfLooks[], text: string): StretchOfLooks[][] {
  let position = 0;
  return textLines(text).map(
    (line) => ((position += line.length + 1), sliceLookRuns(runs, position - line.length - 1, position - 1)),
  );
}
export function looksFromRichText({ paragraphs }: { paragraphs: readonly Paragraph[] }, marksOn: FontMark[], leadLength: number): EntryLooks {
  let { stretches, lists } = looksFromLines(
    paragraphs.map(
      ({ list, runs }) => ({
        list,
        stretches: runs.map(
          ({ text, marks, link }) => ({
            length: text.length,
            marks: fontMarksWhere((mark) => marks.includes(mark) || marksOn.includes(mark)),
            link,
          }),
        ),
      }),
    ),
    marksOn,
  );
  return {
    stretches: mergeLookRuns([
      {
        length: leadLength,
        marks: stretches[0]?.marks ?? marksOn,
        link: null,
      },
      ...stretches,
    ]),
    lists,
  };
}
export function listsAfterTyping(lists: ListLine[], textBefore: string, { from, to, written }: TextDiff): ListLine[] {
  let [firstLine, lastLine] = [lineIndexAt(textBefore, from), lineIndexAt(textBefore, to)];
  if (
    firstLine === lastLine &&
    !written.includes(`
`)
  )
    return lists;
  let isFromLineStart =
    from === 0 ||
    textBefore[from - 1] ===
      `
`;
  let isToLineEnd =
    textBefore[to - 1] ===
      `
` ||
    (to < textBefore.length &&
      textBefore[to] !==
        `
`);
  if (written === '' && isFromLineStart && isToLineEnd) return [...lists.slice(0, firstLine), ...lists.slice(lastLine)];
  let addedLists = textLines(written)
    .slice(1)
    .map(() => uncheckedList(lists[firstLine] ?? NO_LIST));
  return from === to && /^\n+$/.test(written) && isFromLineStart
    ? [...lists.slice(0, firstLine), ...addedLists, ...lists.slice(firstLine)]
    : [...lists.slice(0, firstLine + 1), ...addedLists, ...lists.slice(lastLine + 1)];
}
export function looksAfterTyping(
  { stretches, lists }: EntryLooks,
  textBefore: string,
  textAfter: string,
  caret?: number,
  marksIfNone: FontMark[] = PLAIN_LOOK.marks,
): EntryLooks {
  let diff = diffTexts(textBefore, textAfter, caret);
  let { from, to, written } = diff;
  let [looksBefore, looksAfter] = [sliceLookRuns(stretches, 0, from), sliceLookRuns(stretches, to, textBefore.length)];
  let marks = (looksBefore.at(-1) ?? sliceLookRuns(stretches, from, to)[0] ?? looksAfter[0])?.marks ?? marksIfNone;
  let link = looksBefore.at(-1)?.link === looksAfter[0]?.link ? (looksAfter[0]?.link ?? null) : null;
  let writtenRuns: StretchOfLooks[] =
    written === ''
      ? []
      : [
          {
            length: written.length,
            marks,
            link,
          },
        ];
  return {
    stretches: looksForText([...looksBefore, ...writtenRuns, ...looksAfter], textAfter),
    lists: listsAfterTyping(lists, textBefore, diff),
  };
}
export function marksAcross({ stretches }: EntryLooks, text: string, from: number, to: number): FontMark[] {
  let position = 0;
  let runsAcross = textLines(text).flatMap(
    (line) => (
      (position += line.length + 1),
      sliceLookRuns(stretches, Math.max(from, position - line.length - 1), Math.min(to, position - 1))
    ),
  );
  return fontMarksWhere(
    (mark) => runsAcross.length > 0 && runsAcross.every(({ marks }) => marks.includes(mark)),
  );
}
export function linkSpansOfLooks({ stretches }: EntryLooks): LinkSpan[] {
  let spans: LinkSpan[] = [];
  let position = 0;
  for (let { length, link } of stretches) {
    let last = spans.at(-1);
    if (link !== null && last?.end === position && last.link === link)
      spans[spans.length - 1] = {
        ...last,
        end: position + length,
      };
    else if (link !== null)
      spans.push({
        start: position,
        end: position + length,
        link,
      });
    position += length;
  }
  return spans;
}
export function listKindAcross({ lists }: EntryLooks, text: string, from: number, to: number): ListKind | null {
  let [firstLine, lastLine] = lineRangeOf(text, from, to);
  let [first, ...rest] = lists.slice(firstLine, lastLine + 1);
  if (first === undefined || first.kind === 'none') return null;
  return rest.every(({ kind }) => kind === first.kind) ? first.kind : null;
}
export function toggleListKind(looks: EntryLooks, text: string, from: number, to: number, kind: ListKind): EntryLooks {
  let isAllOfKind = listKindAcross(looks, text, from, to) === kind;
  return mapListsInRange(looks, text, from, to, (list) => {
    if (isAllOfKind) return NO_LIST;
    if (list.kind === kind) return list;
    let level = list.kind === 'none' ? 0 : list.level;
    return kind === 'checkbox'
      ? {
          kind,
          level,
          isChecked: false,
        }
      : {
          kind,
          level,
        };
  });
}
export function indentLists(looks: EntryLooks, text: string, from: number, to: number, levelChange: 1 | -1): EntryLooks {
  let [firstLine, lastLine] = lineRangeOf(text, from, to);
  let cannotGoIn = (list: ListLine, line: number) => {
    if (list.kind === 'none' || line < firstLine || line > lastLine) return false;
    let listAbove = looks.lists[line - 1] ?? NO_LIST;
    let hasParent = listAbove.kind !== 'none' && (line > firstLine || listAbove.level >= list.level);
    return list.level >= LIST_INDENT_LIMIT || !hasParent;
  };
  if (levelChange === 1 && looks.lists.some(cannotGoIn)) return looks;
  return mapListsInRange(
    looks,
    text,
    from,
    to,
    (list) =>
      list.kind === 'none'
        ? list
        : {
            ...list,
            level: Math.max(0, list.level + levelChange),
          },
  );
}
export function listAtCaret({ lists }: EntryLooks, text: string, caret: number): ListAtCaret {
  let line = lineIndexAt(text, caret);
  return {
    line,
    list: lists[line] ?? NO_LIST,
    isAtStart:
      caret === 0 ||
      text[caret - 1] ===
        `
`,
    isEmpty: textLines(text)[line] === '',
  };
}
export function trimLooksHistory(looksHistory: EntryLooksKept[]): EntryLooksKept[] {
  let roomLeft = LOOKS_HISTORY_LIMIT;
  let firstKeptAfter = looksHistory.findLastIndex(({ text }) => ((roomLeft -= text.length), roomLeft < 0));
  return looksHistory.slice(firstKeptAfter + 1);
}
export function pushLooksHistory(
  looksHistory: EntryLooksInHistory | undefined,
  entry: EntryLooksKept | undefined,
): EntryLooksInHistory | undefined {
  if (entry === undefined)
    return looksHistory === undefined
      ? undefined
      : {
          ...looksHistory,
          toRedo: [],
        };
  return {
    toUndo: trimLooksHistory([...(looksHistory?.toUndo ?? []), entry]),
    toRedo: [],
  };
}
export function stepLooksHistory(
  looksHistory: EntryLooksInHistory | undefined,
  direction: StepInLooksHistory,
  current: EntryLooksKept | undefined,
  text: string,
): { looks: EntryLooks | undefined; history: EntryLooksInHistory } {
  let { toUndo, toRedo }: EntryLooksInHistory = looksHistory ?? {
    toUndo: [],
    toRedo: [],
  };
  let [from, to] = direction === 'undo' ? [toUndo, toRedo] : [toRedo, toUndo];
  let index = from.findLastIndex((kept) => kept.text === text);
  let skipped = index < 0 ? [] : from.slice(index + 1);
  skipped.reverse();
  let remaining = index < 0 ? from : from.slice(0, index);
  let moved = trimLooksHistory([...to, ...(current === undefined ? [] : [current]), ...skipped]);
  return {
    looks: from[index]?.looks,
    history:
      direction === 'undo'
        ? {
            toUndo: remaining,
            toRedo: moved,
          }
        : {
            toUndo: moved,
            toRedo: remaining,
          },
  };
}
export function withEntryText(entry: EditingMode, text: string, caret?: number): EditingMode {
  let { text: previousText, looks } = entry;
  if (text === previousText) return entry;
  let looksHistory = pushLooksHistory(
    entry.looksInHistory,
    looks === undefined
      ? undefined
      : {
          text: previousText,
          looks,
        },
  );
  return {
    ...entry,
    text,
    ...(looks !== undefined && {
      looks: looksAfterTyping(looks, previousText, text, caret),
    }),
    ...(looksHistory !== undefined && {
      looksInHistory: looksHistory,
    }),
  };
}
export function richTextFromLooks(text: string, { stretches, lists }: EntryLooks): EntryWithLooks {
  let position = 0;
  return {
    kind: 'textWithLooks',
    paragraphs: lookRunsByLine(stretches, text).map((lineRuns, line) => {
      let runs = lineRuns.map(
        ({ length, marks, link }) => (
          (position += length),
          {
            text: text.slice(position - length, position),
            marks: [...marks],
            link,
          }
        ),
      );
      return (
        (position += 1),
        {
          list: lists[line] ?? NO_LIST,
          runs,
        }
      );
    }),
  };
}
export const FONT_MARKS: readonly FontMark[] = ['bold', 'italic', 'underline', 'strikethrough'];
export const FONT_MARK_SHORTCUTS: Record<FontMark, FontMarkShortcut> = {
  bold: {
    letter: 'b',
    isWithShift: false,
  },
  italic: {
    letter: 'i',
    isWithShift: false,
  },
  underline: {
    letter: 'u',
    isWithShift: false,
  },
  strikethrough: {
    letter: 'x',
    isWithShift: true,
  },
};
export const fontMarkOfShortcut = (keyPress: KeyPress): FontMark | undefined =>
  FONT_MARKS.find((mark) => {
    let { letter, isWithShift } = FONT_MARK_SHORTCUTS[mark];
    return keyPress.isModifierHeld && !keyPress.isAltHeld && letter === keyPress.key.toLowerCase() && isWithShift === keyPress.isShiftHeld;
  });
export const fontMarksOfFormat = (format: FormatWithFontMarks): Record<FontMark, boolean> => ({
  bold: isFontMarkOn('bold', format),
  italic: isFontMarkOn('italic', format),
  underline: isFontMarkOn('underline', format),
  strikethrough: isFontMarkOn('strikethrough', format),
});
export const isHighSurrogate = (char: string | undefined): boolean => char !== undefined && char >= '\uD800' && char <= '\uDBFF';
export const isLowSurrogate = (char: string | undefined): boolean => char !== undefined && char >= '\uDC00' && char <= '\uDFFF';
export const PLAIN_LOOK: Look = {
  marks: [],
  link: null,
};
export const NO_LIST: ListLine = {
  kind: 'none',
};
export const isSameLook = (look: Look, otherLook: Look): boolean =>
  look.link === otherLook.link &&
  look.marks.length === otherLook.marks.length &&
  look.marks.every((mark, index) => mark === otherLook.marks[index]);
export const isSameList = (list: ListLine, otherList: ListLine | undefined): boolean =>
  list.kind === otherList?.kind &&
  (list.kind === 'none' || otherList.kind === 'none' || list.level === otherList.level) &&
  (list.kind !== 'checkbox' || otherList.kind !== 'checkbox' || list.isChecked === otherList.isChecked);
export const areSameLookLines = (looks: EntryLooks, otherLooks: EntryLooks): boolean =>
  looks.stretches.length === otherLooks.stretches.length &&
  looks.stretches.every(
    (stretch, index) =>
      stretch.length === otherLooks.stretches[index]?.length && isSameLook(stretch, otherLooks.stretches[index]),
  ) &&
  looks.lists.length === otherLooks.lists.length &&
  looks.lists.every((list, index) => isSameList(list, otherLooks.lists[index]));
export const looksLength = (runs: readonly StretchOfLooks[]): number => runs.reduce((total, run) => total + run.length, 0);
export const textLines = (text: string): string[] =>
  text.split(`
`);
export const doLooksFitText = ({ stretches, lists }: EntryLooks, text: string): boolean =>
  looksLength(stretches) === text.length && lists.length === textLines(text).length;
export const fontMarksWhere = (isOn: (mark: FontMark) => boolean): FontMark[] => FONT_MARKS.filter(isOn);
export const fontMarksOfStyle = ({ font }: Pick<WholeCellFormat, 'font'>): FontMark[] =>
  fontMarksWhere((mark) => (mark === 'underline' ? font.underline !== 'none' : font[mark]));
export const plainLooks = (text: string, marks: FontMark[]): EntryLooks => ({
  stretches: mergeLookRuns([
    {
      length: text.length,
      marks,
      link: null,
    },
  ]),
  lists: textLines(text).map(() => NO_LIST),
});
export const looksFromLines = (lines: readonly LineOfLooks[], marksIfEmpty: FontMark[]): EntryLooks => ({
  stretches: joinLookLines(
    lines.map(({ stretches }) => stretches),
    marksIfEmpty,
  ),
  lists: lines.map(({ list }) => list),
});
export const looksForText = (runs: readonly StretchOfLooks[], text: string): StretchOfLooks[] => joinLookLines(lookRunsByLine(runs, text), runs[0]?.marks ?? []);
export const lineIndexAt = (text: string, position: number): number => textLines(text.slice(0, position)).length - 1;
export const lineRangeOf = (text: string, from: number, to: number): [first: number, last: number] => [
  lineIndexAt(text, from),
  lineIndexAt(
    text,
    from < to &&
      text[to - 1] ===
        `
`
      ? to - 1
      : to,
  ),
];
export const uncheckedList = (list: ListLine): ListLine =>
  list.kind === 'checkbox'
    ? {
        ...list,
        isChecked: false,
      }
    : list;
export const marksAtCaret = ({ stretches }: EntryLooks, caret: number): FontMark[] =>
  (sliceLookRuns(stretches, caret - 1, caret)[0] ?? sliceLookRuns(stretches, caret, caret + 1)[0] ?? PLAIN_LOOK).marks;
export const setMarkInLooks = (stretches: readonly StretchOfLooks[], from: number, to: number, mark: FontMark, isOn: boolean): StretchOfLooks[] =>
  mergeLookRuns([
    ...sliceLookRuns(stretches, 0, from),
    ...sliceLookRuns(stretches, from, to).map(
      ({ length, marks, link }) => ({
        length,
        marks: fontMarksWhere((markOfRun) => (markOfRun === mark ? isOn : marks.includes(markOfRun))),
        link,
      }),
    ),
    ...sliceLookRuns(stretches, to, looksLength(stretches)),
  ]);
export const withMarkSet = (
  { stretches, lists }: EntryLooks,
  from: number,
  to: number,
  mark: FontMark,
  isOn: boolean,
): EntryLooks => ({
  stretches: setMarkInLooks(stretches, from, to, mark, isOn),
  lists,
});
export const withLinkSet = ({ stretches, lists }: EntryLooks, from: number, to: number, link: string | null): EntryLooks => ({
  stretches: mergeLookRuns([
    ...sliceLookRuns(stretches, 0, from),
    ...sliceLookRuns(stretches, from, to).map(
      ({ length, marks }) => ({
        length,
        marks,
        link,
      }),
    ),
    ...sliceLookRuns(stretches, to, looksLength(stretches)),
  ]),
  lists,
});
export const looksWithRangeReplaced = (
  { stretches, lists }: EntryLooks,
  text: string,
  from: number,
  to: number,
  written: string,
): EntryLooks => ({
  stretches: mergeLookRuns([
    ...sliceLookRuns(stretches, 0, from),
    {
      ...(sliceLookRuns(stretches, from, to)[0] ?? PLAIN_LOOK),
      length: written.length,
    },
    ...sliceLookRuns(stretches, to, looksLength(stretches)),
  ]),
  lists: listsAfterTyping(lists, text, {
    from,
    to,
    written,
  }),
});
export const withMarkSetEverywhere = ({ stretches, lists }: EntryLooks, mark: FontMark, isOn: boolean): EntryLooks => ({
  stretches: setMarkInLooks(stretches, 0, looksLength(stretches), mark, isOn),
  lists,
});
export const toggleMarkInLooks = (looks: EntryLooks, text: string, from: number, to: number, mark: FontMark): EntryLooks => ({
  stretches: looksForText(setMarkInLooks(looks.stretches, from, to, mark, !marksAcross(looks, text, from, to).includes(mark)), text),
  lists: looks.lists,
});
export const mapListsInRange = (
  { stretches, lists }: EntryLooks,
  text: string,
  from: number,
  to: number,
  change: (list: ListLine) => ListLine,
): EntryLooks => {
  let [firstLine, lastLine] = lineRangeOf(text, from, to);
  return {
    stretches,
    lists: lists.map((list, line) => (line < firstLine || line > lastLine ? list : change(list))),
  };
};
export const MAX_LIST_LEVEL = 7;
export const isListLevel = (level: number): boolean => Number.isInteger(level) && level >= 0 && level <= MAX_LIST_LEVEL;
export const LIST_INDENT_LIMIT = 2;
export const clearListAt = (looks: EntryLooks, text: string, at: number): EntryLooks =>
  mapListsInRange(looks, text, at, at, () => NO_LIST);
export const setListAt = (looks: EntryLooks, text: string, at: number, list: ListLine): EntryLooks =>
  mapListsInRange(looks, text, at, at, () => list);
export const LIST_STARTERS: readonly (readonly [RegExp, LineInList])[] = [
  [
    /^[-*] $/,
    {
      kind: 'bullet',
      level: 0,
    },
  ],
  [
    /^1[.)] $/,
    {
      kind: 'numbered',
      level: 0,
    },
  ],
  [
    /^\[ ?\] $/,
    {
      kind: 'checkbox',
      level: 0,
      isChecked: false,
    },
  ],
  [
    /^\[[xX]\] $/,
    {
      kind: 'checkbox',
      level: 0,
      isChecked: true,
    },
  ],
];
export const listOfStarter = (word: string): LineInList | null =>
  LIST_STARTERS.find(([pattern]) => pattern.test(word))?.[1] ?? null;
export const leadingWord = (text: string): string => /^\S+ /.exec(text)?.[0] ?? '';
export const startsWithListStarter = (text: string): boolean => listOfStarter(leadingWord(text)) !== null;
export const toggleCheckboxAt = ({ stretches, lists }: EntryLooks, line: number): EntryLooks => ({
  stretches,
  lists: lists.map(
    (list, index) =>
      index === line && list.kind === 'checkbox'
        ? {
            ...list,
            isChecked: !list.isChecked,
          }
        : list,
  ),
});
export const LOOKS_HISTORY_LIMIT = 1e6;
export const hasLists = ({ lists }: EntryLooks): boolean => lists.some(({ kind }) => kind !== 'none');
export const isWholeLookMarked = (looks: EntryLooks, marks: FontMark[]): boolean =>
  !hasLists(looks) &&
  looks.stretches.every(
    (stretch) =>
      isSameLook(stretch, {
        marks,
        link: null,
      }),
  );
