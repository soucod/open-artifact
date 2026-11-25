import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOCK_MIN_SHOWN, type ScrollingTable, dockFor, samePlace } from '../src/tables/dock.ts';

const WINDOW = { top: 100, bottom: 900, left: 0, right: 1200 };
const BAR = 12;

/** A table from `top` to `bottom`, shown from x 200 to 900, that scrolls `overflow` further. */
const table = (top: number, bottom: number, overflow = 600, shown: [number, number] = [200, 900]): ScrollingTable => ({
  box: { top, bottom, left: shown[0] - 48, right: shown[1] + 12 },
  shownLeft: shown[0],
  shownRight: shown[1],
  overflow,
});

describe('the scrollbar docked under a wide table', () => {
  it('docks for a wide table whose foot is below the window, over the part of it shown', () => {
    assert.deepEqual(dockFor([table(300, 2000)], WINDOW, BAR), { index: 0, left: 200, width: 700, track: 1300 });
  });

  it('scrolls the same distance as the table: its track is its width and how far the table scrolls', () => {
    const place = dockFor([table(300, 2000, 250, [-100, 1500])], WINDOW, BAR)!;
    assert.deepEqual([place.left, place.width], [0, 1200]);
    assert.equal(place.track - place.width, 250);
  });

  it('does not dock while the table fits, its own scrollbar is in sight, or it is hidden', () => {
    assert.equal(dockFor([table(300, 2000, 0)], WINDOW, BAR), null);
    assert.equal(dockFor([table(300, 2000, 1)], WINDOW, BAR), null);
    assert.equal(dockFor([table(300, 880)], WINDOW, BAR), null);
    assert.equal(dockFor([table(300, 900)], WINDOW, BAR), null);
    // A table in a folded section is drawn with no height.
    assert.equal(dockFor([table(0, 0)], WINDOW, BAR), null);
  });

  it('lets go when the table leaves the window from below, or is about to', () => {
    assert.equal(dockFor([table(1000, 3000)], WINDOW, BAR), null);
    assert.equal(dockFor([table(900 - BAR - DOCK_MIN_SHOWN + 1, 3000)], WINDOW, BAR), null);
    assert.ok(dockFor([table(900 - BAR - DOCK_MIN_SHOWN, 3000)], WINDOW, BAR));
  });

  it('keeps docking while the table runs past the top of the window', () => {
    assert.ok(dockFor([table(-4000, 2000)], WINDOW, BAR));
  });

  it('chooses the lowest of the tables that want it', () => {
    const tables = [table(-500, 950), table(200, 400), table(500, 2000, 300), table(1000, 1500)];
    assert.equal(dockFor(tables, WINDOW, BAR)?.index, 2);
  });

  it('does not dock over a sliver of a table', () => {
    assert.equal(dockFor([table(300, 2000, 600, [1180, 1800])], WINDOW, BAR), null);
  });

  it('tells a moved or resized bar from the same one', () => {
    const place = dockFor([table(300, 2000)], WINDOW, BAR);
    assert.ok(samePlace(place, { ...place!, left: place!.left + 0.2 }));
    assert.ok(!samePlace(place, { ...place!, track: place!.track + 20 }));
    assert.ok(!samePlace(place, null));
    assert.ok(samePlace(null, null));
  });
});
