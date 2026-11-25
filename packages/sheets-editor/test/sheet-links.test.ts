import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anchorFragmentOfHash, createGuideFromStream, guideStopsOf, placeOfAnchorFragment, GUIDE_STORAGE_KEY } from '../src/shell/sheet-links.ts';

/** Storage that keeps its items in a map, for the guide's kept walkthrough. */
function mapStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe('links to places in a workbook', () => {
  it('reads a sheet and its ranges from an anchor fragment', () => {
    assert.deepEqual(placeOfAnchorFragment('sheet-s1~A2-D2~F1'), { sheetId: 's1', ranges: ['A2:D2', 'F1'] });
    assert.deepEqual(placeOfAnchorFragment('sheet-s1'), { sheetId: 's1', ranges: [] });
    assert.equal(placeOfAnchorFragment('sheet-'), null);
    assert.equal(placeOfAnchorFragment('page=s1'), null);
    assert.equal(placeOfAnchorFragment('sheet-s1 A1'), null);
    assert.equal(placeOfAnchorFragment(3), null);
  });

  it('takes both forms of the address', () => {
    assert.equal(anchorFragmentOfHash('#sheet-s1~A1'), 'sheet-s1~A1');
    assert.equal(anchorFragmentOfHash('#page=s1~A1'), 'sheet-s1~A1');
    assert.equal(anchorFragmentOfHash(''), null);
  });
});

describe('a walkthrough', () => {
  it('keeps the stops that name cells and say something', () => {
    const stops = guideStopsOf({
      stops: [
        { at: '#sheet-s1~B2', say: '  Here  ' },
        { at: 'sheet-s1', say: 'no cells' },
        { at: 'sheet-s1~C3', say: ' ' },
      ],
    });
    assert.deepEqual(stops, [{ place: { sheetId: 's1', ranges: ['B2'] }, words: 'Here' }]);
    assert.equal(guideStopsOf({ stops: [] }), null);
  });

  it('hands a walkthrough heard to the card, and the kept one again to the same viewer only', () => {
    const storage = mapStorage();
    const guide = createGuideFromStream(() => storage);
    const heard: [number, boolean][] = [];
    guide.start((stops, isRestored) => heard.push([stops.length, isRestored]));
    guide.heardOnStream({ phase: 'guide', guide: { stops: [{ at: 'sheet-s1~A1', say: 'Look' }] } });
    assert.deepEqual(heard, [[1, false]]);
    assert.ok(storage.getItem(GUIDE_STORAGE_KEY) !== null);
    const again = createGuideFromStream(() => storage);
    const restored: boolean[] = [];
    again.start((_, isRestored) => restored.push(isRestored));
    assert.deepEqual(restored, []);
    guide.discard();
    assert.equal(storage.getItem(GUIDE_STORAGE_KEY), null);
  });
});
