import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { type BoundView, TabBinding } from '../src/editor/binding.ts';
import { setLink } from '../src/editor/commands.ts';
import { schema } from '../src/editor/schema.ts';
import { boxText, planLinkCommit } from '../src/selbar/link-commit.ts';
import { type TextRange, linkRangeKey, watchPlugin } from '../src/selbar/watch.ts';
import { type DocServer, type Page, startDocServer } from './harness.ts';

interface Editor {
  page: Page;
  view: BoundView;
  run(edit: (state: EditorState) => Transaction): void;
}

/** Where `words` stand in the doc. */
function wordsAt(doc: PMNode, words: string): TextRange {
  let found: TextRange | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const at = node.text!.indexOf(words);
    if (at >= 0) found = { from: pos + at, to: pos + at + words.length };
    return false;
  });
  assert.ok(found, `no "${words}"`);
  return found;
}

const linkedText = (doc: PMNode, href: string) => {
  let text = '';
  doc.descendants(node => {
    if (node.isText && node.marks.some(mark => mark.type === schema.marks.link && mark.attrs.href === href)) text += node.text;
  });
  return text;
};

describe('saving the link box after the text under it changed', () => {
  let doc: DocServer;
  const opened: Page[] = [];

  async function openEditor(label: string): Promise<Editor> {
    let binding: TabBinding | null = null;
    const page = await doc.open(label, { onShadow: shadow => binding?.showShadow(shadow) });
    opened.push(page);
    const bound = new TabBinding(page.sync, { writable: true });
    binding = bound;
    let state = EditorState.create({ doc: bound.doc, plugins: [watchPlugin({ onLinkClick: () => false })] });
    const view: BoundView = {
      composing: false,
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
        bound.afterTransaction(tr);
      },
    };
    bound.attach(view);
    return { page, view, run: edit => view.dispatch(edit(view.state)) };
  }

  /** Opens the box on `words` in `editor`: its range in the editor's state, and what the box shows. */
  function openBox(editor: Editor, words: string) {
    const range = wordsAt(editor.view.state.doc, words);
    editor.run(state => state.tr.setMeta(linkRangeKey, range));
    return { ...boxText(editor.view.state.doc, range), empty: false };
  }

  before(async () => {
    doc = await startDocServer('# Plan\n\nSee the risks here.\n\nAnd the costs there.\n\nDrop this word.');
  });

  after(async () => {
    await Promise.all(opened.map(page => page.stop()));
    await doc.stop();
  });

  it('holds back new text when another page changed the words, and shows the words as they are now', async () => {
    const mine = await openEditor('mine');
    const theirs = await openEditor('theirs');
    const pop = openBox(mine, 'risks');
    assert.deepEqual(pop, { text: 'risks', textFixed: false, empty: false });
    const at = wordsAt(theirs.view.state.doc, 'risks');
    theirs.run(state => state.tr.insertText('risk factors', at.from, at.to));
    await doc.settle(mine.page, theirs.page);
    assert.match(mine.view.state.doc.textContent, /See the risk factors here\./);

    const plan = planLinkCommit(mine.view.state, pop, 'https://example.com/risks', 'Risk list');
    assert.equal(plan.kind, 'changed');
    assert.ok(plan.kind === 'changed');
    assert.equal(plan.text, 'risk factors');
    assert.equal(plan.empty, false);
    assert.match(mine.view.state.doc.textContent, /See the risk factors here\./, 'nothing was written');
  });

  it('sets only the address on the words as they are now when the text field was left alone', async () => {
    const mine = await openEditor('mine');
    const theirs = await openEditor('theirs');
    const pop = openBox(mine, 'costs');
    const at = wordsAt(theirs.view.state.doc, 'costs');
    theirs.run(state => state.tr.insertText('cost overruns', at.from, at.to));
    await doc.settle(mine.page, theirs.page);

    const href = 'https://example.com/costs';
    const plan = planLinkCommit(mine.view.state, pop, href, pop.text);
    assert.equal(plan.kind, 'set');
    assert.ok(plan.kind === 'set');
    assert.equal(plan.text, undefined);
    setLink(href, plan.text, plan.range)(mine.view.state, mine.view.dispatch);
    assert.equal(linkedText(mine.view.state.doc, href), 'cost overruns');
    await doc.settle(mine.page, theirs.page);
    assert.equal(linkedText(theirs.view.state.doc, href), 'cost overruns');
  });

  it('writes nothing back when the words it was opened on were deleted', async () => {
    const mine = await openEditor('mine');
    const theirs = await openEditor('theirs');
    const pop = openBox(mine, 'word');
    const at = wordsAt(theirs.view.state.doc, 'word');
    theirs.run(state => state.tr.delete(at.from, at.to));
    await doc.settle(mine.page, theirs.page);
    assert.match(mine.view.state.doc.textContent, /Drop this \.$/);

    const plan = planLinkCommit(mine.view.state, pop, 'https://example.com', pop.text);
    assert.equal(plan.kind, 'changed');
    assert.ok(plan.kind === 'changed');
    assert.equal(plan.text, '');
    assert.equal(plan.empty, true);
    // Saved again with text typed in, it is a new link with that text.
    const next = planLinkCommit(mine.view.state, { text: plan.text, textFixed: plan.textFixed, empty: plan.empty }, 'https://example.com', 'new words');
    assert.ok(next.kind === 'set');
    assert.equal(next.text, 'new words');
  });

  it('replaces the text the person typed when nothing changed under the box', () => {
    const d = schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create(null, schema.text('Read the guide now'))]);
    let state = EditorState.create({ doc: d, plugins: [watchPlugin({ onLinkClick: () => false })] });
    const range = wordsAt(d, 'guide');
    state = state.apply(state.tr.setMeta(linkRangeKey, range));
    const pop = { ...boxText(state.doc, range), empty: false };
    assert.deepEqual(planLinkCommit(state, pop, 'https://example.com', 'user guide'), { kind: 'set', range, text: 'user guide' });
    assert.deepEqual(planLinkCommit(state, pop, 'https://example.com', '  '), { kind: 'set', range });
    state = state.apply(state.tr.setMeta(linkRangeKey, false));
    assert.deepEqual(planLinkCommit(state, pop, 'https://example.com', 'user guide'), { kind: 'none' });
  });
});
