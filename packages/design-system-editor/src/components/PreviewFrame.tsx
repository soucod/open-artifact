/**
 * A live component preview: `components/<Comp>/preview.html` in its own
 * sandboxed frame, with the system loaded first — the tokens (compiled
 * from the working copy, so token edits show at once), `bundle.css`, the
 * libraries and `bundle.js`.
 *
 * The frame is sandboxed like a design board (`allow-scripts
 * allow-same-origin`): previews are written into this project by the same
 * agent as everything else, and browsers refuse loopback requests from an
 * opaque-origin `srcdoc` frame, so without the page's origin a preview could
 * not load the bundle, fonts or images from the local type server. It
 * reports uncaught errors by `postMessage`, which the card shows with a fix
 * button.
 * Frames mount when scrolled near and stay mounted.
 */

import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compileTokensCss, parseCardMarker, type Library } from '@open-artifact/design-system-core';
import { Button, cn } from '@open-artifact/ui';
import { useModel, type SystemModel } from '../state/model.ts';
import { projectUrl } from '../lib/color.ts';
import { askToFixPreview } from '../services/agent.ts';
import { useView } from '../state/view.ts';
import { useFiles } from '../state/files.ts';
import { useHostedFonts } from '../services/fonts.ts';
import { liveScript } from '../lib/live-props.ts';
import { PREVIEW_FOCUS_HOLD } from '../lib/preview-focus.ts';

/** CDN builds (jsDelivr) for libraries a bundle expects as globals (UMD builds only exist up to React 18). */
function libraryUrl(library: Library): string | null {
  if (library.file) return projectUrl(library.file);
  const major = Number(/^\d+/.exec(library.version)?.[0] ?? NaN);
  if ((library.name === 'react' || library.name === 'react-dom') && major >= 16 && major <= 18) {
    const file = library.name === 'react' ? 'react.production.min.js' : 'react-dom.production.min.js';
    return `https://cdn.jsdelivr.net/npm/${library.name}@${library.version}/umd/${file}`;
  }
  return null;
}

/** Escapes text for an attribute. */
const attr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The `srcdoc` of a preview. */
function previewDocument(component: string, preview: string, head: string, id: string): string {
  const base = `<base href="${attr(projectUrl(`components/${component}/`))}">`;
  const report = `<script>(function(){var id=${JSON.stringify(id)};function send(m){try{parent.postMessage({openArtifactPreviewError:String(m).slice(0,600),id:id},'*')}catch(e){}}addEventListener('error',function(e){send(e.message||'Error')});addEventListener('unhandledrejection',function(e){send(e.reason&&e.reason.message||e.reason)});})();</script>`;
  const reset = '<style>html,body{margin:0}</style>';
  const inject = `${base}${report}${PREVIEW_FOCUS_HOLD}${reset}${head}`;
  const body = preview.replace(/^\s*<!--\s*@dsCard[\s\S]*?-->\s*/, '');
  const match = /<head(\s[^>]*)?>/i.exec(body);
  if (match) return `${body.slice(0, match.index + match[0].length)}${inject}${body.slice(match.index + match[0].length)}`;
  return `<!doctype html><html><head><meta charset="utf-8">${inject}</head><body>${body}</body></html>`;
}

/** The head every preview loads, per model and hosted fonts (a string, so frames only reload when it really changes). */
const heads = new WeakMap<SystemModel, Map<string, string>>();

/** What every preview loads before its own markup. */
export function useSystemHead(): string {
  const model = useModel();
  const hosted = useHostedFonts((s) => s.urls);
  const selected = useView((s) => s.theme);
  const theme = model.tokens.themes.find((t) => t.id === selected)?.id ?? model.tokens.themes[0]!.id;
  const fontsKey = Object.values(hosted).sort().join(' ');
  let byFonts = heads.get(model);
  if (!byFonts) heads.set(model, (byFonts = new Map()));
  const key = `${theme}:${fontsKey}`;
  let head = byFonts.get(key);
  if (head === undefined) {
    const { tokens, index, files } = model;
    const css = compileTokensCss(tokens, { fontUrl: (file) => projectUrl(file) }).replace(/<\/style/gi, '<\\/style');
    // A content version in the URL reloads frames when the agent rewrites a file.
    const listing = useFiles.getState().listing;
    const versioned = (path: string): string => `${projectUrl(path)}?v=${(listing[path]?.hash ?? '').slice(0, 12)}`;
    const parts = [`<script>document.documentElement.dataset.theme=${JSON.stringify(theme)}</script><style>${css}</style>`];
    // Hosted (Google) families the tokens name.
    for (const url of fontsKey ? fontsKey.split(' ') : []) parts.push(`<link rel="stylesheet" href="${attr(url)}">`);
    if (files.has('components/bundle.css')) parts.push(`<link rel="stylesheet" href="${attr(versioned('components/bundle.css'))}">`);
    for (const library of index.libraries) {
      const url = library.file ? versioned(library.file) : libraryUrl(library);
      if (url) parts.push(`<script src="${attr(url)}"></script>`);
    }
    if (files.has('components/bundle.js')) parts.push(`<script src="${attr(versioned('components/bundle.js'))}"></script>`);
    head = parts.join('');
    byFonts.clear();
    byFonts.set(key, head);
  }
  return head;
}

