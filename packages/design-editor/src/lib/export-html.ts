/**
 * The HTML exports, as pure text work: one artboard as a single
 * self-contained HTML file, the whole canvas as a folder with an index page
 * and a README, and the bookkeeping both need (relative paths, uploaded
 * files, data URLs). services/export.ts reads the files and saves the result.
 *
 * A single-file export runs offline: the board runtime (`support.js`) is
 * inlined, preceded by a small bootstrap that answers the runtime's own
 * `fetch`es (its source, `<dc-import>`ed artboards, data files) from copies
 * embedded in the page. Stylesheets and scripts the artboard links are
 * inlined; images, fonts and uploads become `data:` URLs.
 */

import { supportScriptTag } from '@open-artifact/dc';

/** Root-relative URL of an upload (`/_blob/<id>`). */
export const BLOB_REF = /\/_blob\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?/g;

/** Text files (read and rewritten as text); everything else is bytes. SVG counts as an image. */
export const TEXT_FILE = /\.(html?|css|js|mjs|json|txt|md|csv)$/i;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
};

/** The media type of a file name. */
export function mimeOf(name: string, fallback = 'application/octet-stream'): string {
  return MIME[/\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''] ?? fallback;
}

/** The folder part of a path (`sub/A.dc.html` → `sub/`). */
const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

/** `to` (a project path) as seen from the folder `fromDir` (`''` or `sub/`). */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const target = to.split('/');
  let shared = 0;
  while (shared < from.length && shared < target.length - 1 && from[shared] === target[shared]) shared++;
  return [...from.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}

/** Bytes as base64. */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A file as a `data:` URL. */
export function dataUrl(name: string, data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return `data:${mimeOf(name)};base64,${base64(bytes)}`;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrites references in `text`: each key of `refs` (a relative path, or an
 * upload URL) written as an attribute value or `url()` — after a quote, `(`
 * or `=`, optionally with `./` — becomes its value.
 */
export function rewriteRefs(text: string, refs: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [from, to] of refs) {
    if (!from || from === to) continue;
    const pattern = new RegExp(`(["'(=]\\s*)(?:\\./)?${escapeRegExp(from)}(?=["')\\s?#])`, 'g');
    out = out.replace(pattern, (_match, lead: string) => `${lead}${to}`);
  }
  return out;
}

/** The uploads (`/_blob/<id>`) a text names. */
export function blobRefs(text: string): string[] {
  return [...new Set(text.match(BLOB_REF) ?? [])];
}

