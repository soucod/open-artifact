/**
 * Loaded with `--import` by `site-app.test.ts`: points the host's app tests' `./app-fixture.ts` at
 * `site-app-fixture.ts` (the product Worker behind the same `TestApp`).
 */
import { registerHooks } from 'node:module';

const fixture = new URL('./site-app-fixture.ts', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './app-fixture.ts' && context.parentURL?.includes('/packages/host/test/app-')) return { url: fixture, shortCircuit: true };
    return next(specifier, context);
  },
});
