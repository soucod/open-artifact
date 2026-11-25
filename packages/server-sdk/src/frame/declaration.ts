/**
 * The inline declaration of an original artifact type: a type's index.html
 * carries, near the top of its first script, a block that starts with the
 * line comment `// artifact.json` and declares
 * `var key = "<type key>"; var capabilities = {...}; var monitoring = {...};`
 * in some order (a type may leave capabilities out). Only that block is read:
 * it ends at the next line comment (`declarationSource` in the protocol, which
 * `open-artifact types check` reads too). It is read as literal data
 * (`parseLiteralDeclarations`), never run: nothing from a type folder is
 * evaluated in Node, so an installed type's page is read the same way as a
 * built-in one's.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declarationSource, parseLiteralDeclarations, type CapabilityDecl } from '@open-artifact/protocol';

export { DECLARATION_LINE } from '@open-artifact/protocol';
export type { CapabilityDecl } from '@open-artifact/protocol';

export interface Declaration {
  /** The type key, when the block names one. */
  key: string | null;
  /** cap → declared config. */
  capabilities: Record<string, CapabilityDecl>;
  monitoring: Record<string, unknown>;
}

/**
 * The declaration in a type's index.html, or null when the page carries none. Only `var` bindings count (a `let` or
 * `const` is not a global of the page, and `types check` flags it); the last initialized one of a name wins, as when the
 * block runs. Throws when the block is not literal data.
 */
export function parseDeclaration(html: string): Declaration | null {
  const found = declarationSource(html);
  if (!found) return null;
  const values = new Map<string, unknown>();
  try {
    for (const b of parseLiteralDeclarations(found.source, html.slice(0, found.offset))) {
      if (b.kind !== 'var') continue;
      if (b.initialized || !values.has(b.name)) values.set(b.name, b.value);
    }
  } catch (error) {
    throw new Error(`The artifact.json block of index.html is not literal data: ${(error as Error)?.message ?? error}`);
  }
  const key = values.get('key');
  const capabilities = values.get('capabilities');
  const monitoring = values.get('monitoring');
  return {
    key: typeof key === 'string' ? key : null,
    capabilities: isObject(capabilities) ? (capabilities as Record<string, CapabilityDecl>) : {},
    monitoring: isObject(monitoring) ? monitoring : {},
  };
}

/** The declaration of the type folder `dir` (its index.html), or null. */
export function readDeclaration(dir: string): Declaration | null {
  let html: string;
  try {
    html = readFileSync(join(dir, 'index.html'), 'utf8');
  } catch {
    return null;
  }
  return parseDeclaration(html);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
