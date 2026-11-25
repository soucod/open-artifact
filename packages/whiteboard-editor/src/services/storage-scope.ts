/**
 * Where this board's memory in the browser is filed: the tab's camera, the
 * saved copy, the interrupted-load marker and the agent's last status.
 *
 * A cloud host serves the page at `/<type>/v1.<token>/`, with a new token on
 * every load, so the page's path alone would file each reload apart (and
 * leave the saved copies of earlier loads behind). The scope is the Shell's
 * artifact id when it gave one, else the path with the token taken out.
 */

import { shellArtifactId } from '@open-artifact/runtime';

/** A page-token path segment (`/v1.<payload>.<mac>`). */
const TOKEN_SEGMENT = /\/v1\.[^/]*(?=\/|$)/;

/** The scope for an artifact id (from the Shell) and the page's path. */
export function storageScope(artifactId: string | null | undefined, pathname: string): string {
  return artifactId ? `artifact:${encodeURIComponent(artifactId)}` : pathname.replace(TOKEN_SEGMENT, '') || '/';
}

/** This page's scope. */
export function boardScope(): string {
  let id: string | null = null;
  try {
    id = shellArtifactId();
  } catch {
    /* A page without a usable address keeps its path. */
  }
  return storageScope(id, location.pathname);
}

/** Saved copies before they were filed by scope and viewer (`wb-saved-copy:<path>`). */
const OLD_SAVED_COPY = 'wb-saved-copy:';
/** Keys filed by scope, which older pages filed under their tokened path. */
const SCOPED_PREFIXES = ['wb-camera:', 'wb-load:', 'wb-agent:'];

/** Whether `key` is one of ours that no page reads any more. */
export function isLegacyKey(key: string): boolean {
  if (key.startsWith(OLD_SAVED_COPY)) return true;
  const prefix = SCOPED_PREFIXES.find((p) => key.startsWith(p));
  return !!prefix && TOKEN_SEGMENT.test(key.slice(prefix.length));
}

/**
 * Drops what earlier pages filed where nothing reads it again: saved copies
 * by path (whole boards, one more per cloud reload) and markers under page
 * tokens.
 */
export function dropLegacyKeys(): void {
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      const stale: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null && isLegacyKey(key)) stale.push(key);
      }
      for (const key of stale) storage.removeItem(key);
    } catch {
      /* Storage can be disabled. */
    }
  }
}
