/**
 * The Link sign-in: a device authorization grant in the shape of RFC 8628.
 *
 * | Route | |
 * |---|---|
 * | `POST /api/open-artifact.link.device` | `{client}` → a device code, a user code and the approval page (rate-limited) |
 * | `POST /api/open-artifact.link.token` | `device_code` and `refresh_token` grants → {@link LinkToken}, or 400 {@link LinkTokenError} |
 * | `GET /link/device?user_code=` | the approval page for a signed-in person: type the code, or confirm the one filled in |
 * | `POST /link/device` | `user_code` + `decision=approve\|deny` (same origin only) |
 *
 * Access tokens last {@link LINK_ACCESS_TTL_MS}, refresh tokens {@link LINK_REFRESH_TTL_MS} from their last use; a
 * refresh rotates both and the old refresh token stops working. A refresh token used a second time (it was stolen,
 * or a client replayed it) revokes the whole token, as OAuth's security practice asks. Approvals, denials, issued,
 * refreshed and revoked tokens go to the audit log.
 */

import { LINK_API_PREFIX, LINK_ROUTES, type LinkDeviceStart, type LinkToken, type LinkTokenError, type LinkUser } from '@open-artifact/protocol';
import { redirect } from '../auth/flow.ts';
import { escapeHtml, htmlPage, pageLanguage, type PageLanguage } from '../auth/pages.ts';
import { SIGN_IN_PATH } from '../auth/routes.ts';
import { authenticate } from '../auth/session.ts';
import { normalizeUserCode } from '../catalog/catalog.ts';
import { guards, guardSentence } from '../plugins/hooks.ts';
import { assertSameOrigin, httpError, json, readBody, readJson, type BaseCtx, type Router } from '../http.ts';
import type { DeviceClient, DeviceCodeRecord, UserPrincipal, UserRecord } from '../types.ts';
import { LINK_ACCESS_TTL_MS, LINK_DEVICE_PATH, LINK_DEVICE_TTL_MS, LINK_JSON_BYTES, LINK_POLL_INTERVAL_SECONDS, LINK_REFRESH_TTL_MS, LINK_SCOPE } from './services.ts';

/** How many device sign-ins the whole site may start per window (no caller address is trusted for a finer key). */
export interface DeviceRateLimit {
  limit: number;
  windowMs: number;
}

/** Default: 30 starts a minute. */
export const DEFAULT_DEVICE_RATE: DeviceRateLimit = { limit: 30, windowMs: 60_000 };

/** A fixed-window counter. */
class WindowLimiter {
  readonly #rate: DeviceRateLimit;
  #start = 0;
  #count = 0;
  constructor(rate: DeviceRateLimit) {
    this.#rate = rate;
  }
  /** Takes one; the seconds to wait when the window is full. */
  take(now: number): { ok: true } | { ok: false; retryAfter: number } {
    if (now - this.#start >= this.#rate.windowMs) {
      this.#start = now;
      this.#count = 0;
    }
    if (this.#count >= this.#rate.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((this.#start + this.#rate.windowMs - now) / 1000)) };
    this.#count++;
    return { ok: true };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A short display string from a request, or undefined. */
function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return text || undefined;
}

/** The person a token acts for, as Link shows them. */
export function linkUserOf(user: Pick<UserRecord, 'id' | 'name' | 'email'> | Pick<UserPrincipal, 'id' | 'name' | 'email'>): LinkUser {
  return { id: user.id, name: user.name, ...(user.email ? { email: user.email } : {}) };
}

/** A refused token request (HTTP 400, RFC 6749's error body). */
function tokenError(error: LinkTokenError['error'], description: string): Response {
  return json({ error, error_description: description } satisfies LinkTokenError, { status: 400 });
}

/** The body of `link.token`: JSON, or a form as RFC 8628 clients send it. */
async function tokenRequest(request: Request): Promise<Record<string, unknown>> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    const text = new TextDecoder().decode(await readBody(request, LINK_JSON_BYTES));
    return Object.fromEntries(new URLSearchParams(text));
  }
  const body = await readJson<unknown>(request, LINK_JSON_BYTES);
  if (!isRecord(body)) throw httpError('invalid_argument', 'The body is {grant_type, device_code} or {grant_type, refresh_token}.');
  return body;
}

// ---------------------------------------------------------------------------
// Approval pages

interface Words {
  title: string;
  enterLead: string;
  code: string;
  next: string;
  confirmLead(client: string): string;
  clientLine(client: DeviceClient): string;
  account(name: string): string;
  grants: string;
  approve: string;
  deny: string;
  unknown: string;
  used: string;
  approved(client: string): string;
  denied: string;
  expired: string;
}

