/**
 * The focused view: one artboard on its own, clickable ("Play"). Links to
 * other artboards navigate here; arrows step through the page's artboards.
 *
 * The top bar holds the way back and the artboard's title, the Export menu
 * (only without a Shell: a Shell exports from its Share panel), the preview width (Fill only) and Fill / Fit. Fill lays the artboard out
 * at the window's width (or a chosen screen width, scaled down when the
 * window is narrower); Fit shows it at its own size, scaled down to fit. The
 * last Fill / Fit choice is kept for every artboard and later visits; until
 * one is made, an artboard marked `expand: "fill"` opens in Fill, others in Fit.
 */

import { ChevronDown, ChevronLeft, Download } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { boardsOnPage, pageOf } from '@open-artifact/design-core';
import { cn, toast } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { SCREEN_WIDTHS, exportFormats, exportJob } from '../lib/export-formats.ts';
import { runJob } from '../services/export.ts';
import { exportScene } from '../services/shell.ts';
import { session } from '../services/session.ts';
import { focusedFit, storedFit, storeFit } from '../lib/focused-fit.ts';
import { BoardFrame } from './BoardFrame.tsx';
import { ErrorNotice, useBoardProblems, useCanAskAgent } from './BoardErrors.tsx';
import { noticeClosed } from '../lib/board-errors.ts';
import { ChromeButton, ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator, Tip, TipGroup, useShellDraw } from '@open-artifact/editor-kit/react';
import { isTextField } from '@open-artifact/editor-kit';

/** Padding around an artboard in Fit. */
const PAD = 48;

/** Screen widths of the preview width menu (and of "PNG at a screen width"). */
const PRESETS = SCREEN_WIDTHS;

