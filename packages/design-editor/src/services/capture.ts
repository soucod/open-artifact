/**
 * Copy as PNG / SVG / HTML: captures one rendered element of an artboard.
 *
 * SVG is a real vector drawing (dom-to-svg: boxes, text and images as SVG
 * shapes, no `<foreignObject>`), so it pastes into design tools. PNG captures
 * at 2×, using browser paint for CSS masks and SVG symbols. HTML copies the element
 * with its computed styles inlined (trimmed against browser defaults).
 *
 * {@link pageImage} draws a whole artboard (exports, and the canvas's
 * snapshots). Every picture carries the web fonts its document uses, inlined
 * (`embeddedFontCss`): a picture is drawn apart from the page and cannot
 * load them itself.
 */

import { cssUrls, blobToDataUrl, elementSvg, embeddedFontCss, foreignObjectSvg, loadSvgImage, maxCaptureScale, SVG_NS, type CaptureLimits, type EmbeddedFonts } from '@open-artifact/export-kit';
import { canWriteClipboard, writeClipboard } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { useView, type ElementSelection } from '../state/view.ts';
import { frameOf } from './frames.ts';
import { maybeSession } from './session.ts';

export type CaptureFormat = 'png' | 'svg' | 'html';

const TID_ATTRIBUTE = 'data-dc-tpl';
const PNG_SCALE = 2;
/** How large a capture may be: 12000 px a side, 120 megapixels. */
export const CAPTURE_LIMITS: CaptureLimits = { maxSide: 12000, maxPixels: 120_000_000 };
const MAX_HTML = 8 * 1024 * 1024;
/** Web fonts inlined into one picture unless the caller sets its own limit, characters of `data:` URL. */
const FONT_BYTES = 64 * 1024 * 1024;

/** The web fonts a document's pictures carry; none when they cannot be read (the picture is still drawn, in fallback fonts). */
const documentFonts = (doc: Document, maxBytes = FONT_BYTES): Promise<EmbeddedFonts> => embeddedFontCss(doc, { maxBytes }).catch(() => ({ css: '', skipped: [] }));

/** True when exactly one element or one artboard is selected. */
export function canCaptureSelection(): boolean {
  const { selection } = useView.getState();
  if (selection.kind === 'elements') return selection.items.length === 1;
  return selection.kind === 'objects' && selection.boards.length === 1 && selection.notes.length === 0;
}

/** True when the formats can go on the clipboard (by the browser, or the Shell framing the editor). */
export function canCopyAs(): boolean {
  return canWriteClipboard(maybeSession()?.shell);
}

/**
 * The rendered element of a selected template element (the clicked
 * instance; inside an SVG, its outermost `<svg>`). `descend` steps into
 * component boundaries, which render as `display: contents`; `svg` takes a
 * shape's outermost `<svg>`.
 */
export function liveElementOf(board: string, item: ElementSelection, { descend = true, svg = true } = {}): Element | null {
  const doc = frameOf(board)?.contentDocument;
  if (!doc) return null;
  const instances = doc.querySelectorAll(`[${TID_ATTRIBUTE}="${item.tid}"]`);
  let element: Element | null = instances[item.instance] ?? instances[0] ?? null;
  if (!element) return null;
  if (descend) while (element && element.ownerDocument.defaultView!.getComputedStyle(element).display === 'contents') element = element.firstElementChild;
  if (!element) return null;
  if (svg) for (let up = element.parentElement; up; up = up.parentElement) if (up.namespaceURI === SVG_NS && up.tagName.toLowerCase() === 'svg') element = up;
  return element;
}

/** The rendered element of the single selected element, or a selected artboard's page. */
function selectedLiveElement(): Element | null {
  const { selection } = useView.getState();
  // A whole artboard: its page.
  if (selection.kind === 'objects' && selection.boards.length === 1 && !selection.notes.length) return frameOf(selection.boards[0]!)?.contentDocument?.body ?? null;
  if (selection.kind !== 'elements' || selection.items.length !== 1) return null;
  return liveElementOf(selection.board, selection.items[0]!);
}

