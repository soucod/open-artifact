import type { CellEdit, DecimalSignName } from '@open-artifact/sheets-core';
import { safeLinkUrl, readCellLink, encodedLinkUrl, shortenUrlMiddle, MAX_SHOWN_LINK_LENGTH } from './cell-links.ts';
import { formulaArgumentSeparator, withDecimalSign } from '../format/number-signs.ts';
import { stripTextPrefixQuote, booleanText, addTextPrefixQuote, sanitizeCellText } from '../model/cell-text.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { acceptedLinkUrl, textHasLinks } from './text-links.ts';
import { textToEditAt } from '../editor/start-entry.ts';
import { shownCellText } from '../format/shown-text.ts';
import {
  activeAnchorCell,
  selectedArea,
  selectionKindOf,
  moveActiveCellTo,
  mergedAreaOrCellOf,
  isSameCell,
  scrollToShowActiveCell,
} from '../selection/model.ts';
import { isEntryAmongPeople } from '../chips/people-list.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { isModalOpen } from '../ui/find.ts';
import { layoutOfView } from '../grid/layout.ts';
import { doesCommentModePick } from '../comments/comment-state.ts';
import { cellExplained, cellKeyText } from '../state/explained-under-cell.ts';
import { withNoEffects } from '../state/transitions.ts';
import { enterTextEdit, queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { isRangeInSight } from '../grid/geometry.ts';
import { isEntryUnchanged, cancelEntryIfEditing } from '../editor/commit-entry.ts';
import type { LinkForm, PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
/** A link read from a cell's entry: the words shown, the address, and whether the entry links anywhere yet. */
export type LinkOfEntry = Pick<LinkForm, 'text' | 'address' | 'hasLink'>;
/** What a link form over a cell shows: the link of its entry, and a number or true/false the cell keeps. */
export type LinkFormOfCell = Pick<LinkForm, 'text' | 'address' | 'hasLink' | 'valueKept'>;
/** Why an address typed into a link form cannot be linked to. */
export type LinkAddressProblem = 'notALink' | 'tooLong';
export function hyperlinkFormula(text: string, address: string, decimalSign: DecimalSignName, valueText: string | null = null): string {
  let trimmed = text.trim();
  if ((trimmed === '' || safeLinkUrl(trimmed) === address) && valueText === null) return address;
  return `=HYPERLINK(${quoteFormulaString(address)}${formulaArgumentSeparator(decimalSign)}${valueText ?? quoteFormulaString(trimmed)})`;
}
export function readLinkOfEntry(entry: string, decimalSign: DecimalSignName): LinkOfEntry | null {
  let [, quotedAddress, quotedText] = HYPERLINK_FORMULA_PATTERNS[formulaArgumentSeparator(decimalSign)].exec(entry) ?? [];
  let address = quotedAddress === undefined ? null : safeLinkUrl(unquoteFormulaString(quotedAddress));
  if (address !== null)
    return {
      text: unquoteFormulaString(quotedText ?? quotedAddress ?? ''),
      address,
      hasLink: true,
    };
  if (entry.startsWith('=')) return null;
  let trimmed = entry.trim();
  let typedAddress = safeLinkUrl(trimmed);
  if (typedAddress === null)
    return {
      text: stripTextPrefixQuote(entry),
      address: '',
      hasLink: false,
    };
  return linkAddressProblem(typedAddress, false) === null
    ? {
        text: trimmed,
        address: typedAddress,
        hasLink: true,
      }
    : null;
}
export function keptValueTextOf(workbook: WorkbookReads, cellId: CellId): string | null {
  let value = cellValueOf(workbook.cellOf(cellId));
  if (value?.kind === 'boolean') return booleanText(value.value);
  return value?.kind === 'number' ? withDecimalSign(String(value.value), workbook.decimalSign) : null;
}
export function hasRichTextLink(workbook: WorkbookReads, cellId: CellId): boolean {
  let cellInput = workbook.cellOf(cellId)?.input;
  return (
    cellInput?.kind === 'richText' &&
    cellInput.paragraphs.some(
      ({ runs }) => runs.some(({ link }) => link !== null && acceptedLinkUrl(link) !== null),
    )
  );
}
export function richTextLinkAddresses(workbook: WorkbookReads, cellId: CellId, addresses: string[]): string[] {
  let cellInput = workbook.cellOf(cellId)?.input;
  if (cellInput?.kind !== 'richText') return NO_RICH_TEXT_LINK_ADDRESSES;
  let cached = RICH_TEXT_LINK_ADDRESSES_CACHE.get(addresses);
  if (cached !== undefined) return cached;
  let linkUrls = new Set(
    cellInput.paragraphs.flatMap(
      ({ runs }) => runs.map(({ link }) => (link === null ? null : safeLinkUrl(link))),
    ),
  );
  let found = addresses.filter((address) => linkUrls.has(address));
  return (RICH_TEXT_LINK_ADDRESSES_CACHE.set(addresses, found), found);
}
export function isCellUnlinkable(workbook: WorkbookReads, cellId: CellId): boolean {
  let inputKind = workbook.cellOf(cellId)?.input.kind;
  return inputKind === 'dropdownOption' || inputKind === 'user' || inputKind === 'users' || workbook.formatOf(cellId).cellControl.kind !== 'none';
}
export function linkFormOfCell(state: PageState, workbook: WorkbookReads, cellId: CellId): LinkFormOfCell | null {
  if (isCellWithoutLinkForm(workbook, cellId)) return null;
  let entry = textToEditAt(state, workbook, cellId);
  let link = readLinkOfEntry(entry, workbook.decimalSign);
  if (link === null) return null;
  let cell = workbook.cellOf(cellId);
  if (entry.startsWith('=') && readCellLink(cell, workbook.formatOf(cellId)) === null) return null;
  let valueKept = keptValueTextOf(workbook, cellId);
  if (valueKept === null)
    return {
      ...link,
      valueKept,
    };
  return {
    ...link,
    text: shownCellText(cell, 1 / 0, workbook.decimalSign).text,
    valueKept,
  };
}
export function linkActionAtActiveCell(state: PageState, workbook: WorkbookReads): 'edit' | 'insert' | 'notOnFormula' | null {
  let cellId = activeAnchorCell(state, workbook);
  if (isCellUnlinkable(workbook, cellId)) return null;
  if (workbook.cellOf(cellId)?.input.kind === 'richText') return hasRichTextLink(workbook, cellId) ? 'edit' : 'insert';
  let form = linkFormOfCell(state, workbook, cellId);
  if (form !== null) return form.hasLink ? 'edit' : 'insert';
  return readCellLink(workbook.cellOf(cellId), workbook.formatOf(cellId)) === null ? 'notOnFormula' : null;
}
export function canEditLinkAtActiveCell(state: PageState, workbook: ReadsWithTextMeasurer): boolean {
  if (state.mode.kind === 'editing') {
    let { text, holdsOneLine, isInBoxOfOneLine } = state.mode;
    let isUnlinkable = isCellUnlinkable(workbook, activeAnchorCell(state, workbook)) || isEntryAmongPeople(state, workbook);
    let isOneLineBox = holdsOneLine === true && isInBoxOfOneLine === true;
    if (isFormulaText(text) || isUnlinkable || isOneLineBox) return false;
    return state.linkForm === null && !isModalOpen(state);
  }
  let area = selectedArea(state, workbook);
  if (!(area === null || selectionKindOf(area, layoutOfView(state, workbook)) === 'cells')) return false;
  if (doesCommentModePick(state) || isModalOpen(state)) return false;
  let action = linkActionAtActiveCell(state, workbook);
  return (action === 'insert' || action === 'edit') && textToEditAt(state, workbook, activeAnchorCell(state, workbook)) !== '';
}
export function openLinkFormFromCellCard(state: PageState, workbook: ReadsWithTextMeasurer): PageState | null {
  let card = cellExplained(state, workbook);
  if (card === null || card.link !== null) return null;
  if (linkFormOfCell(state, workbook, card.cellId)?.hasLink !== true) return null;
  let moved = moveActiveCellTo(state, workbook, card.cellId, 'pointer');
  return openLinkForm(moved, workbook, activeAnchorCell(moved, workbook));
}
export function linkAddressOfTyped(typed: string): string | null {
  let safeUrl = safeLinkUrl(typed);
  let [, host] = safeUrl === null ? (BARE_HOST_PATTERN.exec(typed.trim()) ?? []) : [];
  if (host === undefined || !host.includes('.')) return safeUrl;
  let withScheme = safeLinkUrl(`https://${typed.trim()}`);
  let [hostOfUrl] = withScheme?.slice(8).split(/[:/]/, 1) ?? [];
  return /^[\d.]+$/.test(hostOfUrl ?? '') && hostOfUrl !== host ? null : withScheme;
}
export function linkAddressProblem(address: string, isInEntry: boolean): LinkAddressProblem | null {
  if (address.trim() === '') return null;
  let typedUrl = linkAddressOfTyped(address);
  let url = isInEntry ? encodedLinkUrl(typedUrl) : typedUrl;
  if (url === null) return 'notALink';
  return shortenUrlMiddle(MAX_SHOWN_LINK_LENGTH, url) === url ? null : 'tooLong';
}
export function canRemoveLink(form: LinkForm, text: string): boolean {
  if (form.inEntry !== undefined) return form.hasLink;
  if (!form.hasLink || !form.entry.startsWith('=')) return false;
  if (valueKeptForText(form, text) !== null) return true;
  let cleanText = cleanLinkText(text);
  return cleanText !== '' && safeLinkUrl(cleanText) === null && !textHasLinks(cleanText);
}
export function canRemoveLinkFromCellCard(state: PageState, workbook: ReadsWithTextMeasurer): boolean {
  let form = openLinkFormFromCellCard(state, workbook)?.linkForm ?? null;
  return form !== null && canRemoveLink(form, form.text);
}
export function entryOfLinkForm({ text, address, valueKept }: Pick<LinkForm, 'text' | 'address' | 'valueKept'>, decimalSign: DecimalSignName): string {
  let [url, cleanText] = [linkAddressOfTyped(address), cleanLinkText(text)];
  if (url !== null) return hyperlinkFormula(cleanText, url, decimalSign, valueKept);
  return valueKept ?? (cleanText === '' ? '' : addTextPrefixQuote(cleanText));
}
export function isTextTheOldAddress(text: string, oldAddress: string, newAddress: string): boolean {
  let textAddress = withoutHttpScheme(linkAddressOfTyped(text));
  if (textAddress === null || textAddress !== withoutHttpScheme(oldAddress)) return false;
  return !(safeLinkUrl(text) === null && /^[^/]+\/$/.test(textAddress) && withoutHttpScheme(newAddress)?.startsWith(textAddress) === true);
}
export function submitLinkForm(state: PageState, workbook: WorkbookReads, text: string, address: string): PageTransition {
  let { linkForm: form } = state;
  if (form === null || linkAddressProblem(address, false) !== null) return withNoEffects(state);
  if (address.trim() === '' && !canRemoveLink(form, text)) return withNoEffects(state);
  let shutState = {
    ...state,
    linkForm: null,
  };
  let valueKept = valueKeptForText(form, text);
  let url = linkAddressOfTyped(address);
  let newText =
    text === form.text && url !== null && url !== form.address && isTextTheOldAddress(cleanLinkText(text), form.address, url) ? '' : text;
  let entry = entryOfLinkForm(
    {
      text: newText,
      address,
      valueKept,
    },
    workbook.decimalSign,
  );
  if (entry === entryOfLinkForm(form, workbook.decimalSign)) return withNoEffects(shutState);
  let edit = entry === valueKept ? typedTextIntoCellEdit(form.cellId, entry, workbook) : enterTextEdit(form.cellId, entry);
  return queueEdit(shutState, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: state,
    done: null,
    thenEvent: {
      kind: 'linkFormShut',
    },
  });
}
export function removeLinkFromCellCard(state: PageState, workbook: ReadsWithTextMeasurer, cellKey: string): PageTransition {
  let card = cellExplained(state, workbook);
  let opened = card !== null && cellKeyText(card.cellId) === cellKey ? openLinkFormFromCellCard(state, workbook) : null;
  let form = opened?.linkForm ?? null;
  return opened === null || form === null || !canRemoveLink(form, form.text) ? withNoEffects(state) : submitLinkForm(opened, workbook, form.text, '');
}
export function dropStaleLinkForm(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let { linkForm: form } = state;
  if (form === null) return state;
  let area = mergedAreaOrCellOf(workbook, form.cellId);
  let isInSight =
    state.menu === null && !isModalOpen(state) && area !== null && isRangeInSight(area, state, layoutOfView(state, workbook), state);
  let isFormStill =
    form.inEntry === undefined
      ? state.mode.kind === 'navigating' &&
        isSameCell(activeAnchorCell(state, workbook), form.cellId) &&
        !isCellWithoutLinkForm(workbook, form.cellId) &&
        textToEditAt(state, workbook, form.cellId) === form.entry
      : state.mode.kind === 'editing' && state.mode.text === form.entry && (form.opensEntry !== true || isEntryUnchanged(state, workbook));
  return isInSight && isFormStill ? state : shutLinkForm(state, workbook);
}
export const quoteFormulaString = (text: string): string => `"${text.replaceAll('"', '""')}"`;
export const unquoteFormulaString = (text: string): string => text.replaceAll('""', '"');
export const HYPERLINK_SPACE_SOURCE = '[ \\t\\n\\r]*';
export const FORMULA_STRING_PATTERN = '"((?:[^"]|"")*)"';
export const hyperlinkFormulaPattern = (separator: ';' | ','): RegExp =>
  new RegExp(
    `^=${HYPERLINK_SPACE_SOURCE}HYPERLINK\\(${HYPERLINK_SPACE_SOURCE}${FORMULA_STRING_PATTERN}${HYPERLINK_SPACE_SOURCE}(?:${separator}${HYPERLINK_SPACE_SOURCE}(?:${FORMULA_STRING_PATTERN}|${`-?\\d+(?:\\${separator === ',' ? '.' : ','}\\d*)?(?:e[-+]?\\d+)?|TRUE|FALSE`})${HYPERLINK_SPACE_SOURCE})?\\)${HYPERLINK_SPACE_SOURCE}$`,
    'i',
  );
export const HYPERLINK_FORMULA_PATTERNS = {
  ',': hyperlinkFormulaPattern(','),
  ';': hyperlinkFormulaPattern(';'),
};
export const isCellWithoutLinkForm = (workbook: WorkbookReads, cellId: CellId): boolean =>
  isCellUnlinkable(workbook, cellId) || workbook.cellOf(cellId)?.input.kind === 'richText';
export const NO_RICH_TEXT_LINK_ADDRESSES: string[] = [];
export const RICH_TEXT_LINK_ADDRESSES_CACHE = new WeakMap<string[], string[]>();
export const openLinkForm = (state: PageState, workbook: WorkbookReads, cellId: CellId): PageState | null => {
  let entry = textToEditAt(state, workbook, cellId);
  let form = linkFormOfCell(state, workbook, cellId);
  return form === null
    ? null
    : {
        ...state,
        menu: null,
        linkForm: {
          cellId,
          entry,
          ...form,
        },
      };
};
export const openLinkFormAtActiveCell = (state: PageState, workbook: ReadsWithTextMeasurer): PageState | null =>
  openLinkForm(scrollToShowActiveCell(state, workbook, 'cellAlone'), workbook, activeAnchorCell(state, workbook));
export const BARE_HOST_PATTERN = /^([\p{L}\p{N}\p{M}._-]+)(?::\d{1,5})?(?=[/?#]|$)/u;
export const valueKeptForText = (form: Pick<LinkForm, 'text' | 'valueKept'>, text: string): string | null => (text === form.text ? form.valueKept : null);
export const cleanLinkText = (text: string): string => sanitizeCellText(text.replaceAll(/\p{Cs}/gu, '')).trim();
export const typedTextIntoCellEdit = (cellId: CellId, text: string, workbook: WorkbookReads): Extract<CellEdit, { kind: 'pasteTexts' }> => ({
  kind: 'pasteTexts',
  sheetId: cellId.sheetId,
  cells: [
    {
      r: cellId.rowId,
      c: cellId.columnId,
      text,
    },
  ],
  pastedTextIs: 'asTyped',
  localeOfTexts: workbook.locale,
});
export const withoutHttpScheme = (url: string | null): string | null => url?.replace(/^https?:\/\//, '') ?? null;
export const shutLinkForm = (state: PageState, workbook: WorkbookReads): PageState =>
  state.linkForm?.opensEntry === true
    ? {
        ...cancelEntryIfEditing(state, workbook),
        linkForm: null,
      }
    : {
        ...state,
        linkForm: null,
      };
