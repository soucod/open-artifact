/**
 * Readable links to a place on the canvas, for agents and people to write by
 * hand: `#page-<id>`, `#artboard-<name>` and `#play-<name>`. An artboard's
 * name is its path in lower case without `.dc.html`, each run of other
 * characters one `-`. A name that fits more than one artboard opens nothing.
 */

import type { CanvasPage } from '@open-artifact/design-core';

/** Where a link points. */
export type Place =
  | { kind: 'page'; page: string }
  | { kind: 'artboard'; path: string }
  | { kind: 'play'; path: string };

/** What a link is matched against. */
export interface PlaceIndex {
  pages: readonly CanvasPage[];
  boards: Readonly<Record<string, unknown>>;
}

/** The readable name of an artboard path or a page id. */
export function placeSlug(text: string): string {
  return text.toLowerCase().replace(/\.dc\.html$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A name as written in a link, then without a file ending copied along with it. */
function linkSlugs(text: string): string[] {
  const slug = placeSlug(text);
  const bare = slug.replace(/-(?:dc-html|html|dc)$/, '');
  return (bare === slug ? [slug] : [slug, bare]).filter(Boolean);
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The one item whose name is `slug`; none or several give `null`. */
function only<T>(items: readonly T[], name: (item: T) => string, slug: string): T | null {
  const found = items.filter((item) => name(item) === slug);
  return found.length === 1 ? found[0]! : null;
}

/** The artboard a link names: by its whole path, else by its file name. Several fits give `null`. */
function boardBySlug(index: PlaceIndex, slugs: readonly string[]): string | null {
  const paths = Object.keys(index.boards);
  for (const name of [(path: string) => placeSlug(path), (path: string) => placeSlug(fileName(path))]) {
    for (const slug of slugs) {
      const found = paths.filter((path) => name(path) === slug);
      if (found.length) return found.length === 1 ? found[0]! : null;
    }
  }
  return null;
}

/** The place a location hash names, or `null` (not such a link, nothing there, or more than one). */
export function placeFromHash(hash: string, index: PlaceIndex): Place | null {
  const match = /^#(page|artboard|play)-(.+)$/.exec(hash);
  if (!match) return null;
  let written: string;
  try {
    written = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  const slugs = linkSlugs(written);
  if (!slugs.length) return null;
  if (match[1] === 'page') {
    const exact = index.pages.find((page) => page.id === written);
    if (exact) return { kind: 'page', page: exact.id };
    const slug = slugs[0]!;
    const page = only(index.pages, (p) => placeSlug(p.id), slug) ?? only(index.pages, (p) => placeSlug(p.name), slug);
    if (page) return { kind: 'page', page: page.id };
    const path = boardBySlug(index, slugs);
    return path ? { kind: 'artboard', path } : null;
  }
  const path = boardBySlug(index, slugs);
  if (!path) return null;
  return match[1] === 'play' ? { kind: 'play', path } : { kind: 'artboard', path };
}