/** Runs a capture with the element's own placement transforms neutralised. */
async function withoutTransform<T>(element: Element, run: () => Promise<T>): Promise<T> {
  const style = (element as HTMLElement).style;
  if (!style) return run();
  const saved = ['transform', 'rotate', 'scale', 'translate'].map((name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const);
  for (const [name] of saved) style.setProperty(name, 'none', 'important');
  try {
    return await run();
  } finally {
    for (const [name, value, priority] of saved) {
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    }
  }
}

/* ----------------------------------- SVG ---------------------------------- */

/** Removes what the copy should not carry: scripts, handlers, debug data, external links. */
function cleanSvg(root: Element): void {
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (/^(script|foreignObject)$/i.test(node.localName)) {
      node.remove();
      continue;
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const href = name === 'href' || name === 'xlink:href';
      if (name.startsWith('on') || name.startsWith('data-') || name === 'class' || (href && !(attr.value.startsWith('#') || (node.localName === 'image' && attr.value.startsWith('data:image/'))))) node.removeAttribute(attr.name);
    }
  }
  // Links become plain groups.
  for (const link of [...root.querySelectorAll('a')]) {
    const group = root.ownerDocument.createElementNS(SVG_NS, 'g');
    for (const attr of [...link.attributes]) group.setAttribute(attr.name, attr.value);
    group.append(...link.childNodes);
    link.replaceWith(group);
  }
  // Empty groups and styles (stacking layers with nothing in the captured area).
  for (const node of [...root.querySelectorAll('g, style')].reverse()) {
    if (!node.childNodes.length && !node.id) node.remove();
  }
  root.removeAttribute('aria-owns');
}

/** Figma's Chrome capture reads paint from the definition, losing the
 * currentColor inherited through a use. Specialise simple geometry symbols
 * per instance, keeping the original for other uses and referenced IDs. */
function portableSymbolPaints(source: Element, copy: SVGElement): void {
  const originals = source.querySelectorAll('use');
  for (const [i, use] of [...copy.querySelectorAll('use')].entries()) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
    if (!href?.startsWith('#')) continue;
    const symbol = copy.querySelector<SVGSymbolElement>('symbol#' + CSS.escape(href.slice(1)));
    if (!symbol || symbol.querySelector('[id], use') || !/currentcolor/i.test(symbol.outerHTML)) continue;
    const instance = symbol.cloneNode(true) as SVGSymbolElement;
    instance.id = 'export-symbol-' + crypto.getRandomValues(new Uint32Array(4)).join('-');
    const paint = source.ownerDocument.defaultView!.getComputedStyle(originals[i]!).color;
    for (const shape of [instance, ...instance.querySelectorAll<SVGElement>('*')]) {
      let color = paint;
      for (let ancestor: SVGElement | null = shape; ancestor; ancestor = ancestor.parentElement as SVGElement | null) {
        const own = ancestor.style.color || ancestor.getAttribute('color');
        if (own && !/^(currentcolor|inherit|unset)$/i.test(own)) { color = own; break; }
      }
      for (const name of ['fill', 'stroke']) {
        if ((shape.style.getPropertyValue(name) || shape.getAttribute(name))?.toLowerCase() === 'currentcolor') {
          shape.style.setProperty(name, color);
          shape.setAttribute(name, color);
        }
      }
    }
    symbol.after(instance);
    use.setAttribute('href', '#' + instance.id);
  }
}

/** The element as SVG markup and its size; with `fontCss`, carrying those fonts (a drawing that is rasterized). */
async function captureSvg(element: Element, fontCss?: string): Promise<{ svg: string; width: number; height: number }> {
  return withoutTransform(element, async () => {
    const rect = element.getBoundingClientRect();
    const doc = await elementSvg(element, rect, fontCss === undefined ? {} : { fontCss });
    const root = doc.documentElement;
    cleanSvg(root);
    root.setAttribute('width', String(Math.round(rect.width * 100) / 100));
    root.setAttribute('height', String(Math.round(rect.height * 100) / 100));
    for (const node of [...root.childNodes]) if (node.nodeType === Node.COMMENT_NODE) node.remove();
    return { svg: new XMLSerializer().serializeToString(doc), width: rect.width, height: rect.height };
  });
}

/* ----------------------------------- PNG ---------------------------------- */

interface RasterOptions {
  scale?: number;
  type?: 'image/png' | 'image/jpeg';
  /** Painted under the drawing (JPEG has no transparency). */
  background?: string;
  /** Only rows `[from, to)` (CSS px) keep the drawing; the rest is painted over with `background`. */
  keep?: { from: number; to: number };
}

