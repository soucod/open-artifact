/**
 * The layers list at the top of the Properties and Code tabs: the current
 * page's artboards, each opening into its template tree. Clicking selects
 * (Shift or ⌘ adds); hovering highlights on the canvas.
 *
 * Layers are edited in place, each a minimal source edit through the usual
 * operations (undoable, replayed over remote changes): double-click a name
 * to rename it (`data-label`), the eye hides or shows it (inline
 * `display: none`), and dragging rows moves the elements before, after or
 * into another layer of the same artboard.
 */

import { Box, ChevronRight, Eye, EyeOff, GitBranch, Hash, Image, LayoutGrid, Repeat, Shapes, StretchHorizontal, StretchVertical, Type } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { boardsOnPage, groupSelectionUnits, noteGroupIndex, notesOnPage } from '@open-artifact/design-core';
import { cn, isComposingKey } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { attributeValue } from '@open-artifact/dc';
import { templateOf } from '../services/agent.ts';
import { boardApi } from '../services/frames.ts';
import { edit } from '../services/commands.ts';
import { announce } from '../services/announce.ts';
import { ancestorTids, buildOutline, isHiddenLayer, renameOp, reorderOp, visibilityOps, type OutlineDrop, type OutlineGlyph, type OutlineLayout, type OutlineNode } from '../lib/outline.ts';

const GLYPH_PROPS = { className: 'size-3.5', strokeWidth: 1.75 } as const;

const GLYPHS: Record<OutlineGlyph | 'artboard', ReactNode> = {
  column: <StretchHorizontal {...GLYPH_PROPS} />,
  row: <StretchVertical {...GLYPH_PROPS} />,
  grid: <LayoutGrid {...GLYPH_PROPS} />,
  text: <Type {...GLYPH_PROPS} />,
  frame: <Hash {...GLYPH_PROPS} />,
  artboard: <Hash {...GLYPH_PROPS} />,
  image: <Image {...GLYPH_PROPS} />,
  shape: <Shapes {...GLYPH_PROPS} />,
  component: <Box {...GLYPH_PROPS} />,
  repeat: <Repeat {...GLYPH_PROPS} />,
  conditional: <GitBranch {...GLYPH_PROPS} />,
};

