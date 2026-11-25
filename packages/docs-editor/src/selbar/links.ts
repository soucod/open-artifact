/** The link box's state, and what opening, following, copying, setting and removing a link does. */
import { toast } from '@open-artifact/ui';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { create } from 'zustand';
import { cellSelected, linkAt, removeLink, selectedMedia, setLink } from '../editor/commands.ts';
import { currentView } from '../editor/format.ts';
import { schema } from '../editor/schema.ts';
import { boxText, planLinkCommit } from './link-commit.ts';
import { docLinkUrl, followDocLink } from './navigate.ts';
import { stripInvisible, webLinkParts } from './link-url.ts';
import { type TextRange, linkRange, setLinkRange } from './watch.ts';

export interface LinkPop {
  /** `card`: the link's address and what can be done with it; `edit`: its text and address as fields. */
  mode: 'card' | 'edit';
  /** The link's address now ('' for a new link). */
  href: string;
  /** The range's text when the box opened, or when a save last found it changed. */
  text: string;
  /** The text can't be changed here: the range crosses blocks or holds chips. */
  textFixed: boolean;
  /** Opened on no text: a new link that brings its own. */
  empty: boolean;
  /** How many saves were held back because the text under the box changed meanwhile (the box then shows it). */
  changed: number;
  /** Opened from the keyboard, so the card takes the focus. */
  byKey: boolean;
}

export const useLinkPop = create<{ pop: LinkPop | null }>(() => ({ pop: null }));

/** The link run around `pos` in its text block. */
export function linkAround(doc: PMNode, pos: number): (TextRange & { href: string }) | null {
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  if (!$pos.parent.inlineContent) return null;
  const type = schema.marks.link!;
  const start = $pos.start();
  let run: (TextRange & { href: string }) | null = null;
  let found: (TextRange & { href: string }) | null = null;
  let offset = 0;
  $pos.parent.forEach(child => {
    const from = start + offset;
    const to = from + child.nodeSize;
    const mark = type.isInSet(child.marks);
    if (mark && run && run.href === mark.attrs.href && run.to === from) run.to = to;
    else run = mark ? { from, to, href: mark.attrs.href as string } : null;
    if (run && run.from <= pos && run.to > pos) found = { ...run };
    offset += child.nodeSize;
  });
  return found;
}

function open(view: EditorView, range: TextRange, pop: Omit<LinkPop, 'text' | 'textFixed' | 'empty' | 'changed'>): void {
  setLinkRange(view, range);
  useLinkPop.setState({ pop: { ...pop, ...boxText(view.state.doc, range), empty: range.from === range.to, changed: 0 } });
}

export function closeLink(options: { refocus?: boolean } = {}): void {
  if (!useLinkPop.getState().pop) return;
  useLinkPop.setState({ pop: null });
  const view = currentView();
  if (!view) return;
  if (linkRange(view)) setLinkRange(view, null);
  if (options.refocus && view.editable) view.focus();
}

export function editLink(): void {
  const pop = useLinkPop.getState().pop;
  if (pop) useLinkPop.setState({ pop: { ...pop, mode: 'edit' } });
}

/** Mod-k: the box on the link at the cursor or the selection, or for a new link. */
export function startLinkEdit(): boolean {
  const view = currentView();
  if (!view) return false;
  const state = view.state;
  const pop = useLinkPop.getState().pop;
  if (pop) {
    if (pop.mode === 'card' && view.editable) editLink();
    return true;
  }
  if (!view.editable) {
    const link = linkAt(state);
    if (!link) return false;
    open(view, link, { mode: 'card', href: link.href, byKey: true });
    return true;
  }
  if (selectedMedia(state) || cellSelected(state)) return false;
  if (state.selection.$from.parent.type.spec.code) return false;
  const link = linkAt(state);
  if (link) {
    open(view, link, { mode: 'edit', href: link.href, byKey: true });
    return true;
  }
  const { from, to } = state.selection;
  if (!state.selection.$from.parent.inlineContent) return false;
  open(view, { from, to }, { mode: 'edit', href: '', byKey: true });
  return true;
}

