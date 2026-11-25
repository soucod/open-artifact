/**
 * The OAuth 2.1 authorization server remote MCP clients sign in through (the MCP authorization spec):
 *
 * | Route | |
 * |---|---|
 * | `GET /oauth/authorize` | the consent page for a signed-in person (else sign-in first, coming back here) |
 * | `POST /oauth/authorize` | `decision=approve\|deny` (same origin only) → back to the client with a code or `access_denied` |
 * | `POST /oauth/token` | `authorization_code` (PKCE S256, one-time code bound to client and redirect URI) and `refresh_token` (rotating) |
 * | `POST /oauth/revoke` | RFC 7009: an access or refresh token stops working |
 * | `POST /oauth/register` | RFC 7591 dynamic registration, public clients only, rate-limited |
 * | `GET /api/open-artifact.auth.tokens` | the signed-in person's connected apps |
 * | `POST /api/open-artifact.auth.tokens.revoke` | `{id}` disconnects one |
 *
 * Clients are known three ways: a Client ID Metadata Document (the client id is its https URL; `cimd.ts`), a client
 * listed in `OA_OAUTH_CLIENTS`, or one that registered itself. Every grant is for one resource, this host's `/mcp`
 * (RFC 8707), and its tokens are agent tokens with the MCP scopes (never `link`), recorded in `oauth_grants` so only
 * they work on `/mcp`. Access tokens last {@link MCP_ACCESS_TTL_MS}; a refresh rotates both tokens, and a refresh
 * token used a second time revokes the whole grant, and so does an authorization code presented a second time (the
 * tokens issued from it are revoked, even when the replay races the first exchange). Grants, refreshes, revocations and denials go to the audit log.
 */

import { redirect } from '../auth/flow.ts';
import { pkceChallenge } from '../auth/flow.ts';
import { escapeHtml, htmlPage, pageLanguage, type PageLanguage } from '../auth/pages.ts';
import { SIGN_IN_PATH } from '../auth/routes.ts';
import { authenticate } from '../auth/session.ts';
import { randomId } from '../crypto.ts';
import { guards, guardSentence } from '../plugins/hooks.ts';
import { assertSameOrigin, httpError, json, readBody, readJson, type BaseCtx, type Router } from '../http.ts';
import type { UserPrincipal } from '../types.ts';
import { CIMD_TTL_MS, cleanName, fetchClientMetadata, isMetadataClientId, type CimdDeps } from './cimd.ts';
import { redirectUriProblem, type McpConfig } from './config.ts';
import { MCP_ACCESS_TTL_MS, MCP_CODE_TTL_MS, MCP_REFRESH_TTL_MS, MCP_SCOPES, OAUTH_PATHS, type McpScope } from './metadata.ts';
import { McpStore, type McpClientRecord } from './store.ts';

/** How many clients may register themselves per window, site-wide. */
export interface RegistrationRate {
  limit: number;
  windowMs: number;
}

/** Default: 20 registrations an hour. */
export const DEFAULT_REGISTRATION_RATE: RegistrationRate = { limit: 20, windowMs: 3600_000 };

/** The harness recorded on MCP agent tokens. */
export const MCP_HARNESS = 'mcp';

/** How often a `/mcp` call marks its token used, at most (a write per call would be one per tool call). */
export const MCP_USE_MARK_MS = 3600_000;

/**
 * How recently an MCP token must have been used for the owner's agent to count as there (its pages then say it will
 * see what is sent in its next turn): two hours, twice {@link MCP_USE_MARK_MS}, so a client in steady use always
 * counts although its use is marked only hourly.
 */
export const MCP_PRESENT_MS = 2 * MCP_USE_MARK_MS;

/** Cap on a token, revoke or register request body. */
const OAUTH_BODY_BYTES = 64 * 1024;

