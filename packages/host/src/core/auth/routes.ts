/**
 * The sign-in routes on the app origin.
 *
 * | Route | |
 * |---|---|
 * | `GET /auth/sign-in?return_to=` | the sign-in page: one button per provider, the owner-key form |
 * | `POST /auth/owner-key` | the owner-key form |
 * | `GET /auth/:provider/start?return_to=` | starts a redirect sign-in |
 * | `GET /auth/:provider/callback` | the provider's callback |
 * | `POST /auth/sign-out` | ends the session (same origin only) |
 * | `GET /api/open-artifact.auth.me` | who is asking, the providers, the sign-in and sign-out addresses |
 * | `GET /api/open-artifact.auth.sessions` | the signed-in user's sessions |
 * | `POST /api/open-artifact.auth.sessions.revoke` | `{id}` ends one of them, `{all: true}` every one |
 *
 * A successful sign-in answers 303 to `return_to` (a same-origin path,
 * default `/`) with the session cookie. A refused one shows the sign-in page
 * with the reason. Sign-ins (done or refused), sign-outs and revocations go
 * to the audit log.
 */

import { httpError, isTopLevelNavigation, json, readJson, assertSameOrigin, type BaseCtx, type Router } from '../http.ts';
import type { Principal } from '../types.ts';
import { signInWith } from './accounts.ts';
import { SignInError, statusOfFailure, type SignInFailure } from './errors.ts';
import { clearFlow, redirect, safeReturnTo } from './flow.ts';
import { accessLogoutUrl, CLOUDFLARE_ACCESS_PROVIDER } from './cloudflare-access.ts';
import { OWNER_KEY_PROVIDER } from './owner-key.ts';
import { escapeHtml, htmlPage, pageLanguage, type PageLanguage } from './pages.ts';
import { providerById, providersOf, type ExternalIdentity, type ProviderDeps } from './provider.ts';
import { authenticate, clearSessionCookie, invalidBearer, startSession } from './session.ts';
import { siteUi } from '../plugins/hooks.ts';
import type { CloudSiteUi } from '@open-artifact/protocol';

export const SIGN_IN_PATH = '/auth/sign-in';
export const SIGN_OUT_PATH = '/auth/sign-out';
/** A plugin's sign-in provider id starts with it (`plugin:<id>`). */
export const PLUGIN_PROVIDER_PREFIX = 'plugin:';

/** A provider as `auth.me` lists it. */
export interface AuthProviderView {
  id: string;
  name: string;
  /** Where its button goes (the owner key: the sign-in page). */
  url: string;
}

/** What `auth.me` answers. */
export interface AuthMe {
  principal:
    | { kind: 'user'; id: string; name: string; email?: string; avatar?: string; siteRole: 'admin' | 'member' }
    | { kind: 'agent'; id: string; label: string; harness?: string; user: { id: string; name: string; email?: string } }
    | { kind: 'guest'; id: string; name: string; artifact: string }
    | { kind: 'anonymous' };
  providers: AuthProviderView[];
  signInUrl: string;
  signOutUrl: string;
  /**
   * Behind Cloudflare Access only: the team's logout address. Signing out of the host leaves the Access session, so a
   * page offers this too (the same address `auth.sign_out` answers there).
   */
  accessLogoutUrl?: string;
  /** The site's plugins' links and brand, as the boots carry them (only when a plugin adds some). */
  site?: CloudSiteUi;
}

