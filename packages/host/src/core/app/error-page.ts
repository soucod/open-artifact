/**
 * A failed navigation as a page. When a person's browser lands on an error (a refused form post, a broken link), it
 * sees the host's page shell in their language with the same status, not the JSON an API client reads. API routes
 * and fetches keep their JSON.
 */

import { escapeHtml, htmlPage, pageLanguage, type PageLanguage } from '../auth/pages.ts';

/** Whether a request is a browser navigation (a page load or form post), not a fetch. */
export function isNavigation(request: Request): boolean {
  const mode = request.headers.get('sec-fetch-mode');
  if (mode !== null) return mode === 'navigate';
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/** Whether a path is one of the app origin's pages: `/`, `/a/*`, `/s/*`, `/auth/*`. */
export function isPagePath(pathname: string): boolean {
  return pathname === '/' || /^\/(a|s|auth)(\/|$)/.test(pathname);
}

const WORDS: Record<PageLanguage, { titles: Record<string, string>; generic: string; detail: string; home: string }> = {
  en: {
    titles: {
      not_granted: 'Not allowed',
      unauthorized: 'Sign in needed',
      not_found: 'Not found',
      rate_limited: 'Too many tries',
      too_large: 'Too large',
      error: 'Something went wrong',
    },
    generic: 'This request could not be completed',
    detail: 'Go back and try again. If it keeps happening, start again from the address you were given.',
    home: 'Your artifacts',
  },
  zh: {
    titles: {
      not_granted: '不允许这样做',
      unauthorized: '需要登录',
      not_found: '找不到',
      rate_limited: '尝试次数太多',
      too_large: '内容太大',
      error: '出错了',
    },
    generic: '这个请求没有完成',
    detail: '请返回再试一次。如果一直这样，请从别人给你的地址重新开始。',
    home: '你的 artifact',
  },
};

/** The page for an error answer `{code, message}` with its status. The message is the host's (English) text. */
export async function errorPage(request: Request, status: number, body: { code?: unknown; message?: unknown }, headers?: Headers): Promise<Response> {
  const lang = pageLanguage(request);
  const w = WORDS[lang];
  const code = typeof body.code === 'string' ? body.code : 'error';
  const title = w.titles[code] ?? w.generic;
  const message = typeof body.message === 'string' && body.message ? body.message : '';
  const out = new Headers();
  for (const cookie of headers?.getSetCookie() ?? []) out.append('set-cookie', cookie);
  for (const name of ['retry-after', 'www-authenticate', 'allow']) {
    const value = headers?.get(name);
    if (value !== null && value !== undefined) out.set(name, value);
  }
  return htmlPage({
    title,
    lang,
    status,
    headers: out,
    body:
      `<h1>${escapeHtml(title)}</h1>` +
      (message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : '') +
      `<p>${escapeHtml(w.detail)}</p><p class="note"><a href="/">${escapeHtml(w.home)}</a></p>`,
  });
}

/**
 * The answer a browser should see: a JSON error (status >= 400) of a page path, for a navigation, becomes
 * {@link errorPage}; everything else is unchanged.
 */
export async function asPageWhenNavigating(request: Request, response: Response): Promise<Response> {
  if (response.status < 400 || !isNavigation(request) || !isPagePath(new URL(request.url).pathname)) return response;
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return response;
  let body: { code?: unknown; message?: unknown } = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object') body = parsed as typeof body;
  } catch {
    /* an unreadable body: the generic page */
  }
  return errorPage(request, response.status, body, response.headers);
}
