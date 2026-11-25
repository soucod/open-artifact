/**
 * The chrome around the canvas:
 *
 * - top left: the page switcher (and, outside a Shell, the title);
 * - top right: the artboards' errors, Play, the properties toggle, the zoom
 *   readout and save status;
 * - bottom center: the tools and "Ask <agent>".
 *
 * Cards sit 12px from the window edges; top controls are 28px, foot
 * controls 32px.
 */

import { Popover } from '@base-ui/react/popover';
import {
  Check,
  ChevronDown,
  CloudOff,
  Ellipsis,
  Hand,
  Loader2,
  Lock,
  Play,
  Plus,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { boardsOnPage } from '@open-artifact/design-core';
import { Button, CommitInput, Dialog, cn, isComposingKey } from '@open-artifact/ui';
import { useDocument, type SaveState } from '../state/document.ts';
import { PEN_WEIGHTS, useView, type PenStyle, type Tool } from '../state/view.ts';
import { useAgent } from '../services/agent.ts';
import { session } from '../services/session.ts';
import { addPage, deletePage, redo, renamePage, undo } from '../services/commands.ts';
import { ZOOM_PRESETS, zoomStep, zoomTo, zoomToBoards, zoomToFit } from '../services/viewport.ts';
import { MAX_ZOOM, MIN_ZOOM } from '../state/view.ts';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator, MOD, Tip, useShellDraw } from '@open-artifact/editor-kit/react';
import { ErrorsList } from './BoardErrors.tsx';
import { ArrowIcon, CursorIcon, FrameIcon, LineIcon, NoteIcon, OvalIcon, PencilIcon, RectIcon, TextIcon } from './tool-icons.tsx';

/* ================================ top left ================================ */

/** Top-left card: the page switcher, with the title when no Shell shows it. */
export function StartCard({ compact = false }: { compact?: boolean }) {
  const framed = Boolean(session().shell);
  const readOnly = useDocument((s) => s.readOnly);
  const title = useDocument((s) => s.title);
  return (
    <Card className="h-9 px-1 py-px">
      {framed || compact ? null : (
        <>
          {readOnly ? (
            <span className="max-w-56 truncate px-[9px] text-[14px] font-control">{title || 'Untitled design'}</span>
          ) : (
            <CommitInput
              aria-label="Design title"
              value={title}
              placeholder="Untitled design"
              className="h-7 w-44 rounded-[8px] border-transparent bg-transparent px-[9px] text-[14px] font-control text-chrome-fg hover:bg-chrome-hover focus:border-transparent focus:bg-chrome-hover"
              onCommit={(value) => {
                const clean = value.trim().slice(0, 200);
                useDocument.getState().setTitle(clean);
                useDocument.getState().updateCanvas((c) => ({ ...c, title: clean || undefined }));
              }}
            />
          )}
          <ChromeDivider />
        </>
      )}
      <PagePill />
      {compact && <><ChromeDivider /><FootToolbar compact /></>}
    </Card>
  );
}

