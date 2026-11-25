/** Types of scripts/build-sea.mjs, for the tests that import it. */

export class SeaBuildError extends Error {}

export function executableName(platform?: NodeJS.Platform, arch?: string): string;

/** Checks that `node` can build and be a single executable; returns its version. */
export function checkBaseNode(node: string): string;

/** A folder as a gzip tarball with one top folder (`package/`). */
export function packFolder(dir: string): Buffer;

export interface SeaBuild {
  file: string;
  size: number;
  version: string;
  node: string;
  payload: number;
  signed: string;
}

export function buildSea(options?: { node?: string; out?: string }): SeaBuild;
