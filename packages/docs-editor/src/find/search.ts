/**
 * Finding words in a tab and replacing them: the matches in reading order, which of them can be replaced, and how a
 * replacement is planned and written. Pure (no DOM), so the tests run it on plain docs.
 *
 * A match never spans an inline chip, a picture or a line break: each text block is searched along its runs of text.
 * A chip (a date, a dropdown, a mention) is searched on its own words and matches as a whole; it can't be replaced.
 * Without match case, each character is lowercased where that keeps its length, so positions stay exact.
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { schema } from '../editor/schema.ts';

export interface FindMatch {
  from: number;
  to: number;
  /** The match is a whole chip, found by the words it shows. */
  chip?: true;
}

/** The words an inline node shows when it is a chip, or null (not a chip, or nothing to read). */
export type ChipWords = (node: PMNode) => string | null;

/** The longest query searched for. */
export const MAX_QUERY = 1024;
/** Replace all writes at most this many matches per press… */
export const REPLACE_BATCH = 200;
/** …and at most this many characters (removed plus written)… */
export const REPLACE_CHARS = 20_000;
/** …then counts up to this many more as left for the next press. */
export const COUNT_LEFT = 2_000;

/** Code blocks shown drawn (a diagram, a formula) rather than as their text. */
const DRAWN_CODE = new Set(['mermaid', 'math', 'latex']);

const ASCII = /^[\x00-\x7f]*$/;

/** Lowercases each character whose lowercase is as long, so offsets in the folded text are offsets in the text. */
export function foldCase(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase();
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

interface Stretch {
  text: string;
  /** Offset of the stretch in the block's content. */
  start: number;
}

interface BlockText {
  stretches: Stretch[];
  /** The block's chips and their offsets: their words can change while the node stays the same, so they are read each time. */
  atoms: Array<{ node: PMNode; offset: number }>;
  folded: string[] | null;
}

/** Each text block's runs of text, kept per node: an edit makes new nodes only where it changed. */
const textOf = new WeakMap<PMNode, BlockText>();

function blockText(block: PMNode): BlockText {
  const known = textOf.get(block);
  if (known) return known;
  const stretches: Stretch[] = [];
  const atoms: BlockText['atoms'] = [];
  let text = '';
  let start = -1;
  block.forEach((child, offset) => {
    if (child.isText) {
      if (start < 0) start = offset;
      text += child.text ?? '';
    } else {
      if (child.isAtom && child.isInline) atoms.push({ node: child, offset });
      if (start >= 0) stretches.push({ text, start });
      text = '';
      start = -1;
    }
  });
  if (start >= 0) stretches.push({ text, start });
  const made = { stretches, atoms, folded: null };
  textOf.set(block, made);
  return made;
}

const isDrawnCode = (node: PMNode) => node.type === schema.nodes.codeBlock && DRAWN_CODE.has(String(node.attrs.language ?? '').toLowerCase());

/** Every match of `query` in `doc`, in reading order, without overlaps; chips too when `chipWords` reads them. */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean, chipWords?: ChipWords): FindMatch[] {
  if (!query || query.length > MAX_QUERY) return [];
  const needle = caseSensitive ? query : foldCase(query);
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (isDrawnCode(node)) return false;
    if (!node.isTextblock) return true;
    const text = blockText(node);
    if (!caseSensitive && !text.folded) text.folded = text.stretches.map(stretch => foldCase(stretch.text));
    const inBlock: FindMatch[] = [];
    text.stretches.forEach((stretch, index) => {
      if (stretch.text.length < needle.length) return;
      const hay = caseSensitive ? stretch.text : text.folded![index]!;
      const base = pos + 1 + stretch.start;
      for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) inBlock.push({ from: base + at, to: base + at + needle.length });
    });
    if (chipWords && text.atoms.length) {
      const before = inBlock.length;
      for (const { node: atom, offset } of text.atoms) {
        const words = chipWords(atom);
        if (words && (caseSensitive ? words : foldCase(words)).includes(needle)) inBlock.push({ from: pos + 1 + offset, to: pos + 1 + offset + atom.nodeSize, chip: true });
      }
      if (inBlock.length > before && before > 0) inBlock.sort((a, b) => a.from - b.from);
    }
    for (const match of inBlock) matches.push(match);
    return false;
  });
  return matches;
}

/** The first match at or after `pos`, wrapping to the first; -1 when there are none. */
export function matchAtOrAfter(matches: readonly FindMatch[], pos: number): number {
  if (!matches.length) return -1;
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (matches[mid]!.from < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}

/** A match that is part of an open suggestion or an unwritten section: it is left as it is until that is decided. */
export function isFrozen(doc: PMNode, match: FindMatch): boolean {
  const { suggestIns, suggestDel } = schema.marks;
  if (doc.rangeHasMark(match.from, match.to, suggestIns!) || doc.rangeHasMark(match.from, match.to, suggestDel!)) return true;
  const $from = doc.resolve(match.from);
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.attrs.suggestId != null || node.type === schema.nodes.pending) return true;
  }
  return false;
}

/** The marks the replacement takes: the match's first character's, less a mark that ends there and would not grow. */
function replacementMarks(doc: PMNode, match: FindMatch): readonly Mark[] {
  const $from = doc.resolve(match.from);
  const first = $from.nodeAfter?.marks ?? [];
  const across = $from.marksAcross(doc.resolve(match.to)) ?? [];
  return first.filter(mark => mark.type.spec.inclusive !== false || mark.type === schema.marks.link || across.some(other => other.eq(mark)));
}

