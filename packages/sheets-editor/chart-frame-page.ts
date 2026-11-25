/**
 * Builds the chart frame and the interactive frame, each into one self-contained document (`assets/chart-frame.txt`,
 * `assets/interactive-frame.txt`), which the page fetches and gives a sandboxed frame as its `srcdoc`. A document's
 * policy runs its one script by hash and loads nothing from anywhere: the chart worker's code rides along as inert
 * text, and the font and styles are inline. The interactive frame starts no worker: its code runs in the frame.
 */
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild, type Plugin, type Rollup } from 'vite';

const FRAME_FOLDER = fileURLToPath(new URL('./src/chart-frame/', import.meta.url));
const INTERACTIVE_FRAME_FOLDER = fileURLToPath(new URL('./src/interactive-frame/', import.meta.url));
const OUTPUT_FILE = 'assets/chart-frame.txt';
const INTERACTIVE_OUTPUT_FILE = 'assets/interactive-frame.txt';
const WORKER_SCRIPT_ID = 'script-of-worker';

async function buildWorker(): Promise<string> {
  const { outputFiles } = await esbuild({
    entryPoints: [`${FRAME_FOLDER}worker.ts`],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
  });
  const code = outputFiles[0]?.text;
  if (code === undefined) throw Error('the chart worker built to nothing');
  if (!code.includes('import(')) throw Error('the chart worker lost its import of the chart module');
  return code;
}

async function buildFrame(folder: string = FRAME_FOLDER): Promise<{ script: string; style: string }> {
  const result = await viteBuild({
    configFile: false,
    root: folder,
    logLevel: 'warn',
    mode: 'production',
    plugins: [tailwindcss()],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: () => true,
      modulePreload: false,
      rollupOptions: {
        input: `${folder}main.tsx`,
        output: { format: 'iife', inlineDynamicImports: true },
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
          warn(warning);
        },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => ('output' in one ? one.output : []));
  const chunks = outputs.filter((output): output is Rollup.OutputChunk => output.type === 'chunk');
  const styles = outputs.filter((output): output is Rollup.OutputAsset => output.type === 'asset' && output.fileName.endsWith('.css'));
  const others = outputs.filter((output) => output.type === 'asset' && !output.fileName.endsWith('.css'));
  if (chunks.length !== 1 || styles.length !== 1 || others.length > 0)
    throw Error(`the frame in ${folder} built to ${outputs.map((output) => output.fileName).join(', ')}, not one script and one style`);
  const [chunk, style] = [chunks[0], styles[0]];
  if (chunk === undefined || style === undefined) throw Error('the chart frame built to nothing');
  return { script: chunk.code, style: String(style.source) };
}

/** Text that may sit inside a <script> or <style> element without ending it. */
const inertInElement = (text: string, element: 'script' | 'style'): string =>
  text.replace(new RegExp(`</(${element})`, 'gi'), '<\\/$1').replace(/<!--/g, '<\\!--');

const hashOf = (text: string): string => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

export interface FrameDocumentParts {
  /** The chart worker's code; a frame without one may start no worker. */
  worker?: string;
  script: string;
  style: string;
  title?: string;
  /** The id of the element the frame draws in. */
  rootId?: string;
}

export function composeFrameDocument({ worker, script, style, title = 'Chart', rootId = 'chart' }: FrameDocumentParts): string {
  const runs = inertInElement(script, 'script');
  const policy = [
    "default-src 'none'",
    `script-src ${hashOf(runs)} blob:`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    worker === undefined ? "worker-src 'none'" : 'worker-src blob:',
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    `<title>${title}</title>`,
    `<style>${inertInElement(style, 'style')}</style>`,
    '</head><body>',
    `<div id="${rootId}"></div>`,
    ...(worker === undefined ? [] : [`<script type="text/plain" id="${WORKER_SCRIPT_ID}">${inertInElement(worker, 'script')}</script>`]),
    `<script>${runs}</script>`,
    '</body></html>',
  ].join('');
}

/** Emits the chart frame's document and the interactive frame's beside the editor's assets. */
export function chartFramePage(): Plugin {
  return {
    name: 'sheets-chart-frame-page',
    apply: 'build',
    async generateBundle() {
      const [worker, { script, style }, interactive] = await Promise.all([buildWorker(), buildFrame(), buildFrame(INTERACTIVE_FRAME_FOLDER)]);
      this.emitFile({ type: 'asset', fileName: OUTPUT_FILE, source: composeFrameDocument({ worker, script, style }) });
      this.emitFile({
        type: 'asset',
        fileName: INTERACTIVE_OUTPUT_FILE,
        source: composeFrameDocument({ ...interactive, title: 'Interactive sheet', rootId: 'interactive' }),
      });
    },
  };
}
