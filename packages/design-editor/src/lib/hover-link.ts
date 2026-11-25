/**
 * The link an element on an artboard sits in, for the card shown while it
 * is hovered: the address of the nearest `<a href>` at or above it.
 */

import { attributeValue, type HtmlElement, type TemplateModel } from '@open-artifact/dc';

/** The address of the link `tid` is in, or `null`. */
export function linkAround(model: TemplateModel, tid: number): string | null {
  for (let node: HtmlElement | null = model.elements[tid] ?? null; node; node = node.parent) {
    if (node.tag !== 'a') continue;
    const href = attributeValue(node, 'href')?.trim();
    return href ? href : null;
  }
  return null;
}

/** The address a browser can open in a new tab (web and mail links), else `null`. */
export function openableLink(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

/** The address as shown on the card: without the scheme, a query or a trailing slash. */
export function shownLink(href: string): string {
  return href.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/$/, '') || href;
}
