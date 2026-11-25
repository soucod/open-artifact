import { readHtmlTags, decodeHtmlEntities, rowspanOf, colspanOf } from './html-reading.ts';
import type { HtmlAttributes } from './html-reading.ts';
import { readCellsOfAnotherProgram } from './other-programs.ts';
import type { CellsOfAnotherProgram } from './other-programs.ts';
import { isCopiedFromSheets, keepDaysReadAsOthersAsText, copiedCellsLocaleOf, cellsToTsv, normalizeLineEnds } from './formats.ts';
import { encodeChartForClipboard, decodeChartFromClipboard } from './chart-marker.ts';
import type { ChartOfSheet } from './chart-marker.ts';
import { escapeClipboardCellText } from './text-escaping.ts';
import { programOfHtmlTag } from './css-looks.ts';
import { isOverByteLimit } from '../agent/prompt-text.ts';
import { EN_US_LOCALE } from '../format/number-signs.ts';
import type { ClipboardContent, ValuesOfCopiedCells } from '../state/controller.ts';
import type { PasteChosen } from '../state/event-reducer.ts';

/** Clipboard data a paste is read from: the browser's, or what this page put on the clipboard last. */
export interface ClipboardDataToRead {
  readonly types: readonly string[];
  getData(mimeType: string): string;
}

/** The text a paste writes into cells, and how it is to be read. */
export type PastedText = Pick<PasteChosen, 'text' | 'isPlainText' | 'pastedTextIs' | 'localeOfTexts'>;

/** What the cell menu asks to paste. */
export type PasteAsked = 'all' | 'valuesOnly';

/** What the last copy put on the clipboard: the cells cut, or copied. */
export type WhatLastPutHereHolds = 'cutCells' | 'copiedCells';

/** What this page keeps of its last copy, to paste it as copied while the clipboard still holds its text. */
export interface KeptOfLastPut {
  text: string;
  textWithNumbersWhole: string;
  valuesOfCopiedCells: ValuesOfCopiedCells | null;
}

/** A row of a plain HTML table: a cell's text at each column a cell starts at (none where a span covers it). */
export type HtmlTableRow = (string | undefined)[];

/** The page's side of the clipboard: what it puts there on a copy, and what it reads back on a paste. */
export interface SheetClipboard {
  putOnClipboard(copied: ClipboardContent): void;
  putChartOnClipboard(chart: ChartOfSheet, chartTitle: string): void;
  chartAtPasteOf(clipboardData: ClipboardDataToRead | null): ChartOfSheet | 'ofAnotherSheet' | null;
  keptOfLastPutAtPasteOf(clipboardData: ClipboardDataToRead | null): KeptOfLastPut | null;
  /** Lets `copy` put its forms on the clipboard data of a copy event. */
  duringCopy(clipboardData: DataTransfer, copy: () => void): void;
  /** Asks the browser for a copy or cut of the cells; tells whether it made one. */
  askBrowserToCopyOrCutCells(commandName: 'copy' | 'cut'): boolean;
  isBrowserAskedForCells(): boolean;
  lastPutHere(): ClipboardDataToRead | null;
  whatLastPutHereHolds(): WhatLastPutHereHolds | null;
  valuesOfLastPutHere(): ValuesOfCopiedCells | null;
  forgetLastPutHere(): void;
  somethingElseCopiedHere(): void;
  /** Calls `listener` when what this page put on the clipboard last changes; answers how to stop. */
  onLastPutHereChange(listener: () => void): () => void;
}

