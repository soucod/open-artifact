/**
 * The app origin's pages: the home page (`/`), the Shell (`/a/<id>`) and the page that says an artifact is not
 * there for you. An unknown artifact, a trashed one and one you have no role on answer the same, except to the
 * artifact's owner when it is in their trash (unpublished from their computer, or deleted): they are told so and sent to
 * the Trash. Nobody else learns that it exists.
 */

import { ARTIFACT_ID, shellPath } from '@open-artifact/protocol';
import { escapeHtml, htmlPage, pageLanguage } from '../auth/pages.ts';
import { redirect } from '../auth/flow.ts';
import { SIGN_IN_PATH, SIGN_OUT_PATH } from '../auth/routes.ts';
import type { Router } from '../http.ts';
import type { Principal } from '../types.ts';
import { builtPage, inlineBoot } from './security.ts';
import type { AppCtx } from './services.ts';
import { CHECK_FAILED_SENTENCE, homeBoot, live, personOf, shellBoot, visit } from './views.ts';

/** What the built Shell's `index.html` holds where the boot goes (as the daemon replaces it). */
export const SHELL_BOOT_PLACEHOLDER = '/*__OPEN_ARTIFACT_BOOT__*/null';
/** What the built home page's `index.html` holds where its boot goes. */
export const HOME_BOOT_PLACEHOLDER = '/*__OPEN_ARTIFACT_HOME__*/null';

const WORDS = {
  en: {
    noAccessTitle: 'No access',
    noAccess: 'This artifact is not shared with you, or it is not here any more. Ask whoever sent you the address for access.',
    checkFailed: CHECK_FAILED_SENTENCE,
    signedInAs: (who: string) => `You are signed in as ${who}.`,
    switchAccount: 'Switch account',
    signIn: 'Sign in',
    home: 'Your artifacts',
    trashedTitle: 'In your trash',
    trashed: (title: string) => `“${title}” is in your trash: it was unpublished or deleted, so its address opens nothing. Restore it from the Trash to open it here again (publishing it again from your computer brings it back too).`,
    openTrash: 'Open the Trash',
  },
  zh: {
    noAccessTitle: '无权访问',
    noAccess: '这个 artifact 没有分享给你，或者已经不在了。请向发给你地址的人要访问权限。',
    checkFailed: '权限检查暂时没能完成。请稍后再试；如果一直这样，站点的管理员可以在审计日志里看到原因。',
    signedInAs: (who: string) => `你当前登录的是 ${who}。`,
    switchAccount: '切换账号',
    signIn: '登录',
    home: '你的 artifact',
    trashedTitle: '在你的回收站里',
    trashed: (title: string) => `“${title}”在你的回收站里：它已被取消发布或删除，所以这个地址现在打不开。在回收站里恢复它就能在这里重新打开（从你的电脑上再次发布也可以）。`,
    openTrash: '打开回收站',
  },
};

/** The sign-in address that comes back to `path`. */
export function signInRedirect(path: string): Response {
  return redirect(`${SIGN_IN_PATH}?${new URLSearchParams({ return_to: path })}`);
}

/**
 * "No access" for a principal that cannot open the artifact. It names neither the artifact nor its owner. A
 * signed-in person may switch account (sign out, then sign in coming back here); anyone else may sign in.
 */
export async function noAccessPage(request: Request, principal: Principal, path: string, options: { checkFailed?: boolean } = {}): Promise<Response> {
  const lang = pageLanguage(request);
  const w = WORDS[lang];
  const person = personOf(principal);
  const signInPath = `${SIGN_IN_PATH}?${new URLSearchParams({ return_to: path })}`;
  const action = person
    ? `<p>${escapeHtml(w.signedInAs(person.email ?? person.name))}</p>` +
      `<form method="post" action="${SIGN_OUT_PATH}"><input type="hidden" name="return_to" value="${escapeHtml(signInPath)}">` +
      `<button type="submit">${escapeHtml(w.switchAccount)}</button></form><p class="note"><a href="/">${escapeHtml(w.home)}</a></p>`
    : `<p><a href="${escapeHtml(signInPath)}">${escapeHtml(w.signIn)}</a></p>`;
  // A permission plugin that failed: say so (the person may simply try again), rather than "not shared with you".
  const text = options.checkFailed && person ? w.checkFailed : w.noAccess;
  return htmlPage({ title: w.noAccessTitle, lang, status: 403, body: `<h1>${escapeHtml(w.noAccessTitle)}</h1><p>${escapeHtml(text)}</p>${action}` });
}

/** The page an artifact's owner sees at its address while it is in their trash: what happened and the way back. */
export async function inTrashPage(request: Request, title: string): Promise<Response> {
  const lang = pageLanguage(request);
  const w = WORDS[lang];
  return htmlPage({
    title: w.trashedTitle,
    lang,
    status: 404,
    body: `<h1>${escapeHtml(w.trashedTitle)}</h1><p>${escapeHtml(w.trashed(title))}</p><p><a href="/#trash">${escapeHtml(w.openTrash)}</a></p>`,
  });
}

/** Registers `GET /` and `GET /a/:id`. */
export function pageRoutes(router: Router<AppCtx>): void {
  router.get('/', async (request, ctx) => {
    const seen = await visit(request, ctx, '');
    if (!personOf(seen.principal)) return signInRedirect('/');
    const html = inlineBoot(await ctx.homeHtml(), HOME_BOOT_PLACEHOLDER, homeBoot(ctx, seen.principal));
    return builtPage(html, ctx.config, undefined, { headers: seen.auth.setCookie ? { 'set-cookie': seen.auth.setCookie } : {} });
  });

  router.get('/a/:id', async (request, ctx) => {
    const id = ctx.params.id!;
    const path = ARTIFACT_ID.test(id) ? shellPath(id) : '/';
    const seen = await visit(request, ctx, id);
    const access = live(seen.access);
    if (!access) {
      // Anonymous: maybe signing in gives access. Everyone else: the same page whether or not it exists.
      if (seen.principal.kind === 'anonymous') return signInRedirect(path);
      // The owner of an artifact in the trash: say so (only to them).
      const person = personOf(seen.principal);
      const row = person && ARTIFACT_ID.test(id) ? await ctx.catalog.getArtifact(id) : undefined;
      if (person && row && row.trashedAt !== null && row.ownerUser === person.id) return inTrashPage(request, row.title);
      return noAccessPage(request, seen.principal, path, { checkFailed: seen.checkFailed !== null });
    }
    const boot = await shellBoot(ctx, access.artifact, access.principal, access.role);
    const html = inlineBoot(await ctx.shellHtml(), SHELL_BOOT_PLACEHOLDER, boot);
    return builtPage(html, ctx.config, id, { headers: seen.auth.setCookie ? { 'set-cookie': seen.auth.setCookie } : {} });
  });
}