/** Where an upload lands in an exported folder (`assets/<id>.<ext>`). */
export function assetName(ref: string, contentType?: string | null): string {
  const id = ref.replace(/^\/_blob\//, '');
  if (/\.[A-Za-z0-9]+$/.test(id)) return `assets/${id}`;
  const ext = Object.entries(MIME).find(([, type]) => type === contentType?.split(';')[0]?.trim())?.[0];
  return `assets/${id}${ext ? `.${ext}` : ''}`;
}

/** Text safe inside an inline `<script>`. */
export function inlineScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** JSON safe inside an inline `<script>`. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * The bootstrap that serves the embedded copies to the runtime's `fetch`:
 * its own page (the runtime re-reads its source) and files next to it.
 */
export function standaloneBootstrap(self: string, files: Readonly<Record<string, string>>, path = 'index.dc.html'): string {
  return `(function () {
    const path = ${scriptJson(path)}, source = ${scriptJson(self)}, files = ${scriptJson(files)};
    window.__dcExport = {path, source, files};
    const request = window.fetch;
    const project = new URL(path, 'https://artifact.invalid/');
    window.fetch = function (input, init) {
      try {
        const name = typeof input === 'string' ? input : input.url || input.href;
        if (name === location.href) return Promise.resolve(new Response(source));
        const here = new URL(location.href);
        const url = new URL(name, here.protocol === 'about:' ? project : here);
        const relative = here.protocol !== 'about:' && url.origin === here.origin && url.href.startsWith(new URL('.', here).href)
          ? url.href.slice(new URL('.', here).href.length) : name;
        const target = new URL(relative, project);
        const key = decodeURIComponent(target.pathname.slice(1));
        if (target.origin === project.origin && Object.hasOwn(files, key)) return Promise.resolve(new Response(files[key]));
      } catch {}
      return request.apply(this, arguments);
    };
  })();`;
}

/** What {@link standaloneDocument} embeds. */
export interface StandaloneInput {
  /** The artboard's project path. */
  path: string;
  source: string;
  /** Files it uses, by project path: text, or bytes. */
  files: ReadonlyMap<string, Uint8Array | string>;
  /** Uploads it uses, as `data:` URLs by their `/_blob/…` reference. */
  uploads: ReadonlyMap<string, string>;
  /** The board runtime's code. */
  runtime: string;
}

/** One artboard as a single HTML file that runs without a server. */
export function standaloneDocument({ path, source, files, uploads, runtime }: StandaloneInput): string {
  const binaries = [...files].filter(([name, data]) => typeof data !== 'string' || !TEXT_FILE.test(name));
  const dataUrls = new Map(binaries.map(([name, data]) => [name, dataUrl(name, data)]));
  /** References to binaries and uploads in a text at `name`, rewritten to data URLs. */
  const inline = (name: string, text: string): string => {
    const refs = new Map<string, string>(uploads);
    for (const [file, url] of dataUrls) refs.set(relativePath(dirOf(name), file), url);
    return rewriteRefs(text, refs);
  };
  const boardDir = dirOf(path);
  const texts = new Map<string, string>();
  for (const [name, data] of files) if (typeof data === 'string' && TEXT_FILE.test(name)) texts.set(name, inline(name, data));

  const self = inline(path, source);
  let html = self;
  // Linked stylesheets and scripts the browser loads by itself: inline them.
  for (const [name, text] of texts) {
    const rel = escapeRegExp(relativePath(boardDir, name));
    if (/\.css$/i.test(name)) {
      html = html.replace(new RegExp(`<link\\b[^>]*\\bhref=["'](?:\\./)?${rel}["'][^>]*>`, 'gi'), () => `<style>\n${text.replace(/<\/(style)/gi, '<\\/$1')}\n</style>`);
    } else if (/\.m?js$/i.test(name)) {
      html = html.replace(new RegExp(`<script\\b([^>]*?)\\bsrc=["'](?:\\./)?${rel}["']([^>]*)>\\s*</script>`, 'gi'), (_m, a: string, b: string) => `<script${a}${b}>\n${inlineScript(text)}\n</script>`);
    }
  }
  const bootstrap = standaloneBootstrap(self, Object.fromEntries(texts), path);
  const scripts = `<script>${inlineScript(bootstrap)}</script>\n<script>\n${inlineScript(runtime)}\n</script>`;
  const tag = supportScriptTag(html);
  if (tag) return html.replace(tag, () => scripts);
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}\n${scripts}${html.slice(head.index + head[0].length)}`;
  return `${scripts}\n${html}`;
}

/* --------------------------------- canvas --------------------------------- */

/** An artboard in the canvas export's index and README. */
export interface ExportedBoard {
  path: string;
  title: string;
  width: number;
  height: number;
  page: string;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A portable gallery. Only an embedded frame can navigate its own artboard. */
export function standaloneCanvas(title: string, boards: readonly (ExportedBoard & { html: string })[], marker: string, runtime: string): string {
  const gallery = boards.map(b => `<section><h2>${escapeHtml(b.title)}</h2><iframe title="${escapeHtml(b.title)}" width="${b.width}" height="${b.height}" sandbox="allow-scripts allow-popups"></iframe></section>`).join('\n');
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{background:#f5f4ef;color:#1f1e1d;font:14px/1.4 system-ui;margin:48px}main{display:flex;flex-direction:column;align-items:flex-start;gap:48px}h2{font-size:13px;font-weight:500;color:#6b6a68;margin:0 0 12px}iframe{border:0;background:white;display:block;box-shadow:0 1px 3px #0002}</style>
<main>${gallery}</main>
<script>
const runtime = ${scriptJson(inlineScript(runtime))};
const pages = new Map(${scriptJson(boards.map(b => [b.path, b.html]))});
const frames = Array.from(document.querySelectorAll('iframe'));
function show(frame, path) {
  const html = pages.get(path);
  if (html !== undefined) frame.srcdoc = html.replace(${scriptJson(marker)}, () => runtime);
}
window.addEventListener('message', event => {
  const frame = frames.find(f => f.contentWindow === event.source);
  const request = event.data?.__dc;
  if (frame && request?.type === 'navigate') show(frame, request.path);
});
Array.from(pages.keys()).forEach((path, i) => show(frames[i], path));
</script></html>`;
}

