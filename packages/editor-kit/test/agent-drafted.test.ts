import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentResultMessage, draftedText } from '../src/agent.ts';

test('a request put in the conversation for the person to send says so, in the Shell’s words', () => {
  assert.deepEqual(agentResultMessage({ status: 'delivered', drafted: true }, 'this board', { name: 'Codex' }), { title: 'It is in the Codex conversation now: send it there.' });
  assert.deepEqual(agentResultMessage({ status: 'delivered' }, 'this board', { name: 'Codex' }), { title: 'Sent to the agent' });
  assert.equal(draftedText('', false).sent, 'It is in the agent conversation now: send it there.');
  assert.deepEqual(draftedText('Codex', false), {
    sent: 'It is in the Codex conversation now: send it there.',
    via: 'in the conversation, for you to send',
    label: 'In the conversation, for you to send',
  });
  assert.deepEqual(draftedText('Codex', true), { sent: '已放进 Codex 的对话：到那里发出去。', via: '在对话里，等你发出', label: '在对话里，等你发出' });
});
