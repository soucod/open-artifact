import type { Entry, ListLine } from '@open-artifact/sheets-core';
import { isOverByteLimit } from '../agent/prompt-text.ts';
import {
  doLooksFitText,
  withMarkSet,
  plainLooks,
  hasLists,
  looksFromRichText,
  stepLooksHistory,
  pushLooksHistory,
  isWholeLookMarked,
  looksAfterTyping,
  FONT_MARKS,
  marksAtCaret as marksAtCaretImported,
  toggleMarkInLooks,
  marksAcross,
  withEntryText,
  diffTexts,
  NO_LIST,
  toggleListKind,
  listKindAcross,
  leadingWord,
  listOfStarter,
  lineRangeOf,
  listAtCaret,
  indentLists,
  clearListAt,
  setListAt,
  toggleCheckboxAt,
  withMarkSetEverywhere,
  fontMarkFormat,
  areSameLookLines,
  richTextFromLooks,
  fontMarksOfStyle,
} from './text-looks.ts';
import { MARK_SIGN_CHARS } from './entry-looks-values.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { activeAnchorCell } from '../selection/model.ts';
import { isOneLineEditor, withNoEffects } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { cellRefOf } from '../model/workbook.ts';
import { isMentionText } from '../chips/people-typing.ts';
import { TEXT_PREFIX_QUOTE } from '../model/cell-text.ts';
import { readsWithUnansweredEntries } from './unanswered-entries.ts';
import { listLinesOfCell } from '../model/cell-values.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { EntryLooks, EntryLooksKept, FontMark, FormattedDone, PageState } from '../state/initial-state.ts';
import type { EditingMode, PageMode } from '../state/transitions.ts';
import type { CaretInEntry, EditTextChanged } from '../state/event-reducer.ts';
import type { CaretSpan, EntryListKey } from '../keys/key-acts.ts';
import type { CellFormatChoice } from '../i18n/change-labels.ts';
import type { LineInList, ListKind, Look, StepInLooksHistory } from './text-looks.ts';
/** Where a mark typed with signs (`**bold**`) runs: its opening signs from `from` to `wordsFrom`, its closing ones from `wordsTo` to `to`. */
export interface TypedMarkSpan {
  from: number;
  wordsFrom: number;
  wordsTo: number;
  to: number;
}
/** A mark typed with signs, and where it runs. */
export interface TypedMark extends TypedMarkSpan {
  mark: FontMark;
}
/** Whether a position of a text lies within backticks; it reads on from where it last stopped while the text is the same. */
export type InCodeCheck = (text: string, position: number) => boolean;
/** The line of a text around a position, and where it starts. */
export interface LineAround {
  start: number;
  line: string;
}
/** A text with its marks typed with signs read: the signs gone, their marks on the words, and where the typed text now ends. */
export interface TypedMarksRead {
  text: string;
  looks: EntryLooks;
  to: number;
}
/**
 * The marks the next text typed in an entry takes: typed at `from`, with `after` characters of the text behind it.
 * `marksAfterSigns` are the marks the caret had before a mark was set to type in after signs were read;
 * `isAfterSignsRead` says these marks come from signs just read.
 */