/** Where `query` occurs in `text` (at most 16 places), for telling a match that is inside a replacement just made. */
function placesIn(text: string, query: string, caseSensitive: boolean): number[] {
  const hay = caseSensitive ? text : foldCase(text);
  const needle = caseSensitive ? query : foldCase(query);
  const out: number[] = [];
  for (let at = hay.indexOf(needle); at >= 0 && out.length < 16; at = hay.indexOf(needle, at + 1)) out.push(at);
  return out;
}

/** The match lies inside a copy of `text` written by the last replace all, which a second press would grow again. */
function insideReplacement(doc: PMNode, match: FindMatch, text: string, places: readonly number[]): boolean {
  const $from = doc.resolve(match.from);
  const start = $from.start();
  const end = $from.end();
  for (const place of places) {
    const from = match.from - place;
    const to = from + text.length;
    if (from >= start && to <= end && doc.textBetween(from, to, '￼', '￼') === text) return true;
  }
  return false;
}

export interface ReplacePlan {
  /** The matches to write, in order. */
  targets: FindMatch[];
  /** Matches skipped because they cannot be replaced yet. */
  frozen: number;
  /** Matches that are chips, which are changed in the doc, not here. */
  chips: number;
  /** Matches that already read as the replacement. */
  already: number;
  /** Matches left for the next press of Replace all. */
  left: number;
  /** There were more than {@link COUNT_LEFT} left: the count stopped. */
  more: boolean;
}

export interface ReplaceRequest {
  query: string;
  caseSensitive: boolean;
  text: string;
  all: boolean;
  /** Replace all pressed again with the same replacement: matches inside what it wrote are already done. */
  again?: boolean;
}

/** Which of `matches` a press of Replace (the current one) or Replace all writes. */
export function planReplace(doc: PMNode, matches: readonly FindMatch[], current: number, request: ReplaceRequest): ReplacePlan {
  const chosen = request.all ? matches : current >= 0 && matches[current] ? [matches[current]] : [];
  const places = request.all && request.again ? placesIn(request.text, request.query, request.caseSensitive) : null;
  const plan: ReplacePlan = { targets: [], frozen: 0, chips: 0, already: 0, left: 0, more: false };
  let chars = 0;
  let over = 0;
  for (const match of chosen) {
    const full = request.all && (plan.targets.length >= REPLACE_BATCH || chars >= REPLACE_CHARS);
    if (full && ++over > COUNT_LEFT) {
      plan.more = true;
      break;
    }
    if (match.chip) plan.chips++;
    else if (isFrozen(doc, match)) plan.frozen++;
    else if (places ? insideReplacement(doc, match, request.text, places) : doc.textBetween(match.from, match.to) === request.text) plan.already++;
    else if (full) plan.left++;
    else {
      plan.targets.push(match);
      chars += match.to - match.from + request.text.length;
    }
  }
  return plan;
}

/** Writes `text` over each target (last first, so the earlier positions hold). */
export function writeReplacements(tr: Transaction, targets: readonly FindMatch[], text: string): Transaction {
  for (let index = targets.length - 1; index >= 0; index--) {
    const target = targets[index]!;
    if (!text) tr.delete(target.from, target.to);
    else tr.replaceWith(target.from, target.to, schema.text(text, replacementMarks(tr.doc, target)));
  }
  return tr;
}

/** How a press of Replace or Replace all went. */
export interface ReplaceOutcome {
  /** Raised on every press, so the same words are said again. */
  serial: number;
  all: boolean;
  replaced: number;
  frozen: number;
  chips: number;
  already: number;
  left: number;
  more: boolean;
  /** The edit was refused: nothing changed. */
  refused: boolean;
}

const matchesWord = (n: number) => (n === 1 ? 'match' : 'matches');

/** Why a chip match can't be replaced from the bar. */
export const CHIP_MATCH_WORDS = 'This match is a chip: change it in the doc';
/** Why Replace all is off when every match is a chip. */
export const ONLY_CHIPS_WORDS = 'Only chips match: change them in the doc';

const chipsKept = (n: number) => (n === 1 ? 'left 1 chip as it is' : `left ${n} chips as they are`);

/** What the bar says after a press, or null when the count says enough. */
export function outcomeWords(outcome: ReplaceOutcome | null): string | null {
  if (!outcome) return null;
  const { replaced: n, left, more, frozen, chips, already } = outcome;
  if (outcome.refused) return 'Couldn’t replace that text, so nothing changed';
  if (left > 0) return more ? `Replaced ${n}. More than ${left} left: press Replace all again.` : `Replaced ${n}. ${left} left: press Replace all again.`;
  if (more) return `Replaced ${n}. There may be more: press Replace all again.`;
  if (outcome.all) {
    if (n === 0) {
      if (frozen > 0) return frozen === 1 ? '1 match can’t be replaced yet and was skipped' : `${frozen} matches can’t be replaced yet and were skipped`;
      if (chips > 0) return ONLY_CHIPS_WORDS;
      return already > 0 ? 'Nothing left to replace' : null;
    }
    const kept = [frozen > 0 ? `skipped ${frozen} that can’t be replaced yet` : '', chips > 0 ? chipsKept(chips) : ''].filter(Boolean);
    return [`Replaced ${n} ${matchesWord(n)}`, ...kept].join('; ');
  }
  return n === 0 && already > 0 ? 'Already matches the replacement' : null;
}
