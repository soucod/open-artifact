import type { Mark } from '@open-artifact/sheets-core';
import type { LinkPart } from '../grid/grid-drawing.tsx';
import type { CellPosition } from '../selection/model.ts';
import type { ClipboardContent, ValuesOfCopiedCells } from '../state/controller.ts';
import { TEXT_PREFIX_QUOTE } from '../model/cell-text.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
/** The texts of a block of cells, row by row. */
export type CellTextRows = readonly (readonly string[])[];
/** The style attribute of each copied cell's `<td>`, row by row; `null` for a cell left out of the table. */
export type CellStyleRows = readonly (readonly (string | null)[])[];
/** A copied cell of rich text, by its place in the copy, and the parts of its text with their links and marks. */
export interface RichTextCellToCopy {
  rowIndex: number;
  columnIndex: number;
  parts: LinkPart[];
}
export function textRunToHtml({ text, marks, url, isLinkOnWords }: LinkPart): string {
  let marked = marks.reduceRight(
    (inner, mark) => `<${FONT_MARK_TAGS[mark]}>${inner}</${FONT_MARK_TAGS[mark]}>`,
    escapeCellHtml(text),
  );
  if (url === null || !isLinkOnWords) return marked;
  return `<a href="${url.replaceAll(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? '')}">${marked}</a>`;
}
export function cellContentHtml(text: string, runs: readonly LinkPart[] = []): string {
  return runs.map(({ text: runText }) => runText).join('') === text ? runs.map(textRunToHtml).join('') : escapeCellHtml(text);
}
export function openingTableTagOf(html: string): string {
  let tableAt = html.indexOf('<table');
  let tagEnd = tableAt === -1 ? -1 : html.indexOf('>', tableAt);
  return tagEnd === -1 ? '' : html.slice(tableAt, tagEnd + 1);
}
export function copiedCellsLocaleOf(html: string): string | null {
  let locale = matchCopiedCellsAttribute(html)?.[1] ?? '';
  return locale === '' ? null : locale;
}
export function keepDaysReadAsOthersAsText(tsv: string, html: string): string {
  let dayCellList = DAYS_READ_AS_OTHERS_PATTERN.exec(openingTableTagOf(html))?.[1];
  if (dayCellList === undefined) return tsv;
  let cells = parseTsvCells(tsv);
  for (let cellKey of dayCellList.split(';')) {
    let [rowIndex, columnIndex] = cellKey.split(' ').map(Number);
    let row = cells[rowIndex ?? -1];
    let text = row?.[columnIndex ?? -1];
    if (row !== undefined && columnIndex !== undefined && text !== undefined) row[columnIndex] = TEXT_PREFIX_QUOTE + text;
  }
  return cellsToTsv(cells);
}
export function cellsToHtmlTable(
  texts: CellTextRows,
  styles: CellStyleRows | null,
  locale: string,
  daysReadAsOthers: readonly CellPosition[],
  richCells: readonly RichTextCellToCopy[],
): string {
  let partsByCell = new Map<string, LinkPart[]>(
    richCells.map(({ rowIndex, columnIndex, parts }) => [`${rowIndex} ${columnIndex}`, parts]),
  );
  let escapedLocale = locale.replaceAll(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? '');
  let dayCellList = daysReadAsOthers
    .map(({ rowIndex, columnIndex }) => `${rowIndex} ${columnIndex}`)
    .join(';');
  let daysAttribute = dayCellList === '' ? '' : ` ${DAYS_READ_AS_OTHERS_ATTRIBUTE}="${dayCellList}"`;
  let copiedAttributes = `${COPIED_CELLS_ATTRIBUTE}="${escapedLocale}"${daysAttribute}`;
  if ((styles ?? texts).flat().filter((cell) => cell !== null).length === 1) {
    let text = texts[0]?.[0] ?? '';
    let contentHtml = cellContentHtml(text, partsByCell.get('0 0'));
    return /[\r\n]/.test(text)
      ? `<table ${copiedAttributes}><tbody><tr><td>${contentHtml}</td></tr></tbody></table>`
      : `<${ONE_CELL_TABLE_TAG} ${copiedAttributes}>${contentHtml}</${ONE_CELL_TABLE_TAG}>`;
  }
  const hasStyles = styles !== null;
  let rowsHtml = texts
    .map(
      (row, rowIndex) =>
        row.map((text, columnIndex) => {
          let style = hasStyles ? styles[rowIndex]?.[columnIndex] : '';
          return style === null ? '' : `<td${style ?? ''}>${cellContentHtml(text, partsByCell.get(`${rowIndex} ${columnIndex}`))}</td>`;
        }),
    )
    .map((cells) => `${hasStyles ? COPIED_ROW_OPEN_TAG : '<tr>'}${cells.join('')}</tr>`)
    .join('');
  return `<table ${copiedAttributes}${hasStyles ? COPIED_TABLE_ATTRIBUTES : ''}><tbody>${rowsHtml}</tbody></table>`;
}
export function cellsToTsv(texts: CellTextRows): string {
  let rows = texts.map(
    (row) =>
      row.map((text) => (TSV_QUOTE_NEEDED_PATTERN.test(text) ? `"${text.replaceAll('"', '""')}"` : text)).join('\t'),
  ).join(`
`);
  return rows.endsWith(`
`)
    ? `${rows}
`
    : rows;
}
export function parseTsv(text: string, acceptsQuoted: (inner: string) => boolean): string[][] {
  let normalized = normalizeLineEnds(text).replace(/\n$/, '');
  if (normalized === '') return [];
  let row: string[] = [];
  let rows = [row];
  for (let index = 0; ; index += 1) {
    TSV_QUOTED_FIELD_PATTERN.lastIndex = index;
    TSV_PLAIN_FIELD_PATTERN.lastIndex = index;
    let quotedMatch = TSV_QUOTED_FIELD_PATTERN.exec(normalized);
    let quoted = quotedMatch?.[1] !== undefined && acceptsQuoted(quotedMatch[1]) ? quotedMatch : null;
    let field = quoted?.[0] ?? TSV_PLAIN_FIELD_PATTERN.exec(normalized)?.[0] ?? '';
    row.push(quoted?.[1]?.replaceAll('""', '"') ?? field);
    index += field.length;
    if (index >= normalized.length) return rows;
    if (
      normalized[index] ===
      `
`
    )
      rows.push((row = []));
  }
}
export function parseTsvCells(text: string): string[][] {
  return parseTsv(text, () => true);
}
export function parseTsvQuotedOnlyIfNeeded(text: string): string[][] {
  return parseTsv(text, (inner) => /[\t\n]/.test(inner));
}
export const EMPTY_CLIPBOARD_CONTENT: ClipboardContent = {
  cutToken: null,
  copiedCellsAsText: null,
  valuesOfCopiedCells: null,
  textWithNumbersWhole: '',
  localeOfTexts: null,
  typed: '',
  text: '',
  html: '',
};
export const clipboardContentOf = (
  copiedCellsAsText: string | null,
  valuesOfCopiedCells: ValuesOfCopiedCells | null,
  localeOfTexts: string,
  typedRows: CellTextRows,
  textRows: CellTextRows,
  htmlTexts: CellTextRows,
  htmlStyles: CellStyleRows | null = null,
  wholeNumberRows: CellTextRows = textRows,
  daysReadAsOthers: readonly CellPosition[] = [],
  richCells: readonly RichTextCellToCopy[] = [],
): ClipboardContent => {
  let text = cellsToTsv(textRows);
  return {
    cutToken: null,
    copiedCellsAsText,
    valuesOfCopiedCells,
    textWithNumbersWhole: wholeNumberRows === textRows ? text : cellsToTsv(wholeNumberRows),
    localeOfTexts,
    typed: cellsToTsv(typedRows),
    text,
    html: cellsToHtmlTable(htmlTexts, htmlStyles, localeOfTexts, daysReadAsOthers, richCells),
  };
};
export const HTML_ESCAPES: Partial<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
export const MSO_LINE_BREAK = '<br style="mso-data-placement:same-cell">';
export const escapeCellHtml = (text: string): string =>
  text.replaceAll(/[&<>]/g, (char) => HTML_ESCAPES[char] ?? '').replaceAll(/\r\n?|\n/g, MSO_LINE_BREAK);
