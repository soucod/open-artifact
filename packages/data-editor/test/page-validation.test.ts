import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPageFaultTracker, describePageStop, getPageFaultName, ON_DATA_CALLBACK_NAME } from '../src/page/faults.ts';
import {
  countDrawingFaults,
  doLabelBoxesOverlap,
  hasNaNText,
  hasOverlappingLabels,
  isLabelCut,
  parseRowKeyColumns,
  parseRowKeyValues,
} from '../src/page/validation.ts';
import { toDrawSpec } from '../src/page/draw.ts';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('page validation', () => {
  it('finds NaN printed as a word', () => {
    assert.equal(hasNaNText('Total: NaN'), true);
    assert.equal(hasNaNText('NaN%'), true);
    assert.equal(hasNaNText('Nancy'), false);
    assert.equal(hasNaNText('NaNs'), false);
  });

  it('lists drawing faults with a count, in report order', () => {
    assert.deepEqual(countDrawingFaults({ notEmpty: 0, nested: 2, missing: 0, strays: 1 }), [
      { kind: 'drawing', what: 'nested', count: 2 },
      { kind: 'drawing', what: 'stray_write', count: 1 },
    ]);
  });

  it('reads row keys', () => {
    assert.deepEqual(parseRowKeyColumns(' region , year ,'), ['region', 'year']);
    assert.deepEqual(parseRowKeyColumns(null), []);
    assert.deepEqual(parseRowKeyValues('a,b', 1), ['a,b']);
    assert.deepEqual(parseRowKeyValues('North,2024%2C1', 2), ['North', '2024,1']);
    assert.equal(parseRowKeyValues('North', 2), null);
  });

  it('finds overlapping and cut labels', () => {
    assert.equal(doLabelBoxesOverlap(box(0, 0, 40, 10), box(10, 0, 50, 10)), true);
    assert.equal(doLabelBoxesOverlap(box(0, 0, 40, 10), box(40, 0, 80, 10)), false);
    assert.equal(
      hasOverlappingLabels([
        { words: 'a', box: box(0, 0, 40, 10) },
        { words: 'a', box: box(0, 0, 40, 10) },
      ] as never),
      false,
    );
    assert.equal(isLabelCut(box(-10, 0, 30, 10), box(0, 0, 100, 100)), true);
    assert.equal(isLabelCut(box(5, 5, 30, 10), box(0, 0, 100, 100)), false);
  });

  it('accepts a drawing as a function or mount/update/unmount', () => {
    assert.ok(toDrawSpec(() => undefined) !== null);
    assert.ok(toDrawSpec({ mount: () => undefined }) !== null);
    assert.equal(toDrawSpec(42), null);
  });
});

describe('page faults', () => {
  it('counts the same fault once per kind, class and file', () => {
    const tracker = createPageFaultTracker();
    assert.equal(tracker.record('stopped', new TypeError('x is undefined'), 'files/app.js'), true);
    const first = tracker.list();
    assert.equal(tracker.record('stopped', new TypeError('again'), 'files/app.js'), false);
    assert.equal(tracker.list(), first);
    assert.equal(tracker.record('error', new TypeError('x'), 'files/app.js'), true);
    assert.equal(tracker.list().length, 2);
  });

  it('keeps which drawing threw, apart from the same fault in another one', () => {
    const tracker = createPageFaultTracker();
    assert.equal(tracker.record('stopped', new TypeError('a'), undefined, 'revenue'), true);
    assert.equal(tracker.record('stopped', new TypeError('b'), undefined, 'costs'), true);
    assert.equal(tracker.record('stopped', new TypeError('c'), undefined, 'revenue'), false);
    assert.deepEqual(
      tracker.list().map((fault) => fault.where),
      ['revenue', 'costs'],
    );
    tracker.record('stopped', new RangeError('d'));
    assert.equal(Object.hasOwn(tracker.list()[2] ?? {}, 'where'), false);
  });

  it('names fault classes and describes stops', () => {
    assert.equal(getPageFaultName(new RangeError('r')), 'RangeError');
    assert.equal(getPageFaultName(new Error('e')), 'Error');
    assert.equal(getPageFaultName('text'), 'value');
    assert.match(describePageStop(ON_DATA_CALLBACK_NAME, new Error('boom')), /dash\.onData callback\): boom$/);
    assert.match(describePageStop('files/app.js', new Error('boom')), /\(files\/app\.js\): boom$/);
  });
});