let nextId = 0;

export interface PreviewFrameProps {
  component: string;
  /** Layout width the preview was designed at (scaled down to fit). */
  designWidth?: number;
  /** Height at the design width. */
  height?: number;
  className?: string;
  /** Mount right away instead of when scrolled near. */
  eager?: boolean;
}

/** One preview. */
export function PreviewFrame({ component, designWidth, height, className, eager = false }: PreviewFrameProps) {
  const preview = useFiles((s) => s.texts[`components/${component}/preview.html`]);
  const head = useSystemHead();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(eager);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const id = useMemo(() => `preview-${++nextId}`, []);
  const marker = preview ? parseCardMarker(preview) : null;
  const layoutWidth = designWidth ?? marker?.width;
  const minHeight = height ?? marker?.height ?? 120;
  const [contentHeight, setContentHeight] = useState(0);
  const rowHeight = Math.max(minHeight, contentHeight);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const fit = () => {
    observer.current?.disconnect();
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    const measure = () => {
      const bottom = Math.ceil(body.getBoundingClientRect().height);
      setContentHeight(Math.min(4000, bottom));
    };
    observer.current = new ResizeObserver(measure);
    observer.current.observe(body);
    measure();
  };

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const resize = new ResizeObserver(() => setWidth(element.clientWidth));
    resize.observe(element);
    setWidth(element.clientWidth);
    if (eager) return () => resize.disconnect();
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          seen.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    seen.observe(element);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, [eager]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { openArtifactPreviewError?: string; id?: string } | null;
      if (event.source !== frame.current?.contentWindow || !data || data.id !== id || typeof data.openArtifactPreviewError !== 'string') return;
      setError(data.openArtifactPreviewError);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id]);

  const srcDoc = useMemo(() => (preview && visible ? previewDocument(component, preview, head, id) : null), [preview, visible, component, head, id]);
  useEffect(() => setError(null), [srcDoc]);

  const scale = layoutWidth && width ? Math.min(1, width / layoutWidth) : 1;
  const frameWidth = layoutWidth && width ? layoutWidth : width;

  return (
    <div ref={box} className={cn('relative w-full overflow-hidden bg-white', className)} style={{ height: rowHeight * scale }}>
      {srcDoc && width ? (
        <iframe
          ref={frame}
          title={`${component} preview`}
          sandbox="allow-scripts allow-same-origin"
          onLoad={fit}
          srcDoc={srcDoc}
          className="absolute left-0 top-0 block border-0"
          style={{ width: frameWidth, height: rowHeight, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        />
      ) : null}
      {preview === undefined ? <div className="flex size-full items-center justify-center text-[12px] text-fg-subtle">No preview</div> : null}
      {error ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-surface/95 px-2 py-1.5 text-[12px] text-fg shadow-popup">
          <AlertTriangle className="size-3.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <Button size="sm" onClick={() => void askToFixPreview(component, error)}>
            Ask agent to fix
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A component rendered from the bundle with the given props (the live
 * props popover): the frame loads once per system head and re-renders on
 * each props change by message, without a reload.
 */
export function LivePropsFrame({ component, props, height = 160, className }: { component: string; props: Record<string, unknown>; height?: number; className?: string }) {
  const head = useSystemHead();
  const namespace = useModel().index.namespace;
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useMemo(() => `live-${++nextId}`, []);
  const latest = useRef(props);
  latest.current = props;
  // The first props go in the document; later ones by message.
  const srcDoc = useMemo(() => previewDocument(component, `<div id="root" style="padding:16px"></div>${liveScript(namespace, component, latest.current, id)}`, head, id), [component, namespace, head, id]);
  useEffect(() => {
    setError(null);
    frame.current?.contentWindow?.postMessage({ id, openArtifactProps: props }, '*');
  }, [props, id]);
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { openArtifactPreviewError?: string; id?: string } | null;
      if (event.source !== frame.current?.contentWindow || !data || data.id !== id || typeof data.openArtifactPreviewError !== 'string') return;
      setError(data.openArtifactPreviewError);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id]);
  return (
    <div className={cn('relative', className)}>
      <iframe ref={frame} title={`${component} with live props`} sandbox="allow-scripts allow-same-origin" srcDoc={srcDoc} className="block w-full border-0 bg-white" style={{ height }} />
      {error ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <AlertTriangle className="size-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      ) : null}
    </div>
  );
}
