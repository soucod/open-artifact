import {
  linkSpansOfLooks,
  plainLooks,
  fontMarksOfStyle,
  looksWithRangeReplaced,
  looksAfterTyping,
  withLinkSet,
  withEntryText,
  richTextFromLooks,
} from '../editor/text-looks.ts';
import { activeAnchorCell, scrollToShowActiveCell, moveActiveCellTo } from '../selection/model.ts';
import { acceptedLinkUrl } from './text-links.ts';
import { hasRichTextLink, linkAddressProblem, linkAddressOfTyped, cleanLinkText } from './link-form.ts';
import { askLinkCard, cellExplained, cellKeyText } from '../state/explained-under-cell.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { withNoEffects } from '../state/transitions.ts';
import { commitEntryInPlaceIfEditing } from '../editor/commit-entry.ts';
import { encodedLinkUrl, safeLinkUrl } from './cell-links.ts';
import { TEXT_PREFIX_QUOTE, addTextPrefixQuote, stripTextPrefixQuote } from '../model/cell-text.ts';
import { textToEditAt, startEntryEditing } from '../editor/start-entry.ts';
import { looksOfRichCellText } from '../editor/entry-looks.ts';
import { queueEdit, enterEntryEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { EntryLooks, FontMark, LastDone, PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { AddressPastedOverWords, CaretInEntry } from '../state/event-reducer.ts';
import type { CaretSpan } from '../keys/key-acts.ts';
import type { LinkSpan } from '../editor/text-looks.ts';
/** An address pasted over words of an entry, to link them to: where the words start and end. */
export interface LinkOverWords extends CaretSpan {
  address: string;
}
export function trimmedEntrySpan(text: string, { start, end }: CaretSpan = {} as CaretSpan): CaretSpan {
  let from = Math.max(start, spanOfEntryText(text).start);
  let picked = text.slice(from, Math.max(from, end));
  return {
    start: from + (picked.length - picked.trimStart().length),
    end: from + picked.trimEnd().length,
  };
}
export function addressWordAt(text: string, at: number): CaretSpan | null {
  let [start, end] = [at, at];
  while (start > 0 && !ADDRESS_BREAK_PATTERN.test(text.charAt(start - 1))) start -= 1;
  while (end < text.length && !ADDRESS_BREAK_PATTERN.test(text.charAt(end))) end += 1;
  let word = text.slice(start, end);
  let [, lead = '', body = ''] = /^([^\p{L}\p{N}]*)(.*[\p{L}\p{N}/])/su.exec(word) ?? [];
  let [bodyStart, bodyEnd] = [start + lead.length, start + lead.length + body.length];
  return /[._\-@/:]/.test(body) && bodyStart <= at && at <= bodyEnd
    ? {
        start: bodyStart,
        end: bodyEnd,
      }
    : null;
}
export function wordSpanAtCaret(text: string, looks: EntryLooks, at: number): CaretSpan | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  let word = [
    ...new Intl.Segmenter(undefined, {
      granularity: 'word',
    }).segment(text),
  ].find(
    ({ segment, index, isWordLike }) =>
      isWordLike === true && index <= at && at <= index + segment.length,
  );
  if (word === undefined) return null;
  let span = addressWordAt(text, at) ?? spanBetween(word.index, word.index + word.segment.length);
  let linkSpans = linkSpansOfLooks(looks);
  return {
    start: Math.max(span.start, ...linkSpans.filter(({ end }) => end <= at).map(({ end }) => end)),
    end: Math.min(
      span.end,
      ...linkSpans.filter(({ start }) => start >= at).map(({ start }) => start),
    ),
  };
}
export function linkSpansAcrossLines(text: string, looks: EntryLooks): LinkSpan[] {
  let spans: LinkSpan[] = [];
  for (let span of linkSpansOfLooks(looks)) {
    let last = spans.at(-1);
    if (last?.link === span.link && /^\n+$/.test(text.slice(last.end, span.start)))
      spans[spans.length - 1] = {
        ...last,
        end: span.end,
      };
    else spans.push(span);
  }
  return spans;
}
export function openLinkFormInEntry(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  picked: CaretSpan,
  opensEntry: boolean = false,
): PageState | null {
  let { mode } = state;
  if (mode.kind !== 'editing') return null;
  let isCaret = picked.start === picked.end;
  let { start, end } = trimmedEntrySpan(mode.text, picked);
  if (!isCaret && start >= end) return null;
  let cellId = activeAnchorCell(state, reads);
  let looks = mode.looks ?? plainLooks(mode.text, fontMarksOfStyle(reads.formatOf(cellId)));
  let linkSpan = linkSpansAcrossLines(mode.text, looks).find(
    ({ start: spanStart, end: spanEnd, link }) => spanStart <= start && end <= spanEnd && acceptedLinkUrl(link) !== null,
  );
  let wordSpan = isCaret ? wordSpanAtCaret(mode.text, looks, start) : null;
  let { start: formStart, end: formEnd } = linkSpan ?? wordSpan ?? spanBetween(start, end);
  return {
    ...scrollToShowActiveCell(state, reads, 'cellAlone'),
    ...(opensEntry && {
      calendar: null,
      timeList: null,
    }),
    menu: null,
    mode: {
      ...mode,
      looks,
      selectedInEntry: {
        start: formStart,
        end: formEnd,
      },
    },
    linkForm: {
      cellId,
      entry: mode.text,
      text: mode.text.slice(formStart, formEnd),
      address: (linkSpan === undefined ? null : acceptedLinkUrl(linkSpan.link)) ?? '',
      hasLink: linkSpan !== undefined,
      valueKept: null,
      inEntry: {
        start: formStart,
        end: formEnd,
      },
      ...(opensEntry && {
        opensEntry,
      }),
    },
  };
}
export function openEntryLinkForm(state: PageState, reads: ReadsWithTextMeasurer, caretInEntry: CaretInEntry | undefined): PageState | null {
  let { mode } = state;
  let cellId = activeAnchorCell(state, reads);
  if (mode.kind === 'navigating' && isRichTextCell(reads, cellId)) {
    if (hasRichTextLink(reads, cellId))
      return askLinkCard(
        {
          ...moveActiveCellTo(state, reads, cellId),
          menu: null,
        },
        reads,
        null,
        null,
      );
    let started = entryStartedAtActiveCell(state, reads);
    return openLinkFormInEntry(started, reads, spanOfEntryText(started.mode.kind === 'editing' ? started.mode.text : ''), true);
  }
  if (mode.kind !== 'editing' || isFormulaText(mode.text)) return null;
  if (mode.isInBoxOfOneLine === true) return null;
  if (caretInEntry === undefined || caretInEntry.text !== mode.text || caretInEntry.isComposing) return null;
  return openLinkFormInEntry(state, reads, caretInEntry);
}
export function editLinkOfUrlInEntry(state: PageState, reads: ReadsWithTextMeasurer, url: string): PageState | null {
  let linkSpan = state.mode.kind === 'editing' ? linkSpanWithUrl(state.mode.looks, url) : undefined;
  return linkSpan === undefined ? null : openLinkFormInEntry(state, reads, linkSpan, true);
}
export function looksWithSpanReplaced(
  { text, looks }: { text: string; looks: EntryLooks },
  marks: FontMark[],
  { start, end }: CaretSpan = {} as CaretSpan,
  newText: string,
): EntryLooks {
  if (newText === text.slice(start, end)) return looks;
  if (start < end) return looksWithRangeReplaced(looks, text, start, end, newText);
  let textAfter = text.slice(0, start) + newText + text.slice(end);
  return looksAfterTyping(looks, text, textAfter, start + newText.length, marks);
}
export function submitLinkFormInEntry(state: PageState, reads: ReadsWithTextMeasurer, text: string, address: string): PageTransition {
  let { linkForm: form, mode } = state;
  let span = form?.inEntry;
  if (span === undefined || mode.kind !== 'editing' || mode.looks === undefined) return withNoEffects(state);
  if (linkAddressProblem(address, true) !== null) return withNoEffects(state);
  if (address.trim() === '' && form?.hasLink !== true) return withNoEffects(state);
  let finish = (stateAfter: PageState, lastDone: LastDone | null) =>
    (form?.opensEntry === true ? commitEntryInPlaceIfEditing(stateAfter, reads) : null) ??
    withNoEffects({
      ...stateAfter,
      lastDone,
    });
  let oldText = mode.text.slice(span.start, span.end);
  let typedUrl = linkAddressOfTyped(address);
  let link = encodedLinkUrl(typedUrl);
  let cleanText = text === form?.text || cleanLinkText(text) === '' ? oldText : cleanLinkText(text);
  let newText = typedUrl !== null && cleanText === '' ? typedUrl : cleanText;
  if (newText === oldText && (typedUrl ?? '') === form?.address)
    return finish(
      {
        ...state,
        linkForm: null,
      },
      state.lastDone,
    );
  let entryText = mode.text.slice(0, span.start) + newText + mode.text.slice(span.end);
  let linkEnd = span.start + newText.length;
  let marks = fontMarksOfStyle(reads.formatOf(activeAnchorCell(state, reads)));
  let looksReplaced = looksWithSpanReplaced(
    {
      text: mode.text,
      looks: mode.looks,
    },
    marks,
    span,
    newText,
  );
  let looksLinked = withLinkSet(looksReplaced, span.start, linkEnd, link);
  let entryWritten =
    isFormulaText(entryText) || (span.start === 0 && newText.startsWith(TEXT_PREFIX_QUOTE)) ? addTextPrefixQuote(entryText) : entryText;
  let looksWritten = looksAfterTyping(looksLinked, entryText, entryWritten);
  let caretAt = linkEnd + entryWritten.length - entryText.length;
  let newMode = {
    ...withEntryText(mode, entryWritten),
    looks: looksWritten,
    selectedInEntry: {
      start: caretAt,
      end: caretAt,
    },
  };
  return finish(
    {
      ...state,
      linkForm: null,
      mode: newMode,
    },
    {
      what: 'linkSetInEntry',
      link: link === null ? 'removed' : form?.hasLink === true ? 'changed' : 'added',
    },
  );
}
export function linkOfAddressPastedOverWords(text: string, selected: CaretSpan, pasted: string): LinkOverWords | null {
  let address = encodedLinkUrl(safeLinkUrl(pasted));
  if (address === null || linkAddressProblem(address, true) !== null) return null;
  let { start, end } = trimmedEntrySpan(text, selected);
  let words = text.slice(start, end);
  return !isFormulaText(text) && words !== '' && !words.includes('\n') && safeLinkUrl(words) === null
    ? {
        address,
        start,
        end,
      }
    : null;
}
export function withAddressPastedOverWords(
  state: PageState,
  reads: WorkbookReads,
  pasted: LinkOverWords & Pick<AddressPastedOverWords, 'text' | 'caretAt'>,
): PageState {
  let { mode } = state;
  let { address, text, start, end, caretAt } = pasted;
  if (mode.kind !== 'editing' || mode.text !== text) return state;
  let looks = mode.looks ?? plainLooks(text, fontMarksOfStyle(reads.formatOf(activeAnchorCell(state, reads))));
  return {
    ...state,
    mode: {
      ...mode,
      looks: withLinkSet(looks, start, end, address),
      selectedInEntry: {
        start: caretAt,
        end: caretAt,
      },
    },
    lastDone: {
      what: 'linkSetInEntry',
      link: linkSpansOfLooks(looks).some((span) => span.start < end && start < span.end) ? 'changed' : 'added',
    },
  };
}
export function removeLinkOfUrlFromCell(state: PageState, reads: ReadsWithTextMeasurer, cellKey: string, url: string): PageTransition {
  let card = cellExplained(state, reads);
  if (card === null || cellKeyText(card.cellId) !== cellKey) return withNoEffects(state);
  let text = textToEditAt(state, reads, card.cellId);
  let looks = looksOfRichCellText(reads, card.cellId, text);
  if (looks === undefined || linkSpanWithUrl(looks, url) === undefined) return withNoEffects(state);
  let looksUnlinked = linkSpansOfLooks(looks)
    .filter(({ link }) => safeLinkUrl(link) === url)
    .reduce((looksSoFar, { start, end }) => withLinkSet(looksSoFar, start, end, null), looks);
  let moved = moveActiveCellTo(state, reads, card.cellId, 'pointer');
  return queueEdit(moved, enterEntryEdit(card.cellId, richTextFromLooks(text, looksUnlinked)), {
    ...IF_QUEUED_DEFAULTS,
    select: moved,
    done: null,
  });
}
export const isRichTextCell = (reads: WorkbookReads, cellId: CellId): boolean => reads.cellOf(cellId)?.input.kind === 'richText';
export const spanOfEntryText = (text: string): CaretSpan => ({
  start: text.length - stripTextPrefixQuote(text).length,
  end: text.length,
});
export const spanBetween = (start: number, end: number): CaretSpan => ({
  start,
  end,
});
export const ADDRESS_BREAK_PATTERN = /[\s\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
export const entryStartedAtActiveCell = (state: PageState, reads: ReadsWithTextMeasurer) =>
  startEntryEditing(state, reads, textToEditAt(state, reads, activeAnchorCell(state, reads)), 'cell');
export const linkSpanWithUrl = (looks: EntryLooks | undefined, url: string): LinkSpan | undefined =>
  looks === undefined ? undefined : linkSpansOfLooks(looks).find(({ link }) => safeLinkUrl(link) === url);
