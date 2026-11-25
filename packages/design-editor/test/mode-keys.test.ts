import assert from 'node:assert/strict';
import { it } from 'node:test';
import { endsMode } from '../src/lib/mode-keys.ts';

it('ends cropping or a path on Enter or Escape outside text fields', () => {
  assert.equal(endsMode({ key: 'Enter' }, false), true);
  assert.equal(endsMode({ key: 'Escape' }, false), true);
  assert.equal(endsMode({ key: 'a' }, false), false);
  assert.equal(endsMode({ key: 'Enter' }, true), false, 'a panel field keeps its Enter');
  assert.equal(endsMode({ key: 'Escape' }, true), false);
  assert.equal(endsMode({ key: 'Enter', isComposing: true }, false), false, 'an input method keeps its Enter');
  assert.equal(endsMode({ key: 'Enter', keyCode: 229 }, false), false);
});