/** What the OAuth routes need besides the request context. */
export interface McpOAuthDeps {
  config: McpConfig;
  /** The metadata-document fetcher's platform parts (`allowPrivate` is taken from `config.local`). */
  cimd: Omit<CimdDeps, 'allowPrivate'>;
  registrationRate?: RegistrationRate;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** An RFC 6749 error answer. */
function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, { status, headers: { pragma: 'no-cache' } });
}

/** A token, revoke or register body: a form (as OAuth clients send it) or JSON. */
async function oauthBody(request: Request): Promise<Record<string, unknown>> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(await readBody(request, OAUTH_BODY_BYTES))));
  }
  const body = await readJson<unknown>(request, OAUTH_BODY_BYTES);
  if (!isRecord(body)) throw httpError('invalid_argument', 'The body is a form or a JSON object.');
  return body;
}

/** The scopes a client asked for, as granted: the known MCP scopes it named (all of them when it named none). */
export function grantedScopes(requested: string | null | undefined): McpScope[] {
  const asked = new Set((requested ?? '').split(/\s+/).filter(Boolean));
  const known = MCP_SCOPES.filter((scope) => asked.has(scope));
  return known.length ? known : [...MCP_SCOPES];
}

/** Whether a PKCE verifier has RFC 7636's form. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------
// Clients

/** A client by id: from the config, its metadata document (cached), or this host's registrations. */
export async function resolveClient(clientId: string, store: McpStore, deps: McpOAuthDeps, now: number): Promise<McpClientRecord | null> {
  if (!clientId || clientId.length > 2000) return null;
  const configured = deps.config.clients.find((c) => c.clientId === clientId);
  if (configured) {
    const known = await store.getClient(clientId);
    if (known && known.kind === 'config' && known.name === configured.name && JSON.stringify(known.redirectUris) === JSON.stringify(configured.redirectUris)) return known;
    return store.putClient({ id: clientId, name: configured.name, redirectUris: configured.redirectUris, kind: 'config' });
  }
  if (isMetadataClientId(clientId)) {
    const known = await store.getClient(clientId);
    if (known?.kind === 'cimd' && known.fetchedAt && now - Date.parse(known.fetchedAt) < CIMD_TTL_MS) return known;
    const doc = await fetchClientMetadata(clientId, { ...deps.cimd, allowPrivate: deps.config.local });
    return store.putClient({ id: clientId, name: doc.name, redirectUris: doc.redirectUris, kind: 'cimd', metadataUrl: clientId, clientUri: doc.clientUri, fetched: true });
  }
  const known = await store.getClient(clientId);
  return known && known.kind === 'dcr' ? known : null;
}

// ---------------------------------------------------------------------------
// The authorization request

/** A checked authorization request. */
interface AuthorizeRequest {
  client: McpClientRecord;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
}

type Checked = { ok: AuthorizeRequest } | { page: string; status: number } | { back: true; redirectUri: string; state: string | null; error: string; description: string };

/** The URL `uri` with `params` added to its query. */
function withParams(uri: string, params: Record<string, string | null>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return url.href;
}

/** Checks an authorization request's parameters (the GET's query or the POST's form). */
async function checkAuthorize(params: URLSearchParams, ctx: BaseCtx, store: McpStore, deps: McpOAuthDeps, w: Words): Promise<Checked> {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  let client: McpClientRecord | null;
  try {
    client = await resolveClient(clientId, store, deps, ctx.now().getTime());
  } catch (error) {
    return { page: `${w.badClient} ${(error as Error).message}`, status: 400 };
  }
  if (!client) return { page: w.badClient, status: 400 };
  // Never send anyone to an address the client did not register: the mistake is shown here instead.
  if (!redirectUri || redirectUriProblem(redirectUri) || !client.redirectUris.includes(redirectUri)) return { page: w.badRedirect, status: 400 };
  const state = params.get('state');
  const back = (error: string, description: string): Checked => ({ back: true, redirectUri, state, error, description });
  if (params.get('response_type') !== 'code') return back('unsupported_response_type', 'response_type must be "code".');
  const challenge = params.get('code_challenge') ?? '';
  if (params.get('code_challenge_method') !== 'S256' || !CHALLENGE.test(challenge)) return back('invalid_request', 'PKCE is required: code_challenge (S256) and code_challenge_method=S256.');
  const resource = params.get('resource');
  if (resource !== null && resource !== deps.config.resource) return back('invalid_target', `The only resource here is ${deps.config.resource}.`);
  return { ok: { client, redirectUri, state, codeChallenge: challenge, scopes: grantedScopes(params.get('scope')), resource: deps.config.resource } };
}