/** "Page 1 ⌄": opens the page list. */
function PagePill() {
  const shellActions = useShellDraw(session().shell, 'actions');
  const title = useDocument(s => s.title);
  const pages = useDocument((s) => s.canvas.pages);
  const readOnly = useDocument((s) => s.readOnly);
  const page = useView((s) => s.page);
  const setPage = useView((s) => s.setPage);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const list = pages.length ? pages : [{ id: '', name: 'Page 1' }];
  const current = list.find((p) => p.id === page) ?? list[0]!;
  const canvas = useDocument((s) => s.canvas);

  const remove = (id: string): void => {
    const first = canvas.pages[0]?.id;
    const hasContent =
      Object.values(canvas.boards).some((e) => (e.page ?? first) === id) || Object.values(canvas.notes).some((n) => (n.page ?? first) === id);
    if (hasContent) setConfirmDelete(id);
    else deletePage(id);
  };

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tip label={current.name} shortcut={undefined}>
          <Popover.Trigger
            render={
              <ChromeButton className="pr-2" aria-label={`Pages: ${readOnly ? 'switch pages' : 'switch, add, rename or delete a page'}`}>
                {list.length > 1 ? (
                  <span className="min-w-[18px] rounded-full bg-chrome-hover px-1.5 text-[11px] leading-[18px] tabular-nums text-chrome-muted">{list.length}</span>
                ) : null}
                <span className="max-w-[min(20rem,clamp(10rem,50cqw-11rem,20rem))] truncate">{current.name}</span>
                <ChevronDown className="-mx-0.5 size-3 text-chrome-muted" strokeWidth={2} />
              </ChromeButton>
            }
          />
        </Tip>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[1000]">
            <Popover.Popup className="min-w-60 max-w-[28rem] rounded-[12px] bg-chrome p-1 text-[14px] font-control leading-5 text-chrome-fg shadow-chrome-popup outline-none transition-[opacity,transform] duration-100 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              {!shellActions && <CommitInput aria-label="Design title" value={title} disabled={readOnly} className="mb-1 w-full px-2 py-1 text-[13px] font-medium" onCommit={value => {
                const clean = value.trim().slice(0, 200);
                useDocument.getState().setTitle(clean);
                useDocument.getState().updateCanvas(c => ({ ...c, title: clean || undefined }));
              }} />}
              {list.map((p) => (
                <div key={p.id || 'implicit'} className="group flex items-center gap-0.5">
                  <button
                    type="button"
                    className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2.5 text-left outline-none hover:bg-chrome-hover focus-visible:bg-chrome-hover"
                    onClick={() => {
                      setPage(p.id || null);
                      setOpen(false);
                    }}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {p.id === current.id ? <Check className="size-4 text-chrome-accent" strokeWidth={2.25} /> : null}
                    </span>
                    <span className="truncate">{p.name}</span>
                  </button>
                  {readOnly || !p.id ? null : (
                    <ChromeMenu
                      align="end"
                      trigger={
                        <button
                          type="button"
                          aria-label={`Actions for ${p.name}`}
                          className="flex size-7 shrink-0 items-center justify-center rounded-[8px] text-chrome-muted opacity-0 outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
                        >
                          <Ellipsis className="size-4" />
                        </button>
                      }
                    >
                      <ChromeMenuItem
                        onSelect={() => {
                          setOpen(false);
                          setRenaming(p.id);
                        }}
                      >
                        Rename
                      </ChromeMenuItem>
                      <ChromeMenuItem
                        danger
                        disabled={pages.length <= 1}
                        title={pages.length <= 1 ? 'A canvas needs at least one page.' : undefined}
                        onSelect={() => {
                          setOpen(false);
                          remove(p.id);
                        }}
                      >
                        Delete
                      </ChromeMenuItem>
                    </ChromeMenu>
                  )}
                </div>
              ))}
              <div className="mx-2 my-1 h-px bg-chrome-line" />
              {readOnly ? null : (
                <>
                  <button
                    type="button"
                    className="flex h-7 w-full items-center gap-2 rounded-[8px] px-2.5 text-left outline-none hover:bg-chrome-hover focus-visible:bg-chrome-hover"
                    onClick={() => {
                      addPage();
                      setOpen(false);
                    }}
                  >
                    <Plus className="size-4 text-chrome-muted" />
                    New page
                  </button>
                </>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <RenameDialog id={renaming} onClose={() => setRenaming(null)} />
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(next) => !next && setConfirmDelete(null)}
        title="Delete this page?"
        description="Its artboards and notes are deleted too. You can undo this."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmDelete) deletePage(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </>
  );
}

/** Rename a page. */
function RenameDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const page = useDocument((s) => s.canvas.pages.find((p) => p.id === id));
  const [name, setName] = useState('');
  useEffect(() => setName(page?.name ?? ''), [id]); // seed the draft when the dialog opens
  const commit = (): void => {
    if (id) renamePage(id, name);
    onClose();
  };
  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Rename page"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={commit}>
            Rename
          </Button>
        </>
      }
    >
      <input
        autoFocus
        className="h-8 w-full rounded-control border border-line bg-surface-2 px-2 text-[13px] outline-none focus:border-accent"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !isComposingKey(event.nativeEvent)) commit();
        }}
      />
    </Dialog>
  );
}