export interface MarksToTypeIn {
  from: number;
  after: number;
  marks: FontMark[];
  marksAfterSigns?: FontMark[];
  isAfterSignsRead?: true;
}
/** The text of an entry selected in its box, and the entry. */
export interface EntrySelection extends CaretSpan {
  mode: EditingMode;
}
/** What the box of an entry says of a change of its text: the looks it shows, a step through their history, where the caret went. */
export interface EntryTextChange {
  looks?: EntryLooks;
  stepInHistory?: StepInLooksHistory;
  caretAt?: number;
  caretAfterSignsRead?: number;
}
/** The texts of an entry that its looks are read from: the text now and at the start, and whether the cell was typed over. */
export interface EntryTexts {
  text: string;
  textAtStart: string;
  isTypedOverCell?: boolean;
}
/** A list sign typed at the start of a cell (`- `, `1. `), and the list it starts. */
export interface ListStarterTyped {
  sign: string;
  list: LineInList;
}
/** A font mark that the marks to type in turn on or off. */
export interface MarkChange {
  mark: FontMark;
  isOn: boolean;
}
export function doMarksCrossBrackets(text: string, { from, wordsFrom, wordsTo, to }: TypedMarkSpan): boolean {
  let [start, end] = [from, to];
  while ('*~'.includes(text[start - 1] ?? ' ')) start -= 1;
  while ('*~'.includes(text[end] ?? ' ')) end += 1;
  let [depth, lowestDepth] = [0, 0];
  for (let char of text.slice(wordsFrom, wordsTo)) {
    if (OPENING_BRACKET.test(char)) depth += 1;
    else if (CLOSING_BRACKET.test(char)) depth -= 1;
    lowestDepth = Math.min(lowestDepth, depth);
  }
  let [closersUnmatched, openersUnmatched] = [-lowestDepth, depth - lowestDepth];
  return (
    (closersUnmatched > 0 && OPENING_BRACKET.test(charBefore(text, start))) ||
    (openersUnmatched > 0 && (end === text.length || CLOSING_BRACKET.test(charStartingAt(text, end))))
  );
}
export function makeInCodeCheck(): InCodeCheck {
  let [textSeen, checkedUpTo, backticks] = ['', 0, 0];
  return (text, position) => {
    if (text !== textSeen || position < checkedUpTo) [textSeen, checkedUpTo, backticks] = [text, 0, 0];
    for (let index = text.indexOf('`', checkedUpTo); index !== -1 && index < position; index = text.indexOf('`', index + 1)) backticks += 1;
    return ((checkedUpTo = position), backticks % 2 === 1);
  };
}
export function typedMarkEndingAt(line: string, to: number, isInCode: InCodeCheck): TypedMark | null {
  for (let [sign, mark] of TYPED_MARK_SIGNS) {
    let [signChar = sign] = sign;
    let closingAt = to - sign.length;
    if (line.slice(closingAt, to) !== sign) continue;
    let from = line.lastIndexOf(signChar, closingAt - 1) - (sign.length - 1);
    let wordsFrom = from + sign.length;
    if (from < 0 || line.slice(from, wordsFrom) !== sign) continue;
    let [charBeforeFrom, lastWordChar] = [charBefore(line, from), charBefore(line, closingAt)];
    let isBoldAfterItalicSign = sign === '**' && charBeforeFrom === signChar && line[from - 2] !== signChar;
    let [firstWordChar, charAfterTo] = [charStartingAt(line, wordsFrom), charStartingAt(line, to)];
    let isDoubleSign = sign.length === 2;
    let isAfterQuoteInWord = (charBeforeFrom === '"' || charBeforeFrom === "'") && !LETTER_OR_DIGIT.test(charBefore(line, from - 1));
    let canClose =
      !isSpaceOrNothing(lastWordChar) &&
      !PATH_SIGNS.slice(0, 2).includes(lastWordChar) &&
      !(QUOTE_SIGN.test(lastWordChar) && QUOTE_SIGN.test(charAfterTo)) &&
      (CLOSES_TYPED_MARK.test(charAfterTo) || (isDoubleSign && CJK_LETTER.test(charAfterTo)));
    let canOpen =
      !isSpaceOrNothing(firstWordChar) &&
      !PATH_SIGNS.includes(firstWordChar) &&
      !(QUOTE_SIGN.test(firstWordChar) && QUOTE_SIGN.test(charBeforeFrom)) &&
      (isDoubleSign || !isAfterQuoteInWord) &&
      (OPENS_TYPED_MARK.test(charBeforeFrom) || (isDoubleSign && CJK_LETTER.test(charBeforeFrom))) &&
      (charBeforeFrom !== signChar || isBoldAfterItalicSign);
    if (
      canClose &&
      canOpen &&
      LETTER_OR_DIGIT.test(line.slice(wordsFrom, closingAt)) &&
      !isInCode(line, from) &&
      !doMarksCrossBrackets(line, {
        from,
        wordsFrom,
        wordsTo: closingAt,
        to,
      })
    )
      return {
        from,
        wordsFrom,
        wordsTo: closingAt,
        to,
        mark,
      };
  }
  return null;
}
export function lineAround(text: string, position: number): LineAround {
  let start =
    text.lastIndexOf(
      `
`,
      position - 1,
    ) + 1;
  let end = text.indexOf(
    `
`,
    position,
  );
  return {
    start,
    line: text.slice(start, end === -1 ? undefined : end),
  };
}
export function typedMarkAtCaret(text: string, caret: number): TypedMark | null {
  if (!MARK_SIGN_CHARS.includes(text[caret - 1] ?? ' ') || isTextWithoutMarks(text)) return null;
  let around = lineAround(text, caret);
  let mark = typedMarkInLine(text, around, caret, makeInCodeCheck());
  if (!(mark !== null && mark.to - mark.wordsTo === 1) || ANY_LETTER.test(text.slice(mark.wordsFrom, mark.wordsTo))) return mark;
  return ONLY_MARK_SIGNS.test(around.line.slice(caret - around.start)) ? null : mark;
}
export function typedMarkInLine(text: string, { start, line }: LineAround, to: number, isInCode: InCodeCheck): TypedMark | null {
  let inLine = typedMarkEndingAt(line, to - start, isInCode);
  if (inLine === null) return null;
  let typedMark = {
    from: inLine.from + start,
    wordsFrom: inLine.wordsFrom + start,
    wordsTo: inLine.wordsTo + start,
    to: inLine.to + start,
    mark: inLine.mark,
  };
  return typedMark.from === 0 && isTextWithoutMarks(withoutMarkSigns(text, typedMark)) ? null : typedMark;
}
export function looksWithRangeCut({ stretches, lists }: EntryLooks, from: number, to: number): EntryLooks {
  let position = 0;
  return {
    stretches: stretches.flatMap((stretch) => {
      let cut = Math.max(0, Math.min(position + stretch.length, to) - Math.max(position, from));
      return (
        (position += stretch.length),
        stretch.length === cut
          ? []
          : [
              {
                ...stretch,
                length: stretch.length - cut,
              },
            ]
      );
    }),
    lists,
  };
}
export function doesRichTextFit(text: string, { stretches }: EntryLooks): boolean {
  let lineBreaks =
    text.split(`
`).length - 1;
  let linkLength = stretches.reduce(
    (total, { link }: Partial<Look> = {}) => total + (link?.length ?? 0) * (lineBreaks + 1),
    0,
  );
  let overhead = (stretches.length + 2 * lineBreaks + 1) * 128;
  return !isOverByteLimit(text, RICH_TEXT_BYTE_LIMIT - linkLength * 3 - overhead);
}
export function readTypedMarks(text: string, looks: EntryLooks, from: number, to: number, isMarked: boolean = true): TypedMarksRead | null {
  if (!doLooksFitText(looks, text) || isTextWithoutMarks(text)) return null;
  if (isOverByteLimit(text, RICH_TEXT_BYTE_LIMIT + 4 * MAX_TYPED_MARKS)) return null;
  let isInCode = makeInCodeCheck();
  let [textNow, looksNow, toNow, signsLookedAt, marksRead]: [string, EntryLooks, number, number, number] = [text, looks, to, 0, 0];
  let line = lineAround(textNow, from + 1);
  for (let position = from + 1; position <= toNow; position += 1) {
    if (
      textNow[position - 1] ===
      `
`
    )
      line = lineAround(textNow, position + 1);
    if (!MARK_SIGN_CHARS.includes(textNow[position - 1] ?? ' ')) continue;
    if (((signsLookedAt += 1), signsLookedAt > MAX_MARK_SIGNS_LOOKED_AT)) return null;
    let typedMark = typedMarkInLine(textNow, line, position, isInCode);
    if (typedMark === null || typedMark.from < from) continue;
    if (((marksRead += 1), marksRead > MAX_TYPED_MARKS)) return null;
    let looksCut = looksWithRangeCut(looksWithRangeCut(looksNow, typedMark.wordsTo, typedMark.to), typedMark.from, typedMark.wordsFrom);
    let wordsEnd = typedMark.from + typedMark.wordsTo - typedMark.wordsFrom;
    ((looksNow = isMarked ? withMarkSet(looksCut, typedMark.from, wordsEnd, typedMark.mark, true) : looksCut),
      (textNow = withoutMarkSigns(textNow, typedMark)),
      (toNow = to - (text.length - textNow.length)),
      (position = wordsEnd),
      (line = lineAround(textNow, position)));
  }
  return marksRead === 0 || !doesRichTextFit(textNow, looksNow)
    ? null
    : {
        text: textNow,
        looks: looksNow,
        to: toNow,
      };
}
export function textWithMarkSignsRead(before: string, written: string, after: string): string {
  let text = before + written + after;
  let [from, to] = [before.length, before.length + written.length];
  let read = readTypedMarks(text, plainLooks(text, []), from, to, false);
  return read === null ? written : read.text.slice(from, read.to);
}
export function withListNumbersOfEntry(stateBefore: PageState, state: PageState, reads: WorkbookReads): PageState {
  let { mode } = state;
  if (mode.kind !== 'editing') return state;
  let { numbersOfLines, ...modeWithoutNumbers } = mode;
  if (mode.looks === undefined || !hasLists(mode.looks))
    return numbersOfLines === undefined
      ? state
      : {
          ...state,
          mode: modeWithoutNumbers,
        };
  let modeBefore = stateBefore?.mode.kind === 'editing' ? stateBefore.mode : null;
  if (modeBefore?.looks?.lists === mode.looks.lists && modeBefore.numbersOfLines !== undefined)
    return numbersOfLines === modeBefore.numbersOfLines
      ? state
      : {
          ...state,
          mode: {
            ...mode,
            numbersOfLines: modeBefore.numbersOfLines,
          },
        };
  let listLines = reads.listLinesAsKept(mode.looks.lists);
  if (listLines === null) return state;
  return {
    ...state,
    mode: {
      ...mode,
      looks: {
        ...mode.looks,
        lists: listLines.map(({ list }) => list),
      },
      numbersOfLines: listLines.map(({ number }) => number),
    },
  };
}
export function looksOfRichCellText(reads: WorkbookReads, cell: CellId, text: string): EntryLooks | undefined {
  let cellHeld = reads.cellOf(cell);
  if (cellHeld?.input.kind !== 'richText' || cellHeld.value?.kind !== 'text') return;
  let prefixLength = text.length - cellHeld.value.value.length;
  if (prefixLength < 0 || !text.endsWith(cellHeld.value.value)) return;
  return looksFromRichText(cellHeld.input, fontMarksOfCell(reads, cell), prefixLength);
}
export function marksToTypeInKept({ text, marksToTypeIn }: EditingMode, newText: string): MarksToTypeIn | undefined {
  if (marksToTypeIn === undefined) return;
  let { from, after, isAfterSignsRead } = marksToTypeIn;
  if (isAfterSignsRead !== true && !isWordyText(newText, newText.length - after)) return;
  return newText.length - after >= from &&
    newText.slice(0, from) === text.slice(0, from) &&
    newText.slice(newText.length - after) === text.slice(text.length - after)
    ? marksToTypeIn
    : undefined;
}
export function looksOfEntry(
  mode: PageMode,
  reads: WorkbookReads,
  cell: CellId,
  { text, textAtStart, isTypedOverCell }: EntryTexts,
  { looks: looksInBox, stepInHistory, caretAt, caretAfterSignsRead }: EntryTextChange,
): Pick<EditingMode, 'looks' | 'looksInHistory' | 'marksToTypeIn'> {
  let isEditing = mode.kind === 'editing';
  let looksOfCell = isEditing || isTypedOverCell === true ? undefined : looksOfRichCellText(reads, cell, textAtStart);
  let [textBefore, looksBefore]: [string, EntryLooks | undefined] = isEditing
    ? [(mode as EditingMode).text, (mode as EditingMode).looks]
    : [textAtStart, looksOfCell];
  let looksKept = textBefore === '' && !(looksBefore !== undefined && hasLists(looksBefore)) ? undefined : looksBefore;
  let entryBefore: EntryLooksKept | undefined =
    looksKept === undefined
      ? undefined
      : {
          text: textBefore,
          looks: looksKept,
        };
  let historyBefore = isEditing ? (mode as EditingMode).looksInHistory : undefined;
  let stepped =
    stepInHistory !== undefined && looksInBox === undefined && text !== textBefore && (historyBefore !== undefined || entryBefore !== undefined)
      ? stepLooksHistory(historyBefore, stepInHistory, entryBefore, text)
      : undefined;
  let looksInHistory = stepped?.history ?? (text === textBefore ? historyBefore : pushLooksHistory(historyBefore, entryBefore));
  let doesBoxFit = looksInBox !== undefined && doLooksFitText(looksInBox, text);
  let looksOfBox = isEditing && doesBoxFit && (looksKept !== undefined || !isWholeLookMarked(looksInBox!, [])) ? looksInBox : undefined;
  let looksTyped =
    looksKept === undefined ? undefined : looksAfterTyping(looksKept, textBefore, text, caretAt, fontMarksOfCell(reads, cell));
  let looksChosen =
    looksOfBox !== undefined &&
    caretAfterSignsRead !== undefined &&
    stepInHistory === undefined &&
    looksKept?.lists.length === looksOfBox.lists.length
      ? {
          ...looksOfBox,
          lists: looksKept.lists,
        }
      : (looksOfBox ?? stepped?.looks ?? looksTyped);
  let looks = text === '' && !(looksChosen !== undefined && hasLists(looksChosen)) ? undefined : looksChosen;
  let marksToTypeIn = isEditing && looksInBox === undefined && stepInHistory === undefined ? marksToTypeInKept(mode as EditingMode, text) : undefined;
  let looksWithMarks =
    marksToTypeIn === undefined || looks === undefined
      ? looks
      : withMarksToTypeIn(
          {
            text,
            looks,
          },
          marksToTypeIn,
        );
  return {
    ...(looksWithMarks !== undefined && {
      looks: looksWithMarks,
    }),
    ...(looksInHistory !== undefined && {
      looksInHistory,
    }),
    ...(marksToTypeIn !== undefined && {
      marksToTypeIn,
    }),
  };
}
export function entryListsOf(mode: PageMode): ListLine[] | undefined {
  let looks = entryLooksOf(mode);
  return looks !== undefined && hasLists(looks) ? looks.lists : undefined;
}
export function selectedSpanInEntry(mode: PageMode, selectedInBox: CaretInEntry | undefined): EntrySelection | null {
  if (mode.kind !== 'editing' || isFormulaText(mode.text)) return null;
  if (mode.isInBoxOfOneLine === true) return null;
  if (selectedInBox === undefined || selectedInBox.text !== mode.text || selectedInBox.isComposing) return null;
  return selectedInBox.start < selectedInBox.end
    ? {
        start: selectedInBox.start,
        end: selectedInBox.end,
        mode,
      }
    : null;
}
export function caretInWordyEntry(mode: PageMode, reads: WorkbookReads, selectedInBox: CaretInEntry | undefined): number | null {
  if (mode.kind !== 'editing' || selectedInBox === undefined) return null;
  if (selectedInBox.text !== mode.text || selectedInBox.isComposing || selectedInBox.start !== selectedInBox.end) return null;
  if (!isWordyText(mode.text, selectedInBox.start)) return null;
  if (reads.dayTypedAs(mode.text) !== null) return null;
  return mode.isInBoxOfOneLine === true ? null : selectedInBox.start;
}
export function setMarkToTypeIn(state: PageState, reads: WorkbookReads, mark: FontMark, selectedInBox: CaretInEntry | undefined): PageState {
  let { mode } = state;
  let caret = caretInWordyEntry(mode, reads, selectedInBox);
  if (caret === null || mode.kind !== 'editing') return state;
  let looks = mode.looks ?? plainLooks(mode.text, fontMarksOfCell(reads, activeAnchorCell(state, reads)));
  let marksAtCaretNow = marksToTypeAt(mode, looks, caret);
  let marksToType = FONT_MARKS.filter((fontMark) => (fontMark === mark) !== marksAtCaretNow.includes(fontMark));
  let marksOfLooks = marksAtCaretImported(looks, caret);
  let isSameAsLooks = FONT_MARKS.every((fontMark) => marksToType.includes(fontMark) === marksOfLooks.includes(fontMark));
  let { marksToTypeIn, ...modeWithoutMarks } = mode;
  let marksAfterSigns =
    marksToTypeIn?.from !== caret ? undefined : marksToTypeIn.isAfterSignsRead === true ? marksToTypeIn.marks : marksToTypeIn.marksAfterSigns;
  let newMarksToTypeIn: MarksToTypeIn = {
    from: caret,
    after: mode.text.length - caret,
    marks: marksToType,
    ...(marksAfterSigns !== undefined && {
      marksAfterSigns,
    }),
  };
  return {
    ...state,
    mode: {
      ...modeWithoutMarks,
      looks,
      ...((!isSameAsLooks || marksAfterSigns !== undefined) && {
        marksToTypeIn: newMarksToTypeIn,
      }),
      selectedInEntry: {
        start: caret,
        end: caret,
      },
    },
    lastDone: {
      what: 'markSetToTypeIn',
      mark,
      isOn: marksToType.includes(mark),
    },
  };
}
export function setMarkOnEntrySelection(state: PageState, reads: WorkbookReads, mark: FontMark, selectedInBox: CaretInEntry | undefined): PageState {
  let selected = selectedSpanInEntry(state.mode, selectedInBox);
  if (selected === null) return state;
  let { start, end } = selected;
  let { marksToTypeIn, ...mode } = selected.mode;
  let looks = mode.looks ?? plainLooks(mode.text, fontMarksOfCell(reads, activeAnchorCell(state, reads)));
  let newLooks = toggleMarkInLooks(looks, mode.text, start, end, mark);
  let isOn = marksAcross(newLooks, mode.text, start, end).includes(mark);
  return {
    ...state,
    mode: {
      ...mode,
      looks: newLooks,
      selectedInEntry: {
        start,
        end,
      },
    },
    lastDone: {
      what: 'markSetInEntry',
      mark,
      isOn,
    },
  };
}
export function selectionInRichEntry(mode: PageMode, selectedInBox: CaretInEntry | undefined): EntrySelection | null {
  if (mode.kind !== 'editing' || isFormulaText(mode.text) || isOneLineEditor(mode)) return null;
  if (selectedInBox === undefined || selectedInBox.text !== mode.text || selectedInBox.isComposing) return null;
  return {
    start: selectedInBox.start,
    end: selectedInBox.end,
    mode,
  };
}
export function withEntryTextAt(mode: EditingMode, text: string, caret: number): EditingMode {
  let withText = {
    ...withEntryText(mode, text, caret),
    caretToPut: {
      text,
      at: caret,
    },
  };
  if (mode.marksToTypeIn === undefined) return withText;
  let { from, to, written } = diffTexts(mode.text, text, caret);
  let positionAfter = (position: number) => (position <= from ? position : Math.max(from, position + written.length - (to - from)));
  let marksToTypeIn: MarksToTypeIn = {
    ...mode.marksToTypeIn,
    from: positionAfter(mode.marksToTypeIn.from),
  };
  return {
    ...withText,
    marksToTypeIn,
  };
}
export function withListTextNotFormula(mode: EditingMode, caret: number): EditingMode {
  let [firstList = NO_LIST] = mode.looks?.lists ?? [];
  if (firstList.kind === 'none' || !isFormulaText(mode.text)) return mode;
  let withPrefix = withEntryTextAt(mode, LIST_TEXT_PREFIX + mode.text, LIST_TEXT_PREFIX.length);
  return {
    ...withPrefix,
    caretToPut: {
      text: withPrefix.text,
      at: caret + LIST_TEXT_PREFIX.length,
    },
  };
}
export function toggleListInEntry(state: PageState, reads: WorkbookReads, kind: ListKind, selectedInBox: CaretInEntry | undefined): PageState {
  let selection = selectionInRichEntry(state.mode, selectedInBox);
  if (selection === null) return state;
  let { start, end, mode } = selection;
  let changed = withEntryLooksChanged(
    state,
    reads,
    selection,
    (looks) => toggleListKind(looks, mode.text, start, end, kind),
  );
  let isOn = listKindAcross(changed.mode.looks, mode.text, start, end) === kind;
  return {
    ...changed,
    lastDone: {
      what: 'listSetInEntry',
      list: kind,
      isOn,
    },
  };
}
export function listStarterTypedInCell(selection: EntrySelection | null): ListStarterTyped | null {
  if (selection === null || selection.mode.typingIn !== 'cell') return null;
  if (
    selection.mode.text.includes(`
`) ||
    hasEntryLists(selection.mode)
  )
    return null;
  let sign = leadingWord(selection.mode.text);
  let list = listOfStarter(sign);
  if (list?.kind !== 'bullet' && list?.kind !== 'numbered') return null;
  return selection.start >= sign.length
    ? {
        sign,
        list,
      }
    : null;
}
export function doesEntryListTakeKey(mode: PageMode, key: EntryListKey, selectedInBox: CaretInEntry | undefined): boolean {
  let selection = selectionInRichEntry(mode, selectedInBox);
  if (key === 'lineBreak' && listStarterTypedInCell(selection) !== null) return true;
  let looks = selection?.mode.looks;
  if (selection === null || looks === undefined) return false;
  let { start, end } = selection;
  if (key === 'tab' || key === 'shiftTab') {
    if (
      !selection.mode.text.includes(`
`) &&
      selection.mode.isExpanded !== true
    )
      return false;
    let [firstLine, lastLine] = lineRangeOf(selection.mode.text, start, end);
    return looks.lists.slice(firstLine, lastLine + 1).some(({ kind }) => kind !== 'none');
  }
  let { list, isAtStart, isEmpty } = listAtCaret(looks, selection.mode.text, start);
  if (start !== end || list.kind === 'none') return false;
  return key === 'backspace' ? isAtStart : isEmpty;
}
export function isCaretInEntryList(mode: PageMode, selectedInBox: CaretInEntry | undefined): boolean {
  let selection = selectionInRichEntry(mode, selectedInBox);
  let looks = selection?.mode.looks;
  if (selection === null || looks === undefined) return false;
  return listAtCaret(looks, selection.mode.text, selection.start).list.kind !== 'none';
}
export function pressListKeyInEntry(state: PageState, reads: WorkbookReads, key: EntryListKey, selectedInBox: CaretInEntry | undefined): PageState {
  let selection = selectionInRichEntry(state.mode, selectedInBox);
  if (selection === null || !doesEntryListTakeKey(state.mode, key, selectedInBox)) return state;
  let { start, end, mode } = selection;
  let starter = key === 'lineBreak' ? listStarterTypedInCell(selection) : null;
  if (starter !== null) {
    let { sign, list } = starter;
    let caret = start - sign.length + 1;
    let textWithLines = `${mode.text.slice(sign.length, start)}
${mode.text.slice(end)}`;
    let withoutSign = withEntryTextAt(mode, mode.text.slice(sign.length), 0);
    let withLines = withEntryTextAt(withoutSign, textWithLines, caret);
    let changed = withEntryLooksChanged(
      state,
      reads,
      {
        start: caret,
        end: caret,
        mode: withLines,
      },
      (looks) => ({
        ...looks,
        lists: [list, list],
      }),
    );
    return {
      ...changed,
      mode: withListTextNotFormula(changed.mode, caret),
      lastDone: {
        what: 'listSetInEntry',
        list: list.kind,
        isOn: true,
      },
    };
  }
  return withEntryLooksChanged(state, reads, selection, (looks) => {
    if (key === 'tab') return indentLists(looks, mode.text, start, end, 1);
    if (key === 'shiftTab') return indentLists(looks, mode.text, start, end, -1);
    let { list } = listAtCaret(looks, mode.text, start);
    return key === 'lineBreak' && list.kind !== 'none' && list.level > 0
      ? indentLists(looks, mode.text, start, end, -1)
      : clearListAt(looks, mode.text, start);
  });
}
export function readListStarterTyped(modeBefore: EditingMode, state: PageState, reads: WorkbookReads, caret: number): PageState {
  let { mode } = state;
  if (mode.kind !== 'editing') return state;
  let caretOnly: CaretInEntry = {
    start: caret,
    end: caret,
    text: mode.text,
    isComposing: false,
  };
  let { text } = mode;
  if (selectionInRichEntry(mode, caretOnly) === null) return state;
  if (modeBefore.text !== text.slice(0, caret - 1) + text.slice(caret)) return state;
  let lineStart =
    text.lastIndexOf(
      `
`,
      caret - 1,
    ) + 1;
  let typed = text.slice(lineStart, caret);
  let [line] = lineRangeOf(text, lineStart, lineStart);
  let listOfLine = entryLooksOf(mode)?.lists[line] ?? NO_LIST;
  let numberOfLine = modeBefore.numbersOfLines?.[line] ?? null;
  let isNumberTyped = numberOfLine !== null && [`${numberOfLine}. `, `${numberOfLine}) `].includes(typed);
  let listTyped = listOfStarter(isNumberTyped ? '1. ' : typed);
  if (listTyped === null || (listOfLine.kind !== 'none' && listOfLine.kind !== listTyped.kind)) return state;
  let list =
    listOfLine.kind === 'none'
      ? listTyped
      : {
          ...listTyped,
          level: listOfLine.level,
        };
  let isOfManyLines =
    text.includes(`
`) || mode.isExpanded === true;
  if (list.kind !== 'checkbox' && listOfLine.kind === 'none' && !isOfManyLines) return state;
  let withoutStarter = withEntryTextAt(mode, text.slice(0, lineStart) + text.slice(caret), lineStart);
  let changed = withEntryLooksChanged(
    state,
    reads,
    {
      start: lineStart,
      end: lineStart,
      mode: withoutStarter,
    },
    (looks) => setListAt(looks, withoutStarter.text, lineStart, list),
  );
  return {
    ...changed,
    mode: withListTextNotFormula(changed.mode, lineStart),
    lastDone: {
      what: 'listSetInEntry',
      list: list.kind,
      isOn: true,
    },
  };
}
export function readListSignsTyped(
  modeBefore: PageMode,
  state: PageState,
  reads: WorkbookReads,
  { typingIn, caretAt, isNotTyped, isOfHistory }: Pick<EditTextChanged, 'typingIn' | 'caretAt' | 'isNotTyped' | 'isOfHistory'>,
): PageState {
  let { mode } = state;
  if (modeBefore.kind !== 'editing' || mode.kind !== 'editing') return state;
  if (typingIn !== 'cell' || caretAt === undefined || isOfHistory === true) return state;
  if (isFormulaText(mode.text))
    return isFormulaText(modeBefore.text) || isFormulaTypedAfterText(modeBefore, mode.text, caretAt)
      ? state
      : {
          ...state,
          mode: withListTextNotFormula(mode, caretAt),
        };
  return isNotTyped === true ? state : readListStarterTyped(modeBefore, state, reads, caretAt);
}
export function toggleEntryCheckbox(state: PageState, selectedInBox: CaretInEntry | undefined, line: number | undefined): PageState {
  let { mode } = state;
  let looks = entryLooksOf(mode);
  if (mode.kind !== 'editing' || looks === undefined) return state;
  let lineToggled = line ?? (selectedInBox?.text === mode.text ? listAtCaret(looks, mode.text, selectedInBox.start).line : null);
  let list = lineToggled === null ? undefined : looks.lists[lineToggled];
  if (lineToggled === null || list?.kind !== 'checkbox') return state;
  return {
    ...state,
    mode: {
      ...mode,
      looks: toggleCheckboxAt(looks, lineToggled),
    },
    lastDone: {
      what: 'boxOfLineSet',
      isChecked: !list.isChecked,
    },
  };
}
export function toggleCellCheckboxLine(state: PageState, reads: WorkbookReads, paragraph: number) {
  let cell = activeAnchorCell(state, reads);
  let input = state.mode.kind === 'navigating' ? cellShownAtAnchor(state, reads)?.input : undefined;
  let list = input?.kind === 'richText' ? input.paragraphs[paragraph]?.list : undefined;
  if (list?.kind !== 'checkbox') return withNoEffects(state);
  let isChecked = !list.isChecked;
  return queueEdit(
    state,
    {
      kind: 'setListLineChecked',
      sheetId: cell.sheetId,
      cell: cellRefOf(cell),
      paragraph,
      isChecked,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'boxOfLineSet',
        isChecked,
      },
    },
  );
}
export function applyTogglesToEntry(
  state: PageState,
  { bold, italic, underline, strikethrough }: Pick<CellFormatChoice, FontMark>,
): PageState {
  let { mode } = state;
  if (mode.kind !== 'editing') return state;
  let toggles = {
    bold,
    italic,
    underline: underline === undefined ? undefined : underline !== 'none',
    strikethrough,
  };
  let withToggles = (looksBefore: EntryLooks) =>
    FONT_MARKS.reduce(
      (marked, mark) => (toggles[mark] === undefined ? marked : withMarkSetEverywhere(marked, mark, toggles[mark])),
      looksBefore,
    );
  let entriesWithToggles = (entries: EntryLooksKept[]) =>
    entries.map(
      (entry) => ({
        text: entry.text,
        looks: withToggles(entry.looks),
      }),
    );
  let { marksToTypeIn, ...modeWithoutMarks } = mode;
  let { looks, looksInHistory } = modeWithoutMarks;
  if (looks === undefined && looksInHistory === undefined) return state;
  return {
    ...state,
    mode: {
      ...modeWithoutMarks,
      ...(looks !== undefined && {
        looks: withToggles(looks),
      }),
      ...(looksInHistory !== undefined && {
        looksInHistory: {
          toUndo: entriesWithToggles(looksInHistory.toUndo),
          toRedo: entriesWithToggles(looksInHistory.toRedo),
        },
      }),
    },
  };
}
export function togglesOfEntry({ mode }: Pick<PageState, 'mode'>): Record<FontMark, boolean> | null {
  let looks = entryLooksOf(mode);
  if (mode.kind !== 'editing' || looks === undefined) return null;
  let caretAtEnd = {
    start: mode.text.length,
    end: mode.text.length,
  };
  let { start, end } = mode.selectedInEntry ?? caretAtEnd;
  let isPlainEntry = mode.isInBoxOfOneLine === true || !isWordyText(mode.text, start);
  if (start === end && isPlainEntry) return null;
  let marks = start === end ? marksToTypeAt(mode, looks, start) : marksAcross(looks, mode.text, start, end);
  return {
    bold: marks.includes('bold'),
    italic: marks.includes('italic'),
    underline: marks.includes('underline'),
    strikethrough: marks.includes('strikethrough'),
  };
}
export function formatOfSelectionWithEntry(state: PageState, isOutsideEntry: boolean): PageState['formatOfSelection'] {
  let toggles = isOutsideEntry ? null : togglesOfEntry(state);
  return toggles === null
    ? state.formatOfSelection
    : {
        ...state.formatOfSelection,
        togglesOn: toggles,
      };
}
export function isSelectionInMarksSpan({ from, after }: MarksToTypeIn, text: string, { start, end }: CaretSpan): boolean {
  let marksEnd = text.length - after;
  return end <= marksEnd && (start < end ? start >= from : start > from || end === marksEnd);
}
export function selectInEntry(state: PageState, { start, end }: CaretSpan): PageState {
  let { mode } = state;
  if (mode.kind !== 'editing' || mode.looks === undefined) return state;
  let selectedInEntry = mode.selectedInEntry;
  if (start === selectedInEntry?.start && end === selectedInEntry.end) return state;
  let { marksToTypeIn, ...modeWithoutMarks } = mode;
  let keepsMarks =
    marksToTypeIn !== undefined &&
    isSelectionInMarksSpan(marksToTypeIn, mode.text, {
      start,
      end,
    });
  return {
    ...state,
    mode: {
      ...(keepsMarks ? mode : modeWithoutMarks),
      selectedInEntry: {
        start,
        end,
      },
    },
  };
}
export function marksToTypeAfterSigns(
  { mode: modeBefore }: Pick<PageState, 'mode'>,
  state: PageState,
  reads: WorkbookReads,
  caret: number,
  isSignsDropped: boolean,
): PageState {
  if (state.mode.kind !== 'editing' || modeBefore.kind !== 'editing') return state;
  let { areSignsLeftAsTyped, ...modeWithoutFlag } = state.mode;
  let mode = isSignsDropped || areSignsLeftAsTyped === undefined ? modeWithoutFlag : state.mode;
  let looksBefore = modeBefore.looks ?? plainLooks(modeBefore.text, fontMarksOfCell(reads, activeAnchorCell(state, reads)));
  let marksToTypeIn: MarksToTypeIn = {
    from: caret,
    after: mode.text.length - caret,
    marks: marksAtCaretImported(looksBefore, caret + modeBefore.text.length - mode.text.length),
    isAfterSignsRead: true,
  };
  return {
    ...state,
    mode: {
      ...mode,
      marksToTypeIn,
      selectedInEntry: {
        start: caret,
        end: caret,
      },
    },
  };
}
export function setEntryLooks(state: PageState, looks: EntryLooks): PageState {
  let { mode } = state;
  if (mode.kind !== 'editing' || entryLooksOf(mode) === undefined) return state;
  if (!doLooksFitText(looks, mode.text)) return state;
  let { marksToTypeIn } = mode;
  if (marksToTypeIn !== undefined && mode.text.length - marksToTypeIn.after > marksToTypeIn.from) return state;
  return {
    ...state,
    mode: {
      ...mode,
      looks,
    },
  };
}
export function entryLooksWithMarksToType(mode: PageMode): EntryLooks | undefined {
  let looks = entryLooksOf(mode);
  if (mode.kind !== 'editing' || looks === undefined) return looks;
  return marksToTypeChanges(mode, looks).reduce(
    // The default is never taken: every change of the list is passed.
    (marked, { mark, isOn }: MarkChange = {} as MarkChange) => withMarkSet(marked, 0, mode.text.length, mark, isOn),
    looks,
  );
}
export function marksToTypeChanges({ text, marksToTypeIn }: EditingMode, looks: EntryLooks): MarkChange[] {
  if (marksToTypeIn === undefined || marksToTypeIn.isAfterSignsRead === true) return [];
  if (text.length - marksToTypeIn.after !== marksToTypeIn.from) return [];
  let marksAtCaret = marksAtCaretImported(looks, marksToTypeIn.from);
  let marksEverywhere = marksAcross(looks, text, 0, text.length);
  let marksAfterSigns = marksToTypeIn.marksAfterSigns ?? marksAtCaret;
  return FONT_MARKS.map(
    (mark) => ({
      mark,
      isOn: marksToTypeIn.marks.includes(mark),
    }),
  ).filter(
    ({ mark, isOn }) =>
      isOn !== marksAtCaret.includes(mark) && isOn !== marksAfterSigns.includes(mark) && (isOn || marksEverywhere.includes(mark)),
  );
}
export function formatDoneByMarksToType(mode: PageMode, cellEnteredIn: string): Omit<FormattedDone, 'cells'> | null {
  let looks = entryLooksOf(mode);
  if (mode.kind !== 'editing' || looks === undefined) return null;
  let [change] = marksToTypeChanges(mode, looks);
  return change === undefined
    ? null
    : {
        what: 'formatted',
        format: fontMarkFormat(change.mark, change.isOn),
        cellEnteredIn,
      };
}
export function areEntryLooksUnchanged(state: PageState, reads: WorkbookReads) {
  let { mode } = state;
  let looks = entryLooksOf(mode);
  if (mode.kind !== 'editing' || looks === undefined) return true;
  let cell = activeAnchorCell(state, reads);
  let looksOfCell = looksOfRichCellText(reads, cell, mode.textAtStart);
  return looksOfCell === undefined ? isWholeLookMarked(looks, fontMarksOfCell(reads, cell)) : areSameLookLines(looksOfCell, looks);
}
export function richTextOfEntry(text: string, looks: EntryLooks): Extract<Entry, { kind: 'textWithLooks' }> {
  if (!hasLists(looks) || text === '' || text.startsWith(LIST_TEXT_PREFIX)) return richTextFromLooks(text, looks);
  let prefixed = LIST_TEXT_PREFIX + text;
  return richTextFromLooks(prefixed, looksAfterTyping(looks, text, prefixed, LIST_TEXT_PREFIX.length));
}
export function entryInputWithLooks(state: PageState, reads: WorkbookReads, cell: CellId, text: string, readsSigns: boolean): Entry {
  let { mode } = state;
  let looks = entryLooksWithMarksToType(mode);
  if (readsSigns && mode.kind === 'editing' && mode.areSignsLeftAsTyped !== true) {
    let { from, written } = diffTexts(textAtStartOfEntry(mode), text);
    let read = readTypedMarks(
      text,
      looks !== undefined && doLooksFitText(looks, mode.text)
        ? looksAfterTyping(looks, mode.text, text)
        : plainLooks(text, fontMarksOfCell(reads, cell)),
      from,
      from + written.length,
    );
    if (read !== null) return richTextOfEntry(read.text, read.looks);
  }
  let plainInput: Entry = {
    kind: 'text',
    text,
  };
  if (mode.kind !== 'editing' || looks === undefined || isFormulaText(text)) return plainInput;
  if (!doLooksFitText(looks, mode.text)) return plainInput;
  if (reads.cellOf(cell)?.input.kind !== 'richText' && isWholeLookMarked(looks, fontMarksOfCell(reads, cell))) return plainInput;
  return richTextOfEntry(text, looksAfterTyping(looks, mode.text, text));
}
export const TYPED_MARK_SIGNS: readonly (readonly [sign: string, mark: FontMark])[] = [
  ['**', 'bold'],
  ['~~', 'strikethrough'],
  ['*', 'italic'],
];
export const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
export const CJK_PUNCTUATION_RANGES = String.raw`\u3000-\u3003\u3008-\u3011\u3014-\u301F\u3030\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65`;
export const OPENS_TYPED_MARK = new RegExp(String.raw`^$|[\s([{"'“‘«—–\p{So}*~${CJK_PUNCTUATION_RANGES}]`, 'u');
export const CLOSES_TYPED_MARK = new RegExp(String.raw`^$|[\s)\]}"'”’»—–\p{So}*~.,;:!?…${CJK_PUNCTUATION_RANGES}]`, 'u');
export const CJK_LETTER = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]/u;
export const PATH_SIGNS = '/\\.,';
export const OPENING_BRACKET = /(?![„‚])\p{Ps}/u;
export const CLOSING_BRACKET = /\p{Pe}/u;
export const QUOTE_SIGN = /["'＂＇„‚\p{Pi}\p{Pf}]/u;
export const ANY_LETTER = /\p{L}/u;
export const ONLY_MARK_SIGNS = /^[*~]*$/;
export const charBefore = (text: string, position: number): string =>
  /[\uDC00-\uDFFF]/.test(text[position - 1] ?? '') ? text.slice(position - 2, position) : (text[position - 1] ?? '');
export const charStartingAt = (text: string, position: number): string => String.fromCodePoint(text.codePointAt(position) ?? 32);
export const isSpaceOrNothing = (char: string): boolean => char === '' || /\s/.test(char);
export const withoutMarkSigns = (text: string, { from, wordsFrom, wordsTo, to }: TypedMarkSpan): string =>
  text.slice(0, from) + text.slice(wordsFrom, wordsTo) + text.slice(to);
export const isTextWithoutMarks = (text: string): boolean =>
  isFormulaText(text) || isMentionText(text) || text.startsWith(TEXT_PREFIX_QUOTE);
export const MAX_TYPED_MARKS = 100;
export const MAX_MARK_SIGNS_LOOKED_AT = 2000;
export const RICH_TEXT_BYTE_LIMIT = 32767;
export const DATE_LIKE_WORDS =
  'january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday am pm e st nd rd th true false r s'.split(
    ' ',
  );
export const isDateLikeWord = (word: string, isWordDone: boolean): boolean =>
  DATE_LIKE_WORDS.some((dateWord) => dateWord.startsWith(word) && (!isWordDone || word.length >= 3 || dateWord === word));
export const isWordyText = (text: string, caret: number): boolean =>
  !isFormulaText(text) &&
  [...text.matchAll(/\p{L}+/gu)].some(({ 0: word, index }) => {
    let isCaretOutside = caret < index || caret > index + word.length;
    let isAfterDigit = /\d/.test(text.slice(0, index));
    return !isDateLikeWord(word.toLowerCase(), isCaretOutside && !isAfterDigit);
  });
export const fontMarksOfCell = (reads: WorkbookReads, cell: CellId): FontMark[] => fontMarksOfStyle(reads.formatOf(cell));
export const withMarksToTypeIn = ({ text, looks }: EntryLooksKept, { from, after, marks }: MarksToTypeIn): EntryLooks =>
  FONT_MARKS.reduce(
    (withMarks, mark) => withMarkSet(withMarks, from, text.length - after, mark, marks.includes(mark)),
    looks,
  );
export const entryLooksOf = (mode: PageMode): EntryLooks | undefined => (mode.kind === 'editing' && !isFormulaText(mode.text) ? mode.looks : undefined);
export const hasEntryLists = (mode: PageMode): boolean => entryListsOf(mode) !== undefined;
export const canSetMarkToTypeIn = ({ mode }: Pick<PageState, 'mode'>, reads: WorkbookReads, selectedInBox: CaretInEntry | undefined): boolean =>
  caretInWordyEntry(mode, reads, selectedInBox) !== null;
export const marksToTypeAt = ({ text, marksToTypeIn }: EditingMode, looks: EntryLooks, caret: number): FontMark[] =>
  marksToTypeIn !== undefined && caret === text.length - marksToTypeIn.after ? marksToTypeIn.marks : marksAtCaretImported(looks, caret);
export const canSetMarkOnEntrySelection = ({ mode }: Pick<PageState, 'mode'>, selectedInBox: CaretInEntry | undefined): boolean =>
  selectedSpanInEntry(mode, selectedInBox) !== null;
export const canChangeEntryLists = (mode: PageMode, selectedInBox: CaretInEntry | undefined): boolean => selectionInRichEntry(mode, selectedInBox) !== null;
export const withEntryLooksChanged = (
  state: PageState,
  reads: WorkbookReads,
  { start, end, mode }: EntrySelection,
  change: (looks: EntryLooks) => EntryLooks,
) => {
  let looks = mode.looks ?? plainLooks(mode.text, fontMarksOfCell(reads, activeAnchorCell(state, reads)));
  return {
    ...state,
    mode: {
      ...mode,
      looks: change(looks),
      selectedInEntry: {
        start,
        end,
      },
    },
  };
};
export const LIST_TEXT_PREFIX = "'";
export const isFormulaTypedAfterText = (modeBefore: PageMode, text: string, caret: number | undefined): boolean =>
  modeBefore.kind === 'editing' && modeBefore.text !== '' && isFormulaText(text) && caret === text.length;
export const cellShownAtAnchor = (state: PageState, reads: WorkbookReads) =>
  readsWithUnansweredEntries(reads, state).cellOf(activeAnchorCell(state, reads));
export const checkboxLinesOfCell = (state: PageState, reads: WorkbookReads): number[] =>
  listLinesOfCell(cellShownAtAnchor(state, reads)).flatMap(
    ({ list }, line) => (list.kind === 'checkbox' ? [line] : []),
  );
export const textAtStartOfEntry = (mode: PageMode): string =>
  mode.kind !== 'editing' || mode.isTypedOverCell === true ? '' : mode.textAtStart;
export { MARK_SIGN_CHARS } from './entry-looks-values.ts';