export const FONT_MARK_TAGS: Record<Mark, string> = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strikethrough: 's',
};
export const COPIED_CELLS_ATTRIBUTE = 'data-copied-cells';
export const COPIED_CELLS_ATTRIBUTE_PATTERN = new RegExp(String.raw`\s${COPIED_CELLS_ATTRIBUTE}(?:="([^"]*)"|[\s=>])`);
export const matchCopiedCellsAttribute = (html: string): RegExpExecArray | null => COPIED_CELLS_ATTRIBUTE_PATTERN.exec(openingTableTagOf(html));
export const isCopiedFromSheets = (html: string): boolean => matchCopiedCellsAttribute(html) !== null;
export const DAYS_READ_AS_OTHERS_ATTRIBUTE = 'data-days-read-as-others';
export const DAYS_READ_AS_OTHERS_PATTERN = new RegExp(String.raw`\s${DAYS_READ_AS_OTHERS_ATTRIBUTE}="(\d+ \d+(?:;\d+ \d+)*)"`);
export const COPIED_TABLE_ATTRIBUTES = ` cellspacing="0" cellpadding="3" style="border-collapse:collapse;font-size:${DEFAULT_CELL_FORMAT.font.size}pt"`;
export const COPIED_ROW_OPEN_TAG = '<tr style="height:20px;vertical-align:top">';
export const ONE_CELL_TABLE_TAG = 'table-of-one-cell';
export const TSV_QUOTE_NEEDED_PATTERN = /^"|[\t\n\r]/;
export const normalizeLineEnds = (text: string): string =>
  text.replaceAll(
    /\r\n?/g,
    `
`,
  );
export const TSV_QUOTED_FIELD_PATTERN = /"((?:""|[^"])*)"(?=[\t\n]|$)/y;
export const TSV_PLAIN_FIELD_PATTERN = /[^\t\n]*/y;
