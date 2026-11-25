/**
 * The bar over a text selection. Writers get Comment and React (whichever the page offers), then the formatting;
 * readers and commenters only those actions. It hides for a picture or cells (their own bars draw), while text is
 * composed or a selection is being drawn, and while the link box is open.
 */
import { Card, ChromeDivider, ToolButton } from '@open-artifact/editor-kit/react';
import type { EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type SelectionAction, type SelectionActionKey, useSelectionActions } from '../app/selection-actions.ts';
import { useDocs } from '../app/store.ts';
import { cellSelected, indent, outdent, selectedMedia } from '../editor/commands.ts';
import { readFormat, useEditor } from '../editor/format.ts';
import { schema } from '../editor/schema.ts';
import { formatChord } from './chords.ts';
import { FormatControls, type MenuHold } from './FormatControls.tsx';
import { useLinkPop } from './links.ts';
import { useLayerPlacement } from './use-placement.ts';
import { useSelbarSignals } from './watch.ts';

const ACTION_ORDER: readonly SelectionActionKey[] = ['comment', 'react'];

function touchesListItem(state: EditorState): boolean {
  let found = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
    if (found) return false;
    if (node.type === schema.nodes.listItem) found = true;
    return !found;
  });
  return found;
}

/** Re-renders when the page's selection moves (a reader's selection is not dispatched until the view sees it). */
function useDomSelectionTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let frame = 0;
    const changed = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setTick(value => value + 1);
        });
    };
    document.addEventListener('selectionchange', changed);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', changed);
    };
  }, []);
  return tick;
}

/** A reader's selection counts only while the page still shows it in the text. */
function readerSelectionShown(view: EditorView): boolean {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  return view.dom.contains(selection.anchorNode) && view.dom.contains(selection.focusNode);
}

export function SelectionToolbar(): ReactNode {
  const view = useEditor(state => state.view);
  const state = useEditor(state => state.state);
  const focused = useEditor(state => state.focused);
  const writable = useDocs(state => state.writable);
  const composing = useSelbarSignals(state => state.composing);
  const dragging = useSelbarSignals(state => state.dragging);
  const linkOpen = useLinkPop(state => state.pop !== null);
  const actions = useSelectionActions(state => state.actions);
  const domTick = useDomSelectionTick();
  const [menus, setMenus] = useState<ReadonlySet<string>>(new Set());
  const [barFocused, setBarFocused] = useState(false);

  const onMenu = useCallback((name: string, open: boolean) => {
    setMenus(before => {
      if (before.has(name) === open) return before;
      const next = new Set(before);
      if (open) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  if (!view || !state) return null;
  const selection = state.selection;
  const held = menus.size > 0 || barFocused;
  const textSelected = selection instanceof TextSelection && !selection.empty && !selectedMedia(state) && !cellSelected(state);
  const inSight = view.editable ? focused || held : held || readerSelectionShown(view);
  const visible = textSelected && inSight && !composing && !view.composing && !(dragging && !held) && !linkOpen;
  if (!visible) return null;
  const offered = ACTION_ORDER.flatMap(key => {
    const action = actions[key];
    return action && action.available() ? [{ key, action }] : [];
  });
  const formatting = writable && view.editable && !selection.$from.parent.type.spec.code && !selection.$to.parent.type.spec.code;
  if (!formatting && offered.length === 0) return null;
  return (
    <SelectionBar
      view={view}
      state={state}
      offered={offered}
      formatting={formatting}
      onMenu={onMenu}
      onFocusChange={setBarFocused}
      tick={domTick}
    />
  );
}

interface SelectionBarProps {
  view: EditorView;
  state: EditorState;
  offered: ReadonlyArray<{ key: SelectionActionKey; action: SelectionAction }>;
  formatting: boolean;
  onMenu(name: string, open: boolean): void;
  onFocusChange(focused: boolean): void;
  tick: number;
}

function SelectionBar({ view, state, offered, formatting, onMenu, onFocusChange, tick }: SelectionBarProps): ReactNode {
  const bar = useRef<HTMLDivElement>(null);
  const { from, to } = state.selection;
  const range = useMemo(() => ({ from, to }), [from, to]);
  const placement = useLayerPlacement(view, range, bar, `${state.doc.content.size}:${tick}:${formatting}:${offered.length}`);
  const side = placement?.below ? 'bottom' : 'top';
  const hold: MenuHold = { onMenu, side };
  const format = readFormat(state);
  const inList = formatting && touchesListItem(state);

  // Keep the selection: a press on the bar must not move the cursor out of the text.
  const keepSelection = (event: MouseEvent) => {
    if (!(event.target as Element).closest('input, textarea')) event.preventDefault();
  };

  const divider = <ChromeDivider />;
  return (
    <Card
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      data-selbar=""
      className="absolute z-30 h-10 max-w-[calc(100vw-16px)] gap-0.5 overflow-x-auto px-1 [scrollbar-width:none]"
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? 'visible' : 'hidden' }}
      onMouseDown={keepSelection}
      onFocus={() => onFocusChange(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange(false);
      }}
    >
      {offered.map(({ key, action }) => {
        const Icon = action.icon;
        return (
          <ToolButton
            key={key}
            size="md"
            tipSide={side}
            label={action.label}
            shortcut={action.shortcut ? formatChord(action.shortcut) : undefined}
            icon={<Icon className="size-4" />}
            onClick={() => {
              if (bar.current) action.run(bar.current);
            }}
          />
        );
      })}
      {formatting ? (
        <>
          {offered.length ? divider : null}
          <FormatControls format={format} hold={hold} inList={inList} canIndent={indent(state)} canOutdent={outdent(state)} divider={divider} />
        </>
      ) : null}
    </Card>
  );
}
