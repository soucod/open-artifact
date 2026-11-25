/**
 * Who may open an artifact, and as what.
 *
 * `effectiveRole` is pure: it takes the principal, the artifact's row, its
 * grants (and links, for guests) and the site configuration, and answers a
 * role or `null` (no access). The caller loads the rows; nothing here reads
 * the database.
 */

import type { ArtifactRole, ArtifactRow, GrantRecord, HostConfig, LinkRecord, Principal, ShareRole, UserPrincipal } from '../types.ts';

const RANK: Record<ArtifactRole, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

/** Whether `role` is at least `floor` (owner > editor > commenter > viewer). */
export function roleAtLeast(role: ArtifactRole | null | undefined, floor: ArtifactRole): boolean {
  return !!role && RANK[role] >= RANK[floor];
}

/** The higher of the roles (null when none). */
export function maxRole<R extends ArtifactRole>(...roles: Array<R | null | undefined>): R | null {
  let best: R | null = null;
  for (const role of roles) if (role && (!best || RANK[role] > RANK[best])) best = role;
  return best;
}

/** `role` lowered to at most `cap`. */
export function capRole<R extends ArtifactRole>(role: R, cap: ShareRole): R | ShareRole {
  return RANK[role] > RANK[cap] ? cap : role;
}

/** What {@link effectiveRole} needs besides the principal, artifact, grants and config. */
export interface EffectiveRoleOptions {
  /** The artifact's links; a guest's role comes from theirs. Without them a guest has no access. */
  links?: readonly LinkRecord[];
  /**
   * Decision 20: the ids of the links a signed-in user opened on this artifact (their guest rows). Each counts like a
   * guest's link: while enabled, while access is not `restricted`, capped at `linkMaxRole`.
   */
  userLinks?: readonly string[];
  /** The clock for grant expiry (default: now). */
  now?: Date;
}

/**
 * The principal's role on the artifact, or `null` for no access.
 *
 * 1. The artifact's owner, or a site admin → `owner`.
 * 2. An agent → its user's role (scopes narrow it later, at the tool).
 * 3. A trashed artifact → nobody else.
 * 4. Otherwise the highest of: each unexpired grant that matches a user (by
 *    id; by email only when verified; by the verified email's domain; by
 *    group `<provider>:<group>`); for a guest of this artifact, their link's
 *    role while the link is enabled and `general_access` is `link` or
 *    `public` (a `restricted` artifact turns every link off), capped at
 *    `config.linkMaxRole`; the same for each link a signed-in user opened
 *    (`options.userLinks`, decision 20); for anyone, `viewer` when `general_access` is
 *    `public` and the site allows public access (`public` never gives more
 *    than `viewer`).
 */
export function effectiveRole(
  principal: Principal,
  artifact: ArtifactRow,
  grants: readonly GrantRecord[],
  config: Pick<HostConfig, 'linkMaxRole' | 'publicAccess'>,
  options: EffectiveRoleOptions = {},
): ArtifactRole | null {
  return explainedRole(principal, artifact, grants, config, options).role;
}

/**
 * {@link effectiveRole} with what gave the role, in words for an operator: `owner`, `site admin`, `share with
 * email ann@example.com (editor)`, `link (commenter)`, `public access`, or why there is none.
 */
export function explainedRole(
  principal: Principal,
  artifact: ArtifactRow,
  grants: readonly GrantRecord[],
  config: Pick<HostConfig, 'linkMaxRole' | 'publicAccess'>,
  options: EffectiveRoleOptions = {},
): { role: ArtifactRole | null; reason: string } {
  if (principal.kind === 'agent') return explainedRole(principal.user, artifact, grants, config, options);
  if (principal.kind === 'user' && principal.id === artifact.ownerUser) return { role: 'owner', reason: 'the artifact\'s owner' };
  if (principal.kind === 'user' && principal.siteRole === 'admin') return { role: 'owner', reason: 'a site admin (owner of every artifact)' };
  if (artifact.trashedAt !== null) return { role: null, reason: 'the artifact is in the trash: only its owner and site admins reach it' };

  const now = (options.now ?? new Date()).toISOString();
  let best: ShareRole | null = null;
  let reason = 'no share, link or public access gives a role';
  const better = (role: ShareRole | null, why: string): void => {
    if (role && (!best || RANK[role] > RANK[best])) {
      best = role;
      reason = why;
    }
  };

  if (principal.kind === 'user') {
    for (const grant of grants) {
      if (grant.artifactId !== artifact.id) continue;
      if (grant.expiresAt !== null && grant.expiresAt <= now) continue;
      if (grantMatches(grant, principal)) better(grant.role, `a share with ${grant.subjectKind} ${grant.subject} (${grant.role}${grant.expiresAt ? `, until ${grant.expiresAt}` : ''})`);
    }
  }

  // A link counts only while it is on and the artifact is not restricted (decision 16), capped at the site's maximum.
  const linkRole = (id: string): ShareRole | null => {
    if (artifact.generalAccess === 'restricted') return null;
    const link = options.links?.find((l) => l.id === id);
    return link && link.enabled && link.artifactId === artifact.id ? capRole(link.role, config.linkMaxRole) : null;
  };

  if (principal.kind === 'guest' && principal.artifact === artifact.id) better(linkRole(principal.link), 'the share link they joined through');
  if (principal.kind === 'user') for (const id of options.userLinks ?? []) better(linkRole(id), 'a share link they opened');

  if (artifact.generalAccess === 'public' && config.publicAccess) better('viewer', 'public access (anyone may view)');

  return { role: best, reason };
}

function grantMatches(grant: GrantRecord, user: UserPrincipal): boolean {
  switch (grant.subjectKind) {
    case 'user':
      return grant.subject === user.id;
    case 'email':
      return !!user.email && user.emailVerified === true && grant.subject === user.email.toLowerCase();
    case 'domain': {
      if (!user.email || user.emailVerified !== true) return false;
      const email = user.email.toLowerCase();
      return grant.subject === email.slice(email.lastIndexOf('@') + 1);
    }
    case 'group':
      return !!user.groups?.includes(grant.subject);
    default:
      return false;
  }
}
