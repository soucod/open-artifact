/**
 * Cut, copy and paste of template elements, artboards and notes.
 *
 * A copy goes to the system clipboard as HTML (the elements' source, so it
 * pastes into other apps) with the full payload embedded in a marker, and
 * is also kept in memory for pastes the browser does not route through a
 * paste event (keys pressed inside an artboard frame, the context menu).
 */

import {
  applySplices,
  attributeValue,
  elementChildren,
  elementPath,
  elementSource,
  holdsText,
  parseTemplate,
  setStyle,
  styleMap,
  VOID_ELEMENTS,
  type HtmlElement,
  type TemplateModel,
} from '@open-artifact/dc';
import { addNoteCopies } from '@open-artifact/design-core';
import { create } from 'zustand';
import { clipboardData, payloadFromHtml, remapBoardReferences, type ClipboardPayload } from '../lib/clipboard-data.ts';
import { toast } from '@open-artifact/ui';
import { placeImages } from './images.ts';
import { freeBoardName } from '../lib/frame.ts';
import { looksLikeHtml, sanitizeHtml } from '../lib/sanitize.ts';
import type { Address } from '../lib/ops.ts';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { addNote, deleteSelection, edit, selectedElements, viewportCenter } from './commands.ts';
import { boardApi, frameOf } from './frames.ts';
import { maybeSession } from './session.ts';
import { liveElementOf, standaloneHtml } from './capture.ts';
import { carriedCss, dependsOnArtboard, helmetFor, renderedMarkup } from './carry.ts';
import { isTextField, writeClipboard, writeClipboardText } from '@open-artifact/editor-kit';

export { clipboardData, payloadFromHtml, type ClipboardPayload };

let memory: ClipboardPayload | null = null;

/** True when something was copied in this tab. */
export function hasClipboard(): boolean {
  return memory !== null;
}

/* --------------------------------- copy ---------------------------------- */

/** The payload of the current selection, or `null` when nothing is selected. */
export function selectionPayload(): ClipboardPayload | null {
  const { selection } = useView.getState();
  const doc = useDocument.getState();
  if (selection.kind === 'elements') {
    const selected = selectedElements();
    if (!selected) return null;
    return elementsPayload(selected.board, selected.model, selected.elements, selection.items);
  }
  if (selection.kind === 'objects' && (selection.boards.length || selection.notes.length)) {
    const boards = selection.boards.flatMap((path) => {
      const entry = doc.canvas.boards[path];
      const source = doc.boards[path]?.source;
      return entry && source ? [{ path, entry, source }] : [];
    });
    const notes = selection.notes.flatMap((id) => (doc.canvas.notes[id] ? [doc.canvas.notes[id]!] : []));
    return { kind: 'objects', boards, notes };
  }
  return null;
}

/** Where this editor runs: pastes into the same artboard of the same project keep the source. */
const here = () => location.pathname;

/** Standalone HTML larger than this is left out (other apps get the source). */
const MAX_STANDALONE = 2 * 1024 * 1024;

/** The payload of copied elements, with what they need to look the same elsewhere. */
function elementsPayload(board: string, model: TemplateModel, elements: HtmlElement[], items: readonly ElementSelection[]): ClipboardPayload {
  const html = elements.map((el) => elementSource(model, el));
  const payload: Extract<ClipboardPayload, { kind: 'elements' }> = { kind: 'elements', board, html, from: here() };
  try {
    const itemOf = (el: HtmlElement): ElementSelection => {
      const tid = model.tidOf.get(el)!;
      return items.find((item) => item.tid === tid) ?? { tid, path: elementPath(model, el), instance: 0 };
    };
    const lives = elements.map((el) => liveElementOf(board, itemOf(el), { descend: false, svg: false }));
    const rendered = elements.map((_el, index) => (lives[index] && dependsOnArtboard(html[index]!) ? renderedMarkup(model, lives[index]!) : null));
    if (rendered.some((markup) => markup !== null)) payload.rendered = rendered;
    const present = lives.filter((live): live is Element => live !== null);
    const css = carriedCss(present);
    if (css.length) payload.css = css;
    const shown = elements.map((el) => liveElementOf(board, itemOf(el), { descend: false })).filter((live): live is Element => live !== null);
    if (shown.length === elements.length) {
      const standalone = shown.map((live) => standaloneHtml(live)).join('\n');
      if (standalone && standalone.length <= MAX_STANDALONE) payload.standalone = standalone;
    }
  } catch {
    // The page could not be read: the source alone.
  }
  return payload;
}

