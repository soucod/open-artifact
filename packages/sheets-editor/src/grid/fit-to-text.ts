import type { ColumnId, Edit } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellId } from '../model/workbook.ts';
import type { IfQueued, PageContext, PointerPressedTwice } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { FontToMeasure } from '../state/controller.ts';
import type { CellFont } from './cell-drawing.tsx';
import { isCheckboxFormat } from '../chips/checkboxes.ts';
import { cellValueOf, usersOfCell, richTextBoldItalic } from '../model/cell-values.ts';
import { profileOfUser, isPeopleCell } from '../chips/people-list.ts';
import { personChipsWidth, dropdownChipExtraWidth } from './chip-metrics.ts';
import { CELL_TEXT_PADDING_X, TEXT_PADDING_BESIDE_TOTAL, listIndentOfLevel, textRoomInWidth } from './cell-metrics.ts';
import { readCellLink } from '../links/cell-links.ts';
import { githubReferenceOf, urlForDisplay } from '../links/url-display.ts';
import { shownCellText } from '../format/shown-text.ts';
import { dropdownAtCell } from '../chips/dropdown-options.ts';
import { wrappedTextOfCell } from './wrapped-rows.ts';
import { flattenLineBreaks } from './text-overflow.ts';
import { sheetOfView } from './layout.ts';
import { mergedCellsToSkipTest, mergeAnchorCellsTest } from '../selection/merged-cells.ts';
import { drawnFormatsOf } from '../format/conditional/drawn-looks.ts';
import { selectedArea, selectionOfArea } from '../selection/model.ts';
import { withNoEffects, withFormulasLeftToWorkOut } from '../state/transitions.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import { selectAfterEdit } from '../state/edit-answers.ts';
import { resizeLineUnderPointer, columnsToResizeForLine, queueResizeEdit } from './resize-lines.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
/** A text a column is widened to fit, in its font, with the room it needs beside it. */
export interface TextToFit {
  text: string;
  /** The column the text wraps in, by index, or null when it does not wrap. */
  wrapsInColumnAt: number | null;
  font: CellFont;
  besideText: number;
}
/** A text to fit, in the column it is in. */
export interface TextToFitInColumn extends TextToFit {
  columnId: ColumnId;
}
/** The texts drawn in one font, put together to measure their characters at once. */
interface TextsInFont {
  font: CellFont;
  text: string;
  widthOfCharacter: (character: string) => number;
}
/** The edit that widens columns to fit their text. */
export type FitColumnsEdit = Extract<Edit, { kind: 'fitColumns' }>;
export function textToFitOfCell(
  state: PageState,
  workbook: WorkbookReads,
  cellId: CellId,
  format: WholeCellFormat,
  mergeAnchorOf: (cellId: CellId) => boolean,
): TextToFit | TextToFit[] | 'box' | null {
  let cell = workbook.cellOf(cellId);
  let shownCell = cell ?? workbook.spilledCellOf(cellId);
  if (isCheckboxFormat(format) && cellValueOf(shownCell)?.kind === 'boolean') return 'box';
  let users = usersOfCell(cell);
  if (users.length > 0) {
    let names = users.map((userId) => profileOfUser(state.profilesById, userId).name);
    let chipsWidth = personChipsWidth(users.length, isPeopleCell(workbook, cellId), format.font.size);
    let besideText = CELL_TEXT_PADDING_X + chipsWidth;
    return {
      text: names.join(''),
      wrapsInColumnAt: null,
      font: format.font,
      besideText,
    };
  }
  let shown = shownCell?.shown;
  if (shown?.kind === 'cannotBeShown' && shown.reason !== 'notPrintedYet') return null;
  let link = readCellLink(cell, format);
  let text =
    link === null || link.drawnAs === 'words' || githubReferenceOf(link.url) !== null
      ? shownCellText(shownCell, 1 / 0, workbook.decimalSign).text
      : urlForDisplay(link.url, link.drawnAs === 'addressWithoutScheme');
  if (text.trim() === '') return null;
  let isDropdownOption = cell?.dropdownOption !== undefined;
  let boldItalic = richTextBoldItalic(cell);
  let font = {
    ...format.font,
    bold: format.font.bold || isDropdownOption || boldItalic.bold,
    italic: format.font.italic || boldItalic.italic,
  };
  let hasDropdown = format.cellControl.kind === 'dropdown' && dropdownAtCell(workbook, cellId) !== null;
  let wrapped = isDropdownOption ? null : wrappedTextOfCell(cellId, mergeAnchorOf(cellId), workbook);
  if (wrapped !== null) {
    let wrapsInColumnAt = wrapped.areLinesCut === true ? null : workbook.columnIndexOf(state.sheetId, cellId.columnId);
    let { levelsInLists } = wrapped;
    if (levelsInLists === undefined)
      return {
        text: wrapped.text,
        wrapsInColumnAt,
        font,
        besideText: TEXT_PADDING_BESIDE_TOTAL,
      };
    return wrapped.text
      .split(
        `
`,
      )
      .map(
        (line, lineIndex) => ({
          text: line,
          wrapsInColumnAt,
          font,
          besideText: TEXT_PADDING_BESIDE_TOTAL + Math.ceil(listIndentOfLevel(levelsInLists[lineIndex] ?? null, font.size)),
        }),
      );
  }
  return {
    text: isDropdownOption || hasDropdown ? text.replaceAll(/[ \t\r\n]+/g, ' ').replaceAll(/^ | $/g, '') : flattenLineBreaks(text),
    wrapsInColumnAt: null,
    font,
    besideText: (isDropdownOption ? CELL_TEXT_PADDING_X : TEXT_PADDING_BESIDE_TOTAL) + dropdownChipExtraWidth(isDropdownOption, hasDropdown),
  };
}
export function cachedCharacterWidths(workbook: ReadsWithTextMeasurer, font: FontToMeasure): (text: string) => number {
  let widths = new Map<string, number>();
  return (text: string) => {
    let cached = widths.get(text);
    if (cached !== undefined) return cached;
    let width = workbook.widthOfCharacters(text, font);
    widths.set(text, width);
    return width;
  };
}
export function widestWordAndLine(text: string, widthOf: (character: string) => number): { word: number; line: number } {
  let wordWidth = 0;
  let lineWidth = 0;
  let widestWord = 0;
  let widestLine = 0;
  for (let character of text) {
    let isLineBreak =
      character ===
      `
`;
    let width = isLineBreak ? 0 : widthOf(character);
    wordWidth = isLineBreak || character === ' ' ? 0 : wordWidth + width;
    lineWidth = isLineBreak ? 0 : lineWidth + width;
    if (wordWidth > widestWord) widestWord = wordWidth;
    if (lineWidth > widestLine) widestLine = lineWidth;
  }
  return {
    word: widestWord,
    line: widestLine,
  };
}
export function fitColumnsEdit(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  oneColumn: ColumnId,
  otherColumn: ColumnId,
): FitColumnsEdit | null {
  let { sheetId } = state;
  let oneIndex = workbook.columnIndexOf(sheetId, oneColumn);
  let otherIndex = workbook.columnIndexOf(sheetId, otherColumn);
  let layout = sheetOfView(state, workbook);
  if (oneIndex === null || otherIndex === null || layout === undefined) return null;
  let { rowCount, columnEdges } = layout;
  let leftColumnIndex = Math.min(oneIndex, otherIndex);
  let columnCount = Math.abs(oneIndex - otherIndex) + 1;
  let area = {
    topRowIndex: 0,
    rowCount,
    leftColumnIndex,
    columnCount,
  };
  let isSkippedCell = mergedCellsToSkipTest(workbook, sheetId, area);
  let mergeAnchorOf = mergeAnchorCellsTest(workbook, sheetId, area);
  let formats = drawnFormatsOf(workbook, sheetId, workbook.formatsGivenIn(sheetId));
  let cells = workbook.cellsOnShowIn(sheetId, area);
  let texts: TextToFitInColumn[] = [];
  let hasAny = cells.length > MOST_CELLS_MEASURED_TO_FIT;
  for (let cellId of cells.slice(0, MOST_CELLS_MEASURED_TO_FIT)) {
    let textOfCell = isSkippedCell(cellId) ? null : textToFitOfCell(state, workbook, cellId, formats.formatOf(cellId), mergeAnchorOf);
    if (textOfCell === null) continue;
    hasAny = true;
    if (textOfCell !== 'box')
      for (let text of [textOfCell].flat())
        texts.push({
          ...text,
          columnId: cellId.columnId,
        });
  }
  if (!hasAny) return null;
  let fontGroups = new Map<string, TextsInFont>();
  let fontGroupOf = (font: CellFont) => {
    let key = `${font.size} ${font.bold} ${font.italic}`;
    let group: TextsInFont = fontGroups.get(key) ?? {
      font,
      text: '',
      widthOfCharacter: cachedCharacterWidths(workbook, font),
    };
    fontGroups.set(key, group);
    return group;
  };
  for (let { text: textInFont, font: fontOfText } of texts) fontGroupOf(fontOfText).text += textInFont;
  for (let { text: textsOfFont, font: groupFont } of fontGroups.values()) workbook.widthOfCharacters(textsOfFont, groupFont);
  let widthNeeded = ({ text, wrapsInColumnAt, font, besideText }: TextToFit) => {
    if (wrapsInColumnAt === null) return Math.ceil(workbook.widthOfCharacters(text, font)) + besideText;
    let { word: wordWidth, line: lineWidth } = widestWordAndLine(text, fontGroupOf(font).widthOfCharacter);
    let columnWidth = columnEdges.sizeOf(wrapsInColumnAt);
    let indent = besideText - TEXT_PADDING_BESIDE_TOTAL;
    return Math.ceil(wordWidth) + indent <= textRoomInWidth(columnWidth)
      ? Math.min(Math.ceil(lineWidth) + besideText, columnWidth)
      : Math.ceil(wordWidth) + besideText;
  };
  let widthByColumn = new Map<ColumnId, number>();
  for (let textInColumn of texts) widthByColumn.set(textInColumn.columnId, Math.max(widthByColumn.get(textInColumn.columnId) ?? 0, widthNeeded(textInColumn)));
  let noNarrowerThan = [...widthByColumn].map(
    ([column, width]) => ({
      column,
      widthInPixels: width,
    }),
  );
  return {
    kind: 'fitColumns',
    sheetId,
    oneColumn,
    otherColumn,
    noNarrowerThan,
  };
}
export function fitSelectedColumnsToText(state: PageState, reads: ReadsWithTextMeasurer): PageTransition {
  let area = selectedArea(state, reads);
  let selection = area === null ? null : selectionOfArea(state, reads, area);
  if (selection === null) return withNoEffects(state);
  let { activeCell, selectionCorner } = selection;
  let fitEdit = fitColumnsEdit(state, reads, activeCell.columnId, selectionCorner.columnId);
  let queueOptions: IfQueued = {
    ...IF_QUEUED_DEFAULTS,
    select: state,
    done: {
      what: 'columnsSized',
      widthInPixels: null,
    },
  };
  return fitEdit === null ? withNoEffects(selectAfterEdit(state, reads, queueOptions, null)) : queueEdit(state, fitEdit, queueOptions);
}
export function fitColumnToTextOnDoublePress(
  state: PageState,
  action: PointerPressedTwice,
  context: Pick<PageContext, 'reads' | 'refusalOfEveryEdit' | 'areFormulasLeft'>,
): PageTransition | null {
  let resizeLine = action.isByFinger ? null : resizeLineUnderPointer(state, action, context)?.line;
  if (resizeLine?.isA !== 'column') return null;
  let { reads, areFormulasLeft } = context;
  if (areFormulasLeft) return withFormulasLeftToWorkOut(state, action);
  let fitEdit = fitColumnsEdit(state, reads, ...columnsToResizeForLine(state, reads, resizeLine));
  return fitEdit === null ? withNoEffects(state) : queueResizeEdit(state, fitEdit);
}
export const MOST_CELLS_MEASURED_TO_FIT = 1e5;
