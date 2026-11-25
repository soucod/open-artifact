import type { CellContents } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { FormulaShownAsText } from '../grid/formulas-shown.ts';
import type { StoredFormulaToken } from '../formulas/tokenizer.ts';
import { isCellShownBlank } from '../format/shown-text.ts';
import { isCheckboxFormat } from '../chips/checkboxes.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { tokenizeFormulaWithReferences, isSignToken, tokenizeFormula, upperCaseAsciiLetters } from '../formulas/tokenizer.ts';
/** The address a cell links to, and how the grid draws it: on the cell's words, or as the address typed in (with or without its scheme). */
export interface CellLink {
  url: string;
  drawnAs: 'words' | 'address' | 'addressWithoutScheme';
}
export function tryParseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
export function safeLinkUrl(text: string): string | null {
  let trimmed = text.trim();
  let isSchemeless = SCHEMELESS_WWW_PATTERN.test(trimmed);
  let withScheme = isSchemeless ? `https://${trimmed}` : trimmed;
  if (withScheme.length > MAX_LINK_URL_LENGTH || !/^https?:\/\/\S+$/i.test(withScheme)) return null;
  let url = tryParseUrl(withScheme);
  if (url === null) return null;
  let { href, hostname, username, password } = url;
  return href.length > MAX_LINK_URL_LENGTH ||
    username !== '' ||
    password !== '' ||
    hostname.endsWith('.') ||
    hostname.length > MAX_HOSTNAME_LENGTH ||
    (isSchemeless && !WWW_HOSTNAME_PATTERN.test(hostname)) ||
    `.${hostname}`.endsWith('.agentusercontent.com')
    ? null
    : href;
}
export function linkedUrlOfCell(cell: CellContents, format: Pick<WholeCellFormat, 'cellControl'>): string | null {
  let url = cell.linksTo === undefined ? null : safeLinkUrl(cell.linksTo);
  if (url === null || shortenUrlMiddle(MAX_SHOWN_LINK_LENGTH, url) !== url) return null;
  return isCellShownBlank(cell) || (isCheckboxFormat(format) && cellValueOf(cell)?.kind === 'boolean') ? null : url;
}
export function readCellLink(
  cell: CellContents | FormulaShownAsText | null,
  format: Pick<WholeCellFormat, 'cellControl'>,
): CellLink | null {
  if (cell === null || format.cellControl.kind === 'dropdown') return null;
  let typedText = cell.input.kind === 'text' ? cell.input.value : null;
  // A formula shown as its text always holds text, so a cell without typed text holds its own contents.
  let url = typedText === null ? linkedUrlOfCell(cell as CellContents, format) : safeLinkUrl(typedText);
  if (url === null) return null;
  if (typedText === null)
    return {
      url,
      drawnAs: 'words',
    };
  return {
    url,
    drawnAs: SCHEMELESS_WWW_PATTERN.test(typedText.trim()) ? 'addressWithoutScheme' : 'address',
  };
}
export function isLinkBuilt(cell: CellContents | null): boolean {
  if (cell?.input.kind !== 'formula') return cell?.linksTo !== undefined;
  let { formula } = cell.input;
  let tokens = tokenizeFormulaWithReferences(formula);
  let hasOpenQuote =
    tokens.some((token) => isSignToken(token, "'")) ||
    formula.textBetweenReferences.some((text) => tokenizeFormula(text, 'point').isQuotationLeftOpen);
  let hyperlinkIndexes = tokens.flatMap(
    (token, index) => (token.kind === 'name' && upperCaseAsciiLetters(token.text).includes('HYPERLINK') ? [index] : []),
  );
  return (
    hasOpenQuote || hyperlinkIndexes.length === 0 || !hyperlinkIndexes.every((nameIndex) => isHyperlinkWithTextAddress(tokens, nameIndex))
  );
}
export function shortenUrlMiddle(maxLength: number, url: string): string {
  let { origin } = new URL(url);
  let rest = url.slice(origin.length);
  if (rest.length <= maxLength) return url;
  let tailLength = Math.floor(maxLength / 3);
  return `${origin}${rest.slice(0, maxLength - tailLength)}…${rest.slice(-tailLength)}`;
}
export const MAX_LINK_URL_LENGTH = 2048;
export const MAX_HOSTNAME_LENGTH = 253;
export const SCHEMELESS_WWW_PATTERN = /^[Ww]{3}\.[!-~]*$/;
export const WWW_HOSTNAME_PATTERN = /^www(?:\.[a-z\d-]+){2,}$/;
export const encodedLinkUrl = (url: string | null): string | null =>
  url?.replaceAll(/[^\w\-.~:/?#[\]@!$&'()*+,;=%]|%(?![\dA-Fa-f]{2})/g, encodeURIComponent) ?? null;
export const MAX_SHOWN_LINK_LENGTH = 240;
export const isHyperlinkWithTextAddress = (tokens: StoredFormulaToken[], index: number): boolean => {
  let [openKind, argumentKind, followingKind] = tokens.slice(index + 1, index + 4).map(({ kind }) => kind);
  return openKind === 'open' && argumentKind === 'text' && (followingKind === 'betweenArguments' || followingKind === 'close');
};