/** The markup to paste into an artboard: the source in its own artboard, else what renders the same there. */
function markupFor(payload: Extract<ClipboardPayload, { kind: 'elements' }>, board: string, html = payload.html): { html: string; helmet?: string } {
  const same = payload.board === board && (payload.from ?? here()) === here();
  if (same) return { html: html.join('\n') };
  return {
    html: html.map((markup, index) => payload.rendered?.[index] ?? markup).join('\n'),
    helmet: helmetFor(payload.css, frameOf(board)?.contentDocument),
  };
}

/** Copies the selection into memory; returns what was copied. */
export function copySelection(): ClipboardPayload | null {
  const payload = selectionPayload();
  if (payload) memory = payload;
  return payload;
}

/** Copies, then deletes the selection. */
export function cutSelection(): ClipboardPayload | null {
  if (useDocument.getState().readOnly) return null;
  const payload = copySelection();
  if (payload) deleteSelection();
  return payload;
}

/**
 * Copy for callers without a clipboard event: writes the system clipboard
 * when the browser (or, where it keeps the clipboard from the framed editor,
 * the Shell) lets us. The in-page copy is kept either way.
 */
export function copyToSystem(cut = false): void {
  const payload = cut ? cutSelection() : copySelection();
  if (!payload) return;
  const { html, text } = clipboardData(payload);
  const shell = maybeSession()?.shell;
  void writeClipboard({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }, shell)
    .catch(() => writeClipboardText(text, shell))
    .catch(() => undefined);
}

/* --------------------------------- paste --------------------------------- */

/** The single top-level element of a template (its root), if it has one. */
function rootElement(model: TemplateModel) {
  const tops = elementChildren(model.nodes).filter((el) => el.tag !== 'helmet');
  return tops.length === 1 ? tops[0]! : null;
}

/** Tags that hold words or inline content: pasted blocks go next to them, not inside. */
const TEXTUAL = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button', 'label', 'strong', 'em', 'b', 'i', 'u', 's', 'code',
  'small', 'sub', 'sup', 'mark', 'q', 'cite', 'abbr', 'time', 'pre', 'blockquote', 'figcaption', 'caption', 'legend',
  'option', 'textarea', 'select', 'svg', 'canvas', 'video', 'audio', 'picture', 'table', 'thead', 'tbody', 'tr', 'ul', 'ol',
  'script', 'style', 'helmet', 'sc-for', 'sc-if', 'dc-import', 'x-import',
]);

/** True when pasted elements can go inside this element. */
function holdsPaste(element: HtmlElement): boolean {
  if (VOID_ELEMENTS.has(element.tag) || element.closeStart < 0 || TEXTUAL.has(element.tag) || holdsText(element)) return false;
  for (let up = element.parent; up; up = up.parent) if (up.tag === 'svg' || up.tag === 'sc-for' || up.tag === 'dc-import' || up.tag === 'x-import') return false;
  return true;
}

/**
 * Where pasted elements go: inside a single selected container, after the
 * selection, or inside an artboard's root.
 */
