import type { CellContents, EngineRun, Mark, Paragraph } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { LinkPart } from '../grid/grid-drawing.tsx';
import { safeLinkUrl, MAX_LINK_URL_LENGTH, shortenUrlMiddle, MAX_SHOWN_LINK_LENGTH, encodedLinkUrl } from './cell-links.ts';
import { richTextPlainText } from '../model/cell-values.ts';
import { shownCellText } from '../format/shown-text.ts';
/** A text cut into the parts that link somewhere and the parts between them, and the addresses linked to. */
export interface LinksInText {
  parts: LinkPart[];
  addresses: string[];
}
export function trimUrlTrailingPunctuation(text: string): string {
  let counts = new Map<string, number>();
  for (let character of text) counts.set(character, (counts.get(character) ?? 0) + 1);
  let end = text.length;
  for (; end > 0; end -= 1) {
    let character = text.charAt(end - 1);
    if (URL_TRAILING_PUNCTUATION.includes(character)) continue;
    let [count, openerCount] = [counts.get(character) ?? 0, counts.get(CLOSING_BRACKET_OPENERS[character] ?? '')];
    if (CLOSING_BRACKET_OPENERS[character] === undefined || count <= (openerCount ?? 0)) break;
    counts.set(character, count - 1);
  }
  return text.slice(0, end);
}
export function urlOfTextMatch(text: string): string | null {
  if (CONTROL_OR_BACKSLASH_PATTERN.test(text)) return null;
  let url = safeLinkUrl(text);
  if (url === null) return null;
  let withoutScheme = text.replace(/^https?:\/\//i, '');
  if (withoutScheme.split('/', 1)[0]?.includes('@') === true) return null;
  let [host = ''] = withoutScheme.split(/[/?#]/);
  let hostname = host.replace(/:\d*$/, '').replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
  return PLAIN_HOSTNAME_PATTERN.test(hostname) && hostname === new URL(url).hostname ? url : null;
}
export function findLinksInText(text: string): LinksInText {
  let parts: LinkPart[] = [];
  let addresses = new Set<string>();
  let [candidateCount, linkCount, end] = [0, 0, 0];
  for (let { 0: match, index } of text.matchAll(URL_IN_TEXT_PATTERN)) {
    if (linkCount === MAX_LINKS_IN_TEXT || candidateCount === MAX_URL_CANDIDATES) break;
    candidateCount += 1;
    if (match.length > 2 * MAX_LINK_URL_LENGTH) continue;
    let before = text.charAt(index - 1);
    if (URL_GLUED_BEFORE_PATTERN.test(before)) continue;
    if (URL_PUNCTUATION_BEFORE_PATTERN.test(before) && /^www\./i.test(match)) continue;
    let trimmed = trimUrlTrailingPunctuation(match);
    let url = urlOfTextMatch(trimmed);
    if (url === null || shortenUrlMiddle(MAX_SHOWN_LINK_LENGTH, url) !== url) continue;
    if (index > end)
      parts.push({
        text: text.slice(end, index),
        startsAt: end,
        url: null,
        ...PLAIN_LINK_PART_LOOK,
      });
    parts.push({
      text: trimmed,
      startsAt: index,
      url,
      ...PLAIN_LINK_PART_LOOK,
    });
    addresses.add(url);
    linkCount += 1;
    end = index + trimmed.length;
  }
  if (end < text.length)
    parts.push({
      text: text.slice(end),
      startsAt: end,
      url: null,
      ...PLAIN_LINK_PART_LOOK,
    });
  return linkCount === 0
    ? NO_TEXT_LINKS
    : {
        parts,
        addresses: [...addresses],
      };
}
export function acceptedLinkUrl(text: string): string | null {
  let url = safeLinkUrl(text);
  return url !== null && shortenUrlMiddle(MAX_SHOWN_LINK_LENGTH, url) === url ? url : null;
}
export function acceptedEncodedLinkUrl(url: string): string | null {
  let encoded = encodedLinkUrl(safeLinkUrl(url));
  return encoded === null ? null : acceptedLinkUrl(encoded);
}
export function runsWithoutAddressLinks(text: string, runs: EngineRun[]): EngineRun[] {
  if (runs.every(({ link }) => link === null) || !MAY_HOLD_URL_PATTERN.test(text)) return runs;
  let partsByStart = new Map<number, LinkPart>(findLinksInText(text).parts.map((part) => [part.startsAt, part]));
  let kept: EngineRun[] = [];
  let [first, end, startsAt, endsAt] = [0, 0, 0, 0];
  for (; first < runs.length; [first, startsAt] = [end, endsAt]) {
    let link = runs[first]?.link ?? null;
    for (; end < runs.length && runs[end]?.link === link; end += 1) endsAt += runs[end]?.text.length ?? 0;
    let { text: partText = '', url: partUrl = null } = partsByStart.get(startsAt) ?? {};
    let isAddressLink =
      link !== null && partUrl !== null && partText.length === endsAt - startsAt && acceptedEncodedLinkUrl(partUrl) === link;
    for (let run of runs.slice(first, end))
      kept.push(
        isAddressLink
          ? {
              ...run,
              link: null,
            }
          : run,
      );
  }
  return kept;
}
export function findLinksInRichText({ paragraphs }: { paragraphs: Paragraph[] }, text: string): LinksInText {
  let foundLinks = MAY_HOLD_URL_PATTERN.test(text) ? findLinksInText(text).parts : [];
  let addresses = new Set<string>();
  let keepAddress = (address: string | null) => {
    if (address === null || (!addresses.has(address) && addresses.size === MAX_LINKS_IN_TEXT)) return null;
    addresses.add(address);
    return address;
  };
  let runs = paragraphs.flatMap(
    ({ runs: runsOfParagraph }, index) => [
      ...(index === 0
        ? []
        : [
            {
              text: `
`,
              marks: NO_TEXT_MARKS,
              link: null,
            },
          ]),
      ...runsOfParagraph,
    ],
  );
  let runStarts: number[] = [];
  runs.reduce((start, run, index) => ((runStarts[index] = start), start + run.text.length), 0);
  let overlapsLink = (from: number, to: number) =>
    runs.some(
      ({ text: runText, link }, index) =>
        link !== null && (runStarts[index] ?? 0) < to && (runStarts[index] ?? 0) + runText.length > from,
    );
  return {
    parts: runs.flatMap(({ text: runText, marks, link }, index): LinkPart[] => {
      let [start, end] = [runStarts[index] ?? 0, (runStarts[index] ?? 0) + runText.length];
      if (link !== null || foundLinks.length === 0) {
        let url = link === null ? null : keepAddress(acceptedLinkUrl(link));
        return [
          {
            text: runText,
            startsAt: start,
            url,
            isLinkOnWords: url !== null,
            marks,
          },
        ];
      }
      return foundLinks.flatMap(({ text: foundText, startsAt, url }) => {
        let [from, to] = [Math.max(start, startsAt), Math.min(end, startsAt + foundText.length)];
        if (from >= to) return [];
        let isClear = !overlapsLink(startsAt, startsAt + foundText.length);
        return [
          {
            text: text.slice(from, to),
            startsAt: from,
            url: isClear ? keepAddress(url) : null,
            isLinkOnWords: false,
            marks,
          },
        ];
      });
    }),
    addresses: [...addresses],
  };
}
export function runsWithLinksOnWords(text: string, runs: EngineRun[]): EngineRun[] {
  let kept = [...runsWithoutAddressLinks(text, runs)];
  let { parts } = findLinksInRichText(
    {
      paragraphs: [
        {
          list: {
            kind: 'none',
          },
          runs: kept,
        },
      ],
    },
    text,
  );
  let linkStarts = new Set(parts.flatMap((part) => (part.isLinkOnWords ? [part.startsAt] : [])));
  let startsAt = 0;
  for (let [index, run] of kept.entries()) {
    if (run.link !== null && !linkStarts.has(startsAt))
      kept[index] = {
        ...run,
        link: null,
      };
    startsAt += run.text.length;
  }
  return kept;
}
export function groupLinkParts<Part extends LinkPart>(parts: readonly Part[]): Part[][] {
  let groups: Part[][] = [];
  for (let part of parts) {
    let previous = groups.at(-1)?.at(-1);
    if (
      previous !== undefined &&
      part.url !== null &&
      part.url === previous.url &&
      !part.isLinkOnWords &&
      !previous.isLinkOnWords &&
      part.startsAt === previous.startsAt + previous.text.length
    )
      groups.at(-1)?.push(part);
    else groups.push([part]);
  }
  return groups;
}
export function cellTextLinks(
  cell: CellContents | null,
  { cellControl }: Pick<WholeCellFormat, 'cellControl'>,
  text: string,
  overrideLink: string | null,
): LinksInText {
  if (cell === null || cellControl.kind === 'dropdown' || overrideLink !== null) return NO_TEXT_LINKS;
  let { input: cellInput } = cell;
  let richText = cellInput.kind === 'richText' ? richTextPlainText(cell) : null;
  if (!(cellInput.kind === 'text' ? cellInput.value === text : richText !== null && richText === text)) return NO_TEXT_LINKS;
  if (cellInput.kind !== 'richText' && !MAY_HOLD_URL_PATTERN.test(text)) return NO_TEXT_LINKS;
  let cached = CELL_TEXT_LINKS_CACHE.get(cell);
  if (cached?.text === text) return cached.links;
  let links = cellInput.kind === 'richText' ? findLinksInRichText(cellInput, text) : findLinksInText(text);
  CELL_TEXT_LINKS_CACHE.set(cell, {
    text,
    links,
  });
  return links;
}
export function cellLinkAddresses(reads: WorkbookReads, cellId: CellId): string[] {
  let [cell, format] = [reads.cellOf(cellId), reads.formatOf(cellId)];
  let { text } = shownCellText(cell, 1 / 0, reads.decimalSign);
  return cellTextLinks(cell, format, text, null).addresses;
}
export function singleAddressList(addresses: string[], address: string): string[] {
  if (!addresses.includes(address)) return NO_TEXT_LINKS.addresses;
  let byAddress = SINGLE_ADDRESS_CACHE.get(addresses) ?? new Map<string, string[]>();
  SINGLE_ADDRESS_CACHE.set(addresses, byAddress);
  let list = byAddress.get(address) ?? [address];
  byAddress.set(address, list);
  return list;
}
export function linkAddressesOfCell(reads: WorkbookReads, cellId: CellId, chosenAddress: string | null): string[] {
  let cell = reads.cellOf(cellId);
  if (chosenAddress === null || cell === null) return cellLinkAddresses(reads, cellId);
  let cached = CHOSEN_ADDRESS_CACHE.get(cell);
  if (cached?.[0] === chosenAddress) return cached;
  let list = [chosenAddress];
  CHOSEN_ADDRESS_CACHE.set(cell, list);
  return list;
}
export const NO_TEXT_MARKS: Mark[] = [];
export const PLAIN_LINK_PART_LOOK = {
  isLinkOnWords: false,
  marks: NO_TEXT_MARKS,
};
export const MAX_LINKS_IN_TEXT = 10;
export const MAX_URL_CANDIDATES = 30;
export const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"'`。，、；：！？]+|\bwww\.[^\s<>"'`。，、；：！？]+/gi;
export const URL_GLUED_BEFORE_PATTERN = /[A-Za-z\d@.-]/;
export const URL_PUNCTUATION_BEFORE_PATTERN = /[/:=?&#%]/;
export const URL_TRAILING_PUNCTUATION = '.,;:!?\f\r\uFEFF*_';
export const CLOSING_BRACKET_OPENERS: Partial<Record<string, string>> = {
  ')': '(',
  ']': '[',
  '}': '{',
};
export const CONTROL_OR_BACKSLASH_PATTERN = /[\p{C}\\]/u;
export const PLAIN_HOSTNAME_PATTERN = /^[a-z\d-]+(?:\.[a-z\d-]+)+$/;
export const NO_TEXT_LINKS: LinksInText = {
  parts: [],
  addresses: [],
};
export const MAY_HOLD_URL_PATTERN = /https?:\/\/|www\./i;
export const textHasLinks = (text: string): boolean => MAY_HOLD_URL_PATTERN.test(text) && findLinksInText(text).addresses.length > 0;
export const CELL_TEXT_LINKS_CACHE = new WeakMap<CellContents, { text: string; links: LinksInText }>();
export const SINGLE_ADDRESS_CACHE = new WeakMap<string[], Map<string, string[]>>();
export const CHOSEN_ADDRESS_CACHE = new WeakMap<CellContents, string[]>();
