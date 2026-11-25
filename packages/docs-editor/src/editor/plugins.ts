/** The editor's plugins: history, keys, typing rules, tables, cursors, folds and the empty line's hint. */
import { baseKeymap, chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlockKeepMarks } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { splitListItem } from 'prosemirror-schema-list';
import { type Command, NodeSelection, Plugin, type Transaction } from 'prosemirror-state';
import { columnResizing, goToNextCell, tableEditing } from 'prosemirror-tables';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import {
  exitCodeBlock,
  hardBreak,
  indent,
  outdent,
  setBlockStyle,
  splitCodeBlock,
  toggleBold,
  toggleChecked,
  toggleCode,
  toggleCodeBlock,
  toggleItalic,
  toggleList,
  toggleQuote,
  toggleStrike,
  toggleUnderline,
  bodyToTitle,
  lineBelowPlaceholder,
  titleToBody,
} from './commands.ts';
import { leaveText } from './focus-keys.ts';
import { foldPlugin, toggleFoldHere } from './fold.ts';
import { docInputRules } from './input-rules.ts';
import { schema } from './schema.ts';
import { FitTableView } from '../tables/view.ts';

const { nodes } = schema;

/** What the keys ask of the page around the editor. Each answers whether it took the key. */
export interface EditorActions {
  find(mode: 'find' | 'replace'): boolean;
  link(): boolean;
  openLink(): boolean;
  openReference(): boolean;
  comment(): boolean;
  toggleComments(): boolean;
  shortcuts(): boolean;
  slash(): boolean;
}

const action =
  (run: () => boolean): Command =>
  () =>
    run();

/** A check list's items have a box, other lists' items none, whatever made them. */
export function checkBoxes(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some(tr => tr.docChanged)) return null;
      let tr: Transaction | null = null;
      state.doc.descendants((node, pos) => {
        if (node.type !== nodes.list) return true;
        const check = node.attrs.kind === 'check';
        node.forEach((item, offset) => {
          const want = check ? (item.attrs.checked ?? false) : null;
          if (item.attrs.checked !== want) (tr ??= state.tr).setNodeMarkup(pos + 1 + offset, undefined, { ...item.attrs, checked: want });
        });
        return true;
      });
      return tr;
    },
  });
}

/** A selected placeholder takes no typing: it goes with Backspace, and Enter makes a line below it. */
function placeholderGuard(): Plugin {
  const held = (view: EditorView) => view.state.selection instanceof NodeSelection && view.state.selection.node.type === nodes.pending;
  return new Plugin({
    props: {
      handleTextInput: held,
      handleKeyPress: held,
      handleDOMEvents: {
        beforeinput: (view, event) => {
          if (!held(view) || !event.inputType.startsWith('insert') || event.inputType === 'insertParagraph') return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

function emptyLineHint(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type !== nodes.paragraph || $from.parent.content.size || $from.parent.attrs.heading) return null;
        const doc = state.doc;
        const only = doc.childCount === 1;
        const label = only ? 'Start writing, or type / for more' : text;
        return DecorationSet.create(doc, [Decoration.node($from.before(), $from.after(), { class: 'doc-empty-hint', 'data-hint': label })]);
      },
    },
  });
}

export function docPlugins(actions: EditorActions, options: { writable: boolean }): Plugin[] {
  const enter = chainCommands(lineBelowPlaceholder, newlineInCode, splitListItem(nodes.listItem!), createParagraphNear, liftEmptyBlock, splitBlockKeepMarks);
  const keys: Record<string, Command> = {
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    'Mod-b': toggleBold,
    'Mod-i': toggleItalic,
    'Mod-u': toggleUnderline,
    'Mod-Shift-s': toggleStrike,
    'Mod-Shift-x': toggleStrike,
    'Mod-e': toggleCode,
    'Mod-k': action(actions.link),
    'Alt-Enter': chainCommands(action(actions.openReference), action(actions.openLink)),
    'Mod-Alt-0': setBlockStyle('paragraph'),
    'Mod-Alt-1': setBlockStyle('h1'),
    'Mod-Alt-2': setBlockStyle('h2'),
    'Mod-Alt-3': setBlockStyle('h3'),
    'Mod-Alt-4': setBlockStyle('h4'),
    'Mod-Alt-5': setBlockStyle('h5'),
    'Mod-Alt-6': setBlockStyle('h6'),
    'Mod-Alt-Enter': toggleFoldHere,
    'Mod-Shift-7': toggleList('ordered'),
    'Mod-Shift-8': toggleList('bullet'),
    'Mod-Shift-9': toggleList('check'),
    'Mod-Enter': chainCommands(toggleChecked, exitCodeBlock),
    'Mod-Shift-b': toggleQuote,
    'Mod-Alt-c': toggleCodeBlock,
    'Mod-Shift-Enter': splitCodeBlock,
    'Shift-Enter': hardBreak,
    Enter: enter,
    Tab: chainCommands(titleToBody, goToNextCell(1), indent, () => true),
    'Shift-Tab': chainCommands(bodyToTitle, goToNextCell(-1), outdent, () => true),
    'Mod-]': indent,
    'Mod-[': outdent,
    'Mod-f': action(() => actions.find('find')),
    'Mod-Shift-h': action(() => actions.find('replace')),
    'Mod-/': action(actions.shortcuts),
    'Mod-Alt-m': action(actions.comment),
    'Alt-Shift-c': action(actions.toggleComments),
  };
  const plugins = [
    docInputRules(),
    keymap(keys),
    keymap(baseKeymap),
    keymap({ Escape: (_state, _dispatch, view) => !!view && leaveText(view) }),
    history(),
    dropCursor({ color: 'var(--doc-accent)', width: 2 }),
    gapCursor(),
    foldPlugin(),
    checkBoxes(),
    placeholderGuard(),
  ];
  if (options.writable) {
    plugins.unshift(columnResizing({ cellMinWidth: 48, defaultCellMinWidth: 48, View: FitTableView }));
    plugins.push(emptyLineHint('Type / for more'));
  }
  plugins.push(tableEditing({ allowTableNodeSelection: true }));
  return plugins;
}