export function readPlainHtmlTable(html: string): HtmlTableRow[] | null {
  const rows: HtmlTableRow[] = [];
  let lastRowOfColumns: number[] = [];
  let cellCount = 0;
  let isOnlySpaceSoFar = true;
  let [tableWidth, rowOfWidth] = [0, 0];
  let isInTable = false;
  let isTableClosed = false;
  let columnIndex = 0;
  let textColumn: number | null = null;
  let cellText = '';
  for (let piece of readHtmlTags(html)) {
    if (piece.kind === 'unreadable') return null;
    if (piece.kind === 'styleSheet') continue;
    let { name: tagName, isClosing, attributes } = piece;
    if (isHtmlOfOfficeProgram(tagName, attributes)) return null;
    if (isOnlySpaceSoFar && attributes.get('class') === 'Apple-interchange-newline') return null;
    if (textColumn !== null) {
      const textBefore = decodeHtmlEntities(piece.writtenBefore);
      if (textBefore === null) return null;
      isOnlySpaceSoFar &&= !/\S/.test(textBefore);
      cellText += textBefore + (tagName === 'img' ? (attributes.get('alt') ?? '') : '');
    }
    let isTable = tagName === 'table';
    if (isTable && (isClosing ? !isInTable : isInTable || isTableClosed)) return null;
    if (!isTable && !(isInTable && HTML_TABLE_PART_TAGS.has(tagName))) continue;
    let lastRow = rows.at(-1);
    if (textColumn !== null && lastRow !== undefined && (tagName !== 'caption' || /\S/.test(cellText))) lastRow[textColumn] = cellText;
    textColumn = null;
    if (isTable) {
      isInTable = !isClosing;
      isTableClosed = isClosing;
    } else if (tagName === 'thead' || tagName === 'tbody' || tagName === 'tfoot') lastRowOfColumns = [];
    else if ((tagName === 'tr' || tagName === 'caption') && !isClosing) {
      rows.push([]);
      cellCount += 1;
      columnIndex = 0;
      if (tagName === 'caption') [textColumn, cellText, columnIndex] = [0, '', 1];
    } else if ((tagName === 'td' || tagName === 'th') && !isClosing) {
      const rowSpan = rowspanOf(attributes);
      let columnSpan = colspanOf(attributes);
      if (lastRow === undefined || rowSpan === null) return null;
      let firstColumnOfCell = columnIndex;
      while ((lastRowOfColumns[columnIndex] ?? 0) >= rows.length) columnIndex += 1;
      textColumn = columnIndex;
      cellText = '';
      columnIndex += columnSpan;
      if (rowOfWidth === 0) rowOfWidth = rows.length;
      if (rowOfWidth === rows.length) tableWidth = columnIndex;
      else if (columnIndex > tableWidth) return null;
      cellCount += columnIndex - firstColumnOfCell;
      for (let column = textColumn; column < columnIndex; column += 1)
        lastRowOfColumns[column] = Math.max(lastRowOfColumns[column] ?? 0, rows.length - 1 + rowSpan);
    }
    if (cellCount > MAX_PASTED_HTML_TABLE_CELLS) return null;
  }
  let filledRows = rows.filter((row) => row.length > 0);
  return isTableClosed && !(filledRows.length === 2 && !/\S/.test(filledRows[1]?.[0] ?? '')) ? filledRows : null;
}
export function cellsOfPlainTextByHtmlTable(html: string, plainText: string): string[][] | null {
  let htmlRows = /<table[\s>]/i.test(html) ? readPlainHtmlTable(html) : null;
  if (htmlRows === null) return null;
  let wordPattern = /\S+/g;
  const rows: string[][] = [];
  for (let htmlRow of htmlRows) {
    const row: string[] = [];
    for (let htmlCell of htmlRow) {
      let cellLetters = (htmlCell ?? '').replaceAll(/\s+/g, '').toUpperCase();
      let cellStart: number | null = null;
      for (let index = 0; index < cellLetters.length; ) {
        let match = wordPattern.exec(plainText);
        let word = match?.[0].toUpperCase() ?? '';
        if (match === null || !cellLetters.startsWith(word, index)) return null;
        cellStart ??= match.index;
        if (wordPattern.lastIndex - cellStart > MAX_PASTED_HTML_CELL_SPAN) return null;
        index += word.length;
      }
      row.push(cellStart === null ? '' : tidyPastedCellSpaces(plainText.slice(cellStart, wordPattern.lastIndex)));
    }
    rows.push(row);
  }
  return wordPattern.lastIndex === 0 || wordPattern.test(plainText) ? null : rows;
}
export function wasExecCommandHandled(ownerDocument: Document, commandName: string): boolean {
  let wasHandled = false;
  let onCommand = (event: Event) => {
    wasHandled = event.defaultPrevented;
  };
  ownerDocument.defaultView?.addEventListener(commandName, onCommand);
  try {
    ownerDocument.execCommand(commandName);
    return wasHandled;
  } finally {
    ownerDocument.defaultView?.removeEventListener(commandName, onCommand);
  }
}
export function readCutToken(clipboardData: ClipboardDataToRead | null): string | null {
  let cutToken = clipboardData?.getData(CUT_TOKEN_MIME) ?? '';
  return cutToken === '' ? null : cutToken;
}
export function readCopiedCellsText(clipboardData: ClipboardDataToRead | null): string | null {
  let cellsText = clipboardData?.getData(SHEETS_CELLS_MIME) ?? '';
  return cellsText === '' || isPastedTextTooLarge(cellsText) || CONTROL_OR_SURROGATE_CHAR_PATTERN.test(cellsText) ? null : cellsText;
}
export function readPasteOfAnotherProgram(clipboardData: ClipboardDataToRead | null): CellsOfAnotherProgram | null {
  let html = clipboardData?.getData('text/html') ?? '';
  let plainText = clipboardData?.getData('text/plain') ?? '';
  if (html === '' || isPastedTextTooLarge(html) || isPastedTextTooLarge(plainText)) return null;
  let compactTable = clipboardData?.getData(GOOGLE_SHEETS_COMPACT_TABLE_MIME) ?? '';
  return readCellsOfAnotherProgram(html, plainText, isPastedTextTooLarge(compactTable) ? '' : compactTable);
}
export function readTextWrittenFromCells(clipboardData: ClipboardDataToRead | null): PastedText | null {
  let typedText = clipboardData?.getData(TYPED_WITH_NUMBER_FORMATS_MIME) ?? '';
  if (typedText !== '') {
    let locale = clipboardData?.getData(LOCALE_OF_TEXTS_MIME) ?? '';
    return {
      text: typedText,
      isPlainText: false,
      pastedTextIs: 'writtenFromACell',
      localeOfTexts: localeOfTextsOrDefault(locale === '' ? null : locale),
    };
  }
  let html = clipboardData?.getData('text/html') ?? '';
  if (!isCopiedFromSheets(html)) return null;
  let plainText = clipboardData?.getData('text/plain') ?? '';
  return {
    text: !isPastedTextTooLarge(html) && !isPastedTextTooLarge(plainText) ? keepDaysReadAsOthersAsText(plainText, html) : plainText,
    isPlainText: true,
    pastedTextIs: 'writtenFromACell',
    localeOfTexts: localeOfTextsOrDefault(copiedCellsLocaleOf(html)),
  };
}
export function readPastedText(clipboardData: ClipboardDataToRead | null): PastedText {
  let fromCells = readTextWrittenFromCells(clipboardData);
  if (fromCells !== null) return fromCells;
  let html = clipboardData?.getData('text/html') ?? '';
  let plainText = clipboardData?.getData('text/plain') ?? '';
  let htmlTableRows =
    html !== '' && !isPastedTextTooLarge(html) && !isPastedTextTooLarge(plainText) ? cellsOfPlainTextByHtmlTable(html, plainText) : null;
  return {
    text: htmlTableRows === null ? plainText : cellsToTsv(htmlTableRows),
    isPlainText: true,
    pastedTextIs: 'asTyped',
    localeOfTexts: null,
  };
}
export function pasteChosenFrom(clipboard: SheetClipboard, clipboardData: ClipboardDataToRead | null, plainOnly: boolean): PasteChosen {
  let chosenData = plainOnly && clipboardData !== null ? plainTextPartOf(clipboardData) : clipboardData;
  let keptOfLastPut = clipboard.keptOfLastPutAtPasteOf(chosenData);
  let pasted = readPastedText(chosenData);
  return {
    kind: 'pasteChosen',
    cutToken: readCutToken(chosenData),
    copiedCellsAsText: readCopiedCellsText(chosenData),
    ...((chosenData?.getData(FORMULAS_LEFT_OUT_MIME) ?? '') !== '' && {
      areFormulasLeftOut: true,
    }),
    ofAnotherProgram: readPasteOfAnotherProgram(chosenData),
    valuesOfCopiedCells: keptOfLastPut?.valuesOfCopiedCells ?? null,
    ...pasted,
    ...(keptOfLastPut !== null && {
      text: keptOfLastPut.textWithNumbersWhole,
    }),
    ...(keptOfLastPut === null &&
      readTextWrittenFromCells(clipboardData) === null &&
      readPasteOfAnotherProgram(clipboardData) === null &&
      pasted.text === (chosenData?.getData('text/plain') ?? '') && {
        markdownIs: plainOnly ? 'wordsAlone' : 'read',
      }),
    localeOfTexts: chosenData === clipboardData ? pasted.localeOfTexts : (readTextWrittenFromCells(clipboardData)?.localeOfTexts ?? null),
  };
}
export function pasteOfLastPutHere(clipboard: SheetClipboard, pasteWhat: PasteAsked): PasteChosen | null {
  let lastPut = clipboard.lastPutHere();
  if (lastPut === null) return null;
  if (pasteWhat === 'all') return pasteChosenFrom(clipboard, lastPut, false);
  let valuesOfLastPut = clipboard.valuesOfLastPutHere();
  if (valuesOfLastPut === null) return null;
  return {
    ...pasteChosenFrom(clipboard, lastPut, true),
    valuesOfCopiedCells: valuesOfLastPut,
  };
}
export function createSheetClipboard(ownerDocument: Document | null = null, chartKeyPromise: Promise<string> | null = null): SheetClipboard {
  let chartKey: string | null = null;
  chartKeyPromise?.then((key) => {
    chartKey = key;
    return;
  });
  let clipboardDataOfCopy: DataTransfer | null = null;
  let isBrowserAskedForCells = false;
  let keptOfLastPut: KeptOfLastPut | null = null;
  let lastPutHere: Map<string, string> | null = null;
  const lastPutListeners = new Set<() => void>();
  let setLastPutHere = (entries: Map<string, string> | null) => {
    if (entries === lastPutHere) return;
    lastPutHere = entries;
    for (let listener of lastPutListeners) listener();
  };
  return {
    putOnClipboard(copied) {
      let {
        cutToken,
        copiedCellsAsText,
        valuesOfCopiedCells,
        textWithNumbersWhole,
        localeOfTexts,
        typed,
        text,
        html,
      } = copied;
      if (clipboardDataOfCopy === null) return setLastPutHere(null);
      const entries = new Map<string, string>();
      if (cutToken !== null) entries.set(CUT_TOKEN_MIME, cutToken);
      if (copiedCellsAsText !== null) entries.set(SHEETS_CELLS_MIME, copiedCellsAsText);
      if (copied.areFormulasLeftOut) entries.set(FORMULAS_LEFT_OUT_MIME, '-');
      entries.set(TYPED_WITH_NUMBER_FORMATS_MIME, typed);
      if (localeOfTexts !== null) entries.set(LOCALE_OF_TEXTS_MIME, localeOfTexts);
      entries.set('text/plain', text);
      entries.set('text/html', html);
      let isNothingCopied = text === '' && html === '';
      if (isNothingCopied) entries.set(NOTHING_COPIED_MIME, '-');
      for (let [mimeType, data] of entries) clipboardDataOfCopy.setData(mimeType, data);
      keptOfLastPut = {
        text: normalizeLineEnds(text),
        textWithNumbersWhole,
        valuesOfCopiedCells,
      };
      setLastPutHere(isNothingCopied ? null : entries);
    },
    putChartOnClipboard(chart, chartTitle) {
      keptOfLastPut = null;
      if (chartKey !== null) clipboardDataOfCopy?.setData(SHEETS_CHART_MIME, encodeChartForClipboard(chart, chartKey));
      clipboardDataOfCopy?.setData('text/plain', cellsToTsv([[escapeClipboardCellText(chartTitle)]]));
    },
    chartAtPasteOf: (clipboardData) => decodeChartFromClipboard(clipboardData?.getData(SHEETS_CHART_MIME) ?? '', chartKey),
    keptOfLastPutAtPasteOf(clipboardData) {
      if (normalizeLineEnds(clipboardData?.getData('text/plain') ?? '') !== keptOfLastPut?.text) {
        keptOfLastPut = null;
        setLastPutHere(null);
      }
      return keptOfLastPut !== null && keptOfLastPut.text !== '' && holdsOnlyPlainText(clipboardData) ? keptOfLastPut : null;
    },
    duringCopy(clipboardData, copy) {
      setLastPutHere(null);
      clipboardDataOfCopy = clipboardData;
      try {
        copy();
      } finally {
        clipboardDataOfCopy = null;
      }
    },
    askBrowserToCopyOrCutCells(commandName) {
      isBrowserAskedForCells = true;
      try {
        return ownerDocument !== null && wasExecCommandHandled(ownerDocument, commandName);
      } finally {
        isBrowserAskedForCells = false;
      }
    },
    isBrowserAskedForCells: () => isBrowserAskedForCells,
    lastPutHere() {
      const entries = lastPutHere;
      if (entries === null) return null;
      return {
        types: Array.from(entries.keys()),
        getData: (mimeType: string) => entries.get(mimeType) ?? '',
      };
    },
    whatLastPutHereHolds() {
      if (lastPutHere === null) return null;
      return lastPutHere.has(CUT_TOKEN_MIME) ? 'cutCells' : 'copiedCells';
    },
    valuesOfLastPutHere: () => (lastPutHere === null ? null : (keptOfLastPut?.valuesOfCopiedCells ?? null)),
    forgetLastPutHere: () => setLastPutHere(null),
    somethingElseCopiedHere() {
      keptOfLastPut = null;
      setLastPutHere(null);
    },
    onLastPutHereChange(listener) {
      lastPutListeners.add(listener);
      return () => void lastPutListeners.delete(listener);
    },
  };
}
export const MAX_PASTED_HTML_TABLE_CELLS = 200000;
export const MAX_PASTED_HTML_CELL_SPAN = 250000;
export const HTML_TABLE_PART_TAGS = new Set('caption col colgroup tbody td tfoot th thead tr'.split(' '));
export const isHtmlOfOfficeProgram = (tagName: string, attributes: HtmlAttributes): boolean =>
  programOfHtmlTag(tagName, attributes) !== null || (tagName === 'meta' && /^(?:progid|generator)$/i.test(attributes.get('name') ?? ''));
