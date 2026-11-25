/**
 * The suggestions in the text: the looked-at one outlined, a suggested line break or empty block given a sign. It also
 * follows the caret and the pointer into suggestions, and lets the undo keys take back a decision made right before.
 */
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { type EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { getDocs, setDocs } from '../app/store.ts';
import { isSyncedTransaction } from '../editor/binding.ts';
import { schema } from '../editor/schema.ts';
import { refreshOpenSuggestions } from './model.ts';
import { rangesOf, suggestionAt } from './positions.ts';
import { getSuggest, setSuggest } from './store.ts';

/** What the page tells the plugin to draw. */
export interface SuggestUi {
  highlight: string | null;
}

interface SuggestPluginState extends SuggestUi {
  /** Bumped by each edit of the person's own (not a change the sync shows): the undo keys then undo text again. */
  editSerial: number;
  /** Bumped when the person moves the selection. */
  selectSerial: number;
  signs: DecorationSet;
  marks: DecorationSet;
}

export const suggestKey = new PluginKey<SuggestPluginState>('docSuggest');

const SIGN_LINE = '↵';
const SIGN_BLOCK = '¶';

function sign(text: string, op: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `doc-suggest-sign doc-suggest-sign-${op}`;
  span.setAttribute('aria-hidden', 'true');
  span.textContent = text;
  return span;
}

const markedOp = (node: PMNode): string | null => {
  for (const mark of node.marks) {
    if (mark.type === schema.marks.suggestIns) return 'ins';
    if (mark.type === schema.marks.suggestDel) return 'del';
  }
  return null;
};

/** A sign after each suggested line break, and inside each empty block a suggestion adds or strikes. */
function signsOf(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.hardBreak) {
      const op = markedOp(node);
      if (op) decorations.push(Decoration.widget(pos, () => sign(SIGN_LINE, op), { side: -1, ignoreSelection: true, key: `line-${op}` }));
      return false;
    }
    if (node.isTextblock && node.content.size === 0 && typeof node.attrs.suggestId === 'string' && node.attrs.suggestId) {
      const op = node.attrs.suggestOp === 'del' ? 'del' : 'ins';
      decorations.push(Decoration.widget(pos + 1, () => sign(SIGN_BLOCK, op), { side: 1, ignoreSelection: true, key: `block-${op}` }));
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

function marksOf(doc: PMNode, ui: SuggestUi): DecorationSet {
  const decorations: Decoration[] = [];
  if (ui.highlight)
    for (const range of rangesOf(doc, ui.highlight))
      decorations.push(
        range.block ? Decoration.node(range.from, range.to, { class: 'doc-suggest-focused' }) : Decoration.inline(range.from, range.to, { class: 'doc-suggest-focused' }),
      );
  return DecorationSet.create(doc, decorations);
}

function apply(tr: Transaction, value: SuggestPluginState, _before: EditorState, state: EditorState): SuggestPluginState {
  const synced = isSyncedTransaction(tr);
  const meta = tr.getMeta(suggestKey) as Partial<SuggestUi> | undefined;
  let next = value;
  if (tr.docChanged) next = { ...value, signs: signsOf(state.doc), editSerial: synced ? value.editSerial : value.editSerial + 1 };
  if (tr.selectionSet && !synced) next = { ...next, selectSerial: next.selectSerial + 1 };
  if (meta && 'highlight' in meta && meta.highlight !== next.highlight) next = { ...next, ...meta };
  if (next !== value && (tr.docChanged || meta)) next = { ...next, marks: marksOf(state.doc, next) };
  return next;
}

/** The person's edits counted so far in the editor's state: a decision remembers it, the undo keys compare. */
export const editSerialOf = (state: EditorState): number => suggestKey.getState(state)?.editSerial ?? 0;

/** Tells the editor what to draw; only dispatches when something changed. */
export function showUi(view: EditorView, ui: Partial<SuggestUi>): void {
  const current = suggestKey.getState(view.state);
  if (!current) return;
  if ('highlight' in ui && ui.highlight !== current.highlight) view.dispatch(view.state.tr.setMeta(suggestKey, ui).setMeta('addToHistory', false));
}

function suggestionUnder(view: EditorView, target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest('[data-suggest-id]');
  if (!element || !view.dom.contains(element)) return null;
  return element.getAttribute('data-suggest-id');
}

/** How long the pointer may be off a suggestion's words (on its way to the card) before they count as left. */
const LEAVE_MS = 250;
let leaving = 0;

function pointAt(id: string | null): void {
  window.clearTimeout(leaving);
  if (id) {
    if (getSuggest().hoveredText !== id) setSuggest({ hoveredText: id });
    return;
  }
  if (getSuggest().hoveredText === null) return;
  leaving = window.setTimeout(() => setSuggest({ hoveredText: null }), LEAVE_MS);
}

export interface SuggestPluginOptions {
  /** The undo keys right after a decision: takes it back and answers true, or answers false to undo text. */
  undoDecision(state: EditorState): boolean;
}

export function suggestPlugins(options: SuggestPluginOptions): Plugin[] {
  const ui = new Plugin<SuggestPluginState>({
    key: suggestKey,
    state: {
      init: (_config, state) => ({ highlight: null, editSerial: 0, selectSerial: 0, signs: signsOf(state.doc), marks: DecorationSet.empty }),
      apply,
    },
    props: {
      decorations(state) {
        const value = suggestKey.getState(state);
        if (!value) return null;
        return value.marks === DecorationSet.empty ? value.signs : value.signs.add(state.doc, value.marks.find());
      },
      handleDOMEvents: {
        mouseover(view, event) {
          pointAt(suggestionUnder(view, event.target));
          return false;
        },
        mouseleave() {
          pointAt(null);
          return false;
        },
      },
    },
    view() {
      return {
        update(view, before) {
          const now = suggestKey.getState(view.state);
          const prior = suggestKey.getState(before);
          if (view.state.doc !== before.doc) refreshOpenSuggestions();
          if (now && prior && now.selectSerial !== prior.selectSerial) {
            const id = suggestionAt(view.state);
            if (id !== getDocs().focusedSuggestion && (id || view.hasFocus())) setDocs({ focusedSuggestion: id });
          }
        },
      };
    },
  });
  return [keymap({ 'Mod-z': state => options.undoDecision(state) }), ui];
}