export function FocusedView({ path }: { path: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const entry = useDocument((s) => s.canvas.boards[path]);
  const canvas = useDocument((s) => s.canvas);
  const page = useView((s) => s.page);
  const focus = useView((s) => s.focus);
  // A Shell lists the exports in its Share panel; without one, this view has its own Export menu.
  const shellExports = useShellDraw(session().shell, 'formats');
  const only = useMemo(() => [path], [path]);
  const problem = useBoardProblems(only)[0];
  const closedNotices = useView((s) => s.closedNotices);
  const canAsk = useCanAskAgent();
  // Fill or Fit: the kept choice (null until one is made), across artboards and visits.
  const [preferred, setPreferred] = useState<boolean | null>(() => storedFit());
  // The width Fill lays the page out at (null: the window's); kept across artboards.
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Step through the artboard's own page, whichever page the canvas shows.
  const boardPage = entry ? pageOf(canvas, entry) : page;
  const siblings = boardsOnPage(canvas, boardPage);
  const index = siblings.indexOf(path);
  const step = (direction: -1 | 1): void => {
    if (siblings.length < 2) return;
    focus(siblings[(index + direction + siblings.length) % siblings.length]!);
  };

  // Arrow keys step through artboards when nothing inside the frame has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTextField(event.target)) return;
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = entry?.title || path.replace(/^.*\//, '').replace(/\.dc\.html$/, '');
  const fit = focusedFit(preferred, entry?.expand);

  // The frame: its layout size, on-screen scale and position.
  let frame = { width: 0, height: 0, scale: 1, left: 0, top: 0 };
  if (entry && size.width > 0) {
    if (fit) {
      const scale = Math.max(0.05, Math.min(1, (size.width - PAD * 2) / entry.w, (size.height - PAD * 2) / entry.h));
      frame = { width: entry.w, height: entry.h, scale, left: (size.width - entry.w * scale) / 2, top: (size.height - entry.h * scale) / 2 };
    } else if (previewWidth) {
      const scale = Math.min(1, size.width / previewWidth);
      frame = { width: previewWidth, height: Math.max(1, Math.round(size.height / scale)), scale, left: (size.width - previewWidth * scale) / 2, top: 0 };
    } else {
      frame = { width: size.width, height: size.height, scale: 1, left: 0, top: 0 };
    }
  }

  const exportWidth = !fit && frame.width > 0 && frame.width !== entry?.w ? frame.width : null;
  useLayoutEffect(() => {
    useView.setState({ focusedExportWidth: exportWidth });
    return () => useView.setState({ focusedExportWidth: null });
  }, [exportWidth]);

  const navigate = (target: string): void => {
    if (useDocument.getState().canvas.boards[target]) focus(target);
    else toast.add({ title: 'That artboard is not on the canvas', description: target });
  };

  return (
    <div className="relative flex size-full flex-col bg-canvas">
      <TipGroup>
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-chrome-line bg-chrome px-2 text-chrome-fg">
          <Tip label="Back to canvas" shortcut="Esc">
            <ChromeButton square aria-label="Back to canvas" onClick={() => focus(null)}>
              <ChevronLeft className="size-4" />
            </ChromeButton>
          </Tip>
          <h1 className="min-w-0 flex-1 truncate px-1 text-[14px] font-medium leading-5">{entry ? title : ''}</h1>
          {entry ? (
            <>
              {shellExports ? null : <ExportMenu />}
              {!fit ? <PreviewWidthMenu value={previewWidth} onChange={setPreviewWidth} shown={frame.width} scale={frame.scale} boardWidth={entry.w} /> : null}
              <FillFit
                fit={fit}
                onChange={(next) => {
                  setPreferred(next);
                  storeFit(next);
                }}
              />
            </>
          ) : null}
        </header>
      </TipGroup>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
        {!entry ? (
          <div className="flex size-full items-center justify-center text-fg-muted">This artboard is no longer on the canvas.</div>
        ) : size.width > 0 ? (
          <div
            className={cn('absolute overflow-hidden bg-white', fit && 'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_32px_rgba(0,0,0,0.12)]')}
            style={{
              width: frame.width,
              height: frame.height,
              left: frame.left,
              top: frame.top,
              transform: frame.scale === 1 ? undefined : `scale(${frame.scale})`,
              transformOrigin: '0 0',
              borderRadius: fit ? entry.radius : 0,
            }}
          >
            <BoardFrame key={path} path={path} mode="play" width={frame.width} height={frame.height} interactive onNavigate={navigate} />
          </div>
        ) : null}
        {problem && !noticeClosed(closedNotices, problem) ? <ErrorNotice problem={problem} canAsk={canAsk} className="absolute inset-x-3 bottom-3" /> : null}
      </div>
    </div>
  );
}

/* --------------------------------- export --------------------------------- */

/** Without a Shell, the formats its Export tab would list, for this artboard, its page and the canvas. */
function ExportMenu() {
  // The menu follows what it exports: the preview width, and the artboards on the canvas.
  useView((s) => s.focusedExportWidth);
  useDocument((s) => s.canvas.boards);
  const scene = exportScene();
  const formats = exportFormats(scene);
  const start = async (format: string, variant: string): Promise<void> => {
    const job = exportJob(exportScene(), format, variant);
    if (!job) return;
    const outcome = await runJob(job);
    if (outcome.state === 'busy') toast.add({ title: 'Still exporting…' });
    else if (outcome.state === 'failed') toast.add({ title: 'Couldn’t export', description: outcome.reason });
  };
  return (
    <ChromeMenu
      align="end"
      className="max-h-[min(80vh,720px)] w-[440px] max-w-[calc(100vw-16px)] overflow-y-auto"
      tip={{ label: 'Export' }}
      trigger={
        <ChromeButton square aria-label="Export">
          <Download className="size-4" />
        </ChromeButton>
      }
    >
      {formats.map((format, index) => (
        <Fragment key={format.format}>
          {index ? <ChromeMenuSeparator /> : null}
          <ChromeMenuLabel>{format.label}</ChromeMenuLabel>
          {(format.variants ?? []).map((variant) => (
            <ChromeMenuItem key={variant.id} title={variant.label} disabled={format.disabled || variant.disabled} onSelect={() => void start(format.format, variant.id)}>
              {variant.label}
            </ChromeMenuItem>
          ))}
        </Fragment>
      ))}
    </ChromeMenu>
  );
}

/* ------------------------------ preview width ------------------------------ */

/** The width Fill lays the page out at: the window's, a screen size, or the artboard's. */
function PreviewWidthMenu({ value, onChange, shown, scale, boardWidth }: { value: number | null; onChange: (width: number | null) => void; shown: number; scale: number; boardWidth: number }) {
  const readout = scale < 1 ? `${shown} px · ${Math.round(scale * 100)}%` : `${shown} px`;
  const item = (width: number, label: ReactNode) => (
    <ChromeMenuItem key={width} checked={value === width} shortcut={`${width} px`} onSelect={() => onChange(width)}>
      {label}
    </ChromeMenuItem>
  );
  return (
    <ChromeMenu
      align="end"
      className="w-[280px]"
      tip={{ label: 'Lay the page out at another screen width' }}
      trigger={
        <ChromeButton aria-label="Preview width" className="min-w-[84px] gap-1 tabular-nums">
          {readout}
          <ChevronDown className="size-3.5 text-chrome-muted" />
        </ChromeButton>
      }
    >
      <ChromeMenuItem checked={value === null} description="Follows the window as you resize it" onSelect={() => onChange(null)}>
        Window width
      </ChromeMenuItem>
      <ChromeMenuSeparator />
      {PRESETS.map(([width, label]) => item(width, label))}
      {PRESETS.some(([width]) => width === boardWidth) ? null : item(boardWidth, 'Artboard width')}
    </ChromeMenu>
  );
}

/* --------------------------------- fill/fit -------------------------------- */

/** Fill the window, or the artboard at its own size scaled down to fit. */
function FillFit({ fit, onChange }: { fit: boolean; onChange: (fit: boolean) => void }) {
  const segment = (value: boolean, label: string, tip: string) => (
    <Tip label={tip}>
      <button
        type="button"
        role="radio"
        aria-checked={fit === value}
        onClick={() => onChange(value)}
        className={cn(
          'h-6 rounded-[6px] px-2.5 text-[13px] font-control leading-5 outline-none transition-colors duration-100',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
          fit === value ? 'bg-chrome text-chrome-fg shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.08)]' : 'text-chrome-muted hover:text-chrome-fg',
        )}
      >
        {label}
      </button>
    </Tip>
  );
  return (
    <div role="radiogroup" aria-label="Artboard size" className="ml-1 flex h-7 items-center gap-0.5 rounded-[8px] bg-chrome-hover p-0.5">
      {segment(false, 'Fill', 'Fill the window')}
      {segment(true, 'Fit', 'At its own size, scaled down to fit')}
    </div>
  );
}
