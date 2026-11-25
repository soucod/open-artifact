import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeFromHash, placeSlug, type PlaceIndex } from '../src/lib/place-link.ts';

const index: PlaceIndex = {
  pages: [{ id: 'flows', name: 'User Flows' }, { id: 'Home_2', name: 'Home' }],
  boards: {
    'Main.dc.html': {},
    'screens/Sign In.dc.html': {},
    'screens/Pricing.dc.html': {},
    'old/Pricing.dc.html': {},
    'Checkout v2.dc.html': {},
    'docs-html.dc.html': {},
  },
};

describe('place links', () => {
  it('names artboards in lower case without the file ending, other characters as one hyphen', () => {
    assert.equal(placeSlug('screens/Sign In.dc.html'), 'screens-sign-in');
    assert.equal(placeSlug('Checkout v2.dc.html'), 'checkout-v2');
    assert.equal(placeSlug('__Main__.dc.html'), 'main');
  });

  it('opens an artboard by its whole path or, when that is unique, by its file name', () => {
    assert.deepEqual(placeFromHash('#artboard-screens-sign-in', index), { kind: 'artboard', path: 'screens/Sign In.dc.html' });
    assert.deepEqual(placeFromHash('#artboard-sign-in', index), { kind: 'artboard', path: 'screens/Sign In.dc.html' });
    assert.deepEqual(placeFromHash('#play-checkout-v2', index), { kind: 'play', path: 'Checkout v2.dc.html' });
    assert.deepEqual(placeFromHash('#artboard-old-pricing', index), { kind: 'artboard', path: 'old/Pricing.dc.html' });
  });

  it('forgives a copied file ending and escaped characters', () => {
    assert.deepEqual(placeFromHash('#artboard-Main.dc.html', index), { kind: 'artboard', path: 'Main.dc.html' });
    assert.deepEqual(placeFromHash('#artboard-main-dc-html', index), { kind: 'artboard', path: 'Main.dc.html' });
    assert.deepEqual(placeFromHash('#play-screens%2FSign%20In', index), { kind: 'play', path: 'screens/Sign In.dc.html' });
    assert.deepEqual(placeFromHash('#artboard-docs-html', index), { kind: 'artboard', path: 'docs-html.dc.html' });
  });

  it('opens nothing when a name fits several artboards or none', () => {
    assert.equal(placeFromHash('#artboard-pricing', index), null);
    assert.equal(placeFromHash('#play-missing', index), null);
    assert.equal(placeFromHash('#artboard-', index), null);
    assert.equal(placeFromHash('#artboard-%E0%A4%A', index), null);
  });

  it('opens a page by its id, then by a readable id or name, then an artboard of that name', () => {
    assert.deepEqual(placeFromHash('#page-Home_2', index), { kind: 'page', page: 'Home_2' });
    assert.deepEqual(placeFromHash('#page-home-2', index), { kind: 'page', page: 'Home_2' });
    assert.deepEqual(placeFromHash('#page-user-flows', index), { kind: 'page', page: 'flows' });
    assert.deepEqual(placeFromHash('#page-main', index), { kind: 'artboard', path: 'Main.dc.html' });
    assert.equal(placeFromHash('#page-nowhere', index), null);
  });

  it('leaves other addresses alone', () => {
    assert.equal(placeFromHash('#page=flows', index), null);
    assert.equal(placeFromHash('', index), null);
    assert.equal(placeFromHash('#comments', index), null);
  });
});
