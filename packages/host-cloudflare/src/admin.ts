/**
 * The Worker's stand-in for `open-artifact-host link-token`: on Cloudflare there is no shell next to the catalog, so a
 * site administrator mints and revokes preset Link tokens through an authenticated API on the app origin.
 *
 * - `POST /api/open-artifact.admin.link-tokens` `{ user: "<email>", label? }` mints a Link refresh token for that
 *   person (made when missing, with the email counted as verified, as the command does) and answers
 *   `{ id, user, remote, token }` once. `remote` and `token` are what the computer is given as `OPEN_ARTIFACT_REMOTE`
 *   and `OPEN_ARTIFACT_REMOTE_TOKEN`.
 * - `POST /api/open-artifact.admin.link-tokens.revoke` `{ id }` revokes one (`{ revoked: id, already? }`).
 *
 * Only a signed-in site administrator (`site_role = 'admin'`, e.g. who signed in with the owner key) may call them; the
 * app handler's same-origin rule applies (a write from another site is refused), and a Bearer token is never accepted
 * here (an agent cannot mint itself more tokens). Both are written to the audit log without the token. Answers are
 * `no-store`.
 */

import { httpError, json, LINK_ACCESS_TTL_MS, LINK_REFRESH_TTL_MS, LINK_SCOPE, readJson, signedIn, type AppCtx, type Router } from '@open-artifact/host';

export const ADMIN_LINK_TOKENS_PATH = '/api/open-artifact.admin.link-tokens';
export const ADMIN_LINK_TOKENS_REVOKE_PATH = `${ADMIN_LINK_TOKENS_PATH}.revoke`;
const BODY_BYTES = 4096;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The signed-in administrator, or the error to answer. */
async function administrator(request: Request, ctx: AppCtx): Promise<{ id: string }> {
  if (request.headers.has('authorization')) throw httpError('not_granted', 'Link tokens are minted from a signed-in browser session, not with a token.', { status: 403 });
  const { person } = await signedIn(request, ctx);
  if (person.siteRole !== 'admin') throw httpError('not_granted', 'Only a site administrator may mint Link tokens.', { status: 403 });
  return { id: person.id };
}

const noStore = (response: Response): Response => {
  response.headers.set('cache-control', 'no-store');
  return response;
};

/** Mounts the two admin routes. */
export function adminRoutes(router: Router<AppCtx>): void {
  router.post(ADMIN_LINK_TOKENS_PATH, async (request, ctx) => {
    const admin = await administrator(request, ctx);
    const body = await readJson<unknown>(request, BODY_BYTES);
    const given = isRecord(body) && typeof body.user === 'string' ? body.user.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+$/.test(given)) throw httpError('invalid_argument', 'The body is {"user": "<email>", "label"?: "<text>"}.');
    const label = (isRecord(body) && typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Preset link token').slice(0, 100);
    const known = await ctx.catalog.findUserByEmail(given);
    const userId = known?.id ?? (await ctx.catalog.createUser({ name: given, email: given, emailVerified: true })).id;
    const issued = await ctx.catalog.issueAgentToken({ userId, label, harness: null, scopes: [LINK_SCOPE], accessTtlMs: LINK_ACCESS_TTL_MS, refreshTtlMs: LINK_REFRESH_TTL_MS });
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: admin.id, action: 'link.token_issued', detail: { tokenId: issued.token.id, label, userId } });
    return noStore(json({ id: issued.token.id, user: given, remote: ctx.config.appOrigin, token: issued.refreshToken }, { status: 201 }));
  });

  router.post(ADMIN_LINK_TOKENS_REVOKE_PATH, async (request, ctx) => {
    const admin = await administrator(request, ctx);
    const body = await readJson<unknown>(request, BODY_BYTES);
    const id = isRecord(body) && typeof body.id === 'string' ? body.id : '';
    const token = id ? await ctx.catalog.getAgentToken(id) : undefined;
    if (!token || !token.scopes.includes(LINK_SCOPE)) throw httpError('not_found', `No Link token ${id || '(none given)'}.`, { status: 404 });
    if (token.revokedAt) return noStore(json({ revoked: token.id, already: true }));
    await ctx.catalog.revokeAgentToken(token.id);
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: admin.id, action: 'link.token_revoked', detail: { tokenId: token.id, userId: token.userId } });
    return noStore(json({ revoked: token.id }));
  });
}
