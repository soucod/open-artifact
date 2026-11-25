import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { MAX_ZOOM, MIN_ZOOM } from '../src/lib/camera.ts';
import { fitTo, zoomStep, zoomTo } from '../src/services/viewport.ts';
import { useCamera, zoomRange } from '../src/state/camera.ts';

/** The screen box of a board rectangle under the current camera. */
function onScreen(rect: { x: number; y: number; w: number; h: number }): { left: number; top: number; right: number; bottom: number } {
  const { camera } = useCamera.getState();
  return { left: (rect.x - camera.x) * camera.zoom, top: (rect.y - camera.y) * camera.zoom, right: (rect.x + rect.w - camera.x) * camera.zoom, bottom: (rect.y + rect.h - camera.y) * camera.zoom };
}

describe('the camera when the viewport is measured', () => {
  beforeEach(() => {
    useCamera.setState({ camera: { x: 0, y: 0, zoom: 1 }, width: 1, height: 1 });
  });

  it('keeps a camera as it is at any viewport size', () => {
    useCamera.getState().setCamera({ x: 120, y: -40, zoom: 0.3 });
    useCamera.getState().setViewport(1280, 800);
    assert.deepEqual(useCamera.getState().camera, { x: 120, y: -40, zoom: 0.3 });
    // A camera kept from a wide window, in a pane as narrow as an agent app's side pane.
    useCamera.getState().setViewport(660, 800);
    assert.deepEqual(useCamera.getState().camera, { x: 120, y: -40, zoom: 0.3 });
  });
});

describe('zooming in a narrow pane', () => {
  /** A board 2400 units wide: wider than a 660 px pane shows at 60%. */
  const board = { x: -200, y: 100, w: 2400, h: 900 };

  beforeEach(() => {
    useCamera.setState({ camera: { x: 0, y: 0, zoom: 1 }, width: 1, height: 1, insets: { top: 56, right: 16, bottom: 88, left: 16 } });
    useCamera.getState().setViewport(660, 800);
  });

  it('has the same zoom range as a wide window', () => {
    assert.deepEqual(zoomRange(), { min: MIN_ZOOM, max: MAX_ZOOM });
  });

  it('fits the whole board, however far it has to zoom out', () => {
    fitTo(board);
    const { camera, width, height, insets } = useCamera.getState();
    assert.ok(camera.zoom < 0.6, `the fit stopped at ${camera.zoom}`);
    const box = onScreen(board);
    assert.ok(box.left >= insets.left - 1e-6 && box.right <= width - insets.right + 1e-6, `the board is cut off sideways: ${JSON.stringify(box)}`);
    assert.ok(box.top >= insets.top - 1e-6 && box.bottom <= height - insets.bottom + 1e-6, `the board is cut off up or down: ${JSON.stringify(box)}`);
  });

  it('zooms out past 60% by steps and to a zoom asked for', () => {
    zoomTo(0.6);
    zoomStep(-1);
    const stepped = useCamera.getState().camera.zoom;
    assert.ok(stepped < 0.6, `a step out from 60% left ${stepped}`);
    zoomTo(0.1);
    assert.equal(useCamera.getState().camera.zoom, 0.1);
    zoomTo(0.001);
    assert.equal(useCamera.getState().camera.zoom, MIN_ZOOM);
  });
});
