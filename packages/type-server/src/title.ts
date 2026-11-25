/**
 * Where an artifact's title lives in its own files: each built-in type's `titleFrom` (`<file>#<JSON pointer>`, as its
 * `artifact-type.json` declares it), and a reader that resolves it in an artifact folder. A host keeps its catalog
 * title in step with this, so the title people see on the home page is the one the page shows.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTitleFrom, titleInJson, valueAtPointer } from '@open-artifact/protocol';
import { contentDirOf, TYPES, type TypeName } from './types.ts';

/**
 * Each built-in type's `titleFrom` (the same text as in `artifact-types/<type>/artifact-type.json`; a test keeps them
 * equal). A type whose manifest names none reads `title` of its marker file, as the type server's index title does.
 */
export const TITLE_FROM: Record<TypeName, string> = {
  design: 'project/canvas.json#/title',
  'design-system': `${contentDirOf('design-system')}/${TYPES['design-system'].marker}#/title`,
  slides: 'project/deck.json#/title',
  whiteboard: 'db/board/meta.json#/title',
  data: 'db/dash/meta.json#/title',
  sheets: 'sheet/sheet.json#/title',
  docs: 'doc/doc.json#/name',
  motion: 'db/film/meta.json#/title',
};

export { parseTitleFrom, valueAtPointer };

/** The title `spec` points at in the folder `root`: a non-empty string, trimmed, or undefined. */
export async function readTitleFrom(root: string, spec: string): Promise<string | undefined> {
  const parsed = parseTitleFrom(spec);
  if (!parsed) return undefined;
  try {
    return titleInJson(await readFile(join(root, parsed.file), 'utf8'), parsed.pointer);
  } catch {
    return undefined;
  }
}

/** The title of an artifact of a built-in type, read from its own files (see {@link TITLE_FROM}). */
export function readArtifactTitle(root: string, type: TypeName): Promise<string | undefined> {
  return readTitleFrom(root, TITLE_FROM[type]);
}
