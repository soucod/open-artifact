import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askStatusLabel } from '../src/collab/ask-status.ts';

test('a request drafted into the conversation is labelled as waiting for the person to send it', () => {
  assert.equal(askStatusLabel('delivered', true, true), 'In the conversation, for you to send');
  assert.equal(askStatusLabel('delivered', true), 'Sent');
  assert.equal(askStatusLabel('queued', false, true), 'Queued for its next turn', 'only a delivered request is drafted');
});
