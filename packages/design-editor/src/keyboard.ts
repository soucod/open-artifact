/**
 * Keyboard shortcuts. Keys pressed inside an artboard frame arrive as
 * `key` events from the board runtime and go through the same table.
 */

import { useDocument } from './state/document.ts';
import { NO_SELECTION, useView, type Tool } from './state/view.ts';
import {
  copyProperties,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  groupSelectedNotes,
  moveSelectedElements,
  nudgeSelection,
  pasteProperties,
  redo,
  reorderSelection,
  restackSelectedNotes,
  selectAllSiblings,
  selectChild,
  selectParent,
  selectSibling,
  undo,
  unwrapSelection,
  wrapSelection,
} from './services/commands.ts';
import { boardsOnPage, notesOnPage } from '@open-artifact/design-core';
import { copyToSystem, pasteFromSystem } from './services/clipboard.ts';
import { armScale, cancelScale, commitScale, useScale } from './services/scale.ts';
import { zoomStep, zoomTo, zoomToBoards, zoomToFit } from './services/viewport.ts';
import { frameKeyPressed } from './services/follow.ts';
import { openFind, useFind } from './services/find.ts';
import { runCollabShortcut } from './services/collab.ts';
import { isTextField } from '@open-artifact/editor-kit';
import { copyAs } from './services/capture.ts';
import { isCopyPngKey, zoomKeyOf } from './lib/physical-keys.ts';

