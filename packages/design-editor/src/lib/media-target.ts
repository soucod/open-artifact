/**
 * Finding an image or video again after an upload. The board can change
 * while the file uploads (an agent rewrites it, another person edits it), so
 * the address taken when the file was picked may now name another element,
 * or nothing.
 */

import { attributeValue, elementPath, resolveElement, type HtmlElement, type TemplateModel } from '@open-artifact/dc';

/** An element's address in a board's template. */
export interface MediaAddress {
  tid: number;
  path: number[];
}

/** What the element was when the file was picked. */
export interface MediaTarget extends MediaAddress {
  tag: string;
  src: string | undefined;
}

/** The element as it was when picked, from its tag and `src`. */
export function mediaTarget(model: TemplateModel, element: HtmlElement): MediaTarget {
  return { tid: model.tidOf.get(element)!, path: elementPath(model, element), tag: element.tag, src: attributeValue(element, 'src') };
}

/**
 * Where the picked element is in `model` now: at its old address while the
 * same kind of element is there, else the only element of that kind with
 * the same `src`. `null` when it is gone or more than one fits.
 */
export function relocateMedia(model: TemplateModel, target: MediaTarget): MediaAddress | null {
  const same = resolveElement(model, target.tid, target.path);
  if (same && same.tag === target.tag) return { tid: target.tid, path: [...target.path] };
  if (target.src === undefined) return null;
  const found = model.elements.filter((element) => element.tag === target.tag && attributeValue(element, 'src') === target.src);
  if (found.length !== 1) return null;
  const element = found[0]!;
  return { tid: model.tidOf.get(element)!, path: elementPath(model, element) };
}
