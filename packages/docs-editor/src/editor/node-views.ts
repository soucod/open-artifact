/** How the editor draws what plain DOM can't: check boxes, chips, pictures and blocks still being written. */
import { type ChipLookup, chipText, shownDate, tabOfRef } from '@open-artifact/docs-core';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import { nameOfPerson, usePeopleNames } from '../app/people.ts';
import { getDocs, useDocs } from '../app/store.ts';
import { schema } from './schema.ts';

/** The URL a picture's bytes are at. */
export function mediaSrc(attrs: Record<string, unknown>): string {
  const blob = typeof attrs.blob === 'string' ? attrs.blob : '';
  if (/^blob\/[A-Za-z0-9_-]{1,64}$/.test(blob)) return `/_blob/${blob.slice('blob/'.length)}`;
  const src = (attrs.src ?? attrs.url) as string | null;
  return typeof src === 'string' && /^(https?:|data:image\/|\/)/.test(src) ? src : '';
}

export function formatDate(ts: unknown): string {
  return shownDate(ts) || 'Date';
}

/** A dropdown chip's option: its name and color, or null when the list or option is gone. */
export function dropdownOption(enumId: unknown, index: unknown): { name: string; color: string | null } | null {
  const list = getDocs().project?.enums.find(item => item.id === enumId);
  if (!list || typeof index !== 'number') return null;
  const option = list.options[index];
  return option ? { name: option.name, color: option.color ?? null } : null;
}

/** What the chips in this doc name, as the page knows it now. */
export const pageChips: ChipLookup = {
  option: (list, index) => dropdownOption(list, index)?.name ?? null,
  tab: id => getDocs().project?.files.find(file => file.id === id)?.name ?? null,
  person: id => nameOfPerson(id) ?? null,
};

/** Swaps a view's own classes, leaving the ones the editor put on it (a find highlight, a selection). */
export function setOwnClasses(dom: HTMLElement, before: readonly string[], after: readonly string[]): void {
  const keep = new Set(after);
  for (const name of before) if (!keep.has(name)) dom.classList.remove(name);
  for (const name of after) dom.classList.add(name);
}

const classesOf = (dom: HTMLElement) => [...dom.classList];

class CheckItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private box: HTMLButtonElement;
  private node: PMNode;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.dom = document.createElement('li');
    this.box = document.createElement('button');
    this.box.type = 'button';
    this.box.className = 'doc-check';
    this.box.contentEditable = 'false';
    this.box.addEventListener('mousedown', event => event.preventDefault());
    this.box.addEventListener('click', () => {
      const pos = getPos();
      if (pos === undefined || !view.editable) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked: !this.node.attrs.checked }));
    });
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'doc-check-body';
    this.dom.append(this.box, this.contentDOM);
    this.draw();
  }

  private draw(): void {
    const checked = !!this.node.attrs.checked;
    if (this.node.attrs.bid) this.dom.dataset.bid = this.node.attrs.bid;
    this.dom.dataset.checked = String(checked);
    this.dom.className = 'doc-check-item';
    this.box.setAttribute('role', 'checkbox');
    this.box.setAttribute('aria-checked', String(checked));
    this.box.setAttribute('aria-label', checked ? 'Done' : 'Not done');
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs.checked === null) return false;
    this.node = node;
    this.draw();
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return mutation.target === this.box || this.box.contains(mutation.target as Node);
  }

  stopEvent(event: Event): boolean {
    return event.target === this.box;
  }
}

function chip(className: string, text: string, attrs: Record<string, string> = {}): HTMLElement {
  const dom = document.createElement('span');
  dom.className = `doc-chip ${className}`;
  dom.textContent = text;
  for (const [key, value] of Object.entries(attrs)) dom.setAttribute(key, value);
  return dom;
}