/** One session as `auth.sessions` lists it. */
export interface AuthSessionView {
  /** The session's stored id (a hash; not a credential). */
  id: string;
  createdAt: string;
  seenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

// ---------------------------------------------------------------------------
// Words

interface Words {
  title: string;
  lead: string;
  continueWith(name: string): string;
  ownerKey: string;
  yourName: string;
  signIn: string;
  or: string;
  signedInAs(name: string): string;
  continue: string;
  none: string;
  /** Cloudflare Access: who signs people in, and how to leave. */
  access: string;
  accessSignedOut: string;
  accessLogout: string;
  failures: Record<SignInFailure, string>;
  /** A plugin's refusal: the host's words around the plugin's own sentence. */
  pluginRefused(sentence: string): string;
}

const EN: Words = {
  title: 'Sign in',
  lead: 'Sign in to open your artifacts and the ones shared with you.',
  continueWith: (name) => `Continue with ${name}`,
  ownerKey: 'Owner key',
  yourName: 'Your name (optional)',
  signIn: 'Sign in',
  or: 'or',
  signedInAs: (name) => `You are signed in as ${name}.`,
  continue: 'Continue',
  none: 'This site has no sign-in method. Its operator sets one with OA_AUTH.',
  access: 'This site signs people in through Cloudflare Access. Open the site’s address and sign in there.',
  accessSignedOut: 'You are signed out of this site, but Cloudflare Access keeps its own session: the next visit signs you in again. To sign out for good, sign out of Access.',
  accessLogout: 'Sign out of Cloudflare Access',
  failures: {
    disabled: 'This account is disabled. Ask the site’s admin.',
    not_invited: 'This site only lets invited people in, and this account is not invited. Ask the person who shared with you, or sign in with the address they invited.',
    wrong_key: 'That is not the owner key.',
    rate_limited: 'Too many wrong keys. Wait a moment, then try again.',
    bad_state: 'The sign-in took too long or was started elsewhere. Start again.',
    cancelled: 'The sign-in was cancelled.',
    provider_error: 'The sign-in provider could not be reached or gave an unusable answer. Try again.',
    invalid_token: 'The sign-in provider’s answer could not be verified. Try again.',
    unknown_provider: 'There is no such sign-in method here.',
    plugin_refused: 'This site does not let this account in.',
  },
  pluginRefused: (sentence) => `This site does not let this account in. It says: ${sentence}`,
};

const ZH: Words = {
  title: '登录',
  lead: '登录后可以打开你的 artifact 和分享给你的 artifact。',
  continueWith: (name) => `使用 ${name} 继续`,
  ownerKey: '所有者密钥',
  yourName: '你的名字（可选）',
  signIn: '登录',
  or: '或',
  signedInAs: (name) => `你已登录为 ${name}。`,
  continue: '继续',
  none: '这个站点没有配置登录方式。请站点管理员用 OA_AUTH 配置。',
  access: '这个站点通过 Cloudflare Access 登录。请打开站点地址，在那里登录。',
  accessSignedOut: '你已退出这个站点，但 Cloudflare Access 有自己的会话：下次访问会自动重新登录。要彻底退出，请退出 Access。',
  accessLogout: '退出 Cloudflare Access',
  failures: {
    disabled: '这个账号已被停用。请联系站点管理员。',
    not_invited: '这个站点只允许受邀的人加入，而这个账号没有受邀。请联系分享给你的人，或用对方邀请的邮箱登录。',
    wrong_key: '所有者密钥不对。',
    rate_limited: '错误次数太多。请稍等片刻再试。',
    bad_state: '登录超时，或者是在别处开始的。请重新开始。',
    cancelled: '登录已取消。',
    provider_error: '无法连接登录服务，或它的回答无法使用。请再试一次。',
    invalid_token: '无法验证登录服务的回答。请再试一次。',
    unknown_provider: '这里没有这种登录方式。',
    plugin_refused: '这个站点不允许这个账号登录。',
  },
  pluginRefused: (sentence) => `这个站点不允许这个账号登录。原因：${sentence}`,
};

const wordsOf = (lang: PageLanguage): Words => (lang === 'zh' ? ZH : EN);

/** Fills the owner-key field from `#key=` and drops the fragment from the address bar. */
const KEY_FRAGMENT_SCRIPT =
  "(function(){var m=/(?:^#|&)key=([^&]*)/.exec(location.hash);if(!m)return;var i=document.getElementById('key');" +
  "try{if(i)i.value=decodeURIComponent(m[1]);}catch(e){}history.replaceState(null,'',location.pathname+location.search);})();";

// ---------------------------------------------------------------------------
// Pages

async function signInPage(request: Request, ctx: BaseCtx, deps: ProviderDeps, options: { returnTo: string; failure?: SignInError; principal?: Principal; headers?: Headers }): Promise<Response> {
  const lang = pageLanguage(request);
  const w = wordsOf(lang);
  const providers = providersOf(ctx.config, deps);
  const rt = encodeURIComponent(options.returnTo);
  const brand = siteUi(ctx)?.brand ?? null;
  const parts: string[] = [];
  if (brand?.logoUrl) parts.push(`<img class="brand" src="${escapeHtml(brand.logoUrl)}" alt="" height="32">`);
  parts.push(`<h1>${escapeHtml(brand?.name ? `${w.title} · ${brand.name}` : w.title)}</h1>`);
  if (options.failure) {
    const failure = options.failure;
    const text = failure.reason === 'plugin_refused' && failure.plugin ? w.pluginRefused(failure.plugin.sentence) : w.failures[failure.reason];
    parts.push(`<p class="error" role="alert">${escapeHtml(text)}</p>`);
  }
  else parts.push(`<p>${escapeHtml(w.lead)}</p>`);
  if (options.principal?.kind === 'user') {
    parts.push(`<p>${escapeHtml(w.signedInAs(options.principal.name))}</p><a class="button secondary" href="${escapeHtml(options.returnTo)}">${escapeHtml(w.continue)}</a>`);
  }
  const redirects = providers.filter((p) => p.id !== OWNER_KEY_PROVIDER && p.start);
  for (const provider of redirects) {
    parts.push(`<a class="button" href="/auth/${escapeHtml(encodeURIComponent(provider.id))}/start?return_to=${escapeHtml(rt)}">${escapeHtml(w.continueWith(provider.name))}</a>`);
  }
  // A plugin's sign-in button (`auth.signIn`): its label as the plugin wrote it.
  const pluginButtons = ctx.plugins?.signInButtons() ?? [];
  for (const button of pluginButtons) {
    parts.push(`<a class="button" href="/auth/${escapeHtml(encodeURIComponent(button.id))}/start?return_to=${escapeHtml(rt)}">${escapeHtml(button.label)}</a>`);
  }
  const ownerKey = providers.some((p) => p.id === OWNER_KEY_PROVIDER);
  if (ownerKey) {
    if (redirects.length + pluginButtons.length > 0) parts.push(`<p class="or">${escapeHtml(w.or)}</p>`);
    parts.push(
      `<form method="post" action="/auth/owner-key">` +
        `<input type="hidden" name="return_to" value="${escapeHtml(options.returnTo)}">` +
        `<label for="key">${escapeHtml(w.ownerKey)}</label><input id="key" name="key" type="password" autocomplete="current-password" required>` +
        `<label for="name">${escapeHtml(w.yourName)}</label><input id="name" name="name" type="text" autocomplete="name" maxlength="80">` +
        `<button type="submit">${escapeHtml(w.signIn)}</button></form>`,
    );
  }
  if (providers.some((p) => p.id === CLOUDFLARE_ACCESS_PROVIDER) && options.principal?.kind !== 'user') {
    parts.push(`<p>${escapeHtml(w.access)}</p><a class="button" href="${escapeHtml(options.returnTo)}">${escapeHtml(w.continue)}</a>`);
  }
  if (providers.length === 0 && pluginButtons.length === 0 && !ctx.plugins?.hasAuthenticate) parts.push(`<p>${escapeHtml(w.none)}</p>`);
  const headers = new Headers(options.headers);
  if (options.failure?.reason === 'rate_limited' && options.failure.retryAfter) headers.set('retry-after', String(options.failure.retryAfter));
  return htmlPage({
    title: brand?.name ? `${w.title} · ${brand.name}` : w.title,
    body: parts.join(''),
    lang,
    status: options.failure ? statusOfFailure(options.failure.reason) : 200,
    scripts: ownerKey ? [KEY_FRAGMENT_SCRIPT] : [],
    headers,
  });
}

/**
 * The answer to a request a plugin's `auth.authenticate` named someone on whom signing in was refused (the signup
 * rule, a plugin's `auth.identity`), or null to let the request go on as anonymous: a page visit (`GET` of `/`,
 * `/a/…`, `/s/…`) gets the sign-in page saying why, an `/api/` request a 401 `sign_in_refused` with the reason code
 * and the same sentence. The sign-in pages themselves (`/auth/…`) and the built files are not stopped, so another
 * sign-in method still works.
 */
export function signInRefusedAnswer(request: Request, ctx: BaseCtx, refusal: { reason: SignInFailure; sentence?: string; error: SignInError }, deps: ProviderDeps = {}): Promise<Response> | Response | null {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith('/api/')) {
    const message = refusal.reason === 'plugin_refused' && refusal.sentence !== undefined ? EN.pluginRefused(refusal.sentence) : EN.failures[refusal.reason];
    return json({ code: 'sign_in_refused', reason: refusal.reason, message }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/' || /^\/(a|s)(\/|$)/.test(pathname))) {
    return signInPage(request, ctx, deps, { returnTo: '/', failure: refusal.error });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routes

function meView(principal: Principal): AuthMe['principal'] {
  switch (principal.kind) {
    case 'user':
      return { kind: 'user', id: principal.id, name: principal.name, ...(principal.email ? { email: principal.email } : {}), ...(principal.avatar ? { avatar: principal.avatar } : {}), siteRole: principal.siteRole };
    case 'agent':
      return {
        kind: 'agent',
        id: principal.id,
        label: principal.label,
        ...(principal.harness ? { harness: principal.harness } : {}),
        user: { id: principal.user.id, name: principal.user.name, ...(principal.user.email ? { email: principal.user.email } : {}) },
      };
    case 'guest':
      return { kind: 'guest', id: principal.id, name: principal.name, artifact: principal.artifact };
    default:
      return { kind: 'anonymous' };
  }
}

/** A 401 JSON answer for a request with a Bearer token that does not work. */
/**
 * Refuses a sign-in step that is not a top-level navigation (`not_granted`, 403). Starting one sets the flow cookie and
 * finishing one sets the session cookie: an `<img>`, a `fetch` or a frame from another page (an artifact's page on the
 * same site, say) may do neither. A same-site navigation cannot be refused here, since a provider may live on the
 * same domain; the flow cookie ties the callback to the browser that started it.
 */
function assertNavigation(request: Request): void {
  if (!isTopLevelNavigation(request)) throw httpError('not_granted', 'A sign-in starts and finishes in a visit to the page, not in an image, a fetch or a frame.', { status: 403 });
}

function bearerRefused(): Response {
  const { error, challenge } = invalidBearer();
  return json(error.toJSON(), { status: 401, headers: { 'www-authenticate': challenge } });
}

/** Registers the sign-in routes; `deps` reaches the providers (tests stub `fetch`). */
export function authRoutes<C extends BaseCtx>(router: Router<C>, deps: ProviderDeps = {}): Router<C> {
  /** Completes a sign-in: account, session, audit, redirect. */
  async function complete(request: Request, ctx: BaseCtx, identity: ExternalIdentity, returnTo: string, extraCookies: string[]): Promise<Response> {
    const user = await signInWith(identity, ctx);
    const cookie = await startSession(user, request, ctx, identity);
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: user.id, action: 'auth.sign_in', detail: { provider: identity.provider } });
    return redirect(returnTo, [...extraCookies, cookie]);
  }

  async function refused(request: Request, ctx: BaseCtx, provider: string, error: unknown, returnTo: string, extraCookies: string[]): Promise<Response> {
    if (!(error instanceof SignInError)) throw error;
    ctx.log(`sign-in refused (${provider}): ${error.message}`);
    await ctx.catalog.appendAudit({
      actorKind: 'anonymous',
      action: provider === OWNER_KEY_PROVIDER && (error.reason === 'wrong_key' || error.reason === 'rate_limited') ? 'auth.owner_key_failed' : 'auth.sign_in_refused',
      detail: { provider, reason: error.reason, ...(error.plugin ? { plugin: error.plugin.id } : {}) },
    });
    const headers = new Headers();
    for (const cookie of extraCookies) headers.append('set-cookie', cookie);
    return signInPage(request, ctx, deps, { returnTo, failure: error, headers });
  }

  router.get(SIGN_IN_PATH, async (request, ctx) => {
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('return_to'), ctx.config);
    const auth = await authenticate(request, ctx);
    return signInPage(request, ctx, deps, { returnTo, principal: auth.principal });
  });

