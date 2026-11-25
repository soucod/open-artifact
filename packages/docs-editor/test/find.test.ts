import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { schema } from '../src/editor/schema.ts';
import { findChord, undoChord } from '../src/find/keys.ts';
import { CountCache, MAX_TABS_SEARCHED, type TabCount, type TabToCount, afterOpen, countTabs } from '../src/find/other-tabs.ts';
import { findKey, findPlugin, findState } from '../src/find/plugin.ts';
import { REPLACE_BATCH, findMatches, foldCase, isFrozen, matchAtOrAfter, outcomeWords, planReplace, writeReplacements } from '../src/find/search.ts';

const { nodes, marks } = schema;
const para = (...content: (string | PMNode)[]) => nodes.paragraph!.create(null, content.map(part => (typeof part === 'string' ? schema.text(part) : part)));
const doc = (...blocks: PMNode[]) => nodes.doc!.create(null, blocks);
const texts = (d: PMNode, list: readonly { from: number; to: number }[]) => list.map(m => d.textBetween(m.from, m.to));
const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('finding words', () => {
  it('finds every match in reading order, case folded unless asked', () => {
    const d = doc(para('Cat cat CAT'), para('concat'));
    assert.deepEqual(texts(d, findMatches(d, 'cat', false)), ['Cat', 'cat', 'CAT', 'cat']);
    assert.deepEqual(texts(d, findMatches(d, 'cat', true)), ['cat', 'cat']);
  });

  it('does not overlap matches and does not cross a line break', () => {
    const d = doc(para('aaaa'), para('ab', nodes.hardBreak!.create(), 'cd'));
    assert.equal(findMatches(d, 'aa', false).length, 2);
    assert.equal(findMatches(d, 'bc', false).length, 0);
  });

  it('skips code drawn as a diagram, but searches other code', () => {
    const d = doc(nodes.codeBlock!.create({ language: 'mermaid' }, schema.text('graph cat')), nodes.codeBlock!.create({ language: 'js' }, schema.text('cat()')));
    assert.deepEqual(texts(d, findMatches(d, 'cat', false)), ['cat']);
  });

  it('folds case without moving offsets', () => {
    assert.equal(foldCase('İstanbul ABC').length, 'İstanbul ABC'.length);
    assert.equal(foldCase('ÄBC'), 'äbc');
  });

  it('picks the match at or after a position, wrapping round', () => {
    const matches = [{ from: 2, to: 4 }, { from: 10, to: 12 }];
    assert.equal(matchAtOrAfter(matches, 0), 0);
    assert.equal(matchAtOrAfter(matches, 3), 1);
    assert.equal(matchAtOrAfter(matches, 11), 0);
    assert.equal(matchAtOrAfter([], 5), -1);
  });

  it('leaves text in an open suggestion alone', () => {
    const d = doc(para('a ', schema.text('cat', [marks.suggestIns!.create({ suggestId: 's1' })]), ' cat'));
    const [first, second] = findMatches(d, 'cat', false);
    assert.equal(isFrozen(d, first!), true);
    assert.equal(isFrozen(d, second!), false);
  });
});

describe('replacing', () => {
  it('replaces the shown match, keeping its marks', () => {
    const d = doc(para('one ', schema.text('cat', [marks.bold!.create()]), ' cat'));
    const state = EditorState.create({ schema, doc: d });
    const matches = findMatches(d, 'cat', false);
    const plan = planReplace(d, matches, 0, { query: 'cat', caseSensitive: false, text: 'dog', all: false });
    assert.equal(plan.targets.length, 1);
    const next = state.apply(writeReplacements(state.tr, plan.targets, 'dog'));
    assert.equal(next.doc.textContent, 'one dog cat');
    const dog = next.doc.firstChild!.child(1);
    assert.equal(dog.text, 'dog');
    assert.ok(dog.marks.some(mark => mark.type === marks.bold));
  });

  it('replaces all in one transaction, and an empty replacement deletes', () => {
    const d = doc(para('a-b-c'));
    const state = EditorState.create({ schema, doc: d });
    const plan = planReplace(d, findMatches(d, '-', false), 0, { query: '-', caseSensitive: false, text: '', all: true });
    const next = state.apply(writeReplacements(state.tr, plan.targets, ''));
    assert.equal(next.doc.textContent, 'abc');
  });

  it('counts matches that already read as the replacement, and frozen ones', () => {
    const d = doc(para('Cat cat ', schema.text('cat', [marks.suggestIns!.create({ suggestId: 's' })])));
    const plan = planReplace(d, findMatches(d, 'cat', false), 0, { query: 'cat', caseSensitive: false, text: 'cat', all: true });
    assert.deepEqual({ targets: plan.targets.length, already: plan.already, frozen: plan.frozen }, { targets: 1, already: 1, frozen: 1 });
  });

  it('writes a batch per press and counts the rest as left', () => {
    const d = doc(para('x '.repeat(REPLACE_BATCH + 5)));
    const plan = planReplace(d, findMatches(d, 'x', false), 0, { query: 'x', caseSensitive: false, text: 'y', all: true });
    assert.equal(plan.targets.length, REPLACE_BATCH);
    assert.equal(plan.left, 5);
    assert.equal(outcomeWords({ serial: 1, all: true, replaced: REPLACE_BATCH, frozen: 0, chips: 0, already: 0, left: 5, more: false, refused: false }), `Replaced ${REPLACE_BATCH}. 5 left: press Replace all again.`);
  });

  it('does not grow a replacement that contains the words on a second press', () => {
    const d = doc(para('cats cat'));
    const plan = planReplace(d, findMatches(d, 'cat', false), 0, { query: 'cat', caseSensitive: false, text: 'cats', all: true, again: true });
    assert.equal(plan.already, 1);
    assert.equal(plan.targets.length, 1);
  });

  it('says how a press went', () => {
    const base = { serial: 1, all: true, replaced: 3, frozen: 0, chips: 0, already: 0, left: 0, more: false, refused: false };
    assert.equal(outcomeWords(base), 'Replaced 3 matches');
    assert.equal(outcomeWords({ ...base, replaced: 0, already: 2 }), 'Nothing left to replace');
    assert.equal(outcomeWords({ ...base, all: false, replaced: 1 }), null);
    assert.equal(outcomeWords(null), null);
  });
});

