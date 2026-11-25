/**
 * Folded headings: what follows a folded heading, up to the next heading of its level or above, is hidden. Folds are
 * the viewer's own, kept by the heading's id for the page's life.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { type Command, type EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { schema } from './schema.ts';

export const foldKey = new PluginKey<ReadonlySet<string>>('docFold');

const levelOf = (node: PMNode) => (node.type === schema.nodes.paragraph ? ((node.attrs.heading as number | null) ?? 0) : 0);

export function foldedIds(state: EditorState): ReadonlySet<string> {
  return foldKey.getState(state) ?? new Set();
}

/** The folded heading that hides `pos`, if one does: the outermost, which is the one in sight. */
export function foldHiding(state: EditorState, pos: number): string | null {
  const folded = foldedIds(state);
  if (!folded.size) return null;
  const { doc } = state;
  const index = doc.resolve(pos).index(0);
  let hiding = 0;
  let by: string | null = null;
  for (let at = 0; at <= index && at < doc.childCount; at++) {
    const node = doc.child(at);
    const level = levelOf(node);
    if (hiding && level && level <= hiding) {
      hiding = 0;
      by = null;
    }
    if (hiding) {
      if (at === index) return by;
      continue;
    }
    if (level && node.attrs.bid && folded.has(node.attrs.bid as string)) {
      hiding = level;
      by = node.attrs.bid as string;
    }
  }
  return null;
}

/** Where the heading with id `bid` starts, among the blocks a fold can hide. */
export function headingPos(doc: PMNode, bid: string): number | null {
  let found: number | null = null;
  doc.forEach((node, pos) => {
    if (found === null && levelOf(node) && node.attrs.bid === bid) found = pos;
  });
  return found;
}

function decorations(doc: PMNode, folded: ReadonlySet<string>): DecorationSet {
  const decos: Decoration[] = [];
  let hiding = 0;
  doc.forEach((node, pos) => {
    const level = levelOf(node);
    if (hiding && level && level <= hiding) hiding = 0;
    if (hiding) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'doc-folded-away' }));
      return;
    }
    if (level) {
      const isFolded = !!node.attrs.bid && folded.has(node.attrs.bid);
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: isFolded ? 'doc-heading doc-heading-folded' : 'doc-heading' }));
      if (node.attrs.bid) {
        const label = (isFolded ? 'Expand section, ' : 'Collapse section, ') + node.textContent;
        decos.push(Decoration.widget(pos + 1, view => {
          const button = view.dom.ownerDocument.createElement('button');
          button.type = 'button';
          button.className = 'doc-fold-button';
          button.setAttribute('aria-label', label);
          button.setAttribute('aria-expanded', String(!isFolded));
          button.onmousedown = event => event.preventDefault();
          button.onclick = () => toggleFold(node.attrs.bid)(view.state, view.dispatch);
          return button;
        }, { side: -1, key: node.attrs.bid + ':' + label, stopEvent: () => true, ignoreSelection: true }));
      }
      if (isFolded) hiding = level;
    }
  });
  return DecorationSet.create(doc, decos);
}

export function foldPlugin(): Plugin<ReadonlySet<string>> {
  let cachedDoc: PMNode | undefined;
  let cachedIds: ReadonlySet<string> | undefined;
  let cached = DecorationSet.empty;
  return new Plugin<ReadonlySet<string>>({
    key: foldKey,
    state: {
      init: () => new Set(),
      apply: (tr, value) => {
        const toggle = tr.getMeta(foldKey) as string | undefined;
        if (!toggle) return value;
        const next = new Set(value);
        if (next.has(toggle)) next.delete(toggle);
        else next.add(toggle);
        return next;
      },
    },
    props: {
      decorations(state) {
        const ids = foldedIds(state);
        if (state.doc !== cachedDoc || ids !== cachedIds) {
          cachedDoc = state.doc;
          cachedIds = ids;
          cached = decorations(state.doc, ids);
        }
        return cached;
      },
    },
  });
}

/** Folds or unfolds a heading by its id. */
export const toggleFold =
  (bid: string): Command =>
  (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(foldKey, bid));
    return true;
  };

/** Unfolds every folded heading that hides `pos`, the outer ones first (one per heading level at most). */
export function unfoldTo(view: EditorView, pos: number): boolean {
  let opened = false;
  for (let tries = 0; tries < 6; tries++) {
    const heading = foldHiding(view.state, pos);
    if (!heading) break;
    toggleFold(heading)(view.state, view.dispatch);
    opened = true;
  }
  return opened;
}

/** Folds or unfolds the heading the cursor is in. */
export const toggleFoldHere: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth !== 1) return false;
  const node = $from.parent;
  if (!levelOf(node) || !node.attrs.bid) return false;
  return toggleFold(node.attrs.bid)(state, dispatch);
};
