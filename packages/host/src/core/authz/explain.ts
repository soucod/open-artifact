/**
 * Why a person has the role they have on an artifact, or would have once they sign in: for an operator answering
 * "I can't open it", and for checking a permission plugin's configuration without signing in as someone else.
 *
 * The person is named by e-mail address. Someone the site knows is looked at as they are (their account, site role and
 * remembered groups, the share links they opened); someone who never signed in is taken as a new account with that
 * address, verified (as a sign-in provider that vouches for it would make them). The host's own rule
 * ({@link explainedRole}) runs first, then every plugin's `authz.role`, each step recorded. Nothing is cached, nothing
 * is written: a plugin's role hook is asked exactly as on a real request (its `ctx.kv` and `fetch` included).
 *
 * Pure over the catalog and the plugins: no Node APIs.
 */

import type { Catalog } from '../catalog/catalog.ts';
import type { Plugins, RoleStep } from '../plugins/registry.ts';
import type { ArtifactRole, HostConfig, UserPrincipal } from '../types.ts';
import { explainedRole } from './roles.ts';

/** The answer of {@link explainAccess}. */
export interface AccessExplanation {
  artifact: { id: string; title: string; type: string; owner: string; ownerEmail: string | null; generalAccess: string; trashed: boolean };
  person: {
    email: string;
    /** The account, or null when this address never signed in (then the answer is what they WOULD get). */
    userId: string | null;
    name: string | null;
    siteRole: 'admin' | 'member';
    groups: string[];
    disabled: boolean;
  };
  /** The host's own role (owner, shares, links, public access) and what gave it. */
  host: { role: ArtifactRole | null; reason: string };
  /** Each plugin's `authz.role`, in order (empty when no plugin has one). */
  plugins: RoleStep[];
  /** The role the person gets (null: no access). */
  role: ArtifactRole | null;
  /** What decided it: `host` (its reason above), `plugin:<id>`, or `disabled` (the account is turned off). */
  decidedBy: string;
}

/** The person's role on the artifact and how it came about; `null` when there is no such artifact. */
export async function explainAccess(
  input: { catalog: Catalog; config: Pick<HostConfig, 'owners' | 'linkMaxRole' | 'publicAccess'>; plugins?: Plugins; now?: Date },
  artifactId: string,
  email: string,
): Promise<AccessExplanation | null> {
  const { catalog, config, plugins } = input;
  const now = input.now ?? new Date();
  const address = email.trim().toLowerCase();
  const artifact = await catalog.getArtifact(artifactId);
  if (!artifact) return null;
  const owner = await catalog.getUser(artifact.ownerUser);
  const record = await catalog.findUserByEmail(address);
  const groups = record ? await catalog.userGroups(record.id) : [];
  const verified = record ? record.emailVerified : true;
  const configured = verified && config.owners.includes(address);
  const principal: UserPrincipal = {
    kind: 'user',
    id: record?.id ?? '(not signed in yet)',
    name: record?.name ?? address,
    email: record?.email ?? address,
    emailVerified: verified,
    ...(groups.length > 0 ? { groups } : {}),
    siteRole: record?.siteRole === 'admin' || configured ? 'admin' : 'member',
  };
  const disabled = record?.disabledAt != null;
  const grants = await catalog.listGrants(artifactId);
  const userLinks = record ? (await catalog.listUserGuests(record.id, artifactId)).map((g) => g.linkId) : [];
  const links = userLinks.length > 0 ? await catalog.listLinks(artifactId) : [];
  const host = explainedRole(principal, artifact, grants, config, { links, userLinks, now });
  const steps: RoleStep[] = [];
  let role = host.role;
  let decidedBy = 'host';
  if (plugins?.hasRoleHook) {
    role = (await plugins.role({ principal, artifact, role: host.role }, steps)).role;
    // The last plugin that changed the role decided it.
    for (const step of steps) if (step.answer === 'failed' || step.after !== step.before) decidedBy = `plugin:${step.plugin}`;
  }
  if (disabled) {
    role = null;
    decidedBy = 'disabled';
  }
  return {
    artifact: {
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      owner: artifact.ownerUser,
      ownerEmail: owner?.email ?? null,
      generalAccess: artifact.generalAccess,
      trashed: artifact.trashedAt !== null,
    },
    person: { email: address, userId: record?.id ?? null, name: record?.name ?? null, siteRole: principal.siteRole ?? 'member', groups, disabled },
    host,
    plugins: steps,
    role,
    decidedBy,
  };
}

/** An {@link AccessExplanation} in sentences (the `plugin role` command prints this). */
export function accessExplanationText(answer: AccessExplanation): string {
  const who = answer.person.userId ? `${answer.person.email} (${answer.person.userId}${answer.person.siteRole === 'admin' ? ', site admin' : ''})` : `${answer.person.email} (never signed in: what they would get once they do, with a verified address)`;
  const lines = [
    `${who} on "${answer.artifact.title}" (${answer.artifact.id}, owned by ${answer.artifact.ownerEmail ?? answer.artifact.owner}, general access ${answer.artifact.generalAccess}${answer.artifact.trashed ? ', in the trash' : ''}):`,
    `  host: ${answer.host.role ?? 'no access'}: ${answer.host.reason}`,
  ];
  if (answer.person.groups.length) lines.push(`  groups remembered from sign-in: ${answer.person.groups.join(', ')}`);
  for (const step of answer.plugins) {
    const said = step.answer === 'failed' ? 'failed (an error or a time-out; see the log)' : step.answer === 'no opinion' ? 'no opinion' : `answered ${step.answer ?? 'no access'}`;
    const role = step.after !== step.before ? `${step.before ?? 'no access'} -> ${step.after ?? 'no access'}` : `stays ${step.after ?? 'no access'}`;
    lines.push(`  plugin ${step.plugin}: ${said}; role ${role}`);
  }
  if (answer.person.disabled) lines.push('  the account is disabled: no access');
  lines.push(`Role: ${answer.role ?? 'no access'} (decided by ${answer.decidedBy === 'host' ? 'the host' : answer.decidedBy === 'disabled' ? 'the disabled account' : answer.decidedBy}).`);
  return lines.join('\n');
}