const describe = (client: DeviceClient): string => [client.harness, client.version].filter(Boolean).join(' ');

const EN: Words = {
  title: 'Link a computer',
  enterLead: 'Enter the code your computer shows to link its Open Artifact to your account.',
  code: 'Code',
  next: 'Continue',
  confirmLead: (client) => `${client} asks to be linked to your account.`,
  clientLine: (client) => (describe(client) ? `It says it is ${describe(client)}.` : ''),
  account: (name) => `You are signed in as ${name}.`,
  grants: 'Once linked, it can publish artifacts to this site and read and change the artifacts you own here, and it hears comments and requests sent to your agent. Only approve a code you started yourself.',
  approve: 'Approve',
  deny: 'Deny',
  unknown: 'That code is not valid or has run out. Start again on your computer.',
  used: 'That code has been used already. Start again on your computer.',
  approved: (client) => `${client} is linked. You can close this page and go back to it.`,
  denied: 'Refused. Nothing was linked.',
  expired: 'That code ran out before it was approved. Start again on your computer.',
};

const ZH: Words = {
  title: '关联电脑',
  enterLead: '输入你电脑上显示的代码，把那台电脑上的 Open Artifact 关联到你的账号。',
  code: '代码',
  next: '继续',
  confirmLead: (client) => `${client} 请求关联到你的账号。`,
  clientLine: (client) => (describe(client) ? `它自称是 ${describe(client)}。` : ''),
  account: (name) => `你已登录为 ${name}。`,
  grants: '关联后，它可以把 artifact 发布到这个站点，读取和修改你在这里拥有的 artifact，并收到发给你的 agent 的评论和请求。只批准你自己发起的代码。',
  approve: '批准',
  deny: '拒绝',
  unknown: '这个代码无效或已过期。请在电脑上重新开始。',
  used: '这个代码已经用过了。请在电脑上重新开始。',
  approved: (client) => `${client} 已关联。你可以关闭这个页面，回到它那里。`,
  denied: '已拒绝，没有关联任何东西。',
  expired: '这个代码在批准前就过期了。请在电脑上重新开始。',
};

const wordsOf = (lang: PageLanguage): Words => (lang === 'zh' ? ZH : EN);

function enterPage(lang: PageLanguage, options: { error?: string; code?: string; status?: number } = {}): Promise<Response> {
  const w = wordsOf(lang);
  const body =
    `<h1>${escapeHtml(w.title)}</h1>` +
    (options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : `<p>${escapeHtml(w.enterLead)}</p>`) +
    `<form method="get" action="${LINK_DEVICE_PATH}"><label for="user_code">${escapeHtml(w.code)}</label>` +
    `<input id="user_code" name="user_code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" required placeholder="XXXX-XXXX" value="${escapeHtml(options.code ?? '')}">` +
    `<button type="submit">${escapeHtml(w.next)}</button></form>`;
  return htmlPage({ title: w.title, body, lang, status: options.status ?? 200 });
}

function confirmPage(lang: PageLanguage, device: DeviceCodeRecord, person: UserPrincipal): Promise<Response> {
  const w = wordsOf(lang);
  const line = w.clientLine(device.client);
  const body =
    `<h1>${escapeHtml(w.title)}</h1>` +
    `<p><strong>${escapeHtml(w.confirmLead(device.client.name))}</strong>${line ? ` ${escapeHtml(line)}` : ''}</p>` +
    `<p>${escapeHtml(w.code)}: <strong>${escapeHtml(device.userCode)}</strong></p>` +
    `<p>${escapeHtml(w.account(person.name))}</p>` +
    `<p>${escapeHtml(w.grants)}</p>` +
    `<form method="post" action="${LINK_DEVICE_PATH}"><input type="hidden" name="user_code" value="${escapeHtml(device.userCode)}">` +
    `<button type="submit" name="decision" value="approve">${escapeHtml(w.approve)}</button>` +
    `<button type="submit" name="decision" value="deny" class="button secondary">${escapeHtml(w.deny)}</button></form>`;
  return htmlPage({ title: w.title, body, lang });
}

function notePage(lang: PageLanguage, text: string, status = 200): Promise<Response> {
  const w = wordsOf(lang);
  return htmlPage({ title: w.title, body: `<h1>${escapeHtml(w.title)}</h1><p${status >= 400 ? ' class="error" role="alert"' : ''}>${escapeHtml(text)}</p>`, lang, status });
}

/** The sign-in page, coming back to the approval page with the code. */
function toSignIn(code: string): Response {
  const back = code ? `${LINK_DEVICE_PATH}?user_code=${encodeURIComponent(code)}` : LINK_DEVICE_PATH;
  return redirect(`${SIGN_IN_PATH}?return_to=${encodeURIComponent(back)}`);
}

