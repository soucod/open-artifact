import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { schema } from '../src/editor/schema.ts';
import { CountCache, chipNamesKey } from '../src/find/other-tabs.ts';
import { findKey, findPlugin, findState } from '../src/find/plugin.ts';
import { type ChipWords, ONLY_CHIPS_WORDS, findMatches, matchAtOrAfter, outcomeWords, planReplace, writeReplacements } from '../src/find/search.ts';

const { nodes } = schema;
const para = (...content: (string | PMNode)[]) => nodes.paragraph!.create(null, content.map(part => (typeof part === 'string' ? schema.text(part) : part)));
const doc = (...blocks: PMNode[]) => nodes.doc!.create(null, blocks);
const pick = (index: number | null) => nodes.dropdown!.create({ enum: 'e-phase', index });
const day = () => nodes.date!.create({ ts: '2031-03-04' });

/** Option names the tests rename between searches. */
let phases = ['Harvest', 'Planting'];
const words: ChipWords = node => {
  if (node.type === nodes.dropdown) return typeof node.attrs.index === 'number' ? (phases[node.attrs.index] ?? null) : null;
  if (node.type === nodes.date) return 'Mar 4';
  return null;
};

describe('finding chips', () => {
  it('finds a chip by its words, in reading order among the text matches, as one match', () => {
    phases = ['Harvest harvest', 'Planting'];
    const d = doc(para('harvest time: ', pick(0), ' then harvest'));
    const matches = findMatches(d, 'harvest', false, words);
    assert.deepEqual(matches.map(m => !!m.chip), [false, true, false]);
    assert.ok(matches.every((m, i) => i === 0 || matches[i - 1]!.from < m.from));
    const chip = matches[1]!;
    assert.equal(d.nodeAt(chip.from)?.type, nodes.dropdown);
    assert.equal(chip.to - chip.from, 1);
    assert.equal(matchAtOrAfter(matches, chip.from), 1);
  });

  it('applies match case to a chip’s words', () => {
    phases = ['Harvest', 'Planting'];
    const d = doc(para(pick(0)));
    assert.equal(findMatches(d, 'harvest', true, words).length, 0);
    assert.equal(findMatches(d, 'Harvest', true, words).length, 1);
  });

  it('finds no chip with nothing picked, and none without a way to read chips', () => {
    phases = ['Harvest', 'Planting'];
    const d = doc(para(pick(null), ' ', day()));
    assert.equal(findMatches(d, 'select', false, words).length, 0);
    assert.equal(findMatches(d, 'mar', false).length, 0);
    assert.equal(findMatches(d, 'mar', false, words).length, 1);
  });

  it('reads the chips again on every search, though the doc is the same', () => {
    const d = doc(para(pick(1)));
    phases = ['Harvest', 'Planting'];
    assert.equal(findMatches(d, 'planting', false, words).length, 1);
    phases = ['Harvest', 'Sowing'];
    assert.equal(findMatches(d, 'planting', false, words).length, 0);
    assert.equal(findMatches(d, 'sowing', false, words).length, 1);
  });
});

describe('replacing around chips', () => {
  it('never writes over a chip, even with an empty replacement', () => {
    phases = ['Harvest', 'Planting'];
    const d = doc(para('harvest ', pick(0)));
    const state = EditorState.create({ schema, doc: d });
    const matches = findMatches(d, 'harvest', false, words);
    const plan = planReplace(d, matches, 0, { query: 'harvest', caseSensitive: false, text: '', all: true });
    assert.deepEqual({ targets: plan.targets.length, chips: plan.chips, already: plan.already }, { targets: 1, chips: 1, already: 0 });
    const after = state.apply(writeReplacements(state.tr, plan.targets, '')).doc;
    assert.equal(after.firstChild!.childCount, 2);
    assert.equal(after.firstChild!.lastChild!.type, nodes.dropdown);
  });

  it('leaves the shown chip alone on Replace', () => {
    phases = ['Harvest', 'Planting'];
    const d = doc(para('harvest ', pick(0)));
    const plan = planReplace(d, findMatches(d, 'harvest', false, words), 1, { query: 'harvest', caseSensitive: false, text: 'Reaping', all: false });
    assert.deepEqual({ targets: plan.targets.length, chips: plan.chips }, { targets: 0, chips: 1 });
  });

  it('says what was left when chips matched too', () => {
    const base = { serial: 1, all: true, replaced: 2, frozen: 0, chips: 1, already: 0, left: 0, more: false, refused: false };
    assert.equal(outcomeWords(base), 'Replaced 2 matches; left 1 chip as it is');
    assert.equal(outcomeWords({ ...base, chips: 3, frozen: 1 }), 'Replaced 2 matches; skipped 1 that can’t be replaced yet; left 3 chips as they are');
    assert.equal(outcomeWords({ ...base, replaced: 0 }), ONLY_CHIPS_WORDS);
  });
});

describe('the find plugin and chips', () => {
  it('highlights a whole chip and searches again when the chips are relabelled', () => {
    phases = ['Harvest', 'Planting'];
    let state = EditorState.create({ schema, doc: doc(para('planting ', pick(1))), plugins: [findPlugin(words)] });
    state = state.apply(state.tr.setMeta(findKey, { kind: 'search', query: 'planting', caseSensitive: false, near: 0 }));
    assert.equal(findState(state).matches.length, 2);
    const chip = findState(state).matches[1]!;
    assert.deepEqual(findState(state).decorations.find(chip.from, chip.to).map(d => [d.from, d.to]), [[chip.from, chip.to]]);

    state = state.apply(state.tr.setMeta(findKey, { kind: 'show', index: 1 }));
    phases = ['Harvest', 'Sowing'];
    state = state.apply(state.tr.setMeta(findKey, { kind: 'relabel' }));
    assert.equal(findState(state).matches.length, 1);
    assert.equal(findState(state).current, 0);
  });
});

describe('noticing chips renamed outside the text', () => {
  const project = (option: string, tab: string) => ({ enums: [{ id: 'e-phase', options: [{ name: option }] }], files: [{ id: 't1', name: tab }] });

  it('changes its key when an option or a tab is renamed, and only then', () => {
    const key = chipNamesKey(project('Harvest', 'Notes'));
    assert.equal(chipNamesKey(project('Harvest', 'Notes')), key);
    assert.notEqual(chipNamesKey(project('Sowing', 'Notes')), key);
    assert.notEqual(chipNamesKey(project('Harvest', 'Log')), key);
    assert.equal(chipNamesKey(null), '');
  });

  it('changes its key when a person is named or renamed, whatever order the names come in', () => {
    const doc = project('Harvest', 'Notes');
    const key = chipNamesKey(doc, { 'u-1': 'Rosa', 'u-2': 'Ines' });
    assert.equal(chipNamesKey(doc, { 'u-2': 'Ines', 'u-1': 'Rosa' }), key);
    assert.notEqual(chipNamesKey(doc, { 'u-1': 'Rosa' }), key);
    assert.notEqual(chipNamesKey(doc, { 'u-1': 'Rosa M.', 'u-2': 'Ines' }), key);
    assert.notEqual(chipNamesKey(null, { 'u-1': 'Rosa' }), '');
  });

  it('forgets every count it holds', () => {
    const cache = new CountCache();
    const tab = { id: 'a', node: 'n-a', rev: 3 };
    cache.set(tab, 'x', false, 4);
    cache.clear();
    assert.equal(cache.get(tab, 'x', false), undefined);
  });
});
