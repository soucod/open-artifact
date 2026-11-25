/** The home page's pure logic: ordering, what can be created, owner badges. No DOM. */

import { hostToShellOf, type ArtifactView, type HostLibraryFilter, type TypeView } from '@open-artifact/protocol';
import type { HomeHost } from './host.ts';
import type { BadgeState } from '../components/OwnerBadge.tsx';

/**
 * Built-in types the home page can create artifacts of. It began with Design alone (no reason is recorded); `page`
 * joins it, and the other built-ins stay as they were.
 */
export const CREATABLE_TYPES: readonly string[] = ['design', 'page'];

/**
 * Roots whose frame types (the types people make) the home page offers "New" for. A project's types are made from a
 * session in that project: the home page creates in its own workspace. A server type in these roots (a copy of a
 * built-in, say) is not offered.
 */
const CREATABLE_SCOPES: readonly string[] = ['user', 'extra'];

/** When an artifact's content last changed, for ordering. */
export function contentTime(a: Pick<ArtifactView, 'contentAt' | 'updatedAt' | 'createdAt'>): number {
  return Date.parse(a.contentAt || a.updatedAt || a.createdAt || '') || 0;
}

/**
 * The artifacts a host asked for (`host_hello`'s `library`): its harness's sessions', its workspace's (or a folder
 * under it); all of them without a filter.
 */
export function forHost(list: readonly ArtifactView[], filter: HostLibraryFilter | null | undefined): ArtifactView[] {
  if (!filter || (!filter.harness && !filter.workspace)) return [...list];
  const trim = (path: string): string => path.replace(/[\\/]+$/, '');
  const workspace = filter.workspace ? trim(filter.workspace) : null;
  const under = (path: string | null | undefined): boolean => {
    if (!workspace || !path) return false;
    const p = trim(path);
    return p === workspace || p.startsWith(`${workspace}/`) || p.startsWith(`${workspace}\\`);
  };
  return list.filter((a) => (!filter.harness || a.owner?.harness === filter.harness) && (!workspace || under(a.owner?.workspace) || under(a.root)));
}

/** Pinned first, then the most recently changed. */
export function sortArtifacts(list: readonly ArtifactView[]): ArtifactView[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || contentTime(b) - contentTime(a));
}

/** A type runs here and is not overridden by another of the same id. */
export function isUsable(type: TypeView): boolean {
  return type.enabled && type.runnable && !type.shadowedBy;
}

/** The home page offers "New" for this type. */
export function isCreatable(type: TypeView): boolean {
  if (!isUsable(type) || type.trusted === false) return false;
  if (CREATABLE_TYPES.includes(type.id)) return true;
  return type.scope !== 'builtin' && CREATABLE_SCOPES.includes(type.scope) && type.runtime === 'frame';
}

/** The type "New artifact" creates (Design first), or `null` when none is installed and usable. */
export function defaultCreatable(types: readonly TypeView[]): TypeView | null {
  return types.find((type) => type.id === 'design' && isCreatable(type)) ?? types.find(isCreatable) ?? null;
}

/** The badge state of an artifact's owner session. */
export function ownerBadge(owner: ArtifactView['owner']): BadgeState {
  if (!owner) return 'none';
  if (!owner.live) return 'offline';
  return owner.status === 'running' ? 'working' : 'idle';
}

/** Replaces one artifact in a list (after rename or pin), keeping the order. */
export function replaceArtifact(list: readonly ArtifactView[], next: ArtifactView): ArtifactView[] {
  return list.map((a) => (a.id === next.id ? next : a));
}

/** Removes one artifact from a list. */
export function withoutArtifact(list: readonly ArtifactView[], id: string): ArtifactView[] {
  return list.filter((a) => a.id !== id);
}

/** The host a `host_hello` makes; `null` for anything else (pure, for tests). */
export function homeHostOf(message: unknown, origin: string, declared: boolean): HomeHost | null {
  const hello = hostToShellOf(message);
  if (!hello || hello.openArtifact !== 'host_hello') return null;
  return { origin, caps: hello.caps, harness: hello.harness ?? null, agentName: hello.agentName ?? null, declared, library: hello.library ?? null };
}