/* ================================ top right =============================== */

/** Top-right card: the artboards' errors, Play, the properties toggle, zoom and save status. */
export function EndCard() {
  const panelOpen = useView((s) => s.panelOpen);
  const togglePanel = useView((s) => s.togglePanel);
  return (
    <Card className="h-9 px-1 py-px">
      <ErrorsList />
      <PlayMenu />
      <Tip label={panelOpen ? 'Hide the properties panel' : 'Show the properties panel'} shortcut={`${MOD}\\`}>
        <ChromeButton square className="mx-0.5" pressed={panelOpen} aria-label={panelOpen ? 'Hide the properties panel' : 'Show the properties panel'} onClick={togglePanel}>
          <SlidersHorizontal className="size-5" strokeWidth={1.5} />
        </ChromeButton>
      </Tip>
      <ZoomMenu />
      <SaveStatus />
    </Card>
  );
}

/** ▷ Play: opens an artboard of this page full-window. */
function PlayMenu() {
  const canvas = useDocument((s) => s.canvas);
  const page = useView((s) => s.page);
  const focus = useView((s) => s.focus);
  const boards = boardsOnPage(canvas, page);
  const prototypes = boards.filter((path) => canvas.boards[path]?.is_interactive);
  const statics = boards.filter((path) => !canvas.boards[path]?.is_interactive);
  const name = (path: string) => canvas.boards[path]?.title || path.replace(/\.dc\.html$/, '');
  const empty = boards.length === 0;
  const button = (
    <ChromeButton square className="mx-0.5" disabled={empty} aria-label="Play an artboard">
      <Play className="size-5" strokeWidth={1.5} />
    </ChromeButton>
  );
  if (empty) {
    return (
      <Tip label="This page has no artboards to play yet.">
        <span className="inline-flex">{button}</span>
      </Tip>
    );
  }
  return (
    <ChromeMenu align="end" tip={{ label: 'Play an artboard' }} trigger={button}>
      {prototypes.length ? <ChromeMenuLabel>Prototypes</ChromeMenuLabel> : null}
      {prototypes.map((path) => (
        <ChromeMenuItem key={path} onSelect={() => focus(path)}>
          {name(path)}
        </ChromeMenuItem>
      ))}
      {prototypes.length && statics.length ? <ChromeMenuSeparator /> : null}
      {statics.length && prototypes.length ? <ChromeMenuLabel>Static artboards</ChromeMenuLabel> : null}
      {statics.map((path) => (
        <ChromeMenuItem key={path} onSelect={() => focus(path)}>
          {name(path)}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );
}

/** "54% ⌄": the zoom readout and its menu. */
function ZoomMenu() {
  const zoom = useView((s) => s.camera.zoom);
  const selection = useView((s) => s.selection);
  const readOnly = useDocument((s) => s.readOnly);
  const canUndo = useDocument((s) => s.undo.length > 0);
  const canRedo = useDocument((s) => s.redo.length > 0);
  const toolbarTop = useView((s) => s.toolbarTop);
  const percent = Math.max(1, Math.round(zoom * 100));
  const preset = ZOOM_PRESETS.some((value) => Math.abs(value - zoom) < 1e-4);
  return (
    <ChromeMenu
      align="end"
      tip={{ label: `Zoom: ${MOD}0 or ⇧1 fit, ⇧2 zoom to selection, ${MOD}+ / ${MOD}− step` }}
      trigger={
        <ChromeButton className="pl-2 pr-2 tabular-nums" aria-label={`Zoom ${percent}%`}>
            <span className="grid">
              <span className="invisible col-start-1 row-start-1" aria-hidden="true">
                100%
              </span>
              <span className="col-start-1 row-start-1 text-right">{percent}%</span>
            </span>
            <ChevronDown className="-mx-0.5 size-3 text-chrome-muted" strokeWidth={2} />
        </ChromeButton>
      }
    >
      <ChromeMenuItem shortcut={`${MOD}+`} disabled={zoom >= MAX_ZOOM - 1e-6} onSelect={() => zoomStep(1)}>
        Zoom in
      </ChromeMenuItem>
      <ChromeMenuItem shortcut={`${MOD}−`} disabled={zoom <= MIN_ZOOM + 1e-6} onSelect={() => zoomStep(-1)}>
        Zoom out
      </ChromeMenuItem>
      <ChromeMenuItem shortcut="⇧1" onSelect={zoomToFit}>
        Fit artboards
      </ChromeMenuItem>
      <ChromeMenuItem
        shortcut="⇧2"
        disabled={selection.kind === 'none'}
        title={selection.kind === 'none' ? 'Select something to zoom to it.' : undefined}
        onSelect={() => {
          if (selection.kind === 'objects') zoomToBoards(selection.boards);
          else if (selection.kind === 'elements') zoomToBoards([selection.board]);
        }}
      >
        Zoom to selection
      </ChromeMenuItem>
      <ChromeMenuSeparator />
      {preset ? null : <ChromeMenuLabel>Now {percent}%</ChromeMenuLabel>}
      {ZOOM_PRESETS.map((value) => (
        <ChromeMenuItem key={value} checked={Math.abs(value - zoom) < 1e-4} shortcut={value === 1 ? `${MOD}0` : undefined} onSelect={() => zoomTo(value)}>
          {value * 100}%
        </ChromeMenuItem>
      ))}
      {readOnly ? null : (
        <>
          <ChromeMenuSeparator />
          <ChromeMenuItem shortcut={`${MOD}Z`} disabled={!canUndo} onSelect={undo}>
            Undo
          </ChromeMenuItem>
          <ChromeMenuItem shortcut={`⇧${MOD}Z`} disabled={!canRedo} onSelect={redo}>
            Redo
          </ChromeMenuItem>
        </>
      )}
      <ChromeMenuSeparator />
      <ChromeMenuItem shortcut={`${MOD}F`} onSelect={() => useView.getState().setFindOpen(true)}>
        Find…
      </ChromeMenuItem>
      <ChromeMenuItem checked={toolbarTop} onSelect={() => useView.getState().setToolbarTop(!toolbarTop)}>
        Toolbar at top
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

const SAVE_LABEL: Record<Exclude<SaveState, 'saved'>, { label: string; icon: ReactNode }> = {
  dirty: { label: 'Unsaved changes', icon: <span className="size-1.5 rounded-full bg-chrome-muted" /> },
  saving: { label: 'Saving…', icon: <Loader2 className="size-3.5 animate-spin" /> },
  error: { label: 'Could not save', icon: <TriangleAlert className="size-3.5 text-danger" /> },
  offline: { label: 'Offline, retrying', icon: <CloudOff className="size-3.5" /> },
  readonly: { label: 'View only', icon: <Lock className="size-3.5" /> },
};

/** Save status, only when there is something to say. */
function SaveStatus() {
  const save = useDocument((s) => s.save);
  // In a Shell its bar shows the save state.
  const shellSaved = useShellDraw(session().shell, 'saved');
  if (shellSaved || save === 'saved') return null;
  const status = SAVE_LABEL[save];
  return (
    <Tip label={status.label}>
      <span role="status" aria-label={status.label} className="flex h-7 items-center gap-1.5 px-2 text-[13px] text-chrome-muted">
        {status.icon}
        <span className="hidden xl:inline">{status.label}</span>
      </span>
    </Tip>
  );
}

/* ================================ foot bar ================================ */

interface ToolSpec {
  tool: Tool;
  label: string;
  key: string;
  icon: ReactNode;
}

const ICON = { className: 'size-5', strokeWidth: 1.5 } as const;

// The pen and image tools are also available from the keyboard.
const SELECT: ToolSpec = { tool: 'select', label: 'Select', key: 'V', icon: <CursorIcon /> };
const HAND: ToolSpec = { tool: 'hand', label: 'Hand, or hold Space', key: 'H', icon: <Hand {...ICON} /> };
const CREATE: ToolSpec[] = [
  { tool: 'title', label: 'Text', key: 'T', icon: <TextIcon /> },
  { tool: 'board', label: 'Artboard', key: 'A', icon: <FrameIcon /> },
  { tool: 'sticky', label: 'Note', key: 'N', icon: <NoteIcon /> },
  { tool: 'pen', label: 'Pencil', key: 'P', icon: <PencilIcon /> },
];
const SHAPES: ToolSpec[] = [
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: <RectIcon /> },
  { tool: 'oval', label: 'Oval', key: 'O', icon: <OvalIcon /> },
  { tool: 'arrow', label: 'Arrow', key: '⇧L', icon: <ArrowIcon /> },
  { tool: 'line', label: 'Line', key: 'L', icon: <LineIcon /> },
];

/** Foot-bar tooltips open away from the window edge the toolbar sits on. */
function useTipSide(): 'top' | 'bottom' {
  return useView((s) => (s.toolbarTop ? 'bottom' : 'top'));
}

/** Picks a tool; picking the active one again puts it down. */
function pick(tool: Tool): void {
  const view = useView.getState();
  view.setTool(view.tool === tool && tool !== 'select' ? 'select' : tool);
}

function ToolButton({ spec, children, optionsFor = [] }: { spec: ToolSpec; children?: ReactNode; optionsFor?: Tool[] }) {
  const tipSide = useTipSide();
  const active = useView((s) => s.tool === spec.tool);
  const options = useView((s) => s.tool === spec.tool || optionsFor.includes(s.tool));
  return (
    <span className="relative inline-flex">
      <Tip label={spec.label} shortcut={spec.key} side={tipSide}>
        <ChromeButton size="lg" square pressed={active} aria-label={spec.label} onClick={() => pick(spec.tool)}>
          {spec.icon}
        </ChromeButton>
      </Tip>
      {options ? children : null}
    </span>
  );
}

/** A small floating bar above a tool, for its options. */
function SubBar({ label, children }: { label: string; children: ReactNode }) {
  const composer = useView((s) => s.composer);
  const top = useView((s) => s.toolbarTop);
  if (composer) return null;
  return (
    <div role="toolbar" aria-label={label} className={cn('absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[12px] bg-chrome p-1 shadow-chrome', top ? 'top-full mt-3' : 'bottom-full mb-3')}>
      {children}
    </div>
  );
}

/** Option button of a {@link SubBar}. */
function SubButton({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick(): void; children: ReactNode }) {
  const tipSide = useTipSide();
  return (
    <Tip label={label} side={tipSide}>
      <ChromeButton square pressed={pressed} aria-label={label} onClick={onClick}>
        {children}
      </ChromeButton>
    </Tip>
  );
}

/** A stroke sample for the pencil options. */
function StrokeSample({ width = 2, dash = 'solid', muted = false }: { width?: number; dash?: PenStyle['dash']; muted?: boolean }) {
  const pattern = dash === 'dashed' ? '5 4' : dash === 'dotted' ? '0 4' : undefined;
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" className={muted ? 'text-chrome-muted' : undefined}>
      <line x1="2" y1="6" x2="16" y2="6" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeDasharray={pattern} />
    </svg>
  );
}

const DASHES: { value: PenStyle['dash']; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

/** How thick each of `PEN_WEIGHTS` is drawn in its button. */
const SAMPLE_WIDTHS = [1.25, 2, 4, 7];

/** Pencil options: stroke weight, then dash. */
function PenOptions({ label }: { label: string }) {
  const pen = useView((s) => s.pen);
  const setPen = useView((s) => s.setPen);
  return (
    <SubBar label={label}>
      {PEN_WEIGHTS.map((weight, i) => (
        <SubButton key={weight} label={['Thin', 'Regular', 'Bold', 'Heavy'][i] ?? `${weight}px`} pressed={pen.stroke === weight} onClick={() => setPen({ stroke: weight })}>
          <StrokeSample width={SAMPLE_WIDTHS[i] ?? 2} muted={pen.stroke !== weight} />
        </SubButton>
      ))}
      <ChromeDivider className="mx-0" />
      {DASHES.map((dash) => (
        <SubButton key={dash.value} label={dash.label} pressed={pen.dash === dash.value} onClick={() => setPen({ dash: dash.value })}>
          <StrokeSample dash={dash.value} muted={pen.dash !== dash.value} />
        </SubButton>
      ))}
    </SubBar>
  );
}

/** Shapes and lines: one button for the last used; picking it opens the set above. */
function ShapesButton() {
  const tipSide = useTipSide();
  const tool = useView((s) => s.tool);
  const [last, setLast] = useState<ToolSpec>(SHAPES[0]!);
  const inGroup = SHAPES.find((spec) => spec.tool === tool);
  useEffect(() => {
    if (inGroup) setLast(inGroup);
  }, [inGroup]);
  const shown = inGroup ?? last;
  return (
    <span className="relative inline-flex">
      <Tip label="Shapes" shortcut={shown.key} side={tipSide}>
        <ChromeButton size="lg" square pressed={Boolean(inGroup)} aria-label="Shapes and lines" onClick={() => pick(shown.tool)}>
          {shown.icon}
        </ChromeButton>
      </Tip>
      {inGroup ? (
        <SubBar label="Shapes and lines">
          {SHAPES.map((spec, i) => (
            <span key={spec.tool} className="inline-flex items-center gap-1">
              {i === 2 ? <ChromeDivider className="mx-0" /> : null}
              <SubButton label={`${spec.label} (${spec.key})`} pressed={tool === spec.tool} onClick={() => useView.getState().setTool(spec.tool)}>
                {spec.icon}
              </SubButton>
            </span>
          ))}
        </SubBar>
      ) : null}
    </span>
  );
}

/** "Ask <agent>": opens the composer. */
function AskButton() {
  const tipSide = useTipSide();
  const status = useAgent((s) => s.status);
  const composer = useView((s) => s.composer);
  const setComposer = useView((s) => s.setComposer);
  const compact = useView(s => s.toolbarTop);
  const name = status.available ? status.name : 'agent';
  return (
    <Tip
      label={status.available ? (status.busy ? `${status.name} is working` : `Send a request to ${status.name}`) : 'No agent is connected; requests wait until one checks this design'}
      shortcut={`${MOD}↵`}
      side={tipSide}
    >
      <ChromeButton
        size="lg"
        pressed={composer}
        className={cn(compact ? 'px-1.5' : 'ml-1 min-w-[100px] gap-1.5 bg-chrome-hover px-3 hover:bg-chrome-line', !status.available && !composer && 'text-chrome-muted')}
        onClick={() => setComposer(!composer)}
      >
        {status.busy ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" /> : null}
        <span className={compact && !status.available ? 'sr-only' : undefined}>Ask {name}</span>
        {compact && !status.available ? <Ellipsis className="size-4" /> : null}
      </ChromeButton>
    </Tip>
  );
}

/** The foot toolbar. */
export function FootToolbar({ compact = false }: { compact?: boolean }) {
  const readOnly = useDocument((s) => s.readOnly);
  const tool = useView((s) => s.tool);
  return (
    <div role="toolbar" aria-label="Canvas tools" className={cn("pointer-events-auto flex items-center text-chrome-fg", compact ? "dc-compact-tools gap-0.5" : "gap-1 rounded-[12px] bg-chrome p-1 shadow-chrome")}>
      <ToolButton spec={SELECT} />
      <ToolButton spec={HAND} />
      {readOnly ? null : (
        <>
          <ChromeDivider className="mx-0" />
          {CREATE.map((spec) => (
            <ToolButton key={spec.tool} spec={spec} optionsFor={spec.tool === 'pen' ? ['path'] : []}>
              {spec.tool === 'pen' ? <PenOptions label={tool === 'path' ? 'Pen options' : 'Pencil options'} /> : null}
            </ToolButton>
          ))}
          <ShapesButton />
        </>
      )}
      {readOnly ? null : <AskButton />}
    </div>
  );
}
