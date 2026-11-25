/**
 * A comment thread put in the agent's conversation for the person to send there (`drafted`): delivered, marked
 * `via: 'drafted'`, and the page's thread says `drafted: true` until the agent answers.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AGENT_AUTHOR } from '@open-artifact/server-sdk/comments';
import { DbHost, pageThread } from '../src/db-host.ts';

const ana = { kind: 'user' as const, name: 'Ana' };

describe('a thread drafted into the conversation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-drafted-'));
  after(() => rm(dir, { recursive: true, force: true }));

  const hostAnswering = (outcome: 'delivered' | 'drafted') =>
    new DbHost({ root: dir, documents: false, viewerName: 'Ana', emit: () => undefined, sendThread: async () => outcome });

  it('is delivered, and the page hears it is waiting for the person to send', async () => {
    const host = hostAnswering('drafted');
    const thread = host.comments.create({ anchor: '{}', label: 'Intro', text: '@Agent tighten this', to: ['agent'], author: ana });
    const sent = await host.sendThread(thread.id);
    assert.equal(sent.agent?.status, 'delivered');
    assert.equal(sent.agent?.via, 'drafted');
    assert.deepEqual(pageThread(sent).agent, { status: 'delivered', drafted: true });

    const answered = host.comments.addMessage(thread.id, { ...AGENT_AUTHOR }, 'Done.').thread;
    assert.deepEqual(pageThread(answered).agent, { status: 'replied' }, 'once it answers, no longer drafted');
  });

  it('a plain delivery says nothing of drafts', async () => {
    const host = hostAnswering('delivered');
    const thread = host.comments.create({ anchor: '{}', label: 'Intro', text: '@Agent tighten this', to: ['agent'], author: ana });
    assert.deepEqual(pageThread(await host.sendThread(thread.id)).agent, { status: 'delivered' });
  });
});
