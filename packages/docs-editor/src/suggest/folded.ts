/**
 * Suggestions a folded heading hides: their words can't be seen, so their cards gather at the heading, and looking at
 * one unfolds what hides it.
 */
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { foldedIds, foldHiding, unfoldTo } from '../editor/fold.ts';
import { rangesOf } from './positions.ts';

/** The suggestions under one folded heading, in the order given. */
export interface FoldedGroup {
  /** The id of the folded heading in sight above them. */
  heading: string;
  ids: string[];
}

/** The id a folded heading's gathered suggestions go by beside the text: never a suggestion's. */
export const foldedGroupId = (heading: string): string => `folded:${heading}`;

/**
 * Of `ids`, the suggestions every part of which a fold hides, gathered by the folded heading in sight above the first
 * part. One with a part still in sight is not hidden.
 */
export function foldedSuggestions(state: EditorState, ids: readonly string[]): FoldedGroup[] {
  if (!foldedIds(state).size) return [];
  const groups = new Map<string, FoldedGroup>();
  for (const id of ids) {
    const ranges = rangesOf(state.doc, id);
    if (!ranges.length) continue;
    const headings = ranges.map(range => foldHiding(state, range.from));
    const heading = headings[0];
    if (!heading || headings.some(each => !each)) continue;
    const group = groups.get(heading);
    if (group) group.ids.push(id);
    else groups.set(heading, { heading, ids: [id] });
  }
  return [...groups.values()];
}

/** Whether two groupings gather the same suggestions under the same headings. */
export function sameGroups(a: readonly FoldedGroup[], b: readonly FoldedGroup[]): boolean {
  return a.length === b.length && a.every((group, index) => group.heading === b[index]!.heading && group.ids.join(' ') === b[index]!.ids.join(' '));
}

/** The first of a suggestion's words drawn on the page under `root`: a part a fold hides has no box. */
export function shownWords(root: ParentNode, id: string): Element | null {
  for (const element of root.querySelectorAll(`[data-suggest-id="${id}"]`)) if (element.getClientRects().length) return element;
  return null;
}

/** Unfolds every heading that hides a part of suggestion `id`; whether any did. */
export function unfoldSuggestion(view: EditorView, id: string): boolean {
  let opened = false;
  for (const range of rangesOf(view.state.doc, id)) if (unfoldTo(view, range.from)) opened = true;
  return opened;
}
