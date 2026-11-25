/**
 * The image crop editor: over the `<img>` (or `<video>`) being cropped, the
 * whole element shows uncropped, the parts the crop cuts away are dimmed and
 * the crop frame is drawn with eight handles. Drag a handle (Shift on a
 * corner keeps the aspect) or the frame; the edit lands on release as
 * `clip-path: inset(…)` (lib/crop.ts). Enter or Escape ends cropping.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { attributeValue, resolveElement, styleMap } from '@open-artifact/dc';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { boardApi } from '../services/frames.ts';
import { templateOf } from '../services/agent.ts';
import { edit } from '../services/commands.ts';
import { announce } from '../services/announce.ts';
import { isTextField } from '@open-artifact/editor-kit';
import { endsMode } from '../lib/mode-keys.ts';
import { CROP_HANDLES, dragCrop, formatInset, parseInset, type CropHandle, type Insets } from '../lib/crop.ts';

const CURSOR: Record<CropHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  move: 'move',
};

export function CropOverlay() {
  const crop = useView((s) => s.crop);
  const camera = useView((s) => s.camera);
  const tick = useView((s) => s.layoutTick);
  const entry = useDocument((s) => (crop ? s.canvas.boards[crop.board] : undefined));
  const source = useDocument((s) => (crop ? (s.boards[crop.board]?.source ?? null) : null));
  const [live, setLive] = useState<Insets | null>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: Insets } | null>(null);

  const rect = useMemo(() => {
    if (!crop) return null;
    try {
      return boardApi(crop.board)?.rects([crop.tid])[crop.tid]?.[0] ?? null;
    } catch {
      return null;
    }
  }, [crop, tick, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const element = useMemo(() => (crop && source ? resolveElement(templateOf(source), crop.tid, crop.path) : null), [crop, source]);
  const written = element ? styleMap(attributeValue(element, 'style') ?? '')['clip-path'] : undefined;

  // While cropping, the whole image shows (the dimmed parts are what the crop cuts away).
  useEffect(() => {
    if (!crop) return;
    const frame = requestAnimationFrame(() => boardApi(crop.board)?.preview(crop.tid, { 'clip-path': 'none' }));
    return () => {
      cancelAnimationFrame(frame);
      boardApi(crop.board)?.preview(crop.tid, null);
    };
  }, [crop, source]);

  // Enter or Escape ends cropping.
  useEffect(() => {
    if (!crop) return;
    const onKey = (event: KeyboardEvent): void => {
      if (!endsMode(event, isTextField(event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      useView.getState().setCrop(null);
      announce('Crop done');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [crop]);

  if (!crop || !entry || !rect || !element) return null;
  const { width, height } = rect;
  const insets = live ?? parseInset(written, width, height);
  const z = camera.zoom;
  const left = (entry.x + rect.x) * z + camera.x;
  const top = (entry.y + rect.y) * z + camera.y;
  const frame = { left: left + insets.left * z, top: top + insets.top * z, width: (width - insets.left - insets.right) * z, height: (height - insets.top - insets.bottom) * z };

  const begin = (handle: CropHandle) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    drag.current = { handle, x: event.clientX, y: event.clientY, start: insets };
    const move = (e: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      const next = dragCrop(d.start, d.handle, (e.clientX - d.x) / z, (e.clientY - d.y) / z, width, height, e.shiftKey);
      setLive(next);
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const next = dragCrop(d.start, d.handle, (e.clientX - d.x) / z, (e.clientY - d.y) / z, width, height, e.shiftKey);
      setLive(null);
      edit(crop.board, { kind: 'style', targets: [{ tid: crop.tid, path: crop.path }], patch: { 'clip-path': formatInset(next) } }, { coalesce: `crop:${crop.tid}` });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pos = (handle: Exclude<CropHandle, 'move'>) => ({
    left: handle.includes('w') ? frame.left : handle.includes('e') ? frame.left + frame.width : frame.left + frame.width / 2,
    top: handle.includes('n') ? frame.top : handle.includes('s') ? frame.top + frame.height : frame.top + frame.height / 2,
  });

  return (
    <div className="absolute inset-0" aria-label="Crop image" role="group">
      {/* The cut-away parts, dimmed. */}
      <svg className="pointer-events-none absolute inset-0 size-full">
        <path
          fillRule="evenodd"
          fill="rgb(0 0 0 / 0.45)"
          d={`M${left} ${top}h${width * z}v${height * z}h${-width * z}Z M${frame.left} ${frame.top}v${frame.height}h${frame.width}v${-frame.height}Z`}
        />
      </svg>
      <div
        className="pointer-events-auto absolute border border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
        style={{ ...frame, cursor: CURSOR.move }}
        onPointerDown={begin('move')}
      >
        {/* Rule-of-thirds guides. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_33.2%,rgb(255_255_255/0.5)_33.3%,transparent_33.4%,transparent_66.6%,rgb(255_255_255/0.5)_66.7%,transparent_66.8%),linear-gradient(to_bottom,transparent_33.2%,rgb(255_255_255/0.5)_33.3%,transparent_33.4%,transparent_66.6%,rgb(255_255_255/0.5)_66.7%,transparent_66.8%)]" />
      </div>
      {CROP_HANDLES.map((handle) => {
        const p = pos(handle);
        const corner = handle.length === 2;
        return (
          <div
            key={handle}
            role="slider"
            aria-label={`Crop ${handle}`}
            aria-valuenow={Math.round(handle.includes('n') ? insets.top : handle.includes('s') ? insets.bottom : handle.includes('w') ? insets.left : insets.right)}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-[#257de0] bg-white shadow"
            style={{ left: p.left, top: p.top, width: corner ? 10 : handle === 'n' || handle === 's' ? 18 : 6, height: corner ? 10 : handle === 'e' || handle === 'w' ? 18 : 6, cursor: CURSOR[handle] }}
            onPointerDown={begin(handle)}
          />
        );
      })}
    </div>
  );
}