/** Opens a link: one inside the doc goes there, a web or mail address opens in a new window. */
export function openHref(href: string): void {
  const clean = stripInvisible(href).trim();
  if (followDocLink(clean)) return;
  if (clean.startsWith('/') && !clean.startsWith('//')) {
    window.open(new URL(clean, location.origin).href, '_blank', 'noopener,noreferrer');
    return;
  }
  const web = webLinkParts(clean);
  if (web) {
    window.open(web.open, '_blank', 'noopener,noreferrer');
    return;
  }
  if (/^(mailto|tel):/i.test(clean)) window.open(clean, '_blank', 'noopener,noreferrer');
}

/** The address to copy for a link: in-doc links as the page's full address. */
export function shareableHref(href: string): string | null {
  const clean = stripInvisible(href).trim();
  if (clean.startsWith('#')) return docLinkUrl(clean);
  if (clean.startsWith('/') && !clean.startsWith('//')) return new URL(clean, location.origin).href;
  return webLinkParts(clean)?.open ?? (/^(mailto|tel):/i.test(clean) ? clean : null);
}

export async function copyText(text: string, done = 'Link copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title: done });
  } catch {
    toast.add({ title: "Couldn't copy to the clipboard" });
  }
}

/** Alt-Enter: opens the link at the cursor. */
export function openLinkAtCursor(): boolean {
  const view = currentView();
  const link = view ? linkAt(view.state) : null;
  if (!link) return false;
  openHref(link.href);
  return true;
}

/** A click on a link in the text: a modifier opens it, a plain click shows its card. */
export function handleLinkClick(view: EditorView, event: MouseEvent): boolean {
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  if (!anchor || !view.dom.contains(anchor)) return false;
  // Never let the page follow it itself.
  event.preventDefault();
  if (event.button !== 0) return true;
  let pos: number;
  try {
    pos = view.posAtDOM(anchor, 0);
  } catch {
    return true;
  }
  const link = linkAround(view.state.doc, pos);
  if (!link) return true;
  if (event.metaKey || event.ctrlKey) {
    openHref(link.href);
    return true;
  }
  const selected = view.editable ? !view.state.selection.empty : !(document.getSelection()?.isCollapsed ?? true);
  if (selected) return true;
  open(view, link, { mode: 'card', href: link.href, byKey: false });
  return true;
}

/** Sets the box's link: its address, and its text when changed. */
export function commitLink(href: string, text: string): void {
  const view = currentView();
  const pop = useLinkPop.getState().pop;
  const range = view ? linkRange(view) : null;
  if (!view || !pop || !range || !view.editable) {
    closeLink();
    return;
  }
  const plan = planLinkCommit(view.state, pop, href, text);
  if (plan.kind === 'changed') {
    useLinkPop.setState({ pop: { ...pop, text: plan.text, textFixed: plan.textFixed, empty: plan.empty, changed: pop.changed + 1 } });
    return;
  }
  if (plan.kind === 'set') setLink(href, plan.text, plan.range)(view.state, view.dispatch);
  closeLink({ refocus: true });
}

export function unlink(): void {
  const view = currentView();
  const range = view ? linkRange(view) : null;
  if (view && range && view.editable) {
    const link = linkAround(view.state.doc, range.from);
    removeLink(link && link.to >= range.to ? { from: link.from, to: link.to } : range)(view.state, view.dispatch);
  }
  closeLink({ refocus: true });
}

/** Closes the card once its link is gone, or the cursor has left it. */
export function cardStillFits(view: EditorView): boolean {
  const pop = useLinkPop.getState().pop;
  const range = linkRange(view);
  if (!pop || !range) return false;
  if (pop.mode !== 'card') return true;
  const link = linkAround(view.state.doc, range.from);
  if (!link || link.href !== pop.href) return false;
  if (!view.editable) return true;
  const { from, to } = view.state.selection;
  return from >= link.from && to <= link.to;
}
