/**
 * The built Shell and home page (`dist/daemon/shell`, `dist/daemon/home`) on the app origin, at the daemon's
 * `UI_PATHS`: hashed files under `assets/` are cached for a year, `index.html` never. `OA_UI_DIR` points at another
 * built `dist/daemon`.
 */

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mimeOf } from '@open-artifact/type-server';
import { ConfigError } from '../core/config.ts';
import { UI_PATHS } from '../core/app/routes.ts';

/** The repository's `dist/daemon`, resolved from this package (`packages/host/src/node/`). */
export const DEFAULT_UI_DIR = fileURLToPath(new URL('../../../../dist/daemon', import.meta.url));

/** The built pages' folder: `OA_UI_DIR`, else this checkout's `dist/daemon`; refuses one without both pages. */
export function uiDirOf(env: Record<string, string | undefined>): string {
  const given = env.OA_UI_DIR?.trim();
  const dir = resolve(given || DEFAULT_UI_DIR);
  for (const page of ['shell', 'home']) {
    if (!existsSync(join(dir, page, 'index.html'))) {
      throw new ConfigError(
        'OA_UI_DIR',
        given
          ? `${dir} has no ${page}/index.html: point it at a built dist/daemon.`
          : `the Shell is not built (${join(dir, page, 'index.html')} is missing): run \`npm run build\` in the Open Artifact checkout first, or set OA_UI_DIR to a built dist/daemon.`,
      );
    }
  }
  return dir;
}

/** The built pages: their `index.html` templates and their files. */
export interface UiFiles {
  shellHtml(): Promise<string>;
  homeHtml(): Promise<string>;
  /** A file under `UI_PATHS`, or null. */
  file(pathname: string, request: Request): Promise<Response | null>;
}

/** Serves `dir` (a built `dist/daemon`). Templates are read once; `cache: false` reads them on every request. */
export function uiFiles(dir: string, options: { cache?: boolean } = {}): UiFiles {
  const root = resolve(dir);
  const templates = new Map<string, Promise<string>>();
  const template = (page: 'shell' | 'home'): Promise<string> => {
    let text = options.cache === false ? undefined : templates.get(page);
    if (!text) {
      text = readFile(join(root, page, 'index.html'), 'utf8');
      text.catch(() => templates.delete(page));
      templates.set(page, text);
    }
    return text;
  };

  return {
    shellHtml: () => template('shell'),
    homeHtml: () => template('home'),
    async file(pathname, request) {
      const prefix = pathname.startsWith(UI_PATHS.shell) ? UI_PATHS.shell : pathname.startsWith(UI_PATHS.home) ? UI_PATHS.home : null;
      if (!prefix) return null;
      let rel: string;
      try {
        rel = decodeURIComponent(pathname.slice(prefix.length));
      } catch {
        return null;
      }
      if (!rel || rel === 'index.html') return null; // the pages are served with their boot, at / and /a/<id>
      if (rel.includes('\0') || rel.split('/').some((step) => step === '' || step === '.' || step === '..' || step.startsWith('.'))) return null;
      const base = join(root, prefix === UI_PATHS.shell ? 'shell' : 'home');
      const path = resolve(base, rel);
      if (!path.startsWith(base + sep)) return null;
      let info;
      try {
        info = await stat(path);
      } catch {
        return null;
      }
      if (!info.isFile()) return null;
      const etag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
      const headers = new Headers({
        'content-type': mimeOf(path) || 'application/octet-stream',
        'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        etag,
      });
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      if (extname(path) === '.map') headers.set('content-type', 'application/json');
      return new Response(request.method === 'HEAD' ? null : await readFile(path), { headers });
    },
  };
}
