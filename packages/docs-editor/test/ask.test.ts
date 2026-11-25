import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DocState, applyOps } from '@open-artifact/docs-core';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { ASK_STARTERS, agentChip, askOnChip, chipInsertion, chipThread, emptyDocSpot, lineWords, offersAsk } from '../src/ask/ask.ts';
import { askSpotOf, askSpotPlugin } from '../src/ask/spot.ts';
import { idsOfRange, rangeOfIds } from '../src/comments/anchor-map.ts';
import { parseAnchor, serializeAnchor } from '../src/comments/anchor.ts';
import { pmDocOf } from '../src/editor/binding.ts';
import { schema } from '../src/editor/schema.ts';

const { nodes } = schema;
const para = (...content: (string | PMNode)[]) => nodes.paragraph!.create(null, content.map(part => (typeof part === 'string' ? schema.text(part) : part)));
const title = (text: string) => nodes.paragraph!.create({ heading: 1 }, text ? schema.text(text) : null);
const doc = (...blocks: PMNode[]) => nodes.doc!.create(null, blocks);

describe('when the page offers Ask Agent', () => {
  const ready = { agentListening: true, mayComment: true, writable: true, suggesting: false };

  it('offers it with an agent listening, to someone who may comment, in a doc they can write', () => {
    assert.equal(offersAsk(ready), true);
  });

  it('holds it back without an agent', () => {
    assert.equal(offersAsk({ ...ready, agentListening: false }), false);
  });

  it('holds it back in a read-only doc, from someone who may not comment, and in Suggesting mode', () => {
    assert.equal(offersAsk({ ...ready, writable: false }), false);
    assert.equal(offersAsk({ ...ready, mayComment: false }), false);
    assert.equal(offersAsk({ ...ready, suggesting: true }), false);
  });
});

describe('the agent chip in the text', () => {
  it('goes in at the spot alone, the caret after it, outside the undo history', () => {
    const start = doc(para('Hello '));
    const state = EditorState.create({ doc: start });
    const put = chipInsertion(state, agentChip('Agent'), 7)!;
    const after = put.tr.doc.child(0);
    assert.equal(put.at, 7);
    assert.equal(after.childCount, 2);
    assert.equal(after.lastChild!.type, nodes.mention);
    assert.deepEqual({ ...after.lastChild!.attrs }, { principal: 'agent', ref: null, label: null, name: 'Agent', email: null });
    assert.equal(put.tr.selection.from, 8);
    assert.equal(put.tr.getMeta('addToHistory'), false);
  });

  it('gets a line of its own under a lone title', () => {
    const state = EditorState.create({ doc: doc(title('Plan')) });
    const spot = emptyDocSpot(state.doc)!;
    assert.deepEqual(spot, { pos: 6, newLine: true });
    const put = chipInsertion(state, agentChip('Agent'), spot.pos, spot.newLine)!;
    assert.equal(put.tr.doc.childCount, 2);
    assert.equal(put.tr.doc.child(1).firstChild!.type, nodes.mention);
    assert.equal(put.tr.doc.nodeAt(put.at)!.type, nodes.mention);
  });

  it('goes in the empty line under the title, and nowhere once the doc has a body', () => {
    assert.deepEqual(emptyDocSpot(doc(title('Plan'), para())), { pos: 7, newLine: false });
    assert.equal(emptyDocSpot(doc(title('Plan'), para('Words'))), null);
    assert.equal(emptyDocSpot(doc(title('Plan'), para(), para())), null);
  });

  it('stays out of code', () => {
    const state = EditorState.create({ doc: doc(nodes.codeBlock!.create(null, schema.text('x = 1'))) });
    assert.equal(chipInsertion(state, agentChip('Agent'), 2), null);
  });

  it('reads as @name in its line', () => {
    assert.equal(lineWords(para('Intro: ', agentChip('Agent'), ' please')), 'Intro: @Agent please');
  });
});

