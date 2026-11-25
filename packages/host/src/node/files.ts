/**
 * An artifact's files by archive path over its folder on disk: what `link.manifest`, `link.files` and the Link
 * routes' {@link ArtifactFiles} read and write.
 *
 * - The manifest lists exactly what an export zip would hold (`archiveEntries`), each with a SHA-256 etag. Etags are
 *   cached by file, size and modification time, so a manifest of an unchanged folder reads no file again.
 * - A write checks its own `if_match`, then lands atomically (a temp file beside it, then a rename). The host's type
 *   server sees it as an outside change, like an edit made in a local editor, and picks it up.
 * - Refused, for the whole request before anything is written: paths under `doc/` and `sheet/` (the server writes
 *   them), `.artifact.json`, `history/` (each server's own version history: `linkSynced` in the protocol), `_agent/`,
 *   paths an archive leaves out, paths that climb out of the folder or through a symbolic link, and content past the
 *   path's size limit (`importFileLimit`, as an import).
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { serverWrittenPath, type LinkFile, type LinkWrite, type LinkWriteResult } from '@open-artifact/protocol';
// The archive rules alone, not the type server's entry: this module is also bundled into a Worker (the Cloudflare room).
import { archiveEntries, archiveKeeps, importFileLimit } from '@open-artifact/type-server/archive';
import { httpError } from '../core/http.ts';
import type { ArtifactFiles } from '../core/link/services.ts';

/** How many file etags are remembered before the cache starts over. */
const MAX_CACHED = 100_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

