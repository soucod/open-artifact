/**
 * From an external identity to a user of this site.
 *
 * 1. A known `(provider, subject)` is its user.
 * 2. Otherwise a *verified* email that a user already has links the identity
 *    to that user (an unverified one never does).
 * 3. Otherwise a new user, when the signup policy allows it:
 *    - `owners-only`: only `config.owners` emails;
 *    - `invite`: owners, or an email with an unexpired `email` grant on some
 *      artifact, or one a `domain` grant matches, or (for providers that send
 *      groups) a member of a group with a `group` grant;
 *    - `domain:<d>`: owners, or an email at `<d>`;
 *    - `open`: anyone.
 *    Every email test needs the provider to have verified the address.
 *
 * Site admins: the verified `config.owners` emails (promoted at sign-in);
 * with no owners configured, the first user ever created; and the owner-key
 * user, who may always sign in. A disabled user is refused. Name and avatar
 * follow the provider at each sign-in; groups are stored as
 * `<provider>:<group>` and replaced per provider.
 *
 * With plugins: every identity first goes through their `auth.identity` (they may add groups, rename, or refuse with
 * a sentence: {@link SignInError} `plugin_refused`), before any user is looked up. A new account is announced as
 * `user.created`, every completed sign-in as `user.signed_in`.
 */

import type { BaseCtx } from '../http.ts';
import { emitEvent } from '../plugins/hooks.ts';
import type { UserRecord } from '../types.ts';
import { SignInError } from './errors.ts';
import { OWNER_KEY_PROVIDER } from './owner-key.ts';
import type { ExternalIdentity } from './provider.ts';

/** The verified, lower-case email of an identity, or undefined. */
function verifiedEmail(identity: ExternalIdentity): string | undefined {
  return identity.email && identity.emailVerified ? identity.email.trim().toLowerCase() : undefined;
}

/** `<provider>:<group>` for each group the identity carries. */
export function qualifiedGroups(identity: ExternalIdentity): string[] {
  return (identity.groups ?? []).map((group) => `${identity.provider}:${group}`);
}

/** Whether the signup policy lets this identity create an account. */
async function mayCreate(identity: ExternalIdentity, ctx: BaseCtx): Promise<boolean> {
  if (identity.provider === OWNER_KEY_PROVIDER) return true;
  const { signup, owners } = ctx.config;
  const email = verifiedEmail(identity);
  if (signup === 'open') return true;
  if (email && owners.includes(email)) return true;
  if (signup === 'owners-only') return false;
  if (signup === 'invite') {
    const groups = qualifiedGroups(identity);
    if (!email && groups.length === 0) return false;
    // No user has id '' so only email, domain and group grants match.
    const grants = await ctx.catalog.grantsMatching({ id: '', ...(email ? { email, emailVerified: true } : {}), groups });
    return grants.length > 0;
  }
  const domain = signup.slice('domain:'.length);
  return email !== undefined && email.endsWith(`@${domain}`);
}

/**
 * The user an identity signs in as (found, linked or created), refreshed
 * from the identity. Throws {@link SignInError} `not_invited` or `disabled`.
 */
export async function signInWith(identity: ExternalIdentity, ctx: BaseCtx): Promise<UserRecord> {
  const { catalog, config } = ctx;
  if (ctx.plugins?.hasIdentityHook) identity = await pluginIdentity(identity, ctx);
  const email = verifiedEmail(identity);
  const isOwnerKey = identity.provider === OWNER_KEY_PROVIDER;

  let user: UserRecord | undefined;
  const known = await catalog.findIdentity(identity.provider, identity.subject);
  if (known) user = await catalog.getUser(known.userId);
  if (!user && email) {
    user = await catalog.findUserByEmail(email);
    if (user) await catalog.linkIdentity(identity.provider, identity.subject, user.id);
  }

  if (!user) {
    if (!(await mayCreate(identity, ctx))) throw new SignInError('not_invited', `${identity.provider} ${identity.subject}`);
    const firstEver = (await catalog.countUsers()) === 0;
    const admin = isOwnerKey || (email !== undefined && config.owners.includes(email)) || (config.owners.length === 0 && firstEver);
    // An unverified address is kept only when nobody else has it (emails are unique).
    const rawEmail = identity.email?.trim().toLowerCase();
    const storeEmail = email ?? (rawEmail && !(await catalog.findUserByEmail(rawEmail)) ? rawEmail : undefined);
    user = await catalog.createUser({
      name: identity.name || (isOwnerKey ? (config.ownerName ?? 'Owner') : (email ?? rawEmail ?? 'User')),
      email: storeEmail ?? null,
      emailVerified: email !== undefined,
      avatar: identity.avatar ?? null,
      siteRole: admin ? 'admin' : 'member',
    });
    await catalog.linkIdentity(identity.provider, identity.subject, user.id);
    emitEvent(ctx, 'user.created', { user: { id: user.id, name: user.name, email: user.email }, provider: identity.provider });
  } else {
    if (user.disabledAt) throw new SignInError('disabled', user.id);
    const patch: { name?: string; avatar?: string | null; email?: string; emailVerified?: boolean } = {};
    if (identity.name && identity.name !== user.name) patch.name = identity.name;
    if (identity.avatar !== undefined && identity.avatar !== user.avatar) patch.avatar = identity.avatar;
    if (email && (user.email === null || (user.email === email && !user.emailVerified))) {
      const holder = user.email === email ? user : await catalog.findUserByEmail(email);
      if (!holder || holder.id === user.id) Object.assign(patch, { email, emailVerified: true });
    }
    if (Object.keys(patch).length > 0) user = (await catalog.updateUser(user.id, patch))!;
    const promote = isOwnerKey || (email !== undefined && config.owners.includes(email));
    if (promote && user.siteRole !== 'admin') {
      await catalog.setSiteRole(user.id, 'admin');
      user = (await catalog.getUser(user.id))!;
    }
  }

  if (user.disabledAt) throw new SignInError('disabled', user.id);
  if (identity.groups !== undefined || (await catalog.userGroups(user.id)).some((g) => g.startsWith(`${identity.provider}:`))) {
    await catalog.setUserGroups(user.id, identity.provider, qualifiedGroups(identity));
  }
  emitEvent(ctx, 'user.signed_in', { user: { id: user.id, name: user.name, email: user.email }, provider: identity.provider });
  return user;
}

/** The identity after the plugins' `auth.identity` chain (the provider stays); throws `plugin_refused` on a refusal. */
async function pluginIdentity(identity: ExternalIdentity, ctx: BaseCtx): Promise<ExternalIdentity> {
  const { provider, ...rest } = identity;
  const answer = await ctx.plugins!.identity(rest, provider);
  if ('reject' in answer) throw new SignInError('plugin_refused', `plugin ${answer.plugin}: ${answer.reject}`, { plugin: { id: answer.plugin, sentence: answer.reject } });
  const next = answer.identity;
  return {
    provider,
    subject: next.subject,
    ...(next.email !== undefined ? { email: next.email } : {}),
    ...(next.emailVerified !== undefined ? { emailVerified: next.emailVerified } : {}),
    ...(next.name !== undefined ? { name: next.name } : {}),
    ...(next.avatar !== undefined ? { avatar: next.avatar } : {}),
    ...(next.groups !== undefined ? { groups: [...next.groups] } : {}),
  };
}
