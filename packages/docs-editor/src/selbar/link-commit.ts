/** What saving the link box does to the text under it, given what the text is now. */
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { stripInvisible } from './link-url.ts';
import type { LinkPop } from './links.ts';
import { type TextRange, linkRangeKey } from './watch.ts';

/** The atom placeholder `setLink` compares a range's text with. */
export const ATOM_CHAR = '￼';

/** The text the box shows for a range, and whether it can be changed there (not across blocks or chips). */
export function boxText(doc: PMNode, range: TextRange): { text: string; textFixed: boolean } {
  const plain = doc.textBetween(range.from, range.to, '', ATOM_CHAR);
  const textFixed = !doc.resolve(range.from).sameParent(doc.resolve(range.to)) || plain.includes(ATOM_CHAR);
  return textFixed ? { text: stripInvisible(doc.textBetween(range.from, range.to, ' ', '')), textFixed } : { text: plain, textFixed };
}

export type LinkCommit =
  /** Link the range; `text`, when given, replaces what it says. */
  | { kind: 'set'; range: TextRange; text?: string }
  /** The text under the box changed while the person was editing it: nothing is saved, the box shows the text now. */
  | { kind: 'changed'; text: string; textFixed: boolean; empty: boolean }
  /** The box has no range any more. */
  | { kind: 'none' };

/**
 * How a save goes. Someone else's edit to the linked words while the box is open is never written over: when the
 * person changed the Text field too, or the words they opened it on are gone, nothing is saved; an address alone is
 * set on the words as they are now.
 */
export function planLinkCommit(state: EditorState, pop: Pick<LinkPop, 'text' | 'textFixed' | 'empty'>, href: string, typed: string): LinkCommit {
  const range = linkRangeKey.getState(state);
  if (!range) return { kind: 'none' };
  const now = boxText(state.doc, range);
  const empty = range.from === range.to;
  const wanted = typed.trim();
  const retyped = !pop.textFixed && wanted !== '' && wanted !== pop.text.trim();
  const moved = now.text !== pop.text || now.textFixed !== pop.textFixed;
  if (moved && (retyped || (empty && !pop.empty))) return { kind: 'changed', ...now, empty };
  if (empty) return { kind: 'set', range, text: wanted || href };
  return retyped ? { kind: 'set', range, text: wanted } : { kind: 'set', range };
}