// ---------------------------------------------------------------------------
// The consent page

interface Words {
  title: string;
  lead(client: string): string;
  from(host: string): string;
  selfRegistered: string;
  wants: string;
  scopes: Record<McpScope, string>;
  account(name: string): string;
  trust: string;
  allow: string;
  deny: string;
  badClient: string;
  badRedirect: string;
  signedOut: string;
}

const EN: Words = {
  title: 'Connect an app',
  lead: (client) => `${client} asks to use Open Artifact on this site as you.`,
  from: (host) => `It runs at ${host}, and you will be sent back there.`,
  selfRegistered: 'This app registered itself: its name is not verified.',
  wants: 'It will be able to:',
  scopes: {
    'artifacts.read': 'see the artifacts you can open here and read their files',
    'artifacts.write': 'make new artifacts and change the ones you may edit',
    comments: 'read and answer comments, and get the comments and requests sent to your agent',
    'share.read': 'see how your artifacts are shared',
  },
  account: (name) => `You are signed in as ${name}.`,
  trust: 'Only allow apps you trust. You can disconnect it at any time from your account.',
  allow: 'Allow',
  deny: 'Deny',
  badClient: 'This app is not known here, or its description could not be read.',
  badRedirect: 'This app asked to come back to an address it did not register. Nothing was shared.',
  signedOut: 'Sign in first.',
};

const ZH: Words = {
  title: '连接应用',
  lead: (client) => `${client} 请求以你的身份使用这个站点上的 Open Artifact。`,
  from: (host) => `它运行在 ${host}，完成后会回到那里。`,
  selfRegistered: '这个应用是自行注册的：它的名字未经验证。',
  wants: '它将可以：',
  scopes: {
    'artifacts.read': '查看你在这里能打开的 artifact，并读取它们的文件',
    'artifacts.write': '新建 artifact，并修改你有编辑权限的 artifact',
    comments: '读取和回复评论，并收到发给你的 agent 的评论和请求',
    'share.read': '查看你的 artifact 的分享方式',
  },
  account: (name) => `你已登录为 ${name}。`,
  trust: '只允许你信任的应用。你可以随时在账号里断开它。',
  allow: '允许',
  deny: '拒绝',
  badClient: '这个应用在这里未知，或无法读取它的描述。',
  badRedirect: '这个应用要求回到一个它没有登记的地址。没有分享任何东西。',
  signedOut: '请先登录。',
};

const wordsOf = (lang: PageLanguage): Words => (lang === 'zh' ? ZH : EN);

/** The CSP source of a redirect URI, so the consent form may land there. */
function formTarget(uri: string): string {
  const url = new URL(uri);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : url.protocol;
}

/** The host a person is sent back to, as the page names it. */
function hostOf(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : `${url.protocol}//${url.host}`.replace(/\/\/$/, '');
}

