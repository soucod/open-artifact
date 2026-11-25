/**
 * static-groups: roles from a list in the configuration, with no service to call.
 *
 * `groups` puts people in groups by verified e-mail address or domain (a map; members separated by commas):
 *   {"design": "ann@example.com, bo@example.com", "staff": "@example.com"}
 * `roles` gives a group a role on every artifact, or only on the artifacts one person owns:
 *   {"staff": "viewer", "design": "editor:lead@example.com"}
 * A person keeps the better of the host's own answer and the plugin's. `validate` refuses a role that is not
 * viewer, commenter or editor, and a role for a group nobody is in, when the host starts. Imports nothing.
 *
 * `authz.artifacts` puts those artifacts on the person's home page too: it lists them with
 * `ctx.host.artifacts.list` (all of the site's, or one owner's), at most LIST_MAX of them, and keeps each list in
 * `ctx.kv` for CACHE_SECONDS, so the home page asks the host for them once in that time, not on every visit. That
 * suits a small site; on a large one, give groups roles through shares instead.
 */
const RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const CACHE_SECONDS = 300;
const LIST_MAX = 1000;

/** The members of each group: [group, [email or @domain, …]]. */
const membersOf = (groups) =>
  Object.entries(groups ?? {}).map(([group, list]) => [group, list.split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)]);

/** The signed-in person's verified address (an agent's person's), or null. */
function emailOf(principal) {
  const user = principal.kind === 'user' ? principal : principal.kind === 'agent' ? principal.user : null;
  return user?.email && user.emailVerified ? user.email.toLowerCase() : null;
}

/** The groups an address is in. */
function groupsOf(email, groups) {
  const domain = email.slice(email.lastIndexOf('@'));
  return new Set(membersOf(groups).filter(([, who]) => who.includes(email) || who.includes(domain)).map(([group]) => group));
}

/** The ids of every artifact (`scope` "all") or one owner's ("owner:<email>"), at most LIST_MAX, kept CACHE_SECONDS. */
async function listed(scope, ctx) {
  const key = `artifacts:${scope}`;
  const kept = await ctx.kv.get(key);
  if (kept) return kept;
  let owner;
  if (scope !== 'all') {
    owner = (await ctx.host.users.findByEmail(scope.slice('owner:'.length)))?.id;
    if (!owner) return [];
  }
  const ids = [];
  let after;
  do {
    const page = await ctx.host.artifacts.list({ ...(owner ? { owner } : {}), ...(after ? { after } : {}), limit: 200 });
    ids.push(...page.artifacts.map((a) => a.id));
    after = page.next;
  } while (after && ids.length < LIST_MAX);
  const answer = ids.slice(0, LIST_MAX);
  await ctx.kv.set(key, answer, { ttlSeconds: CACHE_SECONDS });
  return answer;
}

export default {
  id: 'static-groups',
  apiVersion: 1,
  name: 'Static groups',
  version: '1.2.0',
  config: {
    groups: { type: 'map', default: {}, description: 'group: comma-separated e-mail addresses and @domains.' },
    roles: { type: 'map', default: {}, description: 'group: role (on all artifacts) or role:owner-email.' },
  },
  validate(c) {
    const problems = [];
    for (const [group, grant] of Object.entries(c.roles)) {
      const role = grant.split(':')[0].trim();
      if (!['viewer', 'commenter', 'editor'].includes(role)) problems.push(`roles.${group} is "${grant}": the role is viewer, commenter or editor.`);
      if (!(group in c.groups)) problems.push(`roles.${group}: there is no group "${group}" in groups.`);
    }
    return problems;
  },
  authz: {
    cacheSeconds: CACHE_SECONDS,
    async role({ principal, artifact, role }, ctx) {
      const email = emailOf(principal);
      if (!email) return undefined;
      const mine = groupsOf(email, ctx.config.groups);
      if (mine.size === 0) return undefined;

      let best = null;
      let ownerEmail;
      for (const [group, grant] of Object.entries(ctx.config.roles)) {
        if (!mine.has(group)) continue;
        const [given, onlyOwner] = grant.split(':').map((s) => s.trim().toLowerCase());
        if (onlyOwner) {
          ownerEmail ??= (await ctx.host.users.get(artifact.owner))?.email?.toLowerCase() ?? '';
          if (ownerEmail !== onlyOwner) continue;
        }
        if (!best || RANK[given] > RANK[best]) best = given;
      }
      if (!best) return undefined;
      return role && RANK[role] >= RANK[best] ? role : best;
    },
    async artifacts({ principal }, ctx) {
      if (!ctx.host.supports('ctx.host.artifacts.list')) return [];
      const email = emailOf(principal);
      if (!email) return [];
      const mine = groupsOf(email, ctx.config.groups);
      const scopes = new Set();
      for (const [group, grant] of Object.entries(ctx.config.roles)) {
        if (!mine.has(group)) continue;
        const onlyOwner = grant.split(':')[1]?.trim().toLowerCase();
        scopes.add(onlyOwner ? `owner:${onlyOwner}` : 'all');
      }
      if (scopes.has('all')) return listed('all', ctx);
      const ids = [];
      for (const scope of scopes) ids.push(...(await listed(scope, ctx)));
      return [...new Set(ids)];
    },
  },
};
