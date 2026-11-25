import assert from 'node:assert/strict';
import { it } from 'node:test';
import { historyKeyOf, stepLength } from '../src/lib/field-keys.ts';

const press = (key: string, init: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

it('reads undo and redo shortcuts, also by physical key', () => {
  assert.equal(historyKeyOf(press('z', { metaKey: true })), 'undo');
  assert.equal(historyKeyOf(press('z', { ctrlKey: true })), 'undo');
  assert.equal(historyKeyOf(press('Z', { metaKey: true, shiftKey: true })), 'redo');
  assert.equal(historyKeyOf(press('y', { ctrlKey: true })), 'redo');
  assert.equal(historyKeyOf(press('я', { code: 'KeyZ', metaKey: true })), 'undo');
  assert.equal(historyKeyOf(press('z')), null);
  assert.equal(historyKeyOf(press('z', { metaKey: true, altKey: true })), null);
  assert.equal(historyKeyOf(press('c', { metaKey: true })), null);
});

it('steps a length, and an empty field from its placeholder or from 0', () => {
  assert.equal(stepLength('12px', '', 1), '13px');
  assert.equal(stepLength('1.5', '', -10), '-8.5');
  assert.equal(stepLength('', '40', 1), '41');
  assert.equal(stepLength('', '', 1, true), '1');
  assert.equal(stepLength('', 'Auto', -1, true), '-1');
  assert.equal(stepLength('', 'https://', 1), null, 'a text field without a number stays empty');
  assert.equal(stepLength('', '', 1), null);
  assert.equal(stepLength('auto', '', 1, true), null);
});
