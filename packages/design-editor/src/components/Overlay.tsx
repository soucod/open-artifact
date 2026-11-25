/**
 * Screen-space layer over the canvas: artboard labels, selection outlines,
 * resize handles, hovered and selected element boxes, and the error notices
 * under artboards.
 * Over the canvas engine, which draws selection outlines and handles
 * itself, only the rest is drawn here.
 *
 * Element boxes come from the board runtime (`rects`) in artboard pixels and
 * are mapped through the artboard's position and the camera. Labels of
 * artboards far outside the view are left out.
 */

import { Maximize2, Play, Square, SlidersHorizontal } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { parseDcDocument, tweakEntries, type BoardRect } from '@open-artifact/dc';
import { cn } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView, type Camera } from '../state/view.ts';
import { boardApi } from '../services/frames.ts';
import { ErrorMark, ErrorNotice, useBoardProblems, useCanAskAgent } from './BoardErrors.tsx';
import { noticeClosed } from '../lib/board-errors.ts';
import { noteBounds } from '../lib/notes.ts';
import type { Handle } from './Canvas.tsx';
import { LayoutGuides } from './LayoutGuides.tsx';
import { HoverLink } from './HoverLink.tsx';
import { linkAround } from '../lib/hover-link.ts';
import { templateOf } from '../services/agent.ts';
import { SelectionBar } from './SelectionBar.tsx';
import { useScale } from '../services/scale.ts';
import { viewportSize } from '../services/viewport.ts';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** A screen rect. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const toBox = (camera: Camera, x: number, y: number, w: number, h: number): Box => ({
  left: x * camera.zoom + camera.x,
  top: y * camera.zoom + camera.y,
  width: w * camera.zoom,
  height: h * camera.zoom,
});

/** Element rects of one artboard mapped to screen boxes. */
function elementBoxes(board: string, tids: number[], instance: number | null, camera: Camera): Box[] {
  const entry = useDocument.getState().canvas.boards[board];
  const api = boardApi(board);
  if (!entry || !api || !tids.length) return [];
  let rects: Record<number, BoardRect[]>;
  try {
    rects = api.rects(tids);
  } catch {
    return [];
  }
  const out: Box[] = [];
  for (const tid of tids) {
    const list = rects[tid] ?? [];
    const chosen = instance === null ? list : list.slice(instance, instance + 1);
    for (const rect of chosen) {
      // Clip to the artboard: content outside it is not visible.
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      const w = Math.min(entry.w, rect.x + rect.width) - x;
      const h = Math.min(entry.h, rect.y + rect.height) - y;
      // A straight line is zero-width or zero-height and still selectable.
      if (w >= 0 && h >= 0 && w + h > 0) out.push(toBox(camera, entry.x + x, entry.y + y, w, h));
    }
  }
  return out;
}

/** Screen pixels around the view within which artboard labels are still drawn. */
const LABEL_MARGIN = 240;

export interface OverlayProps {
  boards: string[];
  notes: string[];
  /** The canvas engine draws the canvas, with selection outlines and resize handles. */
  engine?: boolean;
}