/** The signed-in person of a page request (a session, not an agent token), and the rolled cookie to send. */
async function pagePerson(request: Request, ctx: BaseCtx): Promise<{ person: UserPrincipal | null; setCookie?: string }> {
  const auth = await authenticate(request, ctx);
  if (auth.principal.kind !== 'user' || auth.credential !== 'session') return { person: null };
  return { person: auth.principal, ...(auth.setCookie ? { setCookie: auth.setCookie } : {}) };
}

function withCookie(response: Response, cookie: string | undefined): Response {
  if (cookie) response.headers.append('set-cookie', cookie);
  return response;
}

// ---------------------------------------------------------------------------
// Routes

/** Registers the device sign-in routes (see the module comment). */
export function linkDeviceRoutes<C extends BaseCtx>(router: Router<C>, options: { deviceRate?: DeviceRateLimit } = {}): Router<C> {
  const limiter = new WindowLimiter(options.deviceRate ?? DEFAULT_DEVICE_RATE);

  router.post(`${LINK_API_PREFIX}${LINK_ROUTES.device}`, async (request, ctx) => {
    const taken = limiter.take(ctx.now().getTime());
    if (!taken.ok) {
      const error = httpError('rate_limited', 'Too many sign-ins were started; try again shortly.', { status: 429 });
      return json(error.toJSON(), { status: 429, headers: { 'retry-after': String(taken.retryAfter) } });
    }
    const body = await readJson<unknown>(request, LINK_JSON_BYTES);
    const client = isRecord(body) && isRecord(body.client) ? body.client : null;
    const name = shortText(client?.name, 80);
    if (!client || !name) throw httpError('invalid_argument', 'Send {"client": {"name": "<what is asking>", "harness"?, "version"?}}.');
    const harness = shortText(client.harness, 40);
    const version = shortText(client.version, 40);
    const started = await ctx.catalog.createDeviceCode({
      client: { name, ...(harness ? { harness } : {}), ...(version ? { version } : {}) },
      ttlMs: LINK_DEVICE_TTL_MS,
      interval: LINK_POLL_INTERVAL_SECONDS,
    });
    const page = `${ctx.config.appOrigin}${LINK_DEVICE_PATH}`;
    const answer: LinkDeviceStart = {
      device_code: started.deviceCode,
      user_code: started.userCode,
      verification_uri: page,
      verification_uri_complete: `${page}?user_code=${encodeURIComponent(started.userCode)}`,
      expires_in: Math.round(LINK_DEVICE_TTL_MS / 1000),
      interval: LINK_POLL_INTERVAL_SECONDS,
    };
    return json(answer);
  });

  router.post(`${LINK_API_PREFIX}${LINK_ROUTES.token}`, async (request, ctx) => {
    const body = await tokenRequest(request);
    const now = ctx.now().getTime();
    const { catalog } = ctx;

    if (body.grant_type === 'device_code') {
      if (typeof body.device_code !== 'string' || !body.device_code) throw httpError('invalid_argument', 'device_code is required.');
      const before = await catalog.recordDevicePoll(body.device_code);
      if (!before || Date.parse(before.expiresAt) <= now) return tokenError('expired_token', 'The device code is unknown or has run out: start the sign-in again.');
      if (before.status === 'denied') return tokenError('access_denied', 'The person refused the sign-in.');
      if (before.status === 'consumed') return tokenError('expired_token', 'The device code was used already: start the sign-in again.');
      if (before.status === 'pending') {
        if (before.lastPolledAt && now - Date.parse(before.lastPolledAt) < before.interval * 1000) return tokenError('slow_down', `Poll at most every ${before.interval} seconds.`);
        return tokenError('authorization_pending', 'Waiting for the person to approve the sign-in.');
      }
      const taken = await catalog.consumeDeviceCode(body.device_code);
      if (!taken?.userId) return tokenError('expired_token', 'The device code is no longer good: start the sign-in again.');
      const user = await catalog.getUser(taken.userId);
      if (!user || user.disabledAt) return tokenError('access_denied', 'The account that approved the sign-in is disabled.');
      const issued = await catalog.issueAgentToken({
        userId: user.id,
        label: taken.client.name,
        harness: taken.client.harness ?? null,
        scopes: [LINK_SCOPE],
        accessTtlMs: LINK_ACCESS_TTL_MS,
        refreshTtlMs: LINK_REFRESH_TTL_MS,
      });
      await catalog.appendAudit({ actorKind: 'user', actorId: user.id, action: 'link.token_issued', detail: { token: issued.token.id, client: taken.client } });
      const answer: LinkToken = { access_token: issued.accessToken, refresh_token: issued.refreshToken, expires_in: Math.round(LINK_ACCESS_TTL_MS / 1000), user: linkUserOf(user) };
      return json(answer);
    }

    if (body.grant_type === 'refresh_token') {
      if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw httpError('invalid_argument', 'refresh_token is required.');
      const current = await catalog.findAgentTokenByRefresh(body.refresh_token);
      if (!current) {
        const reused = await catalog.findAgentTokenByReusedRefresh(body.refresh_token);
        if (reused && reused.revokedAt === null && (await catalog.revokeAgentToken(reused.id))) {
          await catalog.appendAudit({ actorKind: 'agent', actorId: reused.id, action: 'link.token_revoked', detail: { token: reused.id, user: reused.userId, reason: 'refresh_token_reused' } });
        }
        return tokenError('expired_token', 'The refresh token is no longer good: sign in again.');
      }
      if (!current.scopes.includes(LINK_SCOPE)) return tokenError('expired_token', 'This refresh token is not a Link token.');
      const user = await catalog.getUser(current.userId);
      if (!user || user.disabledAt) return tokenError('access_denied', 'The account is disabled.');
      const rotated = await catalog.rotateAgentToken(body.refresh_token, LINK_ACCESS_TTL_MS, { refreshTtlMs: LINK_REFRESH_TTL_MS });
      if (!rotated) return tokenError('expired_token', 'The refresh token is no longer good: sign in again.');
      await catalog.appendAudit({ actorKind: 'agent', actorId: rotated.token.id, action: 'link.token_refreshed', detail: { token: rotated.token.id, user: user.id } });
      const answer: LinkToken = { access_token: rotated.accessToken, refresh_token: rotated.refreshToken, expires_in: Math.round(LINK_ACCESS_TTL_MS / 1000), user: linkUserOf(user) };
      return json(answer);
    }

    throw httpError('invalid_argument', 'grant_type is "device_code" or "refresh_token".');
  });

  router.get(LINK_DEVICE_PATH, async (request, ctx) => {
    const lang = pageLanguage(request);
    const typed = new URL(request.url).searchParams.get('user_code')?.trim() ?? '';
    const { person, setCookie } = await pagePerson(request, ctx);
    if (!person) return toSignIn(typed);
    if (!typed) return withCookie(await enterPage(lang), setCookie);
    const code = normalizeUserCode(typed);
    const device = code ? await ctx.catalog.findDeviceCodeByUserCode(code) : undefined;
    if (!device) return withCookie(await enterPage(lang, { error: wordsOf(lang).unknown, code: typed, status: 404 }), setCookie);
    if (device.status !== 'pending') return withCookie(await enterPage(lang, { error: wordsOf(lang).used, status: 409 }), setCookie);
    return withCookie(await confirmPage(lang, device, person), setCookie);
  });

  router.post(LINK_DEVICE_PATH, async (request, ctx) => {
    assertSameOrigin(request, ctx.config);
    const lang = pageLanguage(request);
    const w = wordsOf(lang);
    const form = new URLSearchParams(new TextDecoder().decode(await readBody(request, 16 * 1024)));
    const typed = form.get('user_code')?.trim() ?? '';
    const { person, setCookie } = await pagePerson(request, ctx);
    if (!person) return toSignIn(typed);
    const decision = form.get('decision');
    if (decision !== 'approve' && decision !== 'deny') throw httpError('invalid_argument', 'decision is "approve" or "deny".');
    const code = normalizeUserCode(typed);
    const device = code ? await ctx.catalog.findDeviceCodeByUserCode(code) : undefined;
    if (!code || !device) return withCookie(await enterPage(lang, { error: w.unknown, status: 404 }), setCookie);
    if (device.status !== 'pending') return withCookie(await notePage(lang, w.used, 409), setCookie);
    if (decision === 'deny') {
      await ctx.catalog.denyDeviceCode(code);
      await ctx.catalog.appendAudit({ actorKind: 'user', actorId: person.id, action: 'link.device_denied', detail: { client: device.client } });
      return withCookie(await notePage(lang, w.denied), setCookie);
    }
    const refusal = ctx.plugins ? await guardSentence(() => guards.linkConnect(ctx, person, { client: { ...device.client } })) : null;
    if (refusal !== null) {
      // Refused by the site's rules: the computer's wait ends as if the person had said no.
      await ctx.catalog.denyDeviceCode(code);
      return withCookie(await notePage(lang, refusal, 403), setCookie);
    }
    if (!(await ctx.catalog.approveDeviceCode(code, person.id))) return withCookie(await notePage(lang, w.expired, 409), setCookie);
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: person.id, action: 'link.device_approved', detail: { client: device.client } });
    return withCookie(await notePage(lang, w.approved(device.client.name)), setCookie);
  });

  return router;
}