describe('the comment on the chip', () => {
  const shadow: DocState = {
    rev: 1,
    blocks: [
      {
        id: 's1.1',
        type: 'paragraph',
        inline: [
          { id: 's1.2', ch: 'H' },
          { id: 's1.3', ch: 'i' },
          { id: 's1.4', ch: ' ' },
          { id: 's1.5', atom: 'mention', attrs: { principal: 'agent', name: 'Agent' } },
        ],
      },
    ],
  };
  const pm = pmDocOf(shadow);

  it('hangs on the chip alone: its id is both ends of the range', () => {
    const ids = idsOfRange(pm, shadow, 4, 5);
    assert.deepEqual(ids, ['s1.5', 's1.5']);
    const thread = chipThread({ tab: 't1', chip: ids![0], block: 's1.1', name: 'Agent', line: lineWords(pm.child(0)) });
    assert.deepEqual(thread.anchor, { kind: 'words', tab: 't1', range: ['s1.5', 's1.5'], places: [] });
    assert.deepEqual(parseAnchor(serializeAnchor(thread.anchor)), thread.anchor);
    assert.equal(thread.label, '@Agent');
    assert.equal(thread.detail, 'On “@Agent” in: Hi @Agent');
    assert.deepEqual(thread.location, { tab: 't1', block: 's1.1' });
    assert.deepEqual(rangeOfIds(pm, shadow, ['s1.5', 's1.5']), { from: 4, to: 5 });
  });

  it('says only the chip when it is alone on its line', () => {
    assert.equal(chipThread({ tab: 't1', chip: 'c', block: 'b', name: 'Agent', line: '@Agent' }).detail, 'On “@Agent”');
  });

  it('loses its place once the chip is taken out', () => {
    const after = applyOps(shadow, [{ op: 'delete', target: { kind: 'chars', range: ['s1.5', 's1.5'] } }], { sess: 's2', next: 1 }).doc;
    assert.equal(after.blocks[0]!.inline!.length, 3);
    assert.equal(rangeOfIds(pmDocOf(after), after, ['s1.5', 's1.5']), null);
  });
});

describe('sending an ask', () => {
  const run = (posted: boolean | null) => {
    const steps: string[] = [];
    const outcome = askOnChip<string>({
      put: () => {
        steps.push('put');
        return posted === null ? null : 'chip';
      },
      post: async chip => {
        steps.push(`post ${chip}`);
        return posted === true;
      },
      take: chip => {
        steps.push(`take ${chip}`);
      },
    });
    return outcome.then(result => ({ result, steps }));
  };

  it('puts the chip in, then posts the comment on it', async () => {
    assert.deepEqual(await run(true), { result: 'sent', steps: ['put', 'post chip'] });
  });

  it('takes the chip out when the comment is refused', async () => {
    assert.deepEqual(await run(false), { result: 'refused', steps: ['put', 'post chip', 'take chip'] });
  });

  it('posts nothing where no chip can go', async () => {
    assert.deepEqual(await run(null), { result: 'no_place', steps: ['put'] });
  });
});

describe('the prompt from the @ menu', () => {
  const opened = () => {
    const start = doc(para('Hello world'));
    const state = EditorState.create({ doc: start, plugins: [askSpotPlugin()], selection: TextSelection.create(start, 7) });
    return state.apply(state.tr.setMeta(state.plugins[0]!, { pos: 7 }));
  };

  it('follows its spot through edits before it', () => {
    const state = opened();
    assert.equal(askSpotOf(state), 7);
    assert.equal(askSpotOf(state.apply(state.tr.insertText('Oh, ', 1))), 11);
  });

  it('leaves the text as it was when closed: no chip goes in before Enter', () => {
    const state = opened();
    const closed = state.apply(state.tr.setMeta(state.plugins[0]!, { pos: null }));
    assert.equal(askSpotOf(closed), null);
    assert.ok(closed.doc.eq(doc(para('Hello world'))));
  });
});

describe('the empty doc box', () => {
  it('offers a few ways to start, each filling the box with words to finish', () => {
    assert.ok(ASK_STARTERS.length >= 3);
    for (const starter of ASK_STARTERS) {
      assert.ok(starter.label.length > 0);
      assert.match(starter.text, / $/);
    }
    assert.equal(new Set(ASK_STARTERS.map(starter => starter.label)).size, ASK_STARTERS.length);
  });
});
