import type { DashboardFile } from '@open-artifact/data-core';
import { DASHBOARD_ENTRY_FILENAME, FIELD_ATTRIBUTE, SOURCE_ATTRIBUTE, WHERE_ATTRIBUTE } from '@open-artifact/data-core';
import { DRAW_ATTRIBUTE } from './draw.ts';
import { DERIVED_SOURCE_ATTRIBUTE } from './sources.ts';

/** A page script to run: its text and the file it came from (`index.html` for an inline one). */
export interface PageScript {
  file: string;
  text: string;
}

/** The stored markup's elements and the mounted page's elements, paired both ways. */
export interface DraftTwins {
  storedOf(live: Node | null): Element | null;
  liveOf(stored: Element): Element | null;
  pair(stored: Element, live: Element): void;
  drop(live: Element): void;
}

export interface PageKeptMarkup {
  stored: DocumentFragment;
  twins: DraftTwins;
}

export interface ParsedDashboardPage {
  body: DocumentFragment;
  scripts: PageScript[];
  /** The page opens with `<meta name="dash-one-writer">` (checked before the loader drops `<meta>`). */
  oneWriter: boolean;
  /** With `keep`: an untouched parse of the markup, paired element by element with the loaded copy (edit mode). */
  kept: PageKeptMarkup | null;
}

/** Elements the loader takes out of the page. */
export const REMOVED_PAGE_ELEMENTS: readonly string[] = [
  'script',
  'link',
  'meta',
  'base',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'portal',
  'fencedframe',
];
const REMOVED_PAGE_ELEMENT_SELECTOR = REMOVED_PAGE_ELEMENTS.join(',');
export const ALLOWED_PAGE_SCRIPT_TYPES: readonly string[] = ['', 'text/javascript', 'application/javascript'];
/** Attributes the page may write outside its drawings on a one-writer page (and `aria-*`). */
const ONE_WRITER_ATTRS: ReadonlySet<string> = new Set([
  'class',
  'style',
  'hidden',
  'open',
  'disabled',
  'tabindex',
  'value',
  'checked',
  'selected',
]);
/** What edit mode treats as a whole: a drawing's insides, a style sheet, a template. */
export const DRAFT_OPAQUE_SELECTOR = `[${DRAW_ATTRIBUTE}], style, template`;
export const ONE_WRITER_META_SELECTOR = 'meta[name="dash-one-writer"]';

export function isRemovedPageElement(localName: string): boolean {
  return REMOVED_PAGE_ELEMENTS.includes(localName.toLowerCase());
}

/** `ping` and event handler attributes are stripped from every element. */
export function isStrippedPageAttribute(name: string): boolean {
  return name === 'ping' || name.startsWith('on');
}

export function isAllowedPageScriptType(type: string | null): boolean {
  return ALLOWED_PAGE_SCRIPT_TYPES.includes((type ?? '').trim().toLowerCase());
}

export function isOneWriterAttr(name: string): boolean {
  return ONE_WRITER_ATTRS.has(name) || name.startsWith('aria-');
}

/** Attributes the runtime itself writes on the page. */
export function isInternalDashboardAttribute(name: string): boolean {
  return name.startsWith('data-dash-') || name === DERIVED_SOURCE_ATTRIBUTE || name === 'data-source-lit';
}