async function consentPage(lang: PageLanguage, request: AuthorizeRequest, person: UserPrincipal): Promise<Response> {
  const w = wordsOf(lang);
  const { client } = request;
  const name = cleanName(client.name) || client.id;
  const hidden = (key: string, value: string | null): string => (value === null ? '' : `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`);
  const body =
    `<h1>${escapeHtml(w.title)}</h1>` +
    `<p><strong>${escapeHtml(w.lead(name))}</strong></p>` +
    `<p>${escapeHtml(w.from(hostOf(request.redirectUri)))}${client.kind === 'dcr' ? ` ${escapeHtml(w.selfRegistered)}` : ''}</p>` +
    `<p>${escapeHtml(w.wants)}</p><ul>${request.scopes.map((s) => `<li>${escapeHtml(w.scopes[s])}</li>`).join('')}</ul>` +
    `<p>${escapeHtml(w.account(person.email ? `${person.name} (${person.email})` : person.name))}</p>` +
    `<p>${escapeHtml(w.trust)}</p>` +
    `<form method="post" action="${OAUTH_PATHS.authorize}">` +
    hidden('response_type', 'code') +
    hidden('client_id', client.id) +
    hidden('redirect_uri', request.redirectUri) +
    hidden('state', request.state) +
    hidden('code_challenge', request.codeChallenge) +
    hidden('code_challenge_method', 'S256') +
    hidden('scope', request.scopes.join(' ')) +
    hidden('resource', request.resource) +
    `<button type="submit" name="decision" value="approve">${escapeHtml(w.allow)}</button>` +
    `<button type="submit" name="decision" value="deny" class="button secondary">${escapeHtml(w.deny)}</button></form>`;
  const response = await htmlPage({ title: w.title, body, lang });
  // The form's answer redirects to the client: the page's form-action must allow that address.
  const csp = response.headers.get('content-security-policy') ?? '';
  response.headers.set('content-security-policy', csp.replace("form-action 'self'", `form-action 'self' ${formTarget(request.redirectUri)}`));
  return response;
}

function notePage(lang: PageLanguage, text: string, status: number): Promise<Response> {
  const w = wordsOf(lang);
  return htmlPage({ title: w.title, body: `<h1>${escapeHtml(w.title)}</h1><p class="error" role="alert">${escapeHtml(text)}</p>`, lang, status });
}

/** The signed-in person of a page request (a session, never an agent token), and the rolled cookie to send. */
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