async function rasterize(svg: string, width: number, height: number, { scale = PNG_SCALE, type = 'image/png', background, keep }: RasterOptions = {}): Promise<Blob> {
  scale = Math.min(scale, maxCaptureScale(width, height, CAPTURE_LIMITS));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const image = await loadSvgImage(svg, { error: 'The drawing could not be rendered.', decoding: 'sync' });
  const context = canvas.getContext('2d')!;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (keep) {
    context.fillStyle = background ?? '#ffffff';
    const k = canvas.height / height;
    const from = Math.max(0, Math.round(keep.from * k));
    const to = Math.min(canvas.height, Math.round(keep.to * k));
    if (from > 0) context.fillRect(0, 0, canvas.width, from);
    if (to < canvas.height) context.fillRect(0, to, canvas.width, canvas.height - to);
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image is empty.'))), type, 0.92));
}

/** dom-to-svg cannot paint CSS masks or SVG use shadow trees. */
function needsBrowserPaint(element: Element): boolean {
  const selector = 'svg use, [style*="mask"]';
  return element.matches(selector) || !!element.querySelector(selector) || [...element.ownerDocument.styleSheets].some(sheet => {
    try { return [...sheet.cssRules].some(rule => /mask(?:-image)?\s*:/.test(rule.cssText)); } catch { return false; }
  });
}

/**
 * False once this browser refused to read a canvas a `<foreignObject>` was
 * drawn on (Safari): browser paint is then tried only where nothing else
 * can draw the page.
 */
let paintReadable = true;

/** Paint the computed HTML, with embedded images and the fonts of `fontCss`, so shadows, masks and ::before survive. */
async function browserDrawing(element: Element, width: number, height: number, top = 0, fontCss = ''): Promise<string> {
  const holder = document.createElement('div');
  holder.innerHTML = await captureHtml(element, 'raster');
  const root = holder.firstElementChild as HTMLElement | SVGElement | null;
  if (root && element !== element.ownerDocument.body) {
    Object.assign(root.style, { position: 'relative', inset: 'auto', margin: '0' });
  }
  holder.style.marginTop = `-${top}px`;
  return foreignObjectSvg(new XMLSerializer().serializeToString(holder), fontCss, { width, height });
}

async function selectionPng(element: Element): Promise<Blob> {
  const fonts = await documentFonts(element.ownerDocument);
  if (needsBrowserPaint(element)) {
    try {
      return await withoutTransform(element, async () => {
        const { width, height } = element.getBoundingClientRect();
        return rasterize(await browserDrawing(element, width, height, 0, fonts.css), width, height);
      });
    } catch { /* Fall back to native SVG shapes when foreignObject is unavailable. */ }
  }
  const { svg, width, height } = await captureSvg(element, fonts.css);
  if (width < 1 || height < 1) throw new Error('The element has no size.');
  return rasterize(svg, width, height);
}

/**
 * A frame's page as an image: its viewport (`width` × `height` CSS pixels
 * from the top left) drawn at `scale`, on white.
 *
 * The browser paints it (the page's computed HTML through a
 * `<foreignObject>`), which keeps what only it can draw: shadows, filters,
 * blending, masks. Where the canvas cannot be read back afterwards, and for
 * a `slice` of a long page, dom-to-svg rebuilds the page as SVG shapes
 * instead. Both carry the page's web fonts; call this once they loaded.
 */
export async function pageImage(
  doc: Document,
  width: number,
  height: number,
  options: {
    scale: number;
    type?: 'image/png' | 'image/jpeg';
    /** Top of the captured area, CSS px from the document's top (the frame is never scrolled). */
    top?: number;
    /** Paper under the drawing (default white). */
    background?: string;
    /** Rows of the image that keep the drawing; the rest shows `background` (a PDF page's break margins). */
    keep?: { from: number; to: number };
    /**
     * One of many images of the same long page (a PDF's paper pages).
     * Browser paint lays the whole page out again for each one, pictures
     * and all, so a slice is rebuilt by dom-to-svg (which only visits what
     * the slice shows) unless the page has something only the browser draws.
     */
    slice?: boolean;
    /** Most web font data to inline, characters of `data:` URL (default 64 MB). */
    fontBytes?: number;
    /** Called with the font families left out: over `fontBytes`, or their files could not be read. */
    onSkippedFonts?: (families: string[]) => void;
  },
): Promise<Blob> {
  const rasterOptions = { ...options, background: options.background ?? '#ffffff' };
  const fonts = await documentFonts(doc, options.fontBytes);
  if (fonts.skipped.length) options.onSkippedFonts?.(fonts.skipped);
  if (needsBrowserPaint(doc.body) || (paintReadable && !options.slice)) {
    try {
      const svg = await browserDrawing(doc.body, width, height, options.top ?? 0, fonts.css);
      return await rasterize(svg, width, height, rasterOptions);
    } catch (error) {
      // Some browsers disallow reading a foreignObject canvas; a drawing that will not load is rebuilt as shapes too.
      if (error instanceof DOMException && error.name === 'SecurityError') paintReadable = false;
    }
  }
  const svgDoc = await elementSvg(doc.documentElement, { x: 0, y: options.top ?? 0, width, height }, { fontCss: fonts.css });
  const root = svgDoc.documentElement;
  cleanSvg(root);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  for (const node of [...root.childNodes]) if (node.nodeType === Node.COMMENT_NODE) node.remove();
  return rasterize(new XMLSerializer().serializeToString(svgDoc), width, height, rasterOptions);
}

/* ---------------------------------- HTML ---------------------------------- */

/** Properties children inherit: dropped when equal to the parent's. */
const INHERITED = new Set([
  'color', 'cursor', 'direction', 'font-family', 'font-feature-settings', 'font-kerning', 'font-size', 'font-stretch',
  'font-style', 'font-variant', 'font-variant-caps', 'font-variant-ligatures', 'font-variant-numeric', 'font-weight',
  'hyphens', 'letter-spacing', 'line-height', 'list-style-image', 'list-style-position', 'list-style-type', 'orphans',
  'quotes', 'tab-size', 'text-align', 'text-align-last', 'text-indent', 'text-rendering', 'text-shadow',
  'text-transform', 'visibility', 'white-space', 'white-space-collapse', 'text-wrap', 'text-wrap-mode', 'widows',
  'word-break', 'word-spacing', 'overflow-wrap', 'writing-mode', 'caret-color', '-webkit-text-fill-color',
  '-webkit-text-stroke-color', '-webkit-text-stroke-width', 'paint-order', 'fill', 'stroke', 'text-size-adjust',
  '-webkit-font-smoothing', 'border-collapse', 'border-spacing', 'empty-cells', 'caption-side',
]);

/** Shorthand-free duplicates (logical properties mirror physical ones). */
const SKIPPED = /^(inline-size|block-size|min-inline-size|min-block-size|max-inline-size|max-block-size|margin-(block|inline)|padding-(block|inline)|border-(block|inline)|inset-(block|inline)|border-(start|end)-|overflow-(block|inline)|contain-intrinsic|-webkit-(?!text-fill|text-stroke|font-smoothing)|transition|animation|will-change|view-transition|anchor|position-(try|anchor|visibility)|user-select|pointer-events|cursor|perspective-origin|transform-origin)/;

const KEPT_ATTRIBUTES = new Set(['alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'dir', 'lang', 'start', 'reversed', 'value', 'span']);
const DROPPED_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'iframe', 'object', 'embed', 'audio', 'source', 'track']);

let defaultsFrame: HTMLIFrameElement | null = null;
const defaultsCache = new Map<string, Map<string, string>>();

/** Browser-default computed styles of a tag, from a blank frame. */
function defaultsOf(tag: string): Map<string, string> {
  const cached = defaultsCache.get(tag);
  if (cached) return cached;
  if (!defaultsFrame) {
    defaultsFrame = document.createElement('iframe');
    defaultsFrame.setAttribute('aria-hidden', 'true');
    defaultsFrame.style.cssText = 'position:fixed;left:-10000px;top:0;width:100px;height:100px;visibility:hidden;border:0';
    document.body.append(defaultsFrame);
  }
  const doc = defaultsFrame.contentDocument!;
  const probe = doc.createElement(tag);
  doc.body.append(probe);
  const style = defaultsFrame.contentWindow!.getComputedStyle(probe);
  const map = new Map<string, string>();
  for (const name of style) map.set(name, style.getPropertyValue(name));
  probe.remove();
  defaultsCache.set(tag, map);
  return map;
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, '&quot;');

/** A style value the copy can carry. */
const portable = (value: string) => !/var\(|env\(|attr\(/.test(value) && !/url\((?!\s*["']?data:image\/)/.test(value);

/** Fetches an image as a data URL (so the copy does not point at this server). */
async function dataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.type.startsWith('image/')) return null;
    return await blobToDataUrl(blob).catch(() => null);
  } catch {
    return null;
  }
}

type CaptureHtmlMode = 'clipboard' | 'raster' | 'figma';

const IMAGE_TOKEN = /\u0000img:([\s\S]*?)\u0000/g;

/**
 * The element as standalone HTML with inline computed styles (trimmed
 * against browser defaults). Image sources come back as tokens, with the
 * set of sources they stand for.
 */
function standalone(element: Element, mode: CaptureHtmlMode = 'clipboard'): { html: string; images: Set<string> } {
  const keepPosition = mode !== 'clipboard';
  const view = element.ownerDocument.defaultView!;
  const images = new Set<string>();
  const imageToken = (src: string) => {
    images.add(src);
    return `\u0000img:${encodeURIComponent(src)}\u0000`;
  };

  const styleOf = (node: Element, tag: string, parent: CSSStyleDeclaration | null, root: boolean, pseudo?: string): string => {
    const computed = view.getComputedStyle(node, pseudo);
    const defaults = defaultsOf(tag);
    const out: string[] = [];
    for (const name of computed) {
      if (name.startsWith('--') || SKIPPED.test(name)) continue;
      let value = computed.getPropertyValue(name);
      if (!value) continue;
      if (keepPosition && value.includes('url(')) {
        for (const { match, url } of cssUrls(value)) {
          if (url.startsWith('data:') || url.startsWith('#')) continue;
          const resolved = new URL(url, node.baseURI);
          if (resolved.origin === location.origin || resolved.protocol === 'blob:') value = value.replace(match, () => `url('${imageToken(resolved.href)}')`);
        }
      }
      if (!portable(value.replace(IMAGE_TOKEN, 'data:image/embedded'))) continue;
      if (INHERITED.has(name) && parent) {
        if (parent.getPropertyValue(name) === value) continue;
      } else if (defaults.get(name) === value) continue;
      if (root && !keepPosition && /^(margin-|top$|left$|right$|bottom$|transform$|rotate$|scale$|translate$)/.test(name)) continue;
      // A side or outline that is not drawn needs no color or width.
      const side = /^(border-(?:top|right|bottom|left)|outline)-(?:color|width)$/.exec(name);
      if (side && computed.getPropertyValue(`${side[1]}-style`) === 'none') continue;
      out.push(`${name}: ${value}`);
    }
    if (root && !keepPosition) {
      if (computed.position === 'static' || computed.position === 'absolute' || computed.position === 'fixed') out.push('position: relative');
      out.push('margin: 0');
    }
    // Keep the rendered size of replaced and sized boxes.
    return out.filter((decl) => !(root && decl === 'position: static')).join('; ');
  };

  const walk = (node: Node, parent: CSSStyleDeclaration | null, root: boolean): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const computed = view.getComputedStyle(el);
    if (computed.display === 'none') return '';
    if (el.namespaceURI === SVG_NS) {
      const copy = el.cloneNode(true) as SVGElement;
      // A symbol is styled in the shadow tree of each <use>. Keep inherited
      // paints as currentColor so the same definition can serve different colours.
      const originals = [el, ...el.querySelectorAll('*')];
      const twins = [copy, ...copy.querySelectorAll<SVGElement>('*')];
      for (const [i, original] of originals.entries()) {
        const source = original as SVGElement;
        const styles = view.getComputedStyle(source);
        const inherited = source.parentElement && view.getComputedStyle(source.parentElement);
        for (const name of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'opacity', 'color', 'stop-color', 'stop-opacity']) {
          let value = styles.getPropertyValue(name);
          if (!value || (name !== 'opacity' && inherited?.getPropertyValue(name) === value)) continue;
          if ((name === 'fill' || name === 'stroke') && value === styles.color) {
            const color = source.style.getPropertyValue('color'), priority = source.style.getPropertyPriority('color');
            const probe = value === 'rgb(1, 2, 3)' ? 'rgb(3, 2, 1)' : 'rgb(1, 2, 3)';
            try {
              source.style.setProperty('color', probe, 'important');
              if (styles.getPropertyValue(name) === probe) value = 'currentColor';
            } finally {
              if (color) source.style.setProperty('color', color, priority);
              else source.style.removeProperty('color');
            }
          }
          twins[i]!.style.setProperty(name, value);
        }
      }
      if (mode === 'figma') portableSymbolPaints(el, copy);
      cleanSvg(copy);
      if (el.localName === 'svg') {
        copy.setAttribute('xmlns', SVG_NS);
        if (!root || keepPosition) copy.setAttribute('style', styleOf(el, 'svg', parent, false));
      }
      return new XMLSerializer().serializeToString(copy).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    }
    let tag = keepPosition && el.localName === 'body' ? 'div' : el.localName;
    if (DROPPED_TAGS.has(tag)) return '';
    if (computed.display === 'contents') return [...el.childNodes].map((child) => walk(child, parent, root)).join('');
    const pseudo = (name: string): string => {
      if (!keepPosition) return '';
      const css = view.getComputedStyle(el, name);
      const content = css.content;
      if (!content || content === 'none' || content === 'normal' || css.display === 'none') return '';
      const text = /^["'].*["']$/.test(content) ? content.slice(1, -1) : '';
      return `<span aria-hidden="true" style="${escapeAttr(styleOf(el, 'span', computed, false, name))}">${escapeText(text)}</span>`;
    };
    const children = () => pseudo('::before') + [...el.childNodes].map((child) => walk(child, computed, false)).join('') + pseudo('::after');
    let inner: string | null = null;
    let attrs = keepPosition && el.id ? ` id="${escapeAttr(el.id)}"` : '';
    switch (tag) {
      case 'input': {
        const input = el as HTMLInputElement;
        if (input.type === 'checkbox' || input.type === 'radio') {
          tag = 'span';
          inner = input.checked ? '☑' : '☐';
        } else {
          tag = 'span';
          inner = escapeText(input.value || input.placeholder);
        }
        break;
      }
      case 'textarea':
        tag = 'div';
        inner = escapeText((el as HTMLTextAreaElement).value || (el as HTMLTextAreaElement).placeholder);
        break;
      case 'select':
        tag = 'span';
        inner = escapeText((el as HTMLSelectElement).selectedOptions[0]?.text ?? '');
        break;
      case 'canvas':
        tag = 'img';
        try {
          attrs += ` src="${(el as HTMLCanvasElement).toDataURL('image/png')}"`;
        } catch {
          // Tainted canvas: an empty box of the same size.
          tag = 'div';
        }
        break;
      case 'video':
        tag = 'div';
        inner = '';
        break;
      case 'img': {
        const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
        if (src) attrs += ` src="${imageToken(src)}"`;
        break;
      }
      case 'a': {
        const href = el.getAttribute('href') ?? '';
        if (/^(https?:|mailto:|#)/i.test(href)) attrs += ` href="${escapeAttr(href)}"`;
        break;
      }
    }
    for (const attr of el.attributes) if (KEPT_ATTRIBUTES.has(attr.name) && !(tag !== el.localName && attr.name === 'value')) attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`;
    const style = styleOf(el, el.localName === tag ? tag : 'div', parent, root);
    if (style) attrs += ` style="${escapeAttr(style)}"`;
    if (tag === 'img' || tag === 'br' || tag === 'hr' || tag === 'wbr') return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${inner ?? children()}</${tag}>`;
  };

  // The root inherits from its real parent, so its own inherited values are kept unless default.
  return { html: walk(element, null, true), images };
}

/** The element as standalone HTML, images by URL (for a synchronous clipboard write). */
export function standaloneHtml(element: Element): string {
  return standalone(element).html.replace(IMAGE_TOKEN, (_m, encoded: string) => escapeAttr(decodeURIComponent(encoded)));
}

/** The element as standalone HTML, images inlined as data URLs. */
async function captureHtml(element: Element, mode: CaptureHtmlMode = 'clipboard'): Promise<string> {
  const { html, images } = standalone(element, mode);
  const urls = new Map(await Promise.all([...images].map(async (src) => [src, await dataUrl(src)] as const)));
  return html.replace(IMAGE_TOKEN, (_m, encoded: string) => {
    const src = decodeURIComponent(encoded);
    return escapeAttr(urls.get(src) ?? src);
  });
}

/** The extension paints a centred SVG mask at its intrinsic size. Give fitted
 * masks that size in the asset itself, keeping the paths and the CSS mask. */
export async function captureFigmaHtml(element: Element): Promise<string> {
  const html = await captureHtml(element, 'figma');
  if (!html.includes('mask-image:')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll<HTMLElement>('[style*="mask-image:"]')) {
    const style = node.style;
    if (style.maskSize !== 'contain' || style.maskRepeat !== 'no-repeat' || style.maskPosition !== '50% 50%') continue;
    const urls = cssUrls(style.maskImage);
    if (urls.length !== 1 || !urls[0]!.url.startsWith('data:image/svg+xml')) continue;
    const w = parseFloat(style.width), h = parseFloat(style.height);
    if (!(w > 0 && h > 0) || !style.width.endsWith('px') || !style.height.endsWith('px')) continue;
    try {
      const data = await (await fetch(urls[0]!.url)).text();
      const svg = new DOMParser().parseFromString(data, 'image/svg+xml').documentElement;
      if (svg.localName !== 'svg') continue;
      const sw = svg.getAttribute('width'), sh = svg.getAttribute('height');
      if (!sw || !sh || !/^\d+(?:\.\d+)?(?:px)?$/.test(sw) || !/^\d+(?:\.\d+)?(?:px)?$/.test(sh)) continue;
      const intrinsicW = parseFloat(sw), intrinsicH = parseFloat(sh);
      if (!intrinsicH || Math.abs(intrinsicW / intrinsicH - w / h) > 0.0001) continue;
      if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${intrinsicW} ${intrinsicH}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      const url = await blobToDataUrl(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      style.maskImage = `url("${url}")`;
    } catch {
      // Leave any mask we cannot resize in its original embedded form.
    }
  }
  return template.innerHTML;
}

/* --------------------------------- command -------------------------------- */

let busy = false;

/** Copies the single selected element in a format. */
export async function copyAs(format: CaptureFormat): Promise<void> {
  if (busy) {
    toast.add({ title: 'Still copying…' });
    return;
  }
  const element = selectedLiveElement();
  if (!element) {
    toast.add({ title: `Select just one element to copy it as ${format.toUpperCase()}` });
    return;
  }
  if (!canCopyAs()) {
    toast.add({ title: 'This browser cannot copy images or markup to the clipboard.' });
    return;
  }
  busy = true;
  // Start the clipboard write on the press; the content can finish later. Where
  // the browser keeps the clipboard from the framed editor, the Shell writes it.
  const content: Promise<Blob | string> = format === 'png' ? selectionPng(element)
    : format === 'svg' ? captureSvg(element).then(({ svg }) => svg)
      : captureHtml(element).then((html) => {
        if (!html.trim()) throw new Error('The element is empty.');
        if (html.length > MAX_HTML) throw new Error('The element is too large to copy as HTML.');
        return html;
      });
  const as = (type: string): Promise<Blob> => {
    const blob = content.then((value) => (value instanceof Blob ? value : new Blob([value], { type })));
    blob.catch(() => undefined); // reported below, from `content`
    return blob;
  };
  const items: Record<string, Promise<Blob>> = format === 'png' ? { 'image/png': as('image/png') }
    : format === 'svg' ? { 'text/plain': as('text/plain'), ...(typeof ClipboardItem === 'undefined' || ClipboardItem.supports?.('image/svg+xml') ? { 'image/svg+xml': as('image/svg+xml') } : {}) }
      : { 'text/html': as('text/html'), 'text/plain': as('text/plain') };
  try {
    await writeClipboard(items, maybeSession()?.shell);
    toast.add({ title: `Copied as ${format.toUpperCase()}` });
  } catch (error) {
    // Say what went wrong with the content, rather than how the clipboard took it.
    const reason = await content.then(() => error, (failure: unknown) => failure);
    toast.add({ title: `Couldn’t copy as ${format.toUpperCase()}`, description: reason instanceof Error ? reason.message : String(reason) });
  } finally {
    busy = false;
  }
}