/** `index.html` of the canvas export: every artboard, page by page, as a link. */
export function canvasIndexHtml(title: string, boards: readonly ExportedBoard[]): string {
  const pages = new Map<string, ExportedBoard[]>();
  for (const board of boards) pages.set(board.page, [...(pages.get(board.page) ?? []), board]);
  const sections = [...pages]
    .map(([page, list]) => {
      const items = list.map((b) => `    <li><a href="${escapeHtml(b.path.split('/').map(encodeURIComponent).join('/'))}">${escapeHtml(b.title)}</a> <span>${b.width} × ${b.height}</span></li>`).join('\n');
      return `  <section>\n${pages.size > 1 ? `    <h2>${escapeHtml(page)}</h2>\n` : ''}    <ul>\n${items}\n    </ul>\n  </section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 48px; font: 15px/1.5 system-ui, sans-serif; color: #1a1a1a; background: #fafafa; }
  h1 { margin: 0 0 24px; font-size: 24px; }
  h2 { margin: 24px 0 8px; font-size: 16px; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { padding: 6px 0; border-bottom: 1px solid #e5e5e5; }
  a { color: #0b57d0; text-decoration: none; }
  a:hover { text-decoration: underline; }
  span { color: #767676; font-size: 13px; margin-left: 8px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
${sections}
</main>
</body>
</html>
`;
}

/** What the README describes. */
export interface ReadmeInput {
  title: string;
  boards: readonly ExportedBoard[];
  /** Other files carried (stylesheets, scripts, images, design systems…). */
  resources: readonly string[];
  /** Uploads written under `assets/`. */
  assets: number;
  /** Uploads that could not be read, with the files that use them and, when known, why. */
  missing: readonly { ref: string; usedIn: readonly string[]; why?: string }[];
  /** Folders holding a copy of the runtime. */
  runtimes: readonly string[];
}

/** README.md of an HTML export (one artboard or the whole canvas). */
export function exportReadme({ title, boards, resources, assets, missing, runtimes }: ReadmeInput): string {
  const lines = [
    `# ${title} — design reference`,
    '',
    'This is a design made in a visual design tool, exported as web pages. Treat it as a',
    'REFERENCE MOCKUP, not production code: the markup and inline styles carry the',
    "design's precise values — colors, font sizes, spacing, radii, shadows, layout — which",
    'an implementation should replicate faithfully in its own components and styling',
    'system rather than copy wholesale.',
    '',
    '## Contents',
    '',
  ];
  if (boards.length > 1) lines.push('- `index.html` — every artboard, page by page.');
  for (const board of boards) {
    lines.push(`- \`${board.path}\` — “${board.title}”, ${board.width} × ${board.height}${boards.length > 1 && board.page ? ` (${board.page})` : ''}. A Design Component: an \`<x-dc>\``);
    lines.push('  template and a small logic class; the values to replicate live in its inline');
    lines.push('  `style="…"` attributes and its `<helmet><style>` block.');
  }
  for (const resource of resources) lines.push(`- \`${resource}\` — used by the artboards.`);
  if (assets > 0) lines.push(`- \`assets/\` — ${assets} uploaded file${assets === 1 ? '' : 's'} (images, fonts, media) the artboards use.`);
  for (const runtime of runtimes) lines.push(`- \`${runtime}support.js\` — the runtime that renders the artboards in a browser; not part of the design.`);
  lines.push('');
  if (missing.length) {
    lines.push('## Missing from this export', '', 'These uploaded files could not be included, so wherever the design uses them they do', 'not load. Exporting again may pick them up.', '');
    for (const item of missing) lines.push(`- \`${item.ref}\` (used in ${item.usedIn.map((f) => `\`${f}\``).join(', ')})${item.why ? `: ${item.why}` : ''}`);
    lines.push('');
  }
  const open = boards.length > 1 ? 'index.html' : (boards[0]?.path ?? 'index.html');
  lines.push('## Viewing', '', `Serve the folder (for example \`python3 -m http.server\`) and open \`${open}\`;`, 'browsers block the scripts of pages opened straight from disk (file://).', '');
  return lines.join('\n');
}