/** Registers the authorization server's routes (see the module comment) on the MCP router. */
export function mcpOAuthRoutes<C extends BaseCtx>(router: Router<C>, deps: McpOAuthDeps): Router<C> {
  const rate = deps.registrationRate ?? DEFAULT_REGISTRATION_RATE;
  const iss = deps.config.issuer;

  router.get(OAUTH_PATHS.authorize, async (request, ctx) => {
    const lang = pageLanguage(request);
    const w = wordsOf(lang);
    const url = new URL(request.url);
    const store = new McpStore(ctx.catalog, ctx.now);
    const checked = await checkAuthorize(url.searchParams, ctx, store, deps, w);
    if ('page' in checked) return notePage(lang, checked.page, checked.status);
    if ('back' in checked) return redirect(withParams(checked.redirectUri, { error: checked.error, error_description: checked.description, state: checked.state, iss }));
    const { person, setCookie } = await pagePerson(request, ctx);
    if (!person) return redirect(`${SIGN_IN_PATH}?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
    return withCookie(await consentPage(lang, checked.ok, person), setCookie);
  });

  router.post(OAUTH_PATHS.authorize, async (request, ctx) => {
    assertSameOrigin(request, ctx.config);
    const lang = pageLanguage(request);
    const w = wordsOf(lang);
    const form = new URLSearchParams(new TextDecoder().decode(await readBody(request, 16 * 1024)));
    const store = new McpStore(ctx.catalog, ctx.now);
    const checked = await checkAuthorize(form, ctx, store, deps, w);
    if ('page' in checked) return notePage(lang, checked.page, checked.status);
    if ('back' in checked) return redirect(withParams(checked.redirectUri, { error: checked.error, error_description: checked.description, state: checked.state, iss }));
    const { person } = await pagePerson(request, ctx);
    if (!person) return notePage(lang, w.signedOut, 401);
    const decision = form.get('decision');
    if (decision !== 'approve' && decision !== 'deny') throw httpError('invalid_argument', 'decision is "approve" or "deny".');
    const { client, redirectUri, state } = checked.ok;
    if (decision === 'deny') {
      await ctx.catalog.appendAudit({ actorKind: 'user', actorId: person.id, action: 'mcp.consent_denied', detail: { client: client.id } });
      return redirect(withParams(redirectUri, { error: 'access_denied', error_description: 'The person refused.', state, iss }));
    }
    const refusal = ctx.plugins ? await guardSentence(() => guards.mcpConnect(ctx, person, { client: { id: client.id, name: client.name } })) : null;
    if (refusal !== null) return notePage(lang, refusal, 403);
    const { code } = await ctx.catalog.createOAuthCode({
      clientId: client.id,
      userId: person.id,
      redirectUri,
      codeChallenge: checked.ok.codeChallenge,
      scopes: checked.ok.scopes,
      resource: checked.ok.resource,
      ttlMs: MCP_CODE_TTL_MS,
    });
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: person.id, action: 'mcp.consent_approved', detail: { client: client.id, scopes: checked.ok.scopes } });
    return redirect(withParams(redirectUri, { code, state, iss }));
  });

  router.post(OAUTH_PATHS.token, async (request, ctx) => {
    const body = await oauthBody(request);
    const { catalog } = ctx;
    const store = new McpStore(catalog, ctx.now);
    const answer = (issued: { accessToken: string; refreshToken: string; token: { scopes: string[] } }): Response =>
      json(
        { access_token: issued.accessToken, token_type: 'Bearer', expires_in: Math.round(MCP_ACCESS_TTL_MS / 1000), refresh_token: issued.refreshToken, scope: issued.token.scopes.join(' ') },
        { headers: { pragma: 'no-cache' } },
      );

    /** Revokes the tokens issued from a reused authorization code (their refreshes keep the id, so all of them). */
    const revokeCodeTokens = async (code: string): Promise<void> => {
      for (const tokenId of await store.tokensOfCode(code)) {
        if (await catalog.revokeAgentToken(tokenId)) {
          await catalog.appendAudit({ actorKind: 'agent', actorId: tokenId, action: 'mcp.token_revoked', detail: { token: tokenId, reason: 'code_reused' } });
        }
      }
    };

    if (body.grant_type === 'authorization_code') {
      const code = str(body.code);
      const clientId = str(body.client_id);
      const redirectUri = str(body.redirect_uri);
      const verifier = str(body.code_verifier);
      if (!code || !clientId || !redirectUri || !verifier) return oauthError('invalid_request', 'code, client_id, redirect_uri and code_verifier are required.');
      if (!VERIFIER.test(verifier)) return oauthError('invalid_grant', 'The code_verifier is malformed.');
      const record = await catalog.consumeOAuthCode(code);
      if (!record) {
        // A used code presented again: whoever holds it may not be the client, so what it gave is taken back.
        if (await store.markCodeReplayed(code)) await revokeCodeTokens(code);
        return oauthError('invalid_grant', 'The code is unknown, used already or expired.');
      }
      if (record.clientId !== clientId) return oauthError('invalid_grant', 'The code was issued to another client.');
      if (record.redirectUri !== redirectUri) return oauthError('invalid_grant', 'redirect_uri differs from the authorization request.');
      if ((await pkceChallenge(verifier)) !== record.codeChallenge) return oauthError('invalid_grant', 'The code_verifier does not match the code_challenge.');
      const resource = str(body.resource);
      if (resource && resource !== record.resource) return oauthError('invalid_target', `The only resource here is ${deps.config.resource}.`);
      const user = await catalog.getUser(record.userId);
      if (!user || user.disabledAt) return oauthError('invalid_grant', 'The account that approved is disabled.');
      const client = await store.getClient(record.clientId);
      const issued = await catalog.issueAgentToken({
        userId: user.id,
        label: client ? cleanName(client.name) || client.id : record.clientId,
        harness: MCP_HARNESS,
        scopes: record.scopes,
        accessTtlMs: MCP_ACCESS_TTL_MS,
        refreshTtlMs: MCP_REFRESH_TTL_MS,
      });
      await store.addGrant({ tokenId: issued.token.id, clientId: record.clientId, userId: user.id, resource: record.resource ?? deps.config.resource, code });
      await catalog.appendAudit({ actorKind: 'user', actorId: user.id, action: 'mcp.token_issued', detail: { token: issued.token.id, client: record.clientId, scopes: record.scopes } });
      // A replay seen while this exchange ran found no grant yet to revoke: look again now that there is one.
      if (await store.codeReplayed(code)) {
        await revokeCodeTokens(code);
        return oauthError('invalid_grant', 'The code was used more than once; the tokens issued from it are revoked.');
      }
      return answer(issued);
    }

    if (body.grant_type === 'refresh_token') {
      const refresh = str(body.refresh_token);
      if (!refresh) return oauthError('invalid_request', 'refresh_token is required.');
      const current = await catalog.findAgentTokenByRefresh(refresh);
      if (!current) {
        const reused = await catalog.findAgentTokenByReusedRefresh(refresh);
        if (reused && reused.revokedAt === null && (await store.grantOf(reused.id)) && (await catalog.revokeAgentToken(reused.id))) {
          await catalog.appendAudit({ actorKind: 'agent', actorId: reused.id, action: 'mcp.token_revoked', detail: { token: reused.id, user: reused.userId, reason: 'refresh_token_reused' } });
        }
        return oauthError('invalid_grant', 'The refresh token is no longer good: authorize again.');
      }
      const grant = await store.grantOf(current.id);
      if (!grant) return oauthError('invalid_grant', 'This refresh token was not issued here for MCP.');
      const clientId = str(body.client_id);
      if (clientId && clientId !== grant.clientId) return oauthError('invalid_grant', 'The refresh token was issued to another client.');
      const resource = str(body.resource);
      if (resource && resource !== grant.resource) return oauthError('invalid_target', `The only resource here is ${deps.config.resource}.`);
      const user = await catalog.getUser(current.userId);
      if (!user || user.disabledAt) return oauthError('invalid_grant', 'The account is disabled.');
      const rotated = await catalog.rotateAgentToken(refresh, MCP_ACCESS_TTL_MS, { refreshTtlMs: MCP_REFRESH_TTL_MS });
      if (!rotated) return oauthError('invalid_grant', 'The refresh token is no longer good: authorize again.');
      await catalog.appendAudit({ actorKind: 'agent', actorId: rotated.token.id, action: 'mcp.token_refreshed', detail: { token: rotated.token.id, user: user.id } });
      return answer(rotated);
    }

    return oauthError('unsupported_grant_type', 'grant_type is "authorization_code" or "refresh_token".');
  });

  router.post(OAUTH_PATHS.revoke, async (request, ctx) => {
    const body = await oauthBody(request);
    const token = str(body.token);
    if (!token) return oauthError('invalid_request', 'token is required.');
    const { catalog } = ctx;
    const store = new McpStore(catalog, ctx.now);
    const found = (await catalog.findAgentTokenByAccess(token)) ?? (await catalog.findAgentTokenByRefresh(token));
    const grant = found ? await store.grantOf(found.id) : undefined;
    const clientId = str(body.client_id);
    // RFC 7009: an unknown token, or one that is not this client's, is answered the same way.
    if (found && grant && (!clientId || clientId === grant.clientId) && (await catalog.revokeAgentToken(found.id))) {
      await catalog.appendAudit({ actorKind: 'agent', actorId: found.id, action: 'mcp.token_revoked', detail: { token: found.id, user: found.userId, reason: 'client_revoked' } });
    }
    return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
  });

  router.post(OAUTH_PATHS.register, async (request, ctx) => {
    const store = new McpStore(ctx.catalog, ctx.now);
    if ((await store.registrationsSince(rate.windowMs)) >= rate.limit) {
      return json({ error: 'rate_limited', error_description: 'Too many clients registered lately; try again later.' }, { status: 429, headers: { 'retry-after': String(Math.ceil(rate.windowMs / 1000)) } });
    }
    const body = await readJson<unknown>(request, OAUTH_BODY_BYTES).catch(() => null);
    if (!isRecord(body)) return oauthError('invalid_client_metadata', 'Send the client metadata as a JSON object.');
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20) return oauthError('invalid_redirect_uri', 'redirect_uris must list 1 to 20 URLs.');
    for (const uri of uris) {
      const problem = redirectUriProblem(uri);
      if (problem) return oauthError('invalid_redirect_uri', `${String(uri)} ${problem}.`);
    }
    const method = body.token_endpoint_auth_method ?? 'none';
    if (method !== 'none') return oauthError('invalid_client_metadata', 'Only public clients register here: token_endpoint_auth_method "none".');
    const grants = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'];
    if (!grants.includes('authorization_code') || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
      return oauthError('invalid_client_metadata', 'grant_types: authorization_code and refresh_token.');
    }
    if (Array.isArray(body.response_types) && body.response_types.some((t) => t !== 'code')) return oauthError('invalid_client_metadata', 'response_types: code.');
    const name = typeof body.client_name === 'string' ? cleanName(body.client_name) : '';
    let clientUri: string | null = null;
    if (typeof body.client_uri === 'string') {
      try {
        clientUri = new URL(body.client_uri).protocol === 'https:' ? new URL(body.client_uri).href : null;
      } catch {
        clientUri = null;
      }
    }
    const id = randomId('oac');
    const client = await store.putClient({ id, name: name || new URL(uris[0] as string).host || 'MCP client', redirectUris: uris as string[], kind: 'dcr', clientUri });
    await ctx.catalog.appendAudit({ actorKind: 'system', action: 'mcp.client_registered', detail: { client: id, name: client.name } });
    return json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...(clientUri ? { client_uri: clientUri } : {}),
      },
      { status: 201 },
    );
  });

  return router;
}

/** One connected app as `auth.tokens` lists it. */
export interface ConnectedAppView {
  /** The grant's agent token id; `auth.tokens.revoke` takes it. */
  id: string;
  clientId: string;
  name: string;
  clientUri: string | null;
  scopes: string[];
  createdAt: string;
  usedAt: string | null;
}

/** Registers the connected-apps routes on the app router (its same-origin check applies to the revoke). */
export function connectedAppRoutes<C extends BaseCtx>(router: Router<C>): Router<C> {
  const sessionUser = async (request: Request, ctx: BaseCtx): Promise<string> => {
    const auth = await authenticate(request, ctx);
    if (auth.principal.kind !== 'user' || auth.credential !== 'session') throw httpError('unauthorized', 'Sign in to see your connected apps.', { status: 401 });
    return auth.principal.id;
  };

  router.get('/api/open-artifact.auth.tokens', async (request, ctx) => {
    const userId = await sessionUser(request, ctx);
    const apps: ConnectedAppView[] = (await new McpStore(ctx.catalog, ctx.now).connectedApps(userId)).map((a) => ({
      id: a.tokenId,
      clientId: a.clientId,
      name: a.clientName,
      clientUri: a.clientUri,
      scopes: a.scopes,
      createdAt: a.createdAt,
      usedAt: a.usedAt,
    }));
    return json({ apps });
  });

  router.post('/api/open-artifact.auth.tokens.revoke', async (request, ctx) => {
    assertSameOrigin(request, ctx.config);
    const userId = await sessionUser(request, ctx);
    const body = await readJson<{ id?: unknown }>(request);
    const id = typeof body.id === 'string' ? body.id : '';
    const apps = await new McpStore(ctx.catalog, ctx.now).connectedApps(userId);
    const app = apps.find((a) => a.tokenId === id);
    if (!app) throw httpError('not_found', 'No such connected app.');
    await ctx.catalog.revokeAgentToken(app.tokenId);
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: userId, action: 'mcp.token_revoked', detail: { token: app.tokenId, client: app.clientId, reason: 'user_disconnected' } });
    return json({ revoked: app.tokenId });
  });

  return router;
}
