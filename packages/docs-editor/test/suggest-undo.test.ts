import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { type DiskDoc, isAtom, proposalIds, suggestionAsOf } from '@open-artifact/docs-core';
import type { DocTabResponse } from '@open-artifact/runtime/doc-api';
import { describeSuggestion, sentenceText } from '../src/suggest/summary.ts';
import { type DocServer, startDocServer, texts } from './harness.ts';

describe('deciding a suggestion and taking the decision back', () => {
  let doc: DocServer;

  before(async () => {
    doc = await startDocServer('# Notes\n\nThe quick fox.');
  });

  after(() => doc.stop());

  it('accepts, then an undecide reopens it once the tab is read again', async () => {
    const page = await doc.open('page');
    const quick = page.sync.shadow.blocks[1]!.inline!.filter(item => !isAtom(item));
    const from = quick[4]!.id;
    const to = quick[8]!.id;
    const wrote = await doc.action('update', {
      call: {
        ref: { object: 'node', id: doc.tab },
        payload: { suggest: true, ops: [{ op: 'replace', target: { kind: 'chars', range: [from, to] }, with: { as: 'markdown', from: { kind: 'inline', content: 'slow' } } }] },
      },
    });
    assert.equal(wrote.ok, true, JSON.stringify(wrote));
    await doc.settle(page);
    const [suggestId] = proposalIds(page.sync.shadow.blocks);
    assert.ok(suggestId);
    assert.equal(page.sync.shadow.suggestions?.[suggestId]?.via, 'agent');
    assert.equal(sentenceText(describeSuggestion(page.sync.shadow, suggestId)), 'Replace “quick” with “slow”');

    page.sync.write([{ op: 'decide', suggestId, verdict: 'accept', asOf: suggestionAsOf(page.sync.shadow.blocks, suggestId) }]);
    assert.deepEqual(proposalIds(page.sync.shadow.blocks), []);
    await doc.settle(page);
    assert.deepEqual(await doc.serverTexts(), ['Notes', 'The slow fox.']);

    page.sync.write([{ op: 'undecide', suggestId }]);
    await doc.settle(page);
    const held = (await doc.post<DocTabResponse>('_api/doc/read', { tab: doc.tab })).doc as unknown as DiskDoc;
    assert.ok(held.suggestions?.[suggestId], 'the server reopened it');
    // The page holds no record of its decisions: it shows the reopened suggestion only once it reads the tab again.
    page.sync.reconnected();
    await doc.settle(page);
    assert.deepEqual(proposalIds(page.sync.shadow.blocks), [suggestId]);
    assert.equal(texts(page.sync.shadow)[1], 'The quickslow fox.');
    await page.stop();
  });
});

describe('taking back a decision on several suggestions at once', () => {
  let doc: DocServer;

  before(async () => {
    doc = await startDocServer('# Notes\n\nThe quick brown fox.');
  });

  after(() => doc.stop());

  it('reopens two suggestions in one paragraph that were accepted together', async () => {
    const page = await doc.open('page');
    const suggestWords = async (from: number, to: number, content: string) => {
      const chars = page.sync.shadow.blocks[1]!.inline!;
      const wrote = await doc.action('update', {
        call: {
          ref: { object: 'node', id: doc.tab },
          payload: { suggest: true, ops: [{ op: 'replace', target: { kind: 'chars', range: [chars[from]!.id, chars[to]!.id] }, with: { as: 'markdown', from: { kind: 'inline', content } } }] },
        },
      });
      assert.equal(wrote.ok, true, JSON.stringify(wrote));
      await doc.settle(page);
    };
    await suggestWords(16, 18, 'cat');
    await suggestWords(4, 8, 'slow');
    const ids = proposalIds(page.sync.shadow.blocks);
    assert.equal(ids.length, 2);

    const shadow = page.sync.shadow;
    page.sync.write(ids.map(id => ({ op: 'decide', suggestId: id, verdict: 'accept', asOf: suggestionAsOf(shadow.blocks, id) })));
    await doc.settle(page);
    assert.deepEqual(await doc.serverTexts(), ['Notes', 'The slow brown cat.']);

    // Taken back last decided first, as the page does.
    page.sync.write([...ids].reverse().map(id => ({ op: 'undecide', suggestId: id })));
    await doc.settle(page);
    page.sync.reconnected();
    await doc.settle(page);
    assert.deepEqual(proposalIds(page.sync.shadow.blocks).sort(), [...ids].sort());
    await page.stop();
  });
});