  router.post('/auth/owner-key', async (request, ctx) => {
    assertSameOrigin(request, ctx.config);
    const provider = providerById(ctx.config, OWNER_KEY_PROVIDER, deps);
    if (!provider?.finish) return refused(request, ctx, OWNER_KEY_PROVIDER, new SignInError('unknown_provider'), '/', []);
    // Read the form once here so a refusal can still return to `return_to`.
    const body = await request.clone().text().catch(() => '');
    const returnTo = safeReturnTo(new URLSearchParams(body).get('return_to'), ctx.config);
    try {
      const { identity, returnTo: target } = await provider.finish(request, ctx);
      return await complete(request, ctx, identity, target, []);
    } catch (error) {
      return refused(request, ctx, OWNER_KEY_PROVIDER, error, returnTo, []);
    }
  });

  router.get('/auth/:provider/start', async (request, ctx) => {
    assertNavigation(request);
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('return_to'), ctx.config);
    if (ctx.params.provider!.startsWith(PLUGIN_PROVIDER_PREFIX)) {
      const id = ctx.params.provider!;
      if (!ctx.plugins) return refused(request, ctx, id, new SignInError('unknown_provider'), returnTo, []);
      try {
        return await ctx.plugins.startSignIn(id, request, returnTo, `${ctx.config.appOrigin}/auth/${id}/callback`);
      } catch (error) {
        return refused(request, ctx, id, error, returnTo, []);
      }
    }
    const provider = providerById(ctx.config, ctx.params.provider!, deps);
    if (!provider?.start) return refused(request, ctx, ctx.params.provider!, new SignInError('unknown_provider'), returnTo, []);
    try {
      return await provider.start(request, ctx, returnTo);
    } catch (error) {
      return refused(request, ctx, provider.id, error, returnTo, []);
    }
  });

  router.get('/auth/:provider/callback', async (request, ctx) => {
    assertNavigation(request);
    const clear = [clearFlow(ctx.config)];
    if (ctx.params.provider!.startsWith(PLUGIN_PROVIDER_PREFIX)) {
      const id = ctx.params.provider!;
      if (!ctx.plugins) return refused(request, ctx, id, new SignInError('unknown_provider'), '/', clear);
      try {
        const { identity, provider, returnTo } = await ctx.plugins.finishSignIn(id, request);
        return await complete(request, ctx, { ...identity, provider }, safeReturnTo(returnTo ?? '/', ctx.config), clear);
      } catch (error) {
        return refused(request, ctx, id, error, '/', clear);
      }
    }
    const provider = providerById(ctx.config, ctx.params.provider!, deps);
    if (!provider?.finish || provider.id === OWNER_KEY_PROVIDER) return refused(request, ctx, ctx.params.provider!, new SignInError('unknown_provider'), '/', clear);
    try {
      const { identity, returnTo } = await provider.finish(request, ctx);
      return await complete(request, ctx, identity, returnTo, clear);
    } catch (error) {
      return refused(request, ctx, provider.id, error, '/', clear);
    }
  });

  router.post(SIGN_OUT_PATH, async (request, ctx) => {
    assertSameOrigin(request, ctx.config);
    const auth = await authenticate(request, ctx);
    const headers = new Headers({ 'set-cookie': clearSessionCookie(ctx.config) });
    let pluginSignOut: string | null = null;
    if (auth.credential === 'session' && auth.principal.kind === 'user' && auth.sessionId) {
      await ctx.catalog.revokeSession(auth.sessionId);
      await ctx.catalog.appendAudit({ actorKind: 'user', actorId: auth.principal.id, action: 'auth.sign_out' });
      // After the session is gone: where a plugin wants the person to go next (to end its own session too).
      if (ctx.plugins) pluginSignOut = await ctx.plugins.signOutUrl(auth.principal);
    }
    const wantsPage = (request.headers.get('accept') ?? '').includes('text/html') || (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
    if (pluginSignOut) {
      if (!wantsPage) return json({ signedOut: true, signOutUrl: pluginSignOut }, { headers });
      return redirect(pluginSignOut, [clearSessionCookie(ctx.config)]);
    }
    // Behind Cloudflare Access the host's cookie is not the whole session: say so, and where Access's ends.
    const access = ctx.config.auth.find((auth) => auth.kind === 'cloudflare-access');
    if (access) {
      const logoutUrl = accessLogoutUrl(access);
      if (!wantsPage) return json({ signedOut: true, accessLogoutUrl: logoutUrl }, { headers });
      const lang = pageLanguage(request);
      const w = wordsOf(lang);
      return htmlPage({
        title: w.title,
        body: `<h1>${escapeHtml(w.title)}</h1><p>${escapeHtml(w.accessSignedOut)}</p><a class="button" href="${escapeHtml(logoutUrl)}">${escapeHtml(w.accessLogout)}</a>`,
        lang,
        headers,
      });
    }
    if (wantsPage) {
      const body = await request.text().catch(() => '');
      return redirect(safeReturnTo(new URLSearchParams(body).get('return_to') ?? SIGN_IN_PATH, ctx.config), [clearSessionCookie(ctx.config)]);
    }
    return json({ signedOut: true }, { headers });
  });

  router.get('/api/open-artifact.auth.me', async (request, ctx) => {
    const auth = await authenticate(request, ctx);
    if (auth.invalid.includes('bearer')) return bearerRefused();
    const me: AuthMe = {
      principal: meView(auth.principal),
      providers: providersOf(ctx.config, deps).map((p) => ({
        id: p.id,
        name: p.name,
        url: p.id === OWNER_KEY_PROVIDER || !p.start ? `${ctx.config.appOrigin}${SIGN_IN_PATH}` : `${ctx.config.appOrigin}/auth/${p.id}/start`,
      })),
      signInUrl: `${ctx.config.appOrigin}${SIGN_IN_PATH}`,
      signOutUrl: `${ctx.config.appOrigin}${SIGN_OUT_PATH}`,
    };
    if (ctx.plugins) {
      for (const button of ctx.plugins.signInButtons()) me.providers.push({ id: button.id, name: button.label, url: `${ctx.config.appOrigin}/auth/${button.id}/start` });
      const site = siteUi(ctx);
      if (site) me.site = site;
    }
    const access = ctx.config.auth.find((auth) => auth.kind === 'cloudflare-access');
    if (access) me.accessLogoutUrl = accessLogoutUrl(access);
    const headers = new Headers();
    if (auth.setCookie) headers.append('set-cookie', auth.setCookie);
    else if (auth.invalid.includes('session')) headers.append('set-cookie', clearSessionCookie(ctx.config));
    return json(me, { headers });
  });

  /** The signed-in user (by session) of a request, or a thrown 401. */
  async function sessionUser(request: Request, ctx: BaseCtx): Promise<{ userId: string; sessionId: string }> {
    const auth = await authenticate(request, ctx);
    if (auth.principal.kind !== 'user' || !auth.sessionId) throw httpError('unauthorized', 'Sign in to see your sessions.', { status: 401 });
    return { userId: auth.principal.id, sessionId: auth.sessionId };
  }

  router.get('/api/open-artifact.auth.sessions', async (request, ctx) => {
    const { userId, sessionId } = await sessionUser(request, ctx);
    const sessions: AuthSessionView[] = (await ctx.catalog.listSessions(userId)).map((s) => ({
      id: s.idHash,
      createdAt: s.createdAt,
      seenAt: s.seenAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent,
      current: s.idHash === sessionId,
    }));
    return json({ sessions });
  });

  router.post('/api/open-artifact.auth.sessions.revoke', async (request, ctx) => {
    assertSameOrigin(request, ctx.config);
    const { userId, sessionId } = await sessionUser(request, ctx);
    const body = await readJson<{ id?: unknown; all?: unknown }>(request);
    const mine = await ctx.catalog.listSessions(userId);
    let ended: string[];
    if (body.all === true) {
      ended = mine.map((s) => s.idHash);
      await ctx.catalog.revokeUserSessions(userId);
    } else if (typeof body.id === 'string') {
      if (!mine.some((s) => s.idHash === body.id)) throw httpError('not_found', 'No such session.');
      await ctx.catalog.revokeSession(body.id);
      ended = [body.id];
    } else {
      throw httpError('invalid_argument', 'Send {"id": "<session id>"} or {"all": true}.');
    }
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: userId, action: 'auth.sessions_revoked', detail: { count: ended.length, current: ended.includes(sessionId) } });
    const headers = new Headers();
    if (ended.includes(sessionId)) headers.append('set-cookie', clearSessionCookie(ctx.config));
    return json({ revoked: ended.length }, { headers });
  });

  return router;
}