function pasteTarget(fallbackBoard: string | null, html = ''): { board: string; target: Address | null; position: 'after' | 'last-child' } | null {
  const doc = useDocument.getState();
  const { selection } = useView.getState();
  const intoBoard = (board: string) => {
    const source = doc.boards[board]?.source;
    if (!source) return null;
    const model = templateOf(source);
    const root = rootElement(model);
    return { board, target: root ? { tid: model.tidOf.get(root)!, path: [elementChildren(model.nodes).indexOf(root)] } : null, position: 'last-child' as const };
  };
  const selected = selectedElements();
  if (selected) {
    const last = selected.elements[selected.elements.length - 1]!;
    const address = { tid: selected.model.tidOf.get(last)!, path: elementPath(selected.model, last) };
    // A single selected container takes the paste, unless it is what was
    // copied: a copy of the artboard's root pasted onto it goes after it,
    //.
    if (selected.elements.length === 1 && holdsPaste(last) && elementSource(selected.model, last).trim() !== html.trim()) {
      return { board: selected.board, target: address, position: 'last-child' };
    }
    return { board: selected.board, target: address, position: 'after' };
  }
  if (selection.kind === 'objects' && selection.boards.length === 1) return intoBoard(selection.boards[0]!);
  if (fallbackBoard && doc.canvas.boards[fallbackBoard]) return intoBoard(fallbackBoard);
  return null;
}

/** Inserts copied elements at the paste target and selects them. */
function pasteElements(payload: Extract<ClipboardPayload, { kind: 'elements' }>): boolean {
  const where = pasteTarget(payload.board, payload.html.join('\n'));
  if (!where) {
    toast.add({ title: 'Select an artboard to paste into' });
    return false;
  }
  const { html, helmet } = markupFor(payload, where.board);
  return edit(where.board, { kind: 'insert', target: where.target, position: where.position, html, helmet }, { selectCreated: true });
}

