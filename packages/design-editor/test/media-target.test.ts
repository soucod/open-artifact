import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseTemplate } from '@open-artifact/dc';
import { mediaTarget, relocateMedia } from '../src/lib/media-target.ts';

const picked = () => {
  const model = parseTemplate('<div><img src="/_blob/a"><img src="/_blob/b"></div>');
  return mediaTarget(model, model.elements[2]!);
};

it('keeps the address while the same kind of element is there', () => {
  const target = picked();
  assert.deepEqual(relocateMedia(parseTemplate('<div><img src="/_blob/a"><img src="/_blob/c"></div>'), target), { tid: 2, path: [0, 1] });
});

it('follows the image when the board changed around it during the upload', () => {
  const target = picked();
  const moved = parseTemplate('<section><h1>New</h1><p><img src="/_blob/b"></p><img src="/_blob/a"></section>');
  assert.deepEqual(relocateMedia(moved, target), { tid: 3, path: [0, 1, 0] });
});

it('places nothing when the image is gone or several fit', () => {
  const target = picked();
  assert.equal(relocateMedia(parseTemplate('<div><p>no</p></div>'), target), null);
  assert.equal(relocateMedia(parseTemplate('<p>x</p><p>y</p><img src="/_blob/b"><img src="/_blob/b">'), target), null);
});
