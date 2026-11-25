/**
 * The audit log, read: `GET /api/open-artifact.admin.audit` (site admins signed in in a browser) and the Node host's
 * `open-artifact-host audit`. Both take the same filters and answer a page of entries, newest first, with `next` (pass
 * it as `before` for the page after) while more may follow.
 *
 * Filters: `artifact` (an artifact id), `actor` (a user, agent token or guest id), `action` (a prefix: `auth.` is
 * every sign-in entry, `plugin.failed` the plugins' failures), `before` (an ISO time, or a page's `next`), `limit`
 * (default {@link AUDIT_DEFAULT_LIMIT}, at most {@link AUDIT_MAX_LIMIT}).
 *
 * Platform neutral.
 */

import type { Catalog } from '../catalog/catalog.ts';
import { httpError } from '../http.ts';
import type { AuditRecord } from '../types.ts';

export const ADMIN_AUDIT_PATH = '/api/open-artifact.admin.audit';
export const AUDIT_DEFAULT_LIMIT = 100;
export const AUDIT_MAX_LIMIT = 500;

export interface AuditQuery {
  artifact?: string;
  actor?: string;
  action?: string;
  before?: string;
  limit?: number;
}

export interface AuditPage {
  entries: AuditRecord[];
  /** Pass as `before` for the next page; null when this page is the last. */
  next: string | null;
}

/** A page's `next`: its last entry's time and id. */
const cursorOf = (entry: AuditRecord): string => `${entry.at}~${entry.id}`;

/** Reads the filters from a query string (unknown names are refused, so a typo does not silently list everything). */
export function auditQueryOf(params: URLSearchParams): AuditQuery {
  const query: AuditQuery = {};
  for (const [name, value] of params) {
    if (name === 'artifact' || name === 'actor' || name === 'action' || name === 'before') query[name] = value;
    else if (name === 'limit') {
      if (!/^\d+$/.test(value)) throw httpError('invalid_argument', 'limit is a whole number.', { status: 400 });
      query.limit = Number(value);
    } else throw httpError('invalid_argument', `Unknown filter ${name} (artifact, actor, action, before, limit).`, { status: 400 });
  }
  return query;
}

/** One page of the audit log for {@link AuditQuery}. */
export async function auditPage(catalog: Pick<Catalog, 'listAudit'>, query: AuditQuery): Promise<AuditPage> {
  const limit = Math.min(Math.max(query.limit ?? AUDIT_DEFAULT_LIMIT, 1), AUDIT_MAX_LIMIT);
  let before: string | undefined;
  let after: { at: string; id: string } | undefined;
  if (query.before) {
    const cursor = /^(.+)~(aud_[A-Za-z0-9_-]+)$/.exec(query.before);
    if (cursor) after = { at: cursor[1]!, id: cursor[2]! };
    else if (!Number.isNaN(Date.parse(query.before))) before = new Date(query.before).toISOString();
    else throw httpError('invalid_argument', 'before is an ISO time or a page\'s "next".', { status: 400 });
  }
  const rows = await catalog.listAudit({
    ...(query.artifact ? { artifactId: query.artifact } : {}),
    ...(query.actor ? { actorId: query.actor } : {}),
    ...(query.action ? { actionPrefix: query.action } : {}),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    limit: limit + 1,
  });
  const entries = rows.slice(0, limit);
  return { entries, next: rows.length > limit ? cursorOf(entries.at(-1)!) : null };
}