describe('the find plugin', () => {
  const start = (d: PMNode) => EditorState.create({ schema, doc: d, plugins: [findPlugin()] });

  it('searches near a position, steps, and follows edits', () => {
    let state = start(doc(para('cat dog cat dog cat')));
    state = state.apply(state.tr.setMeta(findKey, { kind: 'search', query: 'cat', caseSensitive: false, near: 6 }));
    assert.equal(findState(state).matches.length, 3);
    assert.equal(findState(state).current, 1);
    assert.equal(findState(state).decorations.find().length, 3);

    state = state.apply(state.tr.setMeta(findKey, { kind: 'show', index: 2 }));
    assert.equal(findState(state).current, 2);

    state = state.apply(state.tr.insertText('cat ', 1));
    assert.equal(findState(state).matches.length, 4);
    assert.equal(state.doc.textBetween(findState(state).matches[findState(state).current]!.from, findState(state).matches[findState(state).current]!.to), 'cat');
    assert.equal(findState(state).current, 3);

    state = state.apply(state.tr.setMeta(findKey, { kind: 'clear' }));
    assert.equal(findState(state).query, '');
    assert.equal(findState(state).decorations.find().length, 0);
  });
});

describe('find keys', () => {
  it('reads ⌘F and ⇧⌘H per platform', () => {
    assert.equal(findChord(press('f', { metaKey: true }), true), 'find');
    assert.equal(findChord(press('H', { metaKey: true, shiftKey: true }), true), 'replace');
    assert.equal(findChord(press('f', { ctrlKey: true }), true), null);
    assert.equal(findChord(press('f', { ctrlKey: true }), false), 'find');
    assert.equal(findChord(press('f', { metaKey: true, altKey: true }), true), null);
  });

  it('reads undo and redo, Ctrl+Y off Apple platforms', () => {
    assert.equal(undoChord(press('z', { metaKey: true }), true), 'undo');
    assert.equal(undoChord(press('z', { metaKey: true, shiftKey: true }), true), 'redo');
    assert.equal(undoChord(press('y', { ctrlKey: true }), false), 'redo');
    assert.equal(undoChord(press('y', { metaKey: true }), true), null);
  });
});

describe('counting the other tabs', () => {
  const tab = (id: string, rev = 1): TabToCount => ({ id, node: `n-${id}`, rev });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it('starts after the open tab and wraps round', () => {
    assert.deepEqual(afterOpen([tab('a'), tab('b'), tab('c')], 'b').map(t => t.id), ['c', 'a']);
    assert.deepEqual(afterOpen([tab('a'), tab('b')], null).map(t => t.id), ['a', 'b']);
  });

  it('asks one tab at a time, remembers counts per revision, and stops when told', async () => {
    const cache = new CountCache();
    const asked: string[] = [];
    const seen = new Map<string, TabCount>();
    let ended = false;
    countTabs({
      tabs: [tab('a'), tab('b')],
      query: 'x',
      caseSensitive: false,
      cache,
      count: async t => {
        asked.push(t.id);
        return t.id === 'a' ? 2 : null;
      },
      onCount: (id, count) => seen.set(id, count),
      onEnd: () => {
        ended = true;
      },
    });
    assert.equal(seen.get('a'), 'pending');
    await flush();
    assert.deepEqual(asked, ['a', 'b']);
    assert.equal(seen.get('a'), 2);
    assert.equal(seen.get('b'), 'failed');
    assert.equal(ended, true);
    assert.equal(cache.get(tab('a'), 'x', false), 2);
    assert.equal(cache.get(tab('a', 2), 'x', false), undefined);

    const stopped: string[] = [];
    const stop = countTabs({ tabs: [tab('c'), tab('d')], query: 'x', caseSensitive: false, cache, count: async () => 1, onCount: (id, c) => typeof c === 'number' && stopped.push(id), onEnd: () => undefined });
    stop();
    await flush();
    assert.deepEqual(stopped, []);
  });

  it('skips the tabs past the limit, and marks the rest failed after a failure', async () => {
    const tabs = Array.from({ length: MAX_TABS_SEARCHED + 2 }, (_, i) => tab(`t${i}`));
    const seen = new Map<string, TabCount>();
    countTabs({
      tabs,
      query: 'x',
      caseSensitive: false,
      cache: new CountCache(),
      count: async t => {
        if (t.id === 't1') throw new Error('offline');
        return 0;
      },
      onCount: (id, count) => seen.set(id, count),
      onEnd: () => undefined,
    });
    assert.equal(seen.get(`t${MAX_TABS_SEARCHED}`), 'skipped');
    await flush();
    assert.equal(seen.get('t0'), 0);
    assert.equal(seen.get('t1'), 'failed');
    assert.equal(seen.get('t2'), 'failed');
  });
});
