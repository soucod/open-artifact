/**
 * The find bar's matches in the editor: the query, every match, the one shown and their highlights. The bar sends
 * the query and the steps as transaction metas; an edit searches again and keeps the shown match where it was, and so
 * does a change to what the chips show (an option or a tab renamed), which the bar sends as `relabel`.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { type EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { type ChipWords, type FindMatch, findMatches, matchAtOrAfter } from './search.ts';

export interface FindPluginState {
  query: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  /** The match shown, or -1. */
  current: number;
  decorations: DecorationSet;
}

/** What the bar tells the editor. */
export type FindMeta =
  /** Search for `query`; the shown match is the first at or after `near`. */
  | { kind: 'search'; query: string; caseSensitive: boolean; near: number }
  | { kind: 'show'; index: number }
  /** After a replacement: the shown match is the first at or after `near` in the new doc. */
  | { kind: 'near'; near: number }
  /** The chips' words changed; the text did not. */
  | { kind: 'relabel' }
  | { kind: 'clear' };

export const findKey = new PluginKey<FindPluginState>('docFind');

/** At most this many matches are highlighted, around the shown one. */
export const MAX_HIGHLIGHTS = 2_000;

const EMPTY: FindPluginState = { query: '', caseSensitive: false, matches: [], current: -1, decorations: DecorationSet.empty };

export function findState(state: EditorState | null | undefined): FindPluginState {
  return (state && findKey.getState(state)) ?? EMPTY;
}

function highlights(doc: PMNode, matches: readonly FindMatch[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  let start = 0;
  let end = matches.length;
  if (matches.length > MAX_HIGHLIGHTS) {
    start = Math.max(0, Math.min(Math.max(current, 0) - MAX_HIGHLIGHTS / 2, matches.length - MAX_HIGHLIGHTS));
    end = start + MAX_HIGHLIGHTS;
  }
  const decorations: Decoration[] = [];
  for (let index = start; index < end; index++) {
    const match = matches[index]!;
    const attrs = { class: index === current ? 'doc-find-match doc-find-current' : 'doc-find-match' };
    decorations.push(match.chip ? Decoration.node(match.from, match.to, attrs) : Decoration.inline(match.from, match.to, attrs));
  }
  return DecorationSet.create(doc, decorations);
}

function settle(doc: PMNode, query: string, caseSensitive: boolean, matches: FindMatch[], current: number): FindPluginState {
  return { query, caseSensitive, matches, current, decorations: highlights(doc, matches, current) };
}

function apply(tr: Transaction, value: FindPluginState, state: EditorState, chipWords: ChipWords | undefined): FindPluginState {
  const meta = tr.getMeta(findKey) as FindMeta | undefined;
  if (meta?.kind === 'clear') return EMPTY;
  if (meta?.kind === 'search') {
    const matches = findMatches(state.doc, meta.query, meta.caseSensitive, chipWords);
    return settle(state.doc, meta.query, meta.caseSensitive, matches, matchAtOrAfter(matches, meta.near));
  }
  if (!value.query) return value;
  if (tr.docChanged || meta?.kind === 'near' || meta?.kind === 'relabel') {
    const matches = findMatches(state.doc, value.query, value.caseSensitive, chipWords);
    const was = value.matches[value.current];
    const near = meta?.kind === 'near' ? meta.near : was ? tr.mapping.map(was.from, -1) : 0;
    return settle(state.doc, value.query, value.caseSensitive, matches, matchAtOrAfter(matches, near));
  }
  if (meta?.kind === 'show') {
    const current = meta.index >= 0 && meta.index < value.matches.length ? meta.index : -1;
    return settle(state.doc, value.query, value.caseSensitive, value.matches, current);
  }
  return value;
}

/** `chipWords`: how to read a chip's words, so chips are found too. */
export function findPlugin(chipWords?: ChipWords): Plugin<FindPluginState> {
  return new Plugin<FindPluginState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply: (tr, value, _old, state) => apply(tr, value, state, chipWords),
    },
    props: {
      decorations: state => findKey.getState(state)?.decorations ?? null,
    },
  });
}
