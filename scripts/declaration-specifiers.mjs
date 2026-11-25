/**
 * Relative `.ts` specifiers in emitted declarations. The libraries import each other's files as `./x.ts`; tsc's
 * `rewriteRelativeImportExtensions` rewrites them to `./x.js` in the JavaScript it emits but not in the `.d.ts`, where
 * `./x.ts` names a file the published package does not have. `scripts/build-npm.mjs` rewrites them with
 * {@link rewriteDeclarationSpecifiers} and refuses to stage a declaration that still has one ({@link relativeTsSpecifiers}).
 *
 * Covered: `from '…'` (import and export), side-effect `import '…'`, and `import('…')` types. Left alone: bare
 * specifiers, `.d.ts` specifiers, and `declare module '…'`.
 */

const EXTENSIONS = { ts: 'js', tsx: 'js', mts: 'mjs', cts: 'cjs' };

// `from '…'`, `import '…'` or `import('…')`, then a relative specifier ending in .ts/.tsx/.mts/.cts (not .d.ts etc.).
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/(?:[^'"\n]*?))(?<!\.d)\.(tsx|ts|mts|cts)\2/g;

/** The declaration text with each relative `.ts`/`.tsx`/`.mts`/`.cts` specifier ending in `.js`/`.js`/`.mjs`/`.cjs`. */
export function rewriteDeclarationSpecifiers(text) {
  return text.replace(SPECIFIER, (_, lead, quote, path, ext) => `${lead}${quote}${path}.${EXTENSIONS[ext]}${quote}`);
}

/** The relative `.ts`-family specifiers left in a declaration text (none once rewritten). */
export function relativeTsSpecifiers(text) {
  return [...text.matchAll(SPECIFIER)].map((match) => `${match[3]}.${match[4]}`);
}