/** One row of the tree. */
function TreeRow({
  level,
  name,
  detail,
  glyph,
  selected,
  hovered,
  open,
  hasChildren,
  bold = true,
  onToggle,
  onSelect,
  onHover,
  row,
  label,
  hidden = false,
  drop = null,
  editable = false,
  onPress,
  onRename,
  onToggleHidden,
}: {
  level: number;
  name: string;
  detail?: string;
  glyph: OutlineGlyph | 'artboard';
  selected: boolean;
  hovered: boolean;
  open: boolean;
  hasChildren: boolean;
  /** Selected rows go medium weight (artboards do not). */
  bold?: boolean;
  onToggle(): void;
  onSelect(additive: boolean): void;
  onHover(on: boolean): void;
  /** Marks the row as a drop target (`data-outline-row`, `data-outline-tid`). */
  row?: { board: string; tid: number };
  /** The layer's own name (`data-label`), edited by Rename. */
  label?: string;
  /** Hidden with `display: none`: the row dims and its eye stays shown. */
  hidden?: boolean;
  /** Where a drag would drop relative to this row. */
  drop?: OutlineDrop | null;
  /** Rename, hide and drag are offered. */
  editable?: boolean;
  /** A left press (after selecting): may start a drag. */
  onPress?(event: ReactMouseEvent): void;
  onRename?(name: string): void;
  onToggleHidden?(): void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      data-outline-row={row?.board}
      data-outline-tid={row?.tid}
      role="treeitem"
      aria-level={level + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      data-outline-selected={selected || undefined}
      onMouseDown={(event) => {
        if (event.button !== 0 || renaming) return;
        event.preventDefault();
        onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
        onPress?.(event);
      }}
      onDoubleClick={(event) => {
        if (!editable || !onRename) return;
        event.preventDefault();
        setRenaming(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'F2' && editable && onRename) setRenaming(true);
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        'group/row relative flex h-6 cursor-default select-none items-center rounded-[6px] pr-1 text-[12px] leading-4',
        selected ? cn('bg-chrome-selected text-chrome-fg', bold && 'font-medium') : cn('text-chrome-secondary', hovered ? 'bg-chrome-hover' : 'hover:bg-chrome-hover'),
        drop === 'inside' && 'outline outline-2 -outline-offset-2 outline-chrome-accent',
      )}
      style={{ paddingLeft: 6 + level * 16 }}
    >
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Collapse' : 'Expand'}
          onMouseDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onToggle();
          }}
          className="flex size-5 shrink-0 items-center justify-center text-chrome-muted hover:text-chrome-fg"
        >
          <ChevronRight className={cn('size-3 transition-transform duration-100', open && 'rotate-90')} strokeWidth={2} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <span className={cn('-ml-1 mr-1.5 flex size-4 shrink-0 items-center justify-center text-chrome-fg/35', hidden && 'opacity-50')}>{GLYPHS[glyph]}</span>
      {renaming ? (
        <input
          autoFocus
          aria-label={`Rename ${name}`}
          defaultValue={label ?? ''}
          placeholder={name}
          className="h-5 min-w-0 flex-1 rounded-[4px] border border-chrome-accent bg-chrome px-1 text-[12px] font-normal text-chrome-fg outline-none"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (isComposingKey(event.nativeEvent)) return;
            if (event.key === 'Enter') {
              onRename?.(event.currentTarget.value);
              setRenaming(false);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setRenaming(false);
            }
          }}
          onBlur={(event) => {
            if (!renaming) return;
            onRename?.(event.currentTarget.value);
            setRenaming(false);
          }}
        />
      ) : (
        <>
          <span className={cn('shrink-0 truncate', hidden && 'opacity-50')}>{name}</span>
          {detail ? <span className={cn('mx-1.5 min-w-0 flex-auto shrink-[9999] truncate font-normal text-chrome-muted', hidden && 'opacity-50')}>{detail}</span> : <span className="flex-auto" />}
        </>
      )}
      {editable && onToggleHidden && !renaming ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
          aria-pressed={hidden}
          onMouseDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onToggleHidden();
          }}
          className={cn('ml-auto flex size-5 shrink-0 items-center justify-center rounded-[4px] text-chrome-muted hover:text-chrome-fg', hidden ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100')}
        >
          {hidden ? <EyeOff className="size-3.5" strokeWidth={1.75} /> : <Eye className="size-3.5" strokeWidth={1.75} />}
        </button>
      ) : null}
      {drop === 'before' || drop === 'after' ? (
        <span aria-hidden="true" className={cn('pointer-events-none absolute right-1 h-0.5 rounded-full bg-chrome-accent', drop === 'before' ? '-top-px' : '-bottom-px')} style={{ left: 6 + level * 16 + 20 }} />
      ) : null}
    </div>
  );
}

/** Rendered layout of each element with children, for Row/Column/Grid names. */
function useLayouts(board: string, source: string | null, enabled: boolean): (tid: number) => OutlineLayout | undefined {
  const tick = useView((s) => s.layoutTick);
  return useMemo(() => {
    const cache = new Map<number, OutlineLayout | undefined>();
    return (tid: number) => {
      if (!enabled) return undefined;
      if (!cache.has(tid)) {
        const computed = boardApi(board)?.inspect(tid)?.computed;
        cache.set(tid, computed ? { display: computed.display ?? '', direction: computed['flex-direction'] ?? '' } : undefined);
      }
      return cache.get(tid);
    };
    // `tick` invalidates the cache when frames re-render.
  }, [board, source, enabled, tick]);
}