/** A key press, from the window or from a frame. */
export interface KeyPress {
  key: string;
  /** Physical key (Alt changes `key` on macOS). */
  code?: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', a: 'board', b: 'board', n: 'sticky', t: 'title', r: 'rect', o: 'oval', l: 'line', p: 'pen' };

/**
 * Runs the shortcut for a key; returns whether it was handled. Copy, cut
 * and paste pressed in this window are left to the clipboard events
 * (`fromFrame` false); pressed inside an artboard frame they run here.
 */
export function runShortcut({ key, code, meta, shift, alt }: KeyPress, fromFrame = false): boolean {
  const view = useView.getState();
  const doc = useDocument.getState();
  const lower = key.toLowerCase();

  const scaling = useScale.getState().session !== null;
  if (scaling && key === 'Escape') {
    cancelScale();
    return true;
  }
  if (scaling && key === 'Enter') {
    commitScale();
    return true;
  }
  if (runCollabShortcut({ key, code, meta, shift, alt })) return true;
  const letter = code?.startsWith('Key') ? code.slice(3).toLowerCase() : lower;
  const elements = view.selection.kind === 'elements';

  if (key === 'Escape') {
    if (view.composer) view.setComposer(false);
    else if (view.findOpen) useFind.getState().close();
    else if (view.noteEdit) view.setNoteEdit(null);
    else if (view.playing) view.play(null);
    else if (view.mode === 'focused') view.focus(null);
    else if (view.tool !== 'select') view.setTool('select');
    else if (view.selection.kind === 'elements') selectParent();
    else view.select(NO_SELECTION);
    return true;
  }

  if (meta && alt && !shift) {
    if (letter === 'c') {
      copyProperties();
      return true;
    }
    if (letter === 'v') {
      if (!doc.readOnly) pasteProperties();
      return true;
    }
  }

  // ⌘G / ⇧⌘G: canvas notes group; elements inside an artboard wrap and
  // unwrap. `letter` reads the physical key, so non-Latin layouts work too.
  if (meta && !alt && letter === 'g') {
    if (doc.readOnly) return true;
    if (view.selection.kind === 'objects') groupSelectedNotes(shift ? 'ungroup' : 'group');
    else if (shift) unwrapSelection();
    else wrapSelection('block');
    return true;
  }

  // ⌘F: find in the design; F3 / ⇧F3 step through the matches.
  if (meta && !alt && !shift && letter === 'f') {
    openFind();
    return true;
  }
  if (key === 'F3' && view.findOpen) {
    useFind.getState().step(shift ? -1 : 1);
    return true;
  }

  if (isCopyPngKey({ key, code, meta, shift, alt })) {
    void copyAs('png');
    return true;
  }

  if (meta) {
    switch (lower) {
      case 'c':
      case 'x':
        if (!fromFrame || shift || alt) return false;
        copyToSystem(lower === 'x');
        return true;
      case 'v':
        if (!fromFrame || shift || alt) return false;
        void pasteFromSystem();
        return true;
      case 'z':
        if (shift) redo();
        else undo();
        return true;
      case 'y':
        redo();
        return true;
      case 'd':
        duplicateSelection();
        return true;
      case 'a': {
        if (view.selection.kind === 'elements') {
          selectAllSiblings();
          return true;
        }
        const page = view.page;
        view.select({ kind: 'objects', boards: boardsOnPage(doc.canvas, page), notes: notesOnPage(doc.canvas, page) });
        return true;
      }
      case '=':
      case '+':
        zoomStep(1);
        return true;
      case '-':
        zoomStep(-1);
        return true;
      case '0':
        zoomTo(1);
        return true;
      case '\\':
        view.togglePanel();
        return true;
      case 'enter':
        view.setComposer(true);
        return true;
      case '[':
      case '{':
        if (!restackSelectedNotes('back')) reorderSelection(-1, shift);
        return true;
      case ']':
      case '}':
        if (!restackSelectedNotes('front')) reorderSelection(1, shift);
        return true;
      case 'k':
        if (!elements || shift || alt || doc.readOnly) return false;
        armScale();
        return true;
      default:
        return false;
    }
  }

  if (view.mode === 'focused') return false;

  const zoomKey = zoomKeyOf({ key, code, meta, shift, alt });
  if (zoomKey) {
    const s = view.selection;
    if (zoomKey === 'fit') zoomToFit();
    else if (zoomKey === 'actual') zoomTo(1);
    else if (s.kind === 'objects' && s.boards.length) zoomToBoards(s.boards);
    else if (s.kind === 'elements') zoomToBoards([s.board]);
    return true;
  }

  switch (key) {
    case 'Delete':
    case 'Backspace':
      if (doc.readOnly) return false;
      deleteSelection();
      return true;
    case 'Tab':
      selectSibling(shift ? -1 : 1);
      return true;
    case 'Enter':
      selectChild();
      return true;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      const step = shift ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      if (view.selection.kind === 'elements') {
        // Positioned elements move; elements in the flow stay put.
        if (!doc.readOnly) moveSelectedElements(dx, dy, { coalesce: 'nudge' });
        return true;
      }
      if (view.selection.kind !== 'objects') return false;
      nudgeSelection(dx, dy);
      return true;
    }
    case ']':
    case '[':
      if (restackSelectedNotes(key === ']' ? 'front' : 'back')) return true;
      if (view.selection.kind !== 'elements' || doc.readOnly) return false;
      reorderSelection(key === ']' ? 1 : -1, true);
      return true;
    default:
      break;
  }
  if (elements && !alt && !doc.readOnly) {
    if (shift && letter === 'h') {
      flipSelection('x');
      return true;
    }
    if (shift && letter === 'v') {
      flipSelection('y');
      return true;
    }
    if (shift && letter === 'a') {
      wrapSelection('flex');
      return true;
    }
    if (!shift && letter === 'k') {
      armScale();
      return true;
    }
  }
  if (!alt && shift && lower === 'l' && !doc.readOnly) {
    view.setTool('arrow');
    return true;
  }
  // ⇧P: the Pen (bezier paths; P stays the Pencil). ⇧I: place an image.
  if (!alt && shift && letter === 'p' && !doc.readOnly) {
    view.setTool('path');
    return true;
  }
  if (!alt && shift && letter === 'i' && !doc.readOnly) {
    view.setTool('image');
    return true;
  }
  if (!alt && !shift && TOOL_KEYS[lower] && (!doc.readOnly || TOOL_KEYS[lower] === 'select' || TOOL_KEYS[lower] === 'hand')) {
    view.setTool(TOOL_KEYS[lower]);
    return true;
  }
  return false;
}


/** Installs the window listeners. */
export function installKeyboard(): () => void {
  const down = (event: KeyboardEvent): void => {
    if (event.key === ' ' && !isTextField(event.target)) {
      useView.getState().setSpacePan(true);
      event.preventDefault();
      return;
    }
    if (isTextField(event.target)) return;
    // Escape in an open menu or popover closes just that, not the selection (or a text edit).
    if (event.key === 'Escape' && (event.target as Element | null)?.closest?.('[role="menu"], [role="dialog"], [role="listbox"]')) return;
    const handled = runShortcut({ key: event.key, code: event.code, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey });
    if (handled) event.preventDefault();
  };
  const up = (event: KeyboardEvent): void => {
    if (event.key === ' ') useView.getState().setSpacePan(false);
  };
  const blur = (): void => useView.getState().setSpacePan(false);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}

/** Keys forwarded by an artboard frame. */
export function handleFrameKey(press: KeyPress): void {
  if (press.key === ' ') return;
  frameKeyPressed(press.key);
  runShortcut(press, true);
}
