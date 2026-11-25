// Bundles the main process into out/main.mjs (the kit and the shared harness-node modules inlined; `electron` left
// to Electron) and copies the preload beside it. Run from the repository: node examples/harness-electron/build.mjs
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const here = import.meta.dirname;
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
buildSync({
  entryPoints: [join(here, 'src', 'main.mjs')],
  outfile: join(out, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
});
copyFileSync(join(here, 'src', 'preload.cjs'), join(out, 'preload.cjs'));
console.log(`built ${join(out, 'main.mjs')}`);
