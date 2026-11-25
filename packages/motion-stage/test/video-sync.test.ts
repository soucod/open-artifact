import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOST_NUDGE, NUDGE_FROM_SECONDS, nudgedRate } from '../src/runtime/video-sync.ts';

test('a playing clip keeps the film’s rate while it is near its time', () => {
  assert.equal(nudgedRate(0, 1), 1);
  assert.equal(nudgedRate(NUDGE_FROM_SECONDS / 2, 1), 1);
  assert.equal(nudgedRate(-NUDGE_FROM_SECONDS / 2, 0.8), 0.8);
  assert.equal(nudgedRate(Number.NaN, 1), 1);
});

test('a clip behind its time plays a little faster, one ahead a little slower, by at most MOST_NUDGE', () => {
  assert.ok(Math.abs(nudgedRate(0.06, 1) - 1.03) < 1e-12);
  assert.ok(Math.abs(nudgedRate(-0.06, 1) - 0.97) < 1e-12);
  assert.equal(nudgedRate(0.2, 1), 1 + MOST_NUDGE);
  assert.equal(nudgedRate(-0.2, 2), 2 * (1 - MOST_NUDGE));
});
