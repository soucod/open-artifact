/** A harness that drafts what it is sent: the Shell says the message is in the conversation for the person to send. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryOf, parseSent } from '../src/shell/model.ts';
import { t } from '../src/lib/i18n.ts';

test('a drafted wake is its own delivery, kept across reloads', () => {
  assert.equal(deliveryOf('live', 'drafted'), 'drafted');
  assert.equal(deliveryOf('live', 'delivered'), 'delivered');
  assert.equal(deliveryOf('live', 'queued'), 'delivered');
  assert.deepEqual(parseSent(JSON.stringify([{ text: 'a', at: '1', delivery: 'drafted' }])), [{ text: 'a', at: '1', delivery: 'drafted' }]);
});

test('the drafted words name the conversation, not a send to the agent', () => {
  assert.match(t('sendToConversation', { agent: 'MyIDE' }), /MyIDE conversation/);
  assert.match(t('sentDrafted', { agent: 'MyIDE' }), /send it there/);
  assert.match(t('viaDrafted'), /for you to send/);
});