export const tidyPastedCellSpaces = (text: string): string =>
  text.replaceAll(
    /\s+/g,
    (spaces) =>
      /[\n\r]/.test(spaces)
        ? `
`
        : spaces.replaceAll(/[\t\u{a0}]/gu, ' '),
  );
export const TYPED_WITH_NUMBER_FORMATS_MIME = 'application/x-sheets-typed-with-number-formats';
export const SHEETS_CELLS_MIME = 'application/x-sheets-cells';
export const LOCALE_OF_TEXTS_MIME = 'application/x-sheets-locale-of-texts';
export const NOTHING_COPIED_MIME = 'application/x-sheets-nothing';
export const CUT_TOKEN_MIME = 'application/x-sheets-cut-token';
export const FORMULAS_LEFT_OUT_MIME = 'application/x-sheets-formulas-left-out';
export const SHEETS_CHART_MIME = 'application/x-sheets-chart';
export const MAX_PASTED_TEXT_BYTES = 16777216;
export const isPastedTextTooLarge = (text: string): boolean => isOverByteLimit(text, MAX_PASTED_TEXT_BYTES);
export const CONTROL_OR_SURROGATE_CHAR_PATTERN = /[\p{Cc}\p{Cs}]/u;
export const GOOGLE_SHEETS_COMPACT_TABLE_MIME = 'application/x-vnd.google-spreadsheet-compact-table+json';
export const localeOfTextsOrDefault = (locale: string | null): string => locale ?? EN_US_LOCALE;
export const holdsOnlyPlainText = (clipboardData: ClipboardDataToRead | null): boolean =>
  clipboardData?.types.length === 1 && clipboardData.types[0] === 'text/plain';
export const plainTextPartOf = (clipboardData: ClipboardDataToRead): ClipboardDataToRead => ({
  types: clipboardData.types.filter((mimeType) => mimeType === 'text/plain'),
  getData: (mimeType: string) => (mimeType === 'text/plain' ? clipboardData.getData(mimeType) : ''),
});