/** A picture's crop: the part kept, as fractions of the whole. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cropOf(value: unknown): Crop | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (![x, y, w, h].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  const crop = { x, y, w, h } as Crop;
  return crop.w > 0 && crop.h > 0 && crop.w <= 1 && crop.h <= 1 && (crop.w < 1 || crop.h < 1) ? crop : null;
}

class MediaView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: PMNode;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.className = 'doc-media';
    this.img = document.createElement('img');
    this.img.draggable = false;
    this.dom.append(this.img);
    this.draw();
  }

  private draw(): void {
    const { attrs } = this.node;
    const src = mediaSrc(attrs);
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.img.alt = (attrs.alt as string | null) ?? '';
    const width = attrs.width as string | number | null;
    this.dom.dataset.size = typeof width === 'string' ? width : '';
    const crop = cropOf(attrs.crop);
    const dims = attrs.dims as { w?: number; h?: number } | null;
    this.dom.style.width = typeof width === 'number' ? `${width}px` : crop && !width && dims?.w ? `${Math.round(dims.w * crop.w)}px` : '';
    if (crop) {
      this.dom.classList.add('doc-media-cropped');
      const ratio = dims?.w && dims?.h ? (crop.w * dims.w) / (crop.h * dims.h) : crop.w / crop.h;
      Object.assign(this.dom.style, { aspectRatio: String(ratio) });
      Object.assign(this.img.style, { width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` });
    } else {
      this.dom.classList.remove('doc-media-cropped');
      Object.assign(this.dom.style, { aspectRatio: '' });
      Object.assign(this.img.style, { width: '', height: '', left: '', top: '' });
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.draw();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('doc-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('doc-selected');
  }
}

class AtomChipView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private draw: (node: PMNode) => HTMLElement;
  private own: string[];
  private readonly stop: () => void;

  /** `watchNames`: the chip shows a tab's or a person's name, so it is drawn again when those change. */
  constructor(node: PMNode, draw: (node: PMNode) => HTMLElement, watchNames = false) {
    this.node = node;
    this.draw = draw;
    this.dom = draw(node);
    this.own = classesOf(this.dom);
    if (!watchNames) {
      this.stop = () => undefined;
      return;
    }
    const stopTabs = useDocs.subscribe((state, before) => {
      if (state.project?.files !== before.project?.files) this.redraw();
    });
    const stopPeople = usePeopleNames.subscribe(() => this.redraw());
    this.stop = () => {
      stopTabs();
      stopPeople();
    };
  }

  private redraw(): void {
    const next = this.draw(this.node);
    const own = classesOf(next);
    setOwnClasses(this.dom, this.own, own);
    this.own = own;
    if (this.dom.textContent !== next.textContent) this.dom.textContent = next.textContent;
    for (const name of next.getAttributeNames()) if (name !== 'class') this.dom.setAttribute(name, next.getAttribute(name)!);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.redraw();
    return true;
  }

  destroy(): void {
    this.stop();
  }

  selectNode(): void {
    this.dom.classList.add('doc-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('doc-selected');
  }
}

const drawDate = (node: PMNode) => chip('doc-date', formatDate(node.attrs.ts), { 'data-date': String(node.attrs.ts ?? '') });

const drawMention = (node: PMNode) => {
  const { ref, principal } = node.attrs as Record<string, string | null>;
  const isTab = tabOfRef(ref) !== null;
  const text = chipText('mention', node.attrs, pageChips) ?? (isTab ? (ref ?? '') : '@someone');
  return chip(isTab ? 'doc-mention doc-mention-tab' : 'doc-mention', text, { 'data-mention': principal ?? ref ?? '' });
};

const drawDropdown = (node: PMNode) => {
  const option = dropdownOption(node.attrs.enum, node.attrs.index);
  const dom = chip('doc-dropdown', option?.name ?? 'Select', { 'data-color': option?.color ?? 'gray' });
  if (!option) dom.classList.add('doc-dropdown-unset');
  return dom;
};

const drawPending = (node: PMNode) => {
  const dom = document.createElement('div');
  dom.className = 'doc-pending';
  dom.dir = 'auto';
  dom.textContent = (node.attrs.intent as string) || 'Writing…';
  if (node.attrs.bid) dom.dataset.bid = node.attrs.bid;
  return dom;
};

const drawEmbed = (node: PMNode) => {
  const dom = document.createElement('div');
  dom.className = 'doc-embed';
  const data = (node.attrs.data ?? {}) as Record<string, unknown>;
  dom.textContent = typeof data.title === 'string' ? data.title : 'Embedded content';
  if (node.attrs.bid) dom.dataset.bid = node.attrs.bid;
  return dom;
};

/** Node views the editor always has; more are added by the features that draw blocks themselves. */
export const baseNodeViews: Record<string, NodeViewConstructor> = {
  listItem: (node, view, getPos) => (node.attrs.checked === null ? (undefined as unknown as NodeView) : new CheckItemView(node, view, getPos)),
  media: node => new MediaView(node),
  date: node => new AtomChipView(node, drawDate),
  mention: node => new AtomChipView(node, drawMention, true),
  dropdown: node => new AtomChipView(node, drawDropdown),
  pending: node => new AtomChipView(node, drawPending),
  embed: node => new AtomChipView(node, drawEmbed),
};

export { schema };
