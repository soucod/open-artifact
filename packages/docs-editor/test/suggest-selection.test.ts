import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DocState, applyOps } from '@open-artifact/docs-core';
import type { Node as PMNode } from 'prosemirror-model';
import { pmDocOf } from '../src/editor/binding.ts';
import { firstPosOf, rangesOf } from '../src/suggest/positions.ts';

const session = { sess: 's1', next: 1 };
const info = { by: 'agent', at: '2026-11-18T00:00:00Z', via: 'agent' };

function docOf(markdown: string): DocState {
  const doc: DocState = { rev: 0, blocks: [{ id: 's0.0', type: 'paragraph', inline: [] }] };
  return applyOps(doc, [{ op: 'replace', target: { kind: 'blocks', ids: ['s0.0'] }, with: { as: 'markdown', from: { kind: 'inline', content: markdown } } }], session).doc;
}

/** The editor positions of `words`, the first time they appear. */
function rangeOf(pm: PMNode, words: string): { from: number; to: number } {
  let out: { from: number; to: number } | null = null;
  pm.descendants((node, pos) => {
    if (out || !node.isText) return !out;
    const at = node.text!.indexOf(words);
    if (at >= 0) out = { from: pos + at, to: pos + at + words.length };
    return false;
  });
  if (!out) throw new Error(`no ${words}`);
  return out;
}

describe('a suggestion in the editor', () => {
  const base = docOf('The quick fox.');
  const chars = base.blocks[0]!.inline!;
  const doc = applyOps(base, [{ op: 'replace', target: { kind: 'chars', range: [chars[4]!.id, chars[8]!.id] }, with: { as: 'markdown', from: { kind: 'inline', content: 'slow' } } }], session, {
    suggest: { id: 'sg1', info },
  }).doc;
  const pm = pmDocOf(doc);

  it('is found by its words', () => {
    const quick = rangeOf(pm, 'quick');
    assert.equal(firstPosOf(pm, 'sg1'), quick.from);
    assert.deepEqual(rangesOf(pm, 'sg1'), [{ from: quick.from, to: quick.from + 'quickslow'.length, block: false }]);
  });
});
