/**
 * Builds the daemon's pages. This file builds the Shell (`/a/<id>`) into
 * `dist/daemon/shell/`; `vite.home.config.ts` builds the home page (`/`)
 * into `dist/daemon/home/` from the same {@link pageConfig}.
 *
 * In dev (`vite -c …`), `/api` is proxied to the daemon at `OPEN_ARTIFACT_DAEMON_URL`
 * (default `http://127.0.0.1:4800`).
 */

import tailwindcss from '@tailwindcss/vite';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

/** The browsers the pages are built for. */
const TARGET = 'es2022';

/** One of the daemon's pages. */
export type DaemonPage = 'shell' | 'home';

/** Where the Shell's `index.html` takes its pre-boot script. */
const PREBOOT_SLOT = '<!--open-artifact:preboot-->';

/**
 * Inlines `src/shell/preboot.ts` into the Shell's `index.html` as a classic script (it must run before the bundle,
 * and before the bundle can fail to load): bundled on its own and minified for the target the Shell is built for.
 */
function prebootScript(target: string): Plugin {
  return {
    name: 'open-artifact-preboot',
    async transformIndexHtml(html) {
      if (!html.includes(PREBOOT_SLOT)) return html;
      const out = await build({
        stdin: {
          contents: "import { preboot } from './preboot.ts';\npreboot(window);\n",
          resolveDir: fileURLToPath(new URL('./src/shell', import.meta.url)),
          sourcefile: 'preboot-inline.ts',
          loader: 'ts',
        },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target,
        minify: true,
        legalComments: 'none',
      });
      const code = out.outputFiles[0]!.text.trim().replace(/<\/(script)/gi, '<\\/$1');
      return html.replace(PREBOOT_SLOT, () => `<script>${code}</script>`);
    },
  };
}

/** The Vite config of one daemon page: served under `/_open-artifact/<page>/`, built into `dist/daemon/<page>/`. */
export function pageConfig(page: DaemonPage): UserConfig {
  const daemon = process.env.OPEN_ARTIFACT_DAEMON_URL ?? 'http://127.0.0.1:4800';
  return {
    root: fileURLToPath(new URL(`./src/${page}`, import.meta.url)),
    base: `/_open-artifact/${page}/`,
    plugins: [tailwindcss(), ...(page === 'shell' ? [prebootScript(TARGET)] : [])],
    server: {
      port: page === 'shell' ? 5180 : 5181,
      proxy: {
        '/api': {
          target: daemon,
          changeOrigin: true,
          // The daemon takes writes from its own origin only: speak as it.
          configure(proxy) {
            proxy.on('proxyReq', (request) => {
              if (request.getHeader('origin')) request.setHeader('origin', daemon);
            });
          },
        },
      },
    },
    build: {
      outDir: fileURLToPath(new URL(`../../dist/daemon/${page}`, import.meta.url)),
      emptyOutDir: true,
      target: TARGET,
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        onwarn(warning, warn) {
          // Base UI marks its modules "use client"; meaningless in a client bundle.
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
          warn(warning);
        },
      },
    },
  };
}

export default defineConfig(pageConfig('shell'));
