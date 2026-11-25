/** Asking the agent from the text: an agent chip goes where the person asked, and an `@agent` comment on it carries the ask. */
import type { JsonRecord } from '@open-artifact/runtime';
import type { Node as PMNode } from 'prosemirror-model';
import { type EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { type DocAnchor, anchorLocation, quoteDetail, quoteLabel } from '../comments/anchor.ts';
import { schema } from '../editor/schema.ts';

const { nodes } = schema;

export const ASK_PLACEHOLDER = 'Ask Agent to write or edit here';

export type AskEntry = 'caret' | 'empty';

export interface AskGate {
  agentListening: boolean;
  mayComment: boolean;
  writable: boolean;
  /** In Suggesting mode the chip would become a suggestion. */
  suggesting: boolean;
}

export const offersAsk = (gate: AskGate): boolean => gate.agentListening && gate.mayComment && gate.writable && !gate.suggesting;

export interface AskStarter {
  label: string;
  text: string;
}

export const ASK_STARTERS: readonly AskStarter[] = [
  { label: 'Write a first draft', text: 'Write a first draft of a doc about ' },
  { label: 'Outline the sections', text: 'Outline the sections a doc about this should have: ' },
  { label: 'Follow a doc I know', text: 'Set this doc up the way this kind of doc usually goes: ' },
];

export const agentChip = (name: string): PMNode => nodes.mention!.create({ principal: 'agent', name });

export function emptyDocSpot(doc: PMNode): { pos: number; newLine: boolean } | null {
  const title = doc.firstChild;
  if (!title?.isTextblock) return null;
  if (doc.childCount === 1) return { pos: title.nodeSize, newLine: true };
  const body = doc.child(1);
  if (doc.childCount !== 2 || body.type !== nodes.paragraph || body.content.size > 0) return null;
  return { pos: title.nodeSize + 1, newLine: false };
}

/** Kept out of the undo history: undo would take the chip from under its comment. */
export function chipInsertion(state: EditorState, chip: PMNode, pos: number, newLine = false): { tr: Transaction; at: number } | null {
  if (pos < 0 || pos > state.doc.content.size) return null;
  const tr = state.tr;
  let at = pos;
  if (newLine) {
    const $pos = state.doc.resolve(pos);
    if ($pos.depth !== 0) return null;
    tr.insert(pos, nodes.paragraph!.create(null, chip));
    at = pos + 1;
  } else {
    const $pos = state.doc.resolve(pos);
    if (!$pos.parent.inlineContent || $pos.parent.type === nodes.codeBlock) return null;
    tr.insert(pos, chip);
  }
  tr.setSelection(TextSelection.create(tr.doc, at + chip.nodeSize));
  tr.setMeta('addToHistory', false);
  return { tr, at };
}

export function lineWords(block: PMNode): string {
  return block.textBetween(0, block.content.size, ' ', leaf => (leaf.type === nodes.mention ? `@${leaf.attrs.label ?? leaf.attrs.name ?? ''}` : ' '));
}

export interface ChipThread {
  anchor: DocAnchor;
  label: string;
  detail: string;
  location: JsonRecord;
}

export function chipThread(options: { tab: string; chip: string; block: string | null; name: string; line: string }): ChipThread {
  const anchor: DocAnchor = { kind: 'words', tab: options.tab, range: [options.chip, options.chip], places: [] };
  const words = `@${options.name}`;
  return { anchor, label: quoteLabel(words), detail: quoteDetail(words, options.line), location: anchorLocation(anchor, options.block) };
}

export type AskOutcome = 'sent' | 'refused' | 'no_place';

/** A comment kept to send later counts as posted: its anchor names the chip, so the chip stays for it. */
export async function askOnChip<T>(steps: { put(): T | null; post(placed: T): Promise<boolean>; take(placed: T): void }): Promise<AskOutcome> {
  const placed = steps.put();
  if (placed === null) return 'no_place';
  if (await steps.post(placed)) return 'sent';
  steps.take(placed);
  return 'refused';
}
