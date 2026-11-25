import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardEntry, CanvasNote } from '@open-artifact/design-core';
import { boardItem, boardItemId, fromEngineCamera, itemTarget, noteItem, noteItemId, noteRect, smallSnapshot, snapshotScale, toEngineCamera } from '../src/lib/scene.ts';

const entry: BoardEntry = { x: 100, y: 50, w: 1280, h: 800 } as BoardEntry;

describe('scene ids and cameras', () => {
  it('maps artboard and note ids both ways', () => {
    assert.deepEqual(itemTarget(boardItemId('a/Main.dc.html')), { board: 'a/Main.dc.html' });
    assert.deepEqual(itemTarget(noteItemId('n1')), { note: 'n1' });
    assert.equal(itemTarget('x:1'), null);
  });

  it('converts the editor camera to the engine camera and back', () => {
    const camera = { x: -240, y: 120, zoom: 0.5 };
    const engine = toEngineCamera(camera);
    // The engine camera names the world point at the canvas corner: screen (0, 0) = world × zoom + (x, y).
    assert.deepEqual(engine, { x: 480, y: -240, zoom: 0.5 });
    assert.deepEqual(fromEngineCamera(engine), camera);
  });

  it('draws an artboard from the small snapshot only while it is small on screen', () => {
    assert.equal(smallSnapshot(entry, 0.1, 2), true);
    assert.equal(smallSnapshot(entry, 0.5, 1), false);
  });

  it('takes a snapshot large enough to stay sharp until the frames take over', () => {
    const sizes = { side: 1024, limit: 2048, sharpZoom: 0.3 };
    // A small artboard is taken at its own size, never larger.
    assert.equal(snapshotScale({ w: 880, h: 560 }, { ...sizes, dpr: 2 }), 1);
    // A large one: as many pixels as it covers at 30 % on the display, where that is more than 1024.
    assert.equal(snapshotScale({ w: 3840, h: 2160 }, { ...sizes, dpr: 1 }), 0.3);
    assert.equal(snapshotScale({ w: 3840, h: 2160 }, { ...sizes, dpr: 2 }), 2048 / 3840);
    assert.equal(snapshotScale({ w: 1920, h: 1080 }, { ...sizes, dpr: 2 }), 0.6);
    assert.equal(snapshotScale({ w: 1920, h: 1080 }, { ...sizes, dpr: 3 }), 0.6);
    assert.equal(snapshotScale({ w: 1080, h: 1440 }, { ...sizes, dpr: 1 }), 1024 / 1440);
    // Never past the limit, however long the artboard.
    assert.equal(snapshotScale({ w: 400, h: 20000 }, { ...sizes, dpr: 2 }), 2048 / 20000);
  });
});

describe('scene items', () => {
  it('draws a live artboard as a hole, and others as a textured placeholder', () => {
    const hole = boardItem('Main.dc.html', entry, { hole: true, z: 0, editable: true });
    assert.equal(hole.kind, 'hole');
    assert.deepEqual([hole.x, hole.y, hole.w, hole.h], [100, 50, 1280, 800]);
    const image = boardItem('Main.dc.html', entry, { hole: false, texture: 'snap:l:1:Main.dc.html', z: 3, editable: false });
    assert.equal(image.kind, 'image');
    assert.equal(image.kind === 'image' && image.texture, 'snap:l:1:Main.dc.html');
    assert.equal(image.movable, false);
    assert.equal(image.z, 3);
  });

  it('sizes stickies, titles and links by their rendered text', () => {
    const sticky = { kind: 'sticky', x: 0, y: 0, text: 'long' } as CanvasNote;
    assert.deepEqual(noteRect(sticky), { x: 0, y: 0, w: 240, h: 80 });
    assert.deepEqual(noteRect(sticky, { w: 240, h: 132 }), { x: 0, y: 0, w: 240, h: 132 });
    const link = { kind: 'link', x: 5, y: 6, href: 'https://example.com' } as CanvasNote;
    assert.equal(noteRect(link, { w: 280, h: 90 }).h, 90);
  });

  it('draws paths in their own bounds, hit by the stroke only and never resized', () => {
    const line = { kind: 'line', x: 10, y: 10, points: [[0, 0], [100, 40]] } as CanvasNote;
    const item = noteItem('l1', line, { z: 0, editable: true });
    assert.equal(item.kind, 'path');
    assert.equal(item.hitStrokeOnly, true);
    assert.equal(item.resizable, false);
    assert.equal(item.movable, true);
    const points = item.kind === 'path' ? Array.from(item.points ?? []) : [];
    assert.deepEqual(points.slice(0, 2), [10 + 0 - item.x, 10 + 0 - item.y]);
  });

  it('keeps an unfilled oval hittable inside', () => {
    const oval = noteItem('o1', { kind: 'oval', x: 0, y: 0, w: 100, h: 60 } as CanvasNote, { z: 0, editable: true });
    assert.equal(oval.kind, 'path');
    assert.notEqual(oval.kind === 'path' && oval.fill, 'transparent');
  });
});