/** A page file's name as a `src`/`href` writes it (`./` and surrounding space dropped). */
export function pageFileName(reference: string | null | undefined): string {
  return (reference ?? '').trim().replace(/^\.\//, '');
}

export function lookupDashboardFile(files: ReadonlyMap<string, string>, reference: string | null | undefined): string | undefined {
  return files.get(pageFileName(reference));
}

export function isOneWriterPage(root: ParentNode): boolean {
  return root.querySelector(ONE_WRITER_META_SELECTOR) !== null;
}

export function createPageTemplate(html: string): HTMLTemplateElement {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template;
}

/** Pairs every element of the stored markup with the mounted copy's element in the same document position. */
export function createDraftTwins(stored: ParentNode, live: ParentNode): DraftTwins {
  const liveByStored = new WeakMap<Element, Element>();
  const storedByLive = new WeakMap<Element, Element>();
  const pair = (storedElement: Element, liveElement: Element): void => {
    liveByStored.set(storedElement, liveElement);
    storedByLive.set(liveElement, storedElement);
  };
  const liveElements = live.querySelectorAll('*');
  stored.querySelectorAll('*').forEach((storedElement, index) => {
    const liveElement = liveElements[index];
    if (liveElement !== undefined) pair(storedElement, liveElement);
  });
  return {
    storedOf: (node) => (node instanceof Element ? (storedByLive.get(node) ?? null) : null),
    liveOf: (storedElement) => liveByStored.get(storedElement) ?? null,
    pair,
    drop(liveElement) {
      const storedElement = storedByLive.get(liveElement);
      if (storedElement !== undefined) liveByStored.delete(storedElement);
      storedByLive.delete(liveElement);
    },
  };
}

/**
 * Whether the mounted page still matches a fresh parse of its markup (attributes the page may write, derived sources
 * and drawings' insides aside); when it does, re-pairs the stored twins with the mounted elements.
 */
export function matchDraftTwins(twins: DraftTwins, parsed: ParentNode, mounted: ParentNode): boolean {
  const pairs: [Element, Element][] = [];
  const sameChildren = (left: Node, right: Node): boolean =>
    left.childNodes.length === right.childNodes.length &&
    [...left.childNodes].every((child, index) => sameNode(child, right.childNodes[index]));
  function sameNode(left: Node, right: Node | undefined): boolean {
    if (!(left instanceof Element) || !(right instanceof Element))
      return left.nodeType === right?.nodeType && left.nodeValue === right.nodeValue;
    pairs.push([left, right]);
    const derived = right.hasAttribute(DERIVED_SOURCE_ATTRIBUTE) ? [SOURCE_ATTRIBUTE, FIELD_ATTRIBUTE, WHERE_ATTRIBUTE] : [];
    const names = left.hasAttribute(DRAW_ATTRIBUTE)
      ? [DRAW_ATTRIBUTE]
      : [...left.attributes, ...right.attributes]
          .map((attribute) => attribute.name)
          .filter((name) => !isOneWriterAttr(name) && !isInternalDashboardAttribute(name) && !derived.includes(name));
    return (
      left.localName === right.localName &&
      names.every((name) => left.getAttribute(name) === right.getAttribute(name)) &&
      (left.matches(DRAFT_OPAQUE_SELECTOR) || sameChildren(left, right))
    );
  }
  if (!sameChildren(parsed, mounted)) return false;
  for (const [parsedElement, mountedElement] of pairs) {
    const storedElement = twins.storedOf(parsedElement);
    if (storedElement !== null) twins.pair(storedElement, mountedElement);
  }
  return true;
}

/** A node's markup (a fragment's: its children's), as a template serializes it. */
export function serializeNodeHtml(node: Node): string {
  const template = document.createElement('template');
  template.content.append(node.cloneNode(true));
  return template.innerHTML;
}

/** Whether markup reads back unchanged once written out (edit mode needs it to save what it changed). */
export function isReparseStable(fragment: DocumentFragment): boolean {
  return createPageTemplate(serializeNodeHtml(fragment)).content.isEqualNode(fragment);
}

/** Turns stylesheet links to page files into `<style>` and collects the scripts to run, in order. */
function collectPageScriptsAndStyles(
  fragment: DocumentFragment,
  files: ReadonlyMap<string, string>,
  twins: DraftTwins | null,
): PageScript[] {
  const scripts: PageScript[] = [];
  for (const element of fragment.querySelectorAll('script,link'))
    if (element.localName === 'link') {
      const isStylesheet = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet');
      const css = isStylesheet ? lookupDashboardFile(files, element.getAttribute('href')) : undefined;
      if (css === undefined) continue;
      const style = document.createElement('style');
      style.textContent = css;
      const media = element.getAttribute('media');
      if (media !== null) style.setAttribute('media', media);
      const stored = twins?.storedOf(element) ?? null;
      if (stored !== null) twins?.pair(stored, style);
      element.replaceWith(style);
    } else if (isAllowedPageScriptType(element.getAttribute('type'))) {
      const src = element.getAttribute('src');
      const text = src === null ? (element.textContent ?? '') : lookupDashboardFile(files, src);
      if (text !== undefined && text.trim() !== '')
        scripts.push({ file: src === null ? DASHBOARD_ENTRY_FILENAME : pageFileName(src), text });
    }
  return scripts;
}

/** With `keep`, also returns an untouched parse of the markup paired with the loaded copy (edit mode's draft). */
export function parseDashboardHtml(html: string, files: ReadonlyMap<string, string>, keep: boolean): ParsedDashboardPage {
  const template = createPageTemplate(html);
  const stored = keep ? createPageTemplate(html).content : null;
  const kept: PageKeptMarkup | null = stored === null ? null : { stored, twins: createDraftTwins(stored, template.content) };
  const scripts = collectPageScriptsAndStyles(template.content, files, kept?.twins ?? null);
  const oneWriter = isOneWriterPage(template.content);
  const removed = [...template.content.querySelectorAll(REMOVED_PAGE_ELEMENT_SELECTOR)];
  for (const element of removed) kept?.twins.drop(element);
  for (const element of removed) element.remove();
  for (const element of template.content.querySelectorAll('*'))
    for (const attribute of [...element.attributes])
      if (isStrippedPageAttribute(attribute.name)) element.removeAttribute(attribute.name);
  return { body: template.content, scripts, oneWriter, kept };
}

export function parseDashboardFilesToPage(files: readonly DashboardFile[], keep = false): ParsedDashboardPage {
  const byName = new Map(files.map((file) => [file.name, file.text]));
  return parseDashboardHtml(byName.get(DASHBOARD_ENTRY_FILENAME) ?? '', byName, keep);
}

/** The entry file's markup, parsed but not loaded. */
export function parsePageEntryMarkup(files: readonly DashboardFile[]): DocumentFragment {
  return createPageTemplate(files.find((file) => file.name === DASHBOARD_ENTRY_FILENAME)?.text ?? '').content;
}

/** A one-writer page whose markup reads back unchanged once written out, so edit mode can work on it. */
export function canEditPageByHand(files: readonly DashboardFile[]): boolean {
  const fragment = parsePageEntryMarkup(files);
  return isOneWriterPage(fragment) && isReparseStable(fragment);
}
