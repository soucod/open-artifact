/**
 * The shell of the host's own small pages (sign-in, and later the share-link
 * join page and device approval): one centred card in the look of the type
 * server's join page, English or Chinese by `Accept-Language`, `no-store`,
 * and a strict Content-Security-Policy. Inline scripts are allowed by their
 * SHA-256 hash only; nothing else runs.
 *
 * Every piece of text that reaches a page goes through {@link escapeHtml}.
 */

import { base64urlEncode } from '../crypto.ts';

/** `text` safe inside HTML text and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A page's language: Chinese when the browser asks for it first, else English. */
export type PageLanguage = 'en' | 'zh';

export function pageLanguage(request: Request): PageLanguage {
  return /^zh\b/i.test(request.headers.get('accept-language') ?? '') ? 'zh' : 'en';
}

/** The card style (the type server's join page, plus secondary buttons and a notice line). */
export const PAGE_CSS = `
:root { color-scheme: light dark; --bg: #f7f6f3; --card: #fff; --fg: #1f1e1d; --muted: #6b6a66; --line: #e3e1dc; --accent: #c96442; --warn: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f1e1d; --card: #2a2927; --fg: #f2f1ee; --muted: #a8a6a0; --line: #3a3936; --warn: #f2b8b5; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 16px; }
main { width: min(420px, 100%); background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
h1 { font-size: 20px; margin: 0 0 8px; word-break: break-word; }
p { margin: 0 0 16px; color: var(--muted); }
label { display: block; font-size: 13px; margin: 0 0 6px; color: var(--muted); }
input { width: 100%; font: inherit; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; margin: 0 0 14px; }
button, .button { display: block; width: 100%; font: inherit; font-weight: 600; text-align: center; text-decoration: none; padding: 10px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; margin: 0 0 10px; }
.button.secondary { background: transparent; color: var(--fg); border: 1px solid var(--line); }
.or { text-align: center; font-size: 12px; margin: 6px 0 14px; }
.error { color: var(--warn); }
.note { font-size: 12px; margin: 14px 0 0; }
a { color: var(--accent); overflow-wrap: anywhere; }
.brand { display: block; height: 32px; width: auto; max-width: 100%; margin: 0 0 12px; }
`;

const scriptHashes = new Map<string, Promise<string>>();

/** The CSP source of an inline script, `'sha256-<base64>'`. */
export function scriptHash(script: string): Promise<string> {
  let hash = scriptHashes.get(script);
  if (!hash) {
    hash = crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)).then((digest) => {
      const b64 = base64urlEncode(new Uint8Array(digest)).replace(/-/g, '+').replace(/_/g, '/');
      return `'sha256-${b64}${'='.repeat((4 - (b64.length % 4)) % 4)}'`;
    });
    scriptHashes.set(script, hash);
  }
  return hash;
}

export interface PageOptions {
  /** Plain text (escaped here). */
  title: string;
  /** HTML inside `<main>`; the caller escapes what it puts in. */
  body: string;
  status?: number;
  lang?: PageLanguage;
  /** Inline scripts (constant text); each is allowed by its hash. */
  scripts?: readonly string[];
  /** More headers (`Set-Cookie`, `Retry-After`…). */
  headers?: HeadersInit;
}

/** A complete page with the host's security headers. */
export async function htmlPage(options: PageOptions): Promise<Response> {
  const scripts = options.scripts ?? [];
  const hashes = await Promise.all(scripts.map(scriptHash));
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src ${hashes.length > 0 ? hashes.join(' ') : "'none'"}`,
    "img-src 'self' https: data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
  const html =
    `<!doctype html><html lang="${options.lang === 'zh' ? 'zh' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="referrer" content="same-origin"><title>${escapeHtml(options.title)}</title><style>${PAGE_CSS}</style></head>` +
    `<body><main>${options.body}</main>${scripts.map((s) => `<script>${s}</script>`).join('')}</body></html>`;
  const headers = new Headers(options.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('content-security-policy', csp);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'same-origin');
  return new Response(html, { status: options.status ?? 200, headers });
}
