/**
 * The canvas context menu (right-click): edit actions for the selected
 * elements, artboards or notes, with their shortcuts.
 */

import { ContextMenu } from '@base-ui/react/context-menu';
import type { ReactElement } from 'react';
import { cn } from '@open-artifact/ui';
import { boardsOnPage, notesOnPage } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import {
  copyProperties,
  deleteSelection,
  detachSelection,
  detachSelectionRefusal,
  duplicateSelection,
  flipSelection,
  groupSelectedNotes,
  hasCopiedProperties,
  noteGroupingFor,
  pasteProperties,
  reorderSelection,
  restackSelectedNotes,
  selectAllSiblings,
  selectionIsPositioned,
  unwrapSelection,
  wrapSelection,
} from '../services/commands.ts';
import { canPasteHere, copyToSystem, pasteFromSystem, pasteHere } from '../services/clipboard.ts';
import { canCaptureSelection, canCopyAs, copyAs } from '../services/capture.ts';
import { armScale } from '../services/scale.ts';
import { ChromeMenuItem, ChromeMenuSeparator, menuFit, POPUP } from '@open-artifact/editor-kit/react';

/** Wraps the canvas root, which becomes the menu's trigger. */
export function CanvasMenu({ children }: { children: ReactElement<Record<string, unknown>> }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={children} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-[1000]">
          <ContextMenu.Popup className={cn(POPUP, 'min-w-[220px]')} style={menuFit()}>
            <MenuItems />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MenuItems() {
  const selection = useView((s) => s.selection);
  const readOnly = useDocument((s) => s.readOnly);
  const elements = selection.kind === 'elements' && selection.items.length > 0;
  const objects = selection.kind === 'objects' && selection.boards.length + selection.notes.length > 0;
  const here = canPasteHere();

  const selectAll = () => {
    if (elements) {
      selectAllSiblings();
      return;
    }
    const { canvas } = useDocument.getState();
    const { page } = useView.getState();
    useView.getState().select({ kind: 'objects', boards: boardsOnPage(canvas, page), notes: notesOnPage(canvas, page) });
  };

  const paste = (
    <>
      <ChromeMenuItem shortcut="⌘V" disabled={readOnly} onSelect={() => void pasteFromSystem()}>
        Paste
      </ChromeMenuItem>
      {here ? (
        <ChromeMenuItem disabled={readOnly} onSelect={() => void pasteHere()}>
          Paste here
        </ChromeMenuItem>
      ) : null}
    </>
  );

  if (!elements && !objects) {
    return (
      <>
        {paste}
        <ChromeMenuItem shortcut="⌘A" onSelect={selectAll}>
          Select all
        </ChromeMenuItem>
      </>
    );
  }

  const copyAsItems = canCopyAs() ? (
    <>
      {(['png', 'svg', 'html'] as const).map((format) => (
        <ChromeMenuItem key={format} shortcut={format === 'png' ? '⇧⌘C' : undefined} disabled={!canCaptureSelection()} onSelect={() => void copyAs(format)}>
          {`Copy as ${format.toUpperCase()}`}
        </ChromeMenuItem>
      ))}
    </>
  ) : null;

  const positioned = elements && selectionIsPositioned();
  const single = elements && selection.items.length === 1;
  const detachable = elements && detachSelectionRefusal() === null;
  // Canvas notes group among themselves; the menu offers only what applies.
  const canGroupNotes = objects && noteGroupingFor('group');
  const canUngroupNotes = objects && noteGroupingFor('ungroup');
  return (
    <>
      <ChromeMenuItem shortcut="⌘X" disabled={readOnly} onSelect={() => copyToSystem(true)}>
        Cut
      </ChromeMenuItem>
      <ChromeMenuItem shortcut="⌘C" onSelect={() => copyToSystem(false)}>
        Copy
      </ChromeMenuItem>
      {paste}
      <ChromeMenuItem shortcut="⌘D" disabled={readOnly} onSelect={duplicateSelection}>
        Duplicate
      </ChromeMenuItem>
      {copyAsItems || elements ? <ChromeMenuSeparator /> : null}
      {copyAsItems}
      {objects && selection.notes.length ? (
        <>
          <ChromeMenuSeparator />
          <ChromeMenuItem shortcut="]" disabled={readOnly} onSelect={() => restackSelectedNotes('front')}>
            Bring to front
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="[" disabled={readOnly} onSelect={() => restackSelectedNotes('back')}>
            Send to back
          </ChromeMenuItem>
        </>
      ) : null}
      {objects && (canGroupNotes || canUngroupNotes) ? (
        <>
          <ChromeMenuSeparator />
          {canGroupNotes ? (
            <ChromeMenuItem shortcut="⌘G" disabled={readOnly} onSelect={() => groupSelectedNotes('group')}>
              Group
            </ChromeMenuItem>
          ) : null}
          {canUngroupNotes ? (
            <ChromeMenuItem shortcut="⇧⌘G" disabled={readOnly} onSelect={() => groupSelectedNotes('ungroup')}>
              Ungroup
            </ChromeMenuItem>
          ) : null}
        </>
      ) : null}
      {elements ? (
        <>
          <ChromeMenuItem shortcut="⌥⌘C" onSelect={copyProperties}>
            Copy properties
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⌥⌘V" disabled={readOnly || !hasCopiedProperties()} onSelect={pasteProperties}>
            Paste properties
          </ChromeMenuItem>
          <ChromeMenuSeparator />
          <ChromeMenuItem shortcut="]" disabled={readOnly} onSelect={() => reorderSelection(1, true)}>
            {positioned ? 'Bring to front' : 'Move to last'}
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="[" disabled={readOnly} onSelect={() => reorderSelection(-1, true)}>
            {positioned ? 'Send to back' : 'Move to first'}
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⌘G" disabled={readOnly} onSelect={() => wrapSelection('block')}>
            Group
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⇧⌘G" disabled={readOnly || !single} onSelect={unwrapSelection}>
            Ungroup
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="K" disabled={readOnly} onSelect={armScale}>
            Scale…
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⇧H" disabled={readOnly} onSelect={() => flipSelection('x')}>
            Flip horizontal
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⇧V" disabled={readOnly} onSelect={() => flipSelection('y')}>
            Flip vertical
          </ChromeMenuItem>
          <ChromeMenuSeparator />
          {detachable ? (
            <ChromeMenuItem disabled={readOnly} onSelect={() => void detachSelection()}>
              Detach instance
            </ChromeMenuItem>
          ) : null}
          <ChromeMenuItem shortcut="⇧A" disabled={readOnly} onSelect={() => wrapSelection('flex')}>
            Wrap in flex
          </ChromeMenuItem>
          <ChromeMenuItem disabled={readOnly} onSelect={() => wrapSelection('grid')}>
            Wrap in grid
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⌘A" onSelect={selectAll}>
            Select all
          </ChromeMenuItem>
        </>
      ) : null}
      <ChromeMenuSeparator />
      <ChromeMenuItem shortcut="⌫" danger disabled={readOnly} onSelect={deleteSelection}>
        Delete
      </ChromeMenuItem>
    </>
  );
}
