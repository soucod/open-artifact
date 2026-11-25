/** Where suggestions are in the editor's doc: their blocks carry `suggestId`, their words a suggestion mark. */
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

const suggestIdOfNode = (node: PMNode): string | null => (typeof node.attrs.suggestId === 'string' && node.attrs.suggestId ? node.attrs.suggestId : null);

function suggestIdOfMarks(node: PMNode): string | null {
  for (const mark of node.marks) {
    const id = mark.attrs.suggestId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/** Where a suggestion's first part starts in the editor's doc: inside its first block, or at its first words. */
export function firstPosOf(doc: PMNode, id: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isBlock && suggestIdOfNode(node) === id) {
      found = node.isLeaf ? pos : pos + 1;
      return false;
    }
    if (node.isInline && suggestIdOfMarks(node) === id) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/** The suggestion the caret is in: a suggested block around it, or suggested words on either side. */
export function suggestionAt(state: EditorState): string | null {
  const { $from, empty } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const id = suggestIdOfNode($from.node(depth));
    if (id) return id;
  }
  const after = $from.nodeAfter;
  const before = $from.nodeBefore;
  const next = after ? suggestIdOfMarks(after) : null;
  if (next) return next;
  const prior = before ? suggestIdOfMarks(before) : null;
  if (prior) return prior;
  if (!empty) {
    let inside: string | null = null;
    state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
      if (inside) return false;
      inside = suggestIdOfNode(node) ?? (node.isInline ? suggestIdOfMarks(node) : null);
      return !inside;
    });
    return inside;
  }
  return null;
}

/** Every range of a suggestion in the editor's doc: its words, and the blocks it adds or strikes whole. */
export function rangesOf(doc: PMNode, id: string): Array<{ from: number; to: number; block: boolean }> {
  const out: Array<{ from: number; to: number; block: boolean }> = [];
  doc.descendants((node, pos) => {
    if (node.isBlock && suggestIdOfNode(node) === id) {
      out.push({ from: pos, to: pos + node.nodeSize, block: true });
      return false;
    }
    if (node.isInline && suggestIdOfMarks(node) === id) {
      const last = out.at(-1);
      if (last && !last.block && last.to === pos) last.to = pos + node.nodeSize;
      else out.push({ from: pos, to: pos + node.nodeSize, block: false });
    }
    return true;
  });
  return out;
}
