import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ArtifactError } from '@open-artifact/runtime';
import { copyRefused, dismissRefused, refusalAdvice, refusalReason, showRefused, useRefused } from '../src/comments/refused.ts';

const draftOf = (id: number) => useRefused.getState().drafts.find(draft => draft.id === id);

describe('a comment the server refused', () => {
  beforeEach(() => useRefused.setState({ drafts: [] }));

  it('reads why from the code the server answered with', () => {
    assert.equal(refusalReason(new ArtifactError('not_found', 'No comment thread t9.')), 'thread_gone');
    assert.equal(refusalReason(new ArtifactError('not_writer', 'Only editors and commenters can do that.')), 'no_access');
    assert.equal(refusalReason({ name: 'ArtifactError', code: 'not_writer', message: 'Viewers cannot comment.' }), 'no_access');
    assert.equal(refusalReason(new ArtifactError('not_granted', 'This doc is no longer shared with you.')), 'no_access');
    assert.equal(refusalReason(new ArtifactError('invalid', 'to is a list of at most 20 names.')), 'invalid');
    assert.equal(refusalReason(new ArtifactError('conflict', 'Busy.')), 'other');
    assert.equal(refusalReason(new Error('odd')), 'other');
    assert.equal(refusalReason(null), 'other');
  });

  it('says what to do for each reason', () => {
    assert.match(refusalAdvice('thread_gone', 'reply'), /deleted.*post it as a new comment/);
    assert.match(refusalAdvice('no_access', 'comment'), /no longer comment.*Copy your comment.*ask the owner/);
    assert.match(refusalAdvice('invalid', 'reply'), /Copy your reply.*naming fewer people/);
    assert.match(refusalAdvice('other', 'reply'), /Copy your reply/);
  });

  it('keeps the whole draft, the server’s words and the advice until it is closed', () => {
    const text = `Check the totals in the second table.\n${'More detail. '.repeat(40)}`;
    const shown = showRefused('The reply could not be saved', text, 'reply', new ArtifactError('not_found', 'No comment thread t9.'));
    assert.deepEqual(draftOf(shown.id), { id: shown.id, title: 'The reply could not be saved', detail: 'No comment thread t9.', advice: refusalAdvice('thread_gone', 'reply'), text, copy: 'idle' });
    dismissRefused(shown.id);
    assert.equal(draftOf(shown.id), undefined);
  });

  it('shows at most three at once, the newest last', () => {
    const ids = ['one', 'two', 'three', 'four'].map(word => showRefused('Not saved', word, 'comment', new ArtifactError('invalid', 'no')).id);
    assert.deepEqual(
      useRefused.getState().drafts.map(draft => draft.text),
      ['two', 'three', 'four'],
    );
    assert.equal(draftOf(ids[0]!), undefined);
  });

  it('copies the whole draft and says so', async () => {
    const text = 'Line one\nLine two with “quotes” and émojis 🎯';
    const { id } = showRefused('Not saved', text, 'comment', new ArtifactError('not_writer', 'no'));
    const written: string[] = [];
    await copyRefused(id, { writeText: async value => void written.push(value) });
    assert.deepEqual(written, [text]);
    assert.equal(draftOf(id)?.copy, 'copied');
  });

  it('shows the text to copy by hand when the clipboard says no, or there is none', async () => {
    const first = showRefused('Not saved', 'first draft', 'comment', new ArtifactError('invalid', 'no'));
    await copyRefused(first.id, {
      writeText: async () => {
        throw new DOMException('Document is not focused.', 'NotAllowedError');
      },
    });
    assert.equal(draftOf(first.id)?.copy, 'manual');
    const second = showRefused('Not saved', 'second draft', 'reply', new ArtifactError('invalid', 'no'));
    await copyRefused(second.id, null);
    assert.equal(draftOf(second.id)?.copy, 'manual');
    assert.equal(draftOf(second.id)?.text, 'second draft');
  });
});