/** Adds copies of artboards and notes to the current page, offset from the originals. */
function pasteObjects(payload: Extract<ClipboardPayload, { kind: 'objects' }>): void {
  const doc = useDocument.getState();
  const view = useView.getState();
  const firstPage = doc.canvas.pages[0]?.id;
  const page = view.page && view.page !== firstPage ? view.page : undefined;
  const taken = new Set([...Object.keys(doc.boards), ...Object.keys(doc.canvas.boards)]);
  const boards: string[] = [];
  const names = new Map<string, string>();
  for (const { path } of payload.boards) {
    const name = freeBoardName(path.replace(/\.dc\.html$/, '').replace(/^.*\//, ''), taken);
    taken.add(name);
    names.set(path, name);
  }
  for (const { path, entry, source } of payload.boards) {
    const name = names.get(path)!;
    const { page: _page, ...rest } = entry;
    useDocument.getState().createBoard(name, remapBoardReferences(source, path, names), { ...rest, x: entry.x + 40, y: entry.y + 40, ...(page ? { page } : {}) });
    boards.push(name);
  }
  let notes: string[] = [];
  if (payload.notes.length) {
    useDocument.getState().updateCanvas((canvas) => {
      // Copies of a group form a new group of their own.
      const copied = addNoteCopies(canvas, payload.notes, (note) => {
        const { page: _page, ...rest } = note;
        return { ...rest, x: note.x + 24, y: note.y + 24, ...(page ? { page } : {}) };
      });
      notes = copied.ids;
      return copied.canvas;
    });
  }
  view.select({ kind: 'objects', boards, notes });
}

type BoardPaste = Extract<ClipboardPayload, { kind: 'objects' }>;
export const useBoardPaste = create<{ pending: BoardPaste | null }>(() => ({ pending: null }));
export function finishBoardPaste(accept: boolean): void {
  const { pending } = useBoardPaste.getState();
  useBoardPaste.setState({ pending: null });
  if (accept && pending && !useDocument.getState().readOnly) pasteObjects(pending);
}

/** Pastes a payload. */
export function pastePayload(payload: ClipboardPayload): void {
  if (useDocument.getState().readOnly) return;
  if (payload.kind === 'elements') pasteElements(payload);
  else if (payload.externalCode) useBoardPaste.setState({ pending: payload });
  else pasteObjects(payload);
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Markup for pasted plain text: sanitized HTML when it is markup, else paragraphs. */
export function textMarkup(text: string): string {
  if (looksLikeHtml(text)) {
    const html = sanitizeHtml(text);
    if (html) {
      // Inline-only markup gets a paragraph of its own.
      const tops = elementChildren(parseTemplate(html).nodes);
      const blocks = tops.some((el) => !INLINE.has(el.tag));
      return blocks ? html : `<p style="margin: 0">${html}</p>`;
    }
  }
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p style="margin: 0">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

const INLINE = new Set(['a', 'abbr', 'b', 'br', 'cite', 'code', 'em', 'i', 'img', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u']);

/** Pastes plain text from another app: a paragraph (or sanitized markup) in an artboard, or a sticky note. */
export function pasteText(text: string): void {
  if (useDocument.getState().readOnly || !text.trim()) return;
  const html = textMarkup(text);
  const where = pasteTarget(null, html);
  if (where) {
    edit(where.board, { kind: 'insert', target: where.target, position: where.position, html }, { selectCreated: true });
  } else {
    addNote('sticky', viewportCenter(), { text: text.trim() });
    useView.getState().setNoteEdit(null);
  }
}

/** Paste for callers without a clipboard event (context menu, frame keys). */
export async function pasteFromSystem(): Promise<void> {
  if (useDocument.getState().readOnly) return;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const payload = payloadFromHtml(await (await item.getType('text/html')).text());
        if (payload) {
          memory = payload;
          pastePayload(payload);
          return;
        }
      }
    }
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const file = new File([blob], `Pasted image.${type.slice(6).replace('jpeg', 'jpg')}`, { type });
      await placeImages([file], menuPoint?.world ?? viewportCenter(), menuPoint?.board);
      return;
    }
    for (const item of items) {
      if (item.types.includes('text/plain')) {
        const text = await (await item.getType('text/plain')).text();
        if (memory && clipboardData(memory).text === text) break;
        pasteText(text);
        return;
      }
    }
  } catch {
    // No permission to read: fall back to what this tab copied.
  }
  if (memory) pastePayload(memory);
}

/* ------------------------------- paste here ------------------------------- */

let menuPoint: { board: string; world: { x: number; y: number } } | null = null;

/** Records where the context menu was opened (an artboard and a world point), or `null`. */
export function setMenuPoint(point: typeof menuPoint): void {
  menuPoint = point;
}

const FREEFORM = new Set(['div', 'section', 'main', 'article']);

/**
 * The container of a freeform artboard that "Paste here" places into: the
 * root (or its single plain container) when it holds only positioned
 * elements; `null` for artboards laid out in the flow.
 */
function freeformContainer(board: string): { model: TemplateModel; container: HtmlElement | null } | null {
  const source = useDocument.getState().boards[board]?.source;
  const api = boardApi(board);
  if (!source || !api) return null;
  const model = templateOf(source);
  const position = (el: HtmlElement) => api.inspect(model.tidOf.get(el)!)?.computed.position ?? 'static';
  const inFlow = (el: HtmlElement) => !['absolute', 'fixed'].includes(position(el));
  const tops = elementChildren(model.nodes).filter((el) => el.tag !== 'helmet');
  if (tops.length !== 1) return tops.some(inFlow) ? null : { model, container: null };
  let container = tops[0]!;
  if (holdsText(container) || VOID_ELEMENTS.has(container.tag)) return null;
  const flow = elementChildren(container).filter((el) => el.tag !== 'helmet' && inFlow(el));
  if (flow.length === 1 && FREEFORM.has(flow[0]!.tag) && !holdsText(flow[0]!) && position(flow[0]!) === 'static' && elementChildren(container).length === 1) container = flow[0]!;
  else if (flow.length) return null;
  return { model, container };
}

/** True when the context menu can offer "Paste here". */
export function canPasteHere(): boolean {
  return Boolean(menuPoint && !useDocument.getState().readOnly && (memory || 'clipboard' in navigator) && freeformContainer(menuPoint.board));
}

/** Gives one element's markup an absolute position, without margins. */
function positioned(html: string, left: number, top: number): string | null {
  const model = parseTemplate(html.trim());
  const tops = elementChildren(model.nodes);
  if (tops.length !== 1 || model.nodes.some((node) => node.type === 'text' && node.value.trim())) return null;
  const element = tops[0]!;
  const patch: Record<string, string | null> = {};
  for (const property of Object.keys(styleMap(attributeValue(element, 'style') ?? ''))) if (property.startsWith('margin')) patch[property] = null;
  Object.assign(patch, { position: 'absolute', left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: 'auto', bottom: 'auto', margin: '0px' });
  return applySplices(model.text, setStyle(model, element, patch));
}

/** Pastes one copied element at the point the context menu was opened. */
export async function pasteHere(): Promise<void> {
  const point = menuPoint;
  if (!point || useDocument.getState().readOnly) return;
  let payload: ClipboardPayload | null = null;
  let text = '';
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) payload ??= payloadFromHtml(await (await item.getType('text/html')).text());
      if (!payload && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    // No permission: what this tab copied.
  }
  if (!payload && !text) payload = memory;
  let html: string;
  let helmet: string | undefined;
  if (payload?.kind === 'elements') {
    if (payload.html.length !== 1) {
      toast.add({ title: 'Paste here places one copied element at a time. Use Paste for several.' });
      return;
    }
    ({ html, helmet } = markupFor(payload, point.board));
  } else if (payload) {
    pastePayload(payload);
    return;
  } else if (text.trim()) {
    html = textMarkup(text);
  } else return;

  const place = freeformContainer(point.board);
  const entry = useDocument.getState().canvas.boards[point.board];
  const api = boardApi(point.board);
  if (!place || !entry || !api) return;
  const { model, container } = place;
  const rect = container ? api.inspect(model.tidOf.get(container)!) : null;
  const borderLeft = parseFloat(rect?.computed['border-left-width'] ?? '0') || 0;
  const borderTop = parseFloat(rect?.computed['border-top-width'] ?? '0') || 0;
  const left = point.world.x - entry.x - (rect ? rect.rect.x + borderLeft : 0);
  const top = point.world.y - entry.y - (rect ? rect.rect.y + borderTop : 0);
  const markup = positioned(html, left, top);
  if (!markup) {
    toast.add({ title: 'Paste here places one copied element at a time. Use Paste for several.' });
    return;
  }
  const key = `paste-here-${Date.now()}`;
  const target = container ? { tid: model.tidOf.get(container)!, path: elementPath(model, container) } : null;
  // The container anchors the pasted element.
  if (container && rect?.computed.position === 'static') edit(point.board, { kind: 'style', targets: [target!], patch: { position: 'relative' } }, { coalesce: key });
  edit(point.board, { kind: 'insert', target, position: 'last-child', html: markup, helmet }, { selectCreated: true, coalesce: key });
}

/* -------------------------------- install -------------------------------- */

/** True when the event belongs to a text field or a text selection on the page. */
function nativeTarget(event: ClipboardEvent): boolean {
  if (isTextField(event.target)) return true;
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

/** Installs the window's copy / cut / paste handlers. */
export function installClipboard(onFiles: (files: File[]) => void): () => void {
  const write = (event: ClipboardEvent, cut: boolean): void => {
    if (nativeTarget(event)) return;
    const payload = cut ? cutSelection() : copySelection();
    if (!payload || !event.clipboardData) return;
    const { html, text } = clipboardData(payload);
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  };
  const onCopy = (event: ClipboardEvent) => write(event, false);
  const onCut = (event: ClipboardEvent) => write(event, true);
  const onPaste = (event: ClipboardEvent): void => {
    if (nativeTarget(event) || useDocument.getState().readOnly) return;
    const data = event.clipboardData;
    if (!data) return;
    const files = [...data.files].filter((file) => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      onFiles(files);
      return;
    }
    const payload = payloadFromHtml(data.getData('text/html'));
    if (payload) {
      event.preventDefault();
      memory = payload;
      pastePayload(payload);
      return;
    }
    const text = data.getData('text/plain');
    if (text) {
      event.preventDefault();
      pasteText(text);
    }
  };
  window.addEventListener('copy', onCopy);
  window.addEventListener('cut', onCut);
  window.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('copy', onCopy);
    window.removeEventListener('cut', onCut);
    window.removeEventListener('paste', onPaste);
  };
}
