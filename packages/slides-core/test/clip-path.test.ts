import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clipPathPoints, compileSlide, formatClipPath, parseClipPath, serializeSlide } from '../src/index.ts';

describe('polygon clip paths', () => {
  const shapes = {
    triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
    hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
    arrow: 'polygon(0 25%, 65% 25%, 65% 0, 100% 50%, 65% 100%, 65% 75%, 0 75%)',
    star: 'polygon(50% 0, 61% 35%, 100% 35%, 68% 57%, 80% 100%, 50% 74%, 20% 100%, 32% 57%, 0 35%, 39% 35%)',
  };

  for (const [name, polygon] of Object.entries(shapes)) {
    it(`round-trips a ${name} on panels and pictures`, () => {
      const source = `<section id="shape"><div style="clip-path:${polygon}"></div><img style="clip-path:${polygon}"></section>`;
      const first = compileSlide(source, { id: 'shape', lints: false });
      assert.deepEqual(first.diagnostics, []);
      assert.deepEqual(first.slide.children.map((node) => node.style['clip-path']), [polygon, polygon]);
      const serialized = serializeSlide(first.slide);
      assert.equal(serializeSlide(compileSlide(serialized, { id: 'shape', lints: false }).slide), serialized);
    });
  }

  it('resolves percentages against the corresponding axis', () => {
    const polygon = parseClipPath(shapes.triangle);
    assert.ok(polygon.ok && polygon.value);
    assert.deepEqual(clipPathPoints(polygon.value, 400, 200), [[200, 0], [400, 200], [0, 200]]);
    assert.deepEqual(clipPathPoints(polygon.value, 800, 300), [[400, 0], [800, 300], [0, 300]]);
  });

  it('preserves mixed pixel and percentage coordinates in either order', () => {
    const polygon = parseClipPath('polygon(calc(100% - 12px) calc(25% + 4px), calc(12px + 50%) 100%, calc(12px - 10%) 0)');
    assert.ok(polygon.ok && polygon.value);
    assert.deepEqual(clipPathPoints(polygon.value, 400, 200), [[388, 54], [212, 200], [-28, 0]]);
    assert.equal(formatClipPath(polygon.value), 'polygon(calc(100% - 12px) calc(25% + 4px), calc(50% + 12px) 100%, calc(-10% + 12px) 0)');
  });

  it('keeps the fill rule and rejects incomplete or unsupported coordinates', () => {
    const polygon = parseClipPath('polygon(evenodd, 0 0, 100% 100%, 0 100%, 100% 0) border-box');
    assert.ok(polygon.ok);
    assert.equal(formatClipPath(polygon.value), 'polygon(evenodd, 0 0, 100% 100%, 0 100%, 100% 0)');
    assert.deepEqual(parseClipPath('none'), { ok: true, value: null });
    for (const source of ['polygon(0 0, 100% 0)', 'polygon(0 0, 100% 0, 50% 100%,)', 'polygon(0 0, 100% 0, calc(50% * 2) 100%)', 'url(#clip)']) {
      assert.equal(parseClipPath(source).ok, false, source);
    }
  });

  it('takes the border box on either side of the polygon', () => {
    for (const source of ['border-box polygon(50% 0, 100% 100%, 0 100%)', 'polygon(50% 0, 100% 100%, 0 100%) border-box']) {
      const polygon = parseClipPath(source);
      assert.ok(polygon.ok, source);
      assert.equal(formatClipPath(polygon.value), 'polygon(50% 0, 100% 100%, 0 100%)');
    }
  });

  it('says what to write instead of a shape or box it does not take', () => {
    const reason = (source: string): string => {
      const result = parseClipPath(source);
      assert.equal(result.ok, false, source);
      return result.ok ? '' : result.reason;
    };
    assert.match(reason('padding-box polygon(0 0, 100% 0, 50% 100%)'), /border box; drop padding-box/);
    assert.match(reason('polygon(0 0, 100% 0, 50% 100%) content-box'), /drop content-box/);
    for (const shape of ['inset(0 round 12px)', 'circle(50%)', 'ellipse(40% 50%)']) assert.match(reason(shape), /use border-radius, or write the outline as polygon/);
    assert.match(reason('path("M0 0 L10 10")'), /<svg>/);
  });
});
