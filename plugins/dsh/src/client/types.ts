/**
 * How each type's thumbnail is taken from its editor page (thumbnails.ts). A type without its own recipe is taken
 * whole, at 1280×800. How a type looks on the page (colors, icon, drawing) is in look.tsx.
 */

/** How a type's thumbnail is taken from its editor page. */
export interface CaptureRecipe {
  /** The viewport the editor is loaded at, CSS pixels. */
  width: number;
  height: number;
  /**
   * An expression run in the editor's page: the element that is the artifact, or a `{ x, y, width, height }` area.
   * Null until it has drawn; the whole page is taken if it never does.
   */
  find: string;
}

/**
 * The design editor draws each artboard as a `[data-board]` element holding the board's iframe; the first artboard on
 * the canvas is the picture. The motion editor draws its stage inside `[data-video-stage]`.
 */
const RECIPES: Record<string, CaptureRecipe> = {
  design: { width: 1280, height: 800, find: `document.querySelector('[data-board] > iframe')?.parentElement ?? null` },
  motion: { width: 1280, height: 800, find: `document.querySelector('[data-video-stage] > iframe')?.parentElement ?? null` },
};

/** The thumbnail recipe of a type; the whole page at 1280×800 for one without its own. */
export function captureRecipe(id: string): CaptureRecipe {
  return RECIPES[id] ?? { width: 1280, height: 800, find: 'null' };
}
