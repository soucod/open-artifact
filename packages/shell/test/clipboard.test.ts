import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClipboardRelay, type ClipboardEnv } from '../src/shell/clipboard.ts';

/** A clipboard that records what it was given and reads it like a browser. */
function fakeClipboard(options: { refuse?: string; supports?: (type: string) => boolean } = {}) {
  const written: Array<Record<string, string>> = [];
  const asked: string[][] = [];
  const env: ClipboardEnv = {
    supports: options.supports ?? (() => true),
    async write(items) {
      asked.push(Object.keys(items));
      if (options.refuse) throw Object.assign(new Error(options.refuse), { name: 'NotAllowedError' });
      const read: Record<string, string> = {};
      for (const [type, blob] of Object.entries(items)) {
        const value = await blob;
        assert.equal(value.type, type);
        read[type] = await value.text();
      }
      written.push(read);
    },
  };
  return { env, written, asked };
}

function answers() {
  const list: Array<{ id: string; error?: string }> = [];
  const answer = (id: string, error?: string): void => void list.push(error === undefined ? { id } : { id, error });
  const next = async (count = 1): Promise<void> => {
    for (let i = 0; i < 50 && list.length < count; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  };
  return { list, answer, next };
}

describe('the Shell clipboard relay', () => {
  it('starts the write at once and fills it with the content that follows', async () => {
    const clipboard = fakeClipboard();
    const done = answers();
    const relay = createClipboardRelay(clipboard.env, done.answer);
    relay.start('c1', ['image/png', 'text/plain']);
    assert.deepEqual(clipboard.asked, [['image/png', 'text/plain']], 'the write started before the content came');
    relay.data('c1', { 'image/png': new Blob(['png'], { type: 'image/png' }), 'text/plain': new Blob(['alt']) }, undefined);
    await done.next();
    assert.deepEqual(done.list, [{ id: 'c1' }]);
    assert.deepEqual(clipboard.written, [{ 'image/png': 'png', 'text/plain': 'alt' }], 'each blob is filed under its own type');
  });

  it('leaves out formats it does not know or the browser cannot write, and refuses when none is left', async () => {
    const clipboard = fakeClipboard({ supports: (type) => type !== 'image/svg+xml' });
    const done = answers();
    const relay = createClipboardRelay(clipboard.env, done.answer);
    relay.start('c1', ['text/plain', 'image/svg+xml', 'application/x-evil', 'text/plain', 7]);
    assert.deepEqual(clipboard.asked, [['text/plain']]);
    relay.data('c1', { 'text/plain': new Blob(['<svg/>']), 'image/svg+xml': new Blob(['<svg/>']) }, undefined);
    relay.start('c2', ['image/svg+xml']);
    await done.next(2);
    assert.deepEqual(done.list.sort((a, b) => a.id.localeCompare(b.id)), [{ id: 'c1' }, { id: 'c2', error: 'This browser cannot copy that to the clipboard.' }]);
  });

  it('answers with the page\'s reason when it sends no content, or content that is missing a format', async () => {
    const clipboard = fakeClipboard();
    const done = answers();
    const relay = createClipboardRelay(clipboard.env, done.answer);
    relay.start('c1', ['image/png']);
    relay.data('c1', undefined, 'The element is empty.');
    relay.start('c2', ['text/html', 'text/plain']);
    relay.data('c2', { 'text/html': new Blob(['<b>x</b>']) }, undefined);
    await done.next(2);
    assert.equal(clipboard.written.length, 0);
    assert.equal(done.list.length, 2);
    assert.ok(done.list.every((answer) => typeof answer.error === 'string'), JSON.stringify(done.list));
  });

  it('passes the browser\'s refusal on, and ignores content for a write that is over', async () => {
    const clipboard = fakeClipboard({ refuse: 'Write permission denied.' });
    const done = answers();
    const relay = createClipboardRelay(clipboard.env, done.answer);
    relay.start('c1', ['text/plain']);
    await done.next();
    assert.deepEqual(done.list, [{ id: 'c1', error: 'Write permission denied.' }]);
    relay.data('c1', { 'text/plain': new Blob(['late']) }, undefined);
    relay.data('nobody', { 'text/plain': new Blob(['x']) }, undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(done.list.length, 1);
  });

  it('ignores bad or repeated ids, gives up on content that never comes, and drops waiting writes when the page reloads', async () => {
    const clipboard = fakeClipboard();
    const done = answers();
    const relay = createClipboardRelay(clipboard.env, done.answer, 20);
    relay.start('has space', ['text/plain']);
    relay.start(42, ['text/plain']);
    relay.start('slow', ['text/plain']);
    relay.start('slow', ['text/plain']);
    assert.equal(clipboard.asked.length, 1);
    await done.next();
    assert.deepEqual(done.list, [{ id: 'slow', error: 'The page did not send what to copy.' }]);
    relay.start('gone', ['text/plain']);
    relay.clear();
    await done.next(2);
    assert.deepEqual(done.list[1], { id: 'gone', error: 'The page went away.' });
  });

  it('refuses a fifth write while four wait for their content', async () => {
    const clipboard = fakeClipboard();
    const done = answers();
    const relay = createClipboardRelay(clipboard.env, done.answer);
    for (const id of ['a', 'b', 'c', 'd', 'e']) relay.start(id, ['text/plain']);
    await done.next();
    assert.deepEqual(done.list, [{ id: 'e', error: 'Still copying…' }]);
    relay.clear();
  });
});
