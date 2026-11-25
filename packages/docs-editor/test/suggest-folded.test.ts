import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { foldHiding, foldKey, foldPlugin, headingPos } from '../src/editor/fold.ts';
import { schema } from '../src/editor/schema.ts';
import { foldedGroupId, foldedSuggestions, sameGroups } from '../src/suggest/folded.ts';

const heading = (bid: string, level: number, words: string) => schema.nodes.paragraph.create({ bid, heading: level }, schema.text(words));
const para = (bid: string, ...parts: PMNode[]) => schema.nodes.paragraph.create({ bid }, parts);
const plain = (words: string) => schema.text(words);
const added = (words: string, id: string) => schema.text(words, [schema.marks.suggestIns.create({ suggestId: id })]);

/**
 * # Notes / one (sg1)
 * ## Plan / two (sg2) / three (sg3)
 * ### Steps / four (sg4)
 * ## Later / five (sg5 here) and six (sg5 there)
 */
const doc = schema.nodes.doc.create(null, [
  heading('h-notes', 1, 'Notes'),
  para('p1', plain('one '), added('new', 'sg1')),
  heading('h-plan', 2, 'Plan'),
  para('p2', plain('two '), added('new', 'sg2')),
  para('p3', plain('three '), added('new', 'sg3')),
  heading('h-steps', 3, 'Steps'),
  para('p4', plain('four '), added('new', 'sg4')),
  heading('h-later', 2, 'Later'),
  para('p5', plain('five '), added('new', 'sg5')),
  heading('h-end', 1, 'End'),
  para('p6', plain('six '), added('new', 'sg5')),
]);

function folded(...bids: string[]): EditorState {
  let state = EditorState.create({ doc, plugins: [foldPlugin()] });
  for (const bid of bids) state = state.apply(state.tr.setMeta(foldKey, bid));
  return state;
}

const ALL = ['sg1', 'sg2', 'sg3', 'sg4', 'sg5'];
const posOf = (bid: string) => headingPos(doc, bid)!;

describe('folded headings', () => {
  it('finds a heading by its id, and nothing for a block that is not one', () => {
    assert.equal(doc.nodeAt(posOf('h-plan'))?.textContent, 'Plan');
    assert.equal(headingPos(doc, 'p2'), null);
    assert.equal(headingPos(doc, 'nope'), null);
  });

  it('names the folded heading in sight above a hidden place, and none for one in sight', () => {
    const state = folded('h-plan');
    assert.equal(foldHiding(state, posOf('h-steps') + 2), 'h-plan');
    assert.equal(foldHiding(state, posOf('h-plan') + 1), null);
    assert.equal(foldHiding(state, posOf('h-later') + 1), null);
  });

  it('names the outer of two folded headings', () => {
    assert.equal(foldHiding(folded('h-steps', 'h-plan'), posOf('h-steps') + 8), 'h-plan');
    assert.equal(foldHiding(folded('h-steps'), posOf('h-steps') + 8), 'h-steps');
  });
});

describe('suggestions a folded heading hides', () => {
  it('is none while nothing is folded', () => {
    assert.deepEqual(foldedSuggestions(folded(), ALL), []);
  });

  it('gathers the hidden suggestions under the heading in sight, in the order given', () => {
    assert.deepEqual(foldedSuggestions(folded('h-plan'), ALL), [{ heading: 'h-plan', ids: ['sg2', 'sg3', 'sg4'] }]);
    assert.deepEqual(foldedSuggestions(folded('h-plan'), ['sg4', 'sg2']), [{ heading: 'h-plan', ids: ['sg4', 'sg2'] }]);
  });

  it('keeps each folded heading its own group', () => {
    assert.deepEqual(foldedSuggestions(folded('h-plan', 'h-later', 'h-end'), ALL), [
      { heading: 'h-plan', ids: ['sg2', 'sg3', 'sg4'] },
      { heading: 'h-later', ids: ['sg5'] },
    ]);
  });

  it('gathers under the outer of two folded headings', () => {
    assert.deepEqual(foldedSuggestions(folded('h-steps', 'h-plan'), ALL), [{ heading: 'h-plan', ids: ['sg2', 'sg3', 'sg4'] }]);
    assert.deepEqual(foldedSuggestions(folded('h-notes', 'h-later'), ['sg1', 'sg4']), [{ heading: 'h-notes', ids: ['sg1', 'sg4'] }]);
  });

  it('leaves out one with a part still in sight, until every part is hidden', () => {
    assert.deepEqual(foldedSuggestions(folded('h-later'), ALL), []);
    assert.deepEqual(foldedSuggestions(folded('h-later', 'h-end'), ALL), [{ heading: 'h-later', ids: ['sg5'] }]);
  });

  it('passes over an id with no words in the page', () => {
    assert.deepEqual(foldedSuggestions(folded('h-plan'), ['gone', 'sg2']), [{ heading: 'h-plan', ids: ['sg2'] }]);
  });

  it('goes by an id no suggestion has', () => {
    assert.equal(foldedGroupId('h-plan'), 'folded:h-plan');
    assert.ok(!ALL.includes(foldedGroupId('sg1')));
  });

  it('tells the same grouping from a changed one', () => {
    const one = [{ heading: 'h-plan', ids: ['sg2', 'sg3'] }];
    assert.ok(sameGroups(one, [{ heading: 'h-plan', ids: ['sg2', 'sg3'] }]));
    assert.ok(!sameGroups(one, [{ heading: 'h-plan', ids: ['sg2'] }]));
    assert.ok(!sameGroups(one, [{ heading: 'h-later', ids: ['sg2', 'sg3'] }]));
    assert.ok(!sameGroups(one, []));
  });
});