export function Overlay({ boards, engine = false }: OverlayProps) {
  const camera = useView((s) => s.camera);
  const selection = useView((s) => s.selection);
  const hover = useView((s) => s.hover);
  const textEdit = useView((s) => s.textEdit);
  const layoutTick = useView((s) => s.layoutTick);
  const focus = useView((s) => s.focus);
  const canvas = useDocument((s) => s.canvas);
  const readOnly = useDocument((s) => s.readOnly);
  const playing = useView(s => s.playing);
  const panelOpen = useView((s) => s.panelOpen);
  const scaling = useScale((s) => s.session !== null);
  const sources = useDocument((s) => s.boards);
  const problems = useBoardProblems(boards);
  const closedNotices = useView((s) => s.closedNotices);
  const canAsk = useCanAskAgent();
  const problemOf = useMemo(() => new Map(problems.map((problem) => [problem.path, problem])), [problems]);
  const tweakable = useMemo(() => {
    const out = new Set<string>();
    for (const path of boards) {
      const source = sources[path]?.source;
      if (!source) continue;
      try {
        if (tweakEntries(parseDcDocument(source).props).length) out.add(path);
      } catch {
        // An unreadable file has no tweaks to show.
      }
    }
    return out;
  }, [boards, sources]);

  const selectedBoxes = useMemo(() => {
    if (selection.kind !== 'elements') return [];
    return selection.items.flatMap((item) => elementBoxes(selection.board, [item.tid], item.instance, camera));
    // layoutTick: rects move when the artboard re-renders.
  }, [selection, camera, layoutTick, canvas]);

  const hoverBoxes = useMemo(() => {
    if (!hover || textEdit) return [];
    if (selection.kind === 'elements' && selection.board === hover.board && selection.items.some((i) => i.tid === hover.tid)) return [];
    return elementBoxes(hover.board, [hover.tid], null, camera);
  }, [hover, selection, textEdit, camera, layoutTick, canvas]);

  // A hovered element inside a link shows its address; a selected one carries it on the selection bar.
  const hoverLink = useMemo(() => {
    const box = hoverBoxes[0];
    const source = hover ? sources[hover.board]?.source : undefined;
    if (!hover || !box || source == null || playing) return null;
    const href = linkAround(templateOf(source), hover.tid);
    return href ? { href, left: box.left, top: box.top, height: box.height } : null;
  }, [hover, hoverBoxes, sources, playing]);

  const objectBoxes = useMemo(() => {
    if (selection.kind !== 'objects') return [];
    const out: { key: string; box: Box; board?: string; note?: string }[] = [];
    for (const path of selection.boards) {
      const e = canvas.boards[path];
      if (e) out.push({ key: `b:${path}`, box: toBox(camera, e.x, e.y, e.w, e.h), board: path });
    }
    for (const id of selection.notes) {
      const note = canvas.notes[id];
      if (!note) continue;
      const r = noteBounds(note);
      out.push({ key: `n:${id}`, box: toBox(camera, r.x, r.y, r.w, r.h), note: id });
    }
    return out;
  }, [selection, canvas, camera]);

  const single = objectBoxes.length === 1 ? objectBoxes[0]! : null;
  const singleNote = single?.note ? canvas.notes[single.note] : undefined;
  const resizable = Boolean(single && !readOnly && !(singleNote && (singleNote.kind === 'pen' || singleNote.kind === 'line' || singleNote.kind === 'arrow')));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Artboard labels and error notices. */}
      {boards.map((path) => {
        const entry = canvas.boards[path]!;
        const box = toBox(camera, entry.x, entry.y, entry.w, entry.h);
        if (box.width < 24) return null;
        if (box.left > viewportSize.width + LABEL_MARGIN || box.top > viewportSize.height + LABEL_MARGIN || box.left + box.width < -LABEL_MARGIN || box.top + box.height < -LABEL_MARGIN) return null;
        const problem = problemOf.get(path);
        const closed = problem ? noticeClosed(closedNotices, problem) : false;
        const selected = selection.kind === 'objects' ? selection.boards.includes(path) : selection.kind === 'elements' && selection.board === path;
        return (
          // The engine moves selected artboards without the document until the drag ends: their labels hide meanwhile.
          <div key={path} data-gesture-bound={selected ? '' : undefined}>
            {path !== playing && <LayoutGuides entry={entry} zoom={camera.zoom} left={box.left} top={box.top} />}
            <div
              data-board-title={path}
              className="pointer-events-auto absolute flex h-5 items-center gap-1 text-[11px] leading-5"
              style={{ left: box.left, top: box.top - 22, width: Math.max(60, box.width) }}
            >
              <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-accent' : 'text-fg-muted')}>{entry.title || path.replace(/\.dc\.html$/, '')}</span>
              {problem && closed ? <ErrorMark problem={problem} /> : null}
              {box.width >= 64 ? (
                <>
                  {tweakable.has(path) ? (
                    <FrameButton
                      label="Tweaks"
                      onClick={() => {
                        useView.getState().select({ kind: 'objects', boards: [path], notes: [] });
                        useView.getState().setPanel('tweaks', true);
                      }}
                    >
                      <SlidersHorizontal className="size-3" />
                    </FrameButton>
                  ) : null}
                  {entry.is_interactive || path === playing ? <FrameButton label={playing === path ? 'Stop playing' : 'Play on canvas'} onClick={() => useView.getState().play(playing === path ? null : path)}>
                    {playing === path ? <Square className="size-3 text-accent" /> : <Play className="size-3 text-accent" />}
                  </FrameButton> : null}
                  <FrameButton label={entry.is_interactive ? 'Play full screen' : 'Focus'} onClick={() => focus(path)}>
                    <Maximize2 className="size-3" />
                  </FrameButton>
                </>
              ) : entry.is_interactive ? (
                <FrameButton label="Play" onClick={() => focus(path)}>
                  <Play className="size-3" />
                </FrameButton>
              ) : null}
            </div>
            {/* Under the artboard, and under its size label while it is the only thing selected. */}
            {problem && !closed ? (
              <ErrorNotice
                problem={problem}
                canAsk={canAsk}
                onShowAll={() => useView.getState().setErrorsOpen(true)}
                className="absolute"
                style={{ left: box.left, top: box.top + box.height + (single?.board === path ? 28 : 6), width: box.width }}
              />
            ) : null}
          </div>
        );
      })}

      {hoverBoxes.map((box, index) => (
        <div key={`h${index}`} className="absolute border border-accent/70" style={box} />
      ))}
      <HoverLink link={hoverLink} />
      {selectedBoxes.map((box, index) => (
        <div key={`s${index}`} className={cn('absolute border-2', textEdit ? 'border-accent/40' : 'border-accent')} style={box} />
      ))}
      {engine
        ? null
        : objectBoxes.map(({ key, box }) => (
            <div key={key} className="absolute border-2 border-accent" style={{ ...box, left: box.left - 1, top: box.top - 1, width: box.width + 2, height: box.height + 2 }} />
          ))}

      {single && resizable && !engine
        ? HANDLES.filter((handle) => !(singleNote?.kind === 'title1' && handle !== 'e' && handle !== 'w')).map((handle) => {
            const { left, top, width, height } = single.box;
            const x = handle.includes('w') ? left : handle.includes('e') ? left + width : left + width / 2;
            const y = handle.includes('n') ? top : handle.includes('s') ? top + height : top + height / 2;
            return (
              <div
                key={handle}
                data-handle={handle}
                data-handle-board={single.board}
                data-handle-note={single.note}
                className="pointer-events-auto absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-accent bg-white"
                style={{ left: x, top: y, cursor: HANDLE_CURSOR[handle] }}
              />
            );
          })
        : null}

      {selectedBoxes[0] && (!panelOpen || scaling) ? (
        // Hidden while the camera moves: it does not scale with the canvas.
        <div data-camera-bound="">
          <SelectionBar box={selectedBoxes[0]} />
        </div>
      ) : null}

      {single?.board ? (
        <div data-gesture-bound="">
          <SizeLabel box={single.box} w={canvas.boards[single.board]!.w} h={canvas.boards[single.board]!.h} />
        </div>
      ) : null}
    </div>
  );
}

/** A small icon button in an artboard's name strip. */
function FrameButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className="flex size-4 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

/** The selected artboard's size, under it. */
function SizeLabel({ box, w, h }: { box: Box; w: number; h: number }) {
  return (
    <div
      className="absolute -translate-x-1/2 rounded bg-accent px-1 text-[10px] leading-4 text-accent-fg"
      style={{ left: box.left + box.width / 2, top: box.top + box.height + 6 }}
    >
      {w} × {h}
    </div>
  );
}
