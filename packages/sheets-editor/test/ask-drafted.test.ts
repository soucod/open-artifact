import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askSentToChatWords, isAskTaken } from '../src/messages/charts.ts';

test('a chart ask put in the conversation for the person to send says so, in the other editors’ words', () => {
  assert.equal(askSentToChatWords('drafted'), 'It is in the agent conversation now: send it there.');
  assert.equal(askSentToChatWords('taken'), 'Continue in your chat with Agent.');
  assert.ok(isAskTaken('drafted') && isAskTaken('taken'));
  assert.ok(!isAskTaken('failed') && !isAskTaken(null));
});
