/**
 * Loaded with `--import` by `catalog-d1.test.ts`: points the host's catalog tests' `../src/node/sqlite.ts` at
 * `catalog-d1-shim.ts` (a D1 driver).
 */
import { registerHooks } from 'node:module';

const shim = new URL('./catalog-d1-shim.ts', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../src/node/sqlite.ts' && context.parentURL?.includes('/packages/host/test/')) return { url: shim, shortCircuit: true };
    return next(specifier, context);
  },
});