/** The tree of one artboard. */
function BoardTree({ path, flipped, flip, unflip, autoOpen }: { path: string; flipped: Set<string>; flip(key: string): void; unflip(keys: string[]): void; autoOpen: boolean }) {
  const entry = useDocument((s) => s.canvas.boards[path]);
  const source = useDocument((s) => s.boards[path]?.source ?? null);
  const selection = useView((s) => s.selection);
  const hover = useView((s) => s.hover);
  const booted = useView((s) => s.frames[path]?.booted ?? false);

  const boardKey = `b:${path}`;
  const boardSelected = selection.kind === 'objects' && selection.boards.includes(path);
  const open = autoOpen !== flipped.has(boardKey);

  const layoutOf = useLayouts(path, source, open && booted);
  const model = useMemo(() => (source && open ? templateOf(source) : null), [source, open]);
  const nodes = useMemo(() => (model ? buildOutline(model, layoutOf) : []), [model, layoutOf]);

  const selectedTids = useMemo(() => new Set(selection.kind === 'elements' && selection.board === path ? selection.items.map((item) => item.tid) : []), [selection, path]);
  const openTids = useMemo(() => {
    const out = new Set<number>();
    if (model && selection.kind === 'elements' && selection.board === path) for (const item of selection.items) for (const tid of ancestorTids(model, item.path)) out.add(tid);
    return out;
  }, [model, selection, path]);

  // Ancestors of a new selection open, whatever was toggled before.
  useEffect(() => {
    if (openTids.size) unflip([...openTids].map((tid) => `${path}:${tid}`));
  }, [openTids, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = useDocument((s) => s.readOnly);
  const [drop, setDrop] = useState<{ tid: number; where: OutlineDrop } | null>(null);

  /** A press on a row: past a few pixels it drags the selected layers of this artboard. */
  const press = (node: OutlineNode) => (event: ReactMouseEvent) => {
    if (readOnly || !model || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let target: { tid: number; where: OutlineDrop } | null = null;
    const dragged = (): number[] => {
      const current = useView.getState().selection;
      return current.kind === 'elements' && current.board === path && current.items.some((item) => item.tid === node.tid) ? current.items.map((item) => item.tid) : [node.tid];
    };
    const move = (e: MouseEvent): void => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
      dragging = true;
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-outline-tid]');
      if (!row || row.dataset.outlineRow !== path) {
        target = null;
        setDrop(null);
        return;
      }
      const tid = Number(row.dataset.outlineTid);
      const box = row.getBoundingClientRect();
      const at = (e.clientY - box.top) / box.height;
      const element = model.elements[tid];
      const inside = element && reorderOp(model, dragged(), tid, 'inside') !== null;
      const where: OutlineDrop = inside ? (at < 0.25 ? 'before' : at > 0.75 ? 'after' : 'inside') : at < 0.5 ? 'before' : 'after';
      target = reorderOp(model, dragged(), tid, where) ? { tid, where } : null;
      setDrop(target);
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrop(null);
      if (!dragging || !target) return;
      const op = reorderOp(model, dragged(), target.tid, target.where);
      if (op && edit(path, op, { selectCreated: true })) announce(`Moved ${target.where === 'inside' ? 'into' : target.where} the layer`);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const rename = (node: OutlineNode) => (name: string) => {
    if (!model) return;
    const op = renameOp(model, node.tid, name);
    if (op && edit(path, op)) announce(name.trim() ? `Renamed to ${name.trim()}` : 'Name removed');
  };

  const toggleHidden = (node: OutlineNode) => () => {
    if (!model) return;
    const element = model.elements[node.tid];
    const hiding = element ? !isHiddenLayer(element) : true;
    const key = `visibility:${node.tid}:${Date.now()}`;
    for (const op of visibilityOps(model, node.tid)) {
      // Each edit re-reads the source, so the second one's address still matches.
      edit(path, op, { coalesce: key });
    }
    announce(hiding ? `${node.name} hidden` : `${node.name} shown`);
  };

  const view = useView.getState;
  const selectBoard = (additive: boolean) => {
    const current = view().selection;
    if (additive && current.kind === 'objects') {
      const boards = current.boards.includes(path) ? current.boards.filter((b) => b !== path) : [...current.boards, path];
      view().select({ kind: 'objects', boards, notes: current.notes });
    } else view().select({ kind: 'objects', boards: [path], notes: [] });
  };
  const selectNode = (node: OutlineNode, additive: boolean) => {
    const item: ElementSelection = { tid: node.tid, path: node.path, instance: 0 };
    const current = view().selection;
    if (additive && current.kind === 'elements' && current.board === path) {
      const has = current.items.some((i) => i.tid === node.tid);
      const items = has ? current.items.filter((i) => i.tid !== node.tid) : [...current.items, item];
      view().select(items.length ? { kind: 'elements', board: path, items } : { kind: 'objects', boards: [path], notes: [] });
    } else view().select({ kind: 'elements', board: path, items: [item] });
  };

  const renderNodes = (list: OutlineNode[], level: number): ReactNode =>
    list.map((node) => {
      const key = `${path}:${node.tid}`;
      const defaultOpen = level < 2 || openTids.has(node.tid);
      const nodeOpen = node.children.length > 0 && defaultOpen !== flipped.has(key);
      return (
        <div key={node.tid} role="group">
          <TreeRow
            level={level}
            name={node.name}
            detail={node.detail}
            glyph={node.glyph}
            selected={selectedTids.has(node.tid)}
            hovered={hover?.board === path && hover.tid === node.tid}
            open={nodeOpen}
            hasChildren={node.children.length > 0}
            onToggle={() => flip(key)}
            onSelect={(additive) => selectNode(node, additive)}
            onHover={(on) => view().setHover(on ? { board: path, tid: node.tid, instance: 0 } : null)}
            row={{ board: path, tid: node.tid }}
            label={model?.elements[node.tid] ? attributeValue(model.elements[node.tid]!, 'data-label') : undefined}
            hidden={model?.elements[node.tid] ? isHiddenLayer(model.elements[node.tid]!) : false}
            drop={drop?.tid === node.tid ? drop.where : null}
            editable={!readOnly}
            onPress={press(node)}
            onRename={rename(node)}
            onToggleHidden={toggleHidden(node)}
          />
          {nodeOpen ? renderNodes(node.children, level + 1) : null}
        </div>
      );
    });

  if (!entry) return null;
  return (
    <div role="group">
      <TreeRow
        level={0}
        name={entry.title || path.replace(/\.dc\.html$/, '')}
        glyph="artboard"
        selected={boardSelected}
        hovered={false}
        bold={false}
        open={open}
        hasChildren
        onToggle={() => flip(boardKey)}
        onSelect={selectBoard}
        onHover={() => undefined}
      />
      {open ? nodes.length ? renderNodes(nodes, 1) : <div className="py-1 pl-[42px] text-[12px] text-chrome-muted">{source === null ? 'Loading…' : 'No elements yet'}</div> : null}
    </div>
  );
}

/** The layers list of the current page. */
export function Outline() {
  const canvas = useDocument((s) => s.canvas);
  const page = useView((s) => s.page);
  const selection = useView((s) => s.selection);
  const boards = useMemo(() => boardsOnPage(canvas, page), [canvas, page]);
  const units = useMemo(() => {
    const ids = notesOnPage(canvas, page);
    const items = ids.map(id => ({ id, groups: canvas.notes[id]!.groups }));
    return groupSelectionUnits(noteGroupIndex(items), items, new Set(ids));
  }, [canvas, page]);
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);

  const activeBoard = selection.kind === 'elements' ? selection.board : selection.kind === 'objects' && selection.boards.length === 1 ? selection.boards[0] : null;

  // A newly selected element's row scrolls into view.
  useEffect(() => {
    const row = scroller.current?.querySelector('[data-outline-selected]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  // Selecting inside a collapsed artboard opens it again.
  useEffect(() => {
    if (!activeBoard) return;
    setFlipped((current) => {
      const key = `b:${activeBoard}`;
      if (!current.has(key) || boards.length === 1) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, [activeBoard, boards.length]);

  const unflip = (keys: string[]) =>
    setFlipped((current) => {
      if (!keys.some((key) => current.has(key))) return current;
      const next = new Set(current);
      for (const key of keys) next.delete(key);
      return next;
    });

  const flip = (key: string) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedNotes = selection.kind === 'objects' ? selection.notes : [];
  const selectNotes = (ids: string[], additive: boolean) => {
    const notes = new Set(additive ? selectedNotes : []);
    const remove = additive && ids.every(id => notes.has(id));
    for (const id of ids) { if (remove) notes.delete(id); else notes.add(id); }
    useView.getState().select({ kind: 'objects', boards: additive && selection.kind === 'objects' ? selection.boards : [], notes: [...notes] });
  };
  const noteRow = (id: string, level: number) => {
    const note = canvas.notes[id]!;
    const name = note.title || note.text?.split('\n')[0] || note.alt || note.href || note.kind || 'Sticky';
    const glyph = note.kind === 'image' ? 'image' : !note.kind || ['link', 'title1', 'sticky'].includes(note.kind) ? 'text' : 'shape';
    return <TreeRow key={id} level={level} name={name} glyph={glyph} selected={selectedNotes.includes(id)}
      hovered={false} open={false} hasChildren={false} onHover={() => {}} onToggle={() => {}} onSelect={add => selectNotes([id], add)} />;
  };

  return (
    <div ref={scroller} role="tree" aria-label="Layers" className="h-full overflow-y-auto px-1.5 py-1.5" onMouseLeave={() => useView.getState().setHover(null)}>
      {boards.map(path => <BoardTree key={path} path={path} flipped={flipped} flip={flip} unflip={unflip} autoOpen={boards.length === 1 || path === activeBoard} />)}
      {units.map(({ group, ids }) => {
        if (!group) return noteRow(ids[0]!, 0);
        const key = 'g:' + group;
        const open = flipped.has(key);
        return <div key={key} role="group">
          <TreeRow level={0} name="Group" detail={String(ids.length)} glyph="frame" selected={ids.every(id => selectedNotes.includes(id))}
            hovered={false} open={open} hasChildren onHover={() => {}} onToggle={() => flip(key)} onSelect={add => selectNotes(ids, add)} />
          {open && ids.map(id => noteRow(id, 1))}
        </div>;
      })}
      {!boards.length && !units.length ? <div className="px-2 py-1 text-[12px] text-chrome-muted">No elements yet</div> : null}
    </div>
  );
}
