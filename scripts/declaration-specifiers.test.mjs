/**
 * `scripts/declaration-specifiers.mjs`: the rewrite `scripts/build-npm.mjs` applies to every staged `.d.ts`.
 *
 * Run: node --test scripts/declaration-specifiers.test.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { relativeTsSpecifiers, rewriteDeclarationSpecifiers } from './declaration-specifiers.mjs';

describe('relative .ts specifiers in declarations', () => {
  it('rewrites export/import from, side-effect imports and import() types', () => {
    const before = [
      "export { createHarness, type HarnessOptions } from './harness.ts';",
      'export * from "../protocol/index.ts";',
      "import type { Caps } from './caps.tsx';",
      "import './side.mts';",
      "export declare const x: import('./types.ts').Thing;",
      "export type Y = typeof import( './y.cts' );",
    ].join('\n');
    const after = rewriteDeclarationSpecifiers(before);
    assert.equal(
      after,
      [
        "export { createHarness, type HarnessOptions } from './harness.js';",
        'export * from "../protocol/index.js";',
        "import type { Caps } from './caps.js';",
        "import './side.mjs';",
        "export declare const x: import('./types.js').Thing;",
        "export type Y = typeof import( './y.cjs' );",
      ].join('\n'),
    );
    assert.deepEqual(relativeTsSpecifiers(before), ['./harness.ts', '../protocol/index.ts', './caps.tsx', './side.mts', './types.ts', './y.cts']);
    assert.deepEqual(relativeTsSpecifiers(after), []);
  });

  it('leaves bare specifiers, .d.ts specifiers, .js specifiers and declare module alone', () => {
    const text = [
      "import type { Server } from 'node:http';",
      "export * from '@open-artifact/protocol';",
      "import type { A } from './a.d.ts';",
      "import type { B } from './b.js';",
      "declare module 'virtual:motion-stage-runtime' { const s: string; export default s; }",
      "declare module './augmented.ts' { interface X { y: 1 } }",
      "/** See from './comment.md' */",
    ].join('\n');
    assert.equal(rewriteDeclarationSpecifiers(text), text);
    assert.deepEqual(relativeTsSpecifiers(text), []);
  });
});