interface Cached {
  size: number;
  mtimeMs: number;
  etag: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Whether `inner` is `outer` or inside it. */
const within = (outer: string, inner: string): boolean => {
  const rel = relative(outer, inner);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** Why a path may not be written by a Link, or null when it may. */
export function linkWriteRefusal(path: string): string | null {
  if (!path || path.length > 1024) return 'is empty or too long';
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/')) return 'is not a relative path with forward slashes';
  const steps = path.split('/');
  if (steps.some((step) => step === '' || step === '.' || step === '..')) return 'climbs out of the folder or has empty steps';
  // Folded, for file systems that ignore case.
  const folded = path.toLowerCase();
  if (serverWrittenPath(folded)) return 'is written only by the host (doc/ and sheet/)';
  if (folded === '.artifact.json') return 'is the artifact manifest, which a sync never changes';
  if (folded === '_agent' || folded.startsWith('_agent/')) return 'is the local agent channel';
  if (folded === 'history' || folded.startsWith('history/')) return "is the host's own version history, which a sync never changes";
  if (!archiveKeeps(path)) return 'is not a path an artifact archive carries';
  return null;
}

/** The decoded bytes of a base64 string, or null when it is not base64. */
function decodeBase64(text: string): Buffer | null {
  if (text.length % 4 !== 0 || !BASE64.test(text)) return null;
  return Buffer.from(text, 'base64');
}

/**
 * The files of artifacts kept at `rootOf(id)`. `afterWrite` hears the paths each write request changed (a page
 * artifact's frame core is told of them: `FrameCore.noteChanges`, as a watcher would on a computer).
 */
export function createArtifactFiles(rootOf: (artifactId: string) => string, options: { afterWrite?: (artifactId: string, paths: string[]) => void } = {}): ArtifactFiles & { clearCache(): void } {
  const cache = new Map<string, Cached>();
  const queues = new Map<string, Promise<unknown>>();

  /** The etag of a file whose size and mtime are known, from the cache when they still match. */
  const etagOf = async (file: string, size: number, mtimeMs: number): Promise<string> => {
    const hit = cache.get(file);
    if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.etag;
    const etag = await hashFile(file);
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(file, { size, mtimeMs, etag });
    return etag;
  };

  /** The artifact's folder, real path; `not_found` when there is none. */
  const folderOf = async (artifactId: string): Promise<string> => {
    const root = rootOf(artifactId);
    try {
      if ((await stat(root)).isDirectory()) return await realpath(root);
    } catch {
      /* answered below */
    }
    throw httpError('not_found', `Artifact ${artifactId} has no folder on this host.`, { status: 404 });
  };

  /** The current etag of a path in a folder (no symbolic links followed), or null when there is no file. */
  const currentEtag = async (file: string): Promise<string | null> => {
    try {
      const info = await lstat(file);
      if (!info.isFile()) return null;
      return await etagOf(file, info.size, info.mtimeMs);
    } catch {
      return null;
    }
  };

  /** Checks that `file`'s nearest existing parent is inside `root` (no symbolic link leads out) and `file` is no link. */
  const assertContained = async (root: string, path: string): Promise<string> => {
    const file = resolve(root, ...path.split('/'));
    if (!within(root, file) || file === root) throw httpError('invalid_argument', `${path} climbs out of the artifact folder.`);
    let parent = dirname(file);
    for (;;) {
      try {
        const real = await realpath(parent);
        if (!within(root, real)) throw httpError('invalid_argument', `${path} leads out of the artifact folder through a link.`);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (parent === root) break;
        parent = dirname(parent);
      }
    }
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw httpError('invalid_argument', `${path} is a symbolic link on the host.`);
      if (info.isDirectory()) throw httpError('invalid_argument', `${path} is a folder on the host.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return file;
  };

  /** Runs one artifact's writes one request at a time. */
  const serialized = <T>(artifactId: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(artifactId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(artifactId, settled);
    void settled.then(() => {
      if (queues.get(artifactId) === settled) queues.delete(artifactId);
    });
    return next;
  };

  return {
    async manifest(artifactId) {
      const root = await folderOf(artifactId);
      const files: Record<string, LinkFile> = {};
      for (const entry of await archiveEntries(root)) {
        const path = entry.name.slice(entry.name.indexOf('/') + 1);
        try {
          files[path] = { etag: await etagOf(entry.file, entry.size, entry.mtime.getTime()), size: entry.size };
        } catch {
          // Removed between the listing and the hash.
        }
      }
      return files;
    },

    async read(artifactId, path) {
      if (linkReadRefusal(path)) return null;
      const root = await folderOf(artifactId);
      const file = resolve(root, ...path.split('/'));
      if (!within(root, file)) return null;
      try {
        const info = await lstat(file);
        if (!info.isFile()) return null;
        const real = await realpath(file);
        if (!within(root, real)) return null;
        const bytes = await readFile(file);
        const etag = sha256(bytes);
        if (cache.size >= MAX_CACHED) cache.clear();
        cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, etag });
        return { bytes, etag };
      } catch {
        return null;
      }
    },

    write(artifactId, writes, _author) {
      return serialized(artifactId, async () => {
        const root = await folderOf(artifactId);
        // Check everything first: a refused path fails the whole request.
        const planned: Array<{ write: LinkWrite; file: string; bytes: Buffer | null }> = [];
        const seen = new Set<string>();
        for (const write of writes) {
          const refusal = linkWriteRefusal(write.path);
          if (refusal) throw httpError('invalid_argument', `${write.path} ${refusal}.`);
          if (seen.has(write.path)) throw httpError('invalid_argument', `${write.path} is written twice in one request.`);
          seen.add(write.path);
          let bytes: Buffer | null = null;
          if (write.content !== null) {
            bytes = decodeBase64(write.content);
            if (!bytes) throw httpError('invalid_argument', `The content of ${write.path} is not base64.`);
            const limit = importFileLimit(write.path);
            if (bytes.byteLength > limit) throw httpError('too_large', `${write.path} is ${bytes.byteLength} bytes; the limit for it is ${limit}.`);
          }
          planned.push({ write, file: await assertContained(root, write.path), bytes });
        }

        const results: LinkWriteResult[] = [];
        for (const { write, file, bytes } of planned) {
          const current = await currentEtag(file);
          if (write.if_match !== undefined && write.if_match !== current) {
            results.push({ path: write.path, conflict: true, etag: current });
            continue;
          }
          if (bytes === null) {
            if (current !== null) await unlink(file);
            cache.delete(file);
            results.push({ path: write.path, etag: null });
            continue;
          }
          await mkdir(dirname(file), { recursive: true });
          const temp = join(dirname(file), `.tmp-${randomBytes(6).toString('hex')}`);
          try {
            await writeFile(temp, bytes);
            await rename(temp, file);
          } catch (error) {
            await rm(temp, { force: true });
            throw error;
          }
          const etag = sha256(bytes);
          try {
            const info = await lstat(file);
            if (cache.size >= MAX_CACHED) cache.clear();
            cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, etag });
          } catch {
            /* the cache fills on the next manifest */
          }
          results.push({ path: write.path, etag });
        }
        const changed = results.filter((r) => !('conflict' in r)).map((r) => r.path);
        if (changed.length) options.afterWrite?.(artifactId, changed);
        return results;
      });
    },

    clearCache() {
      cache.clear();
    },
  };
}

/** Why a path may not be read by a Link (it is not an archive path), or null. */
function linkReadRefusal(path: string): string | null {
  if (!path || path.length > 1024 || path.includes('\\') || path.includes('\0') || path.startsWith('/')) return 'bad path';
  if (path.split('/').some((step) => step === '' || step === '.' || step === '..')) return 'bad path';
  return archiveKeeps(path) ? null : 'not an archive path';
}
