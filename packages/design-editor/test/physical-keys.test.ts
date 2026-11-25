import assert from 'node:assert/strict';
import { it } from 'node:test';
import { isCopyPngKey, zoomKeyOf } from '../src/lib/physical-keys.ts';

const press = (key: string, code: string | undefined, mods: { meta?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key,
  ...(code ? { code } : {}),
  meta: mods.meta ?? false,
  shift: mods.shift ?? false,
  alt: mods.alt ?? false,
});

it('zooms by the digit key under Shift, whatever character the layout types', () => {
  assert.equal(zoomKeyOf(press('!', 'Digit1', { shift: true })), 'fit');
  assert.equal(zoomKeyOf(press('+', 'Digit1', { shift: true })), 'fit');
  assert.equal(zoomKeyOf(press('=', 'Digit0', { shift: true })), 'actual');
  assert.equal(zoomKeyOf(press('"', 'Digit2', { shift: true })), 'selection');
  assert.equal(zoomKeyOf(press('1', 'Digit1')), null);
  assert.equal(zoomKeyOf(press('!', 'Digit1', { shift: true, meta: true })), null);
  assert.equal(zoomKeyOf(press('!', 'Digit3', { shift: true })), null);
});

it('falls back to the typed character when a press has no physical key', () => {
  assert.equal(zoomKeyOf(press('!', undefined, { shift: true })), 'fit');
  assert.equal(zoomKeyOf(press(')', undefined, { shift: true })), 'actual');
  assert.equal(zoomKeyOf(press('@', undefined, { shift: true })), 'selection');
});

it('copies as PNG on Shift+Cmd+C, also where C types another letter', () => {
  assert.equal(isCopyPngKey(press('C', 'KeyC', { meta: true, shift: true })), true);
  assert.equal(isCopyPngKey(press('С', 'KeyC', { meta: true, shift: true })), true);
  assert.equal(isCopyPngKey(press('c', undefined, { meta: true, shift: true })), true);
  assert.equal(isCopyPngKey(press('c', 'KeyC', { meta: true })), false);
  assert.equal(isCopyPngKey(press('c', 'KeyC', { meta: true, shift: true, alt: true })), false);
  assert.equal(isCopyPngKey(press('C', 'KeyC', { shift: true })), false);
});
