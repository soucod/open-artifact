/**
 * A whole check of one artifact folder, as `check` (the CLI) and the
 * server's `check` action run it: the type's own check over the text files,
 * given what the folder holds beyond them (uploads, file sizes, symbolic
 * links), then the stale copy notes of installed design systems.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connectorsFile, parseConnectors } from './connectors.ts';
import { readDbFiles } from './db-host.ts';
import { staleCopyFindings } from './ds-sync.ts';
import { mimeOf } from './http.ts';
import { ArtifactStore, blobFilenames } from './store.ts';
import { EDITS_FILE, META_FILE, SHEET_DIR } from './sheets/store.ts';
import { readDocFiles } from './docs/type.ts';
import { TYPES, type CheckContext, type CheckFinding, type TypeName } from './types.ts';

/** Every file under `project/` with its size, and the symbolic links met (never followed). */
async function scanProject(root: string): Promise<{ sizes: Map<string, number>; symlinks: string[] }> {
  const sizes = new Map<string, number>();
  const symlinks: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.endsWith('.tmp')) continue;
      const inner = rel ? `${rel}/${entry.name}` : entry.name;
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) symlinks.push(inner);
      else if (entry.isDirectory()) await walk(file, inner);
      else if (entry.isFile()) sizes.set(inner, (await lstat(file).catch(() => null))?.size ?? 0);
    }
  };
  if ((await lstat(join(root, 'project')).catch(() => null))?.isDirectory()) await walk(join(root, 'project'), '');
  return { sizes, symlinks };
}

/** The uploads of a folder: each id's file name and size, and their total bytes. */
function scanBlobs(root: string): { files: Map<string, { name: string; size: number }>; bytes: number } {
  const files = new Map<string, { name: string; size: number }>();
  let bytes = 0;
  let entries: Dirent[];
  try {
    const dir = join(root, '_blobs');
    if (!lstatSync(dir).isDirectory()) return { files, bytes };
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const [id, name] of blobFilenames(entries)) {
    let size = 0;
    try {
      size = statSync(join(root, '_blobs', name)).size;
    } catch {
      // removed meanwhile
    }
    files.set(id, { name, size });
    bytes += size;
  }
  return { files, bytes };
}

/** The connectors a query can call (set up, usable and turned on); `null` when there is no readable file. */
function configuredConnectors(): ReadonlySet<string> | null {
  try {
    const entries = parseConnectors(readFileSync(connectorsFile(), 'utf8'));
    return new Set([...entries].filter(([, entry]) => entry.config !== undefined && !entry.config.disabled).map(([name]) => name));
  } catch {
    return null;
  }
}

/** What the type's check gets to know of the folder. */
export async function checkContextOf(root: string, type: TypeName): Promise<CheckContext> {
  const blobs = scanBlobs(root);
  const context: CheckContext = {
    blobExists: (id) => blobs.files.has(id),
    fileExists: (path) => !path.split('/').some((part) => part === '..' || part === '') && existsSync(join(root, ...path.split('/'))),
    blobBytes: blobs.bytes,
  };
  if (TYPES[type].store !== 'db') {
    const project = await scanProject(root);
    Object.assign(context, project);
    if (type === 'design-system') {
      const imported = scanBlobs(join(root, 'project'));
      context.blobExists = (id) => blobs.files.has(id) || imported.files.has(id);
    }
    if (type === 'design') {
      const imported = new Set<string>();
      for (const path of project.sizes.keys()) {
        const id = /^assets\/([0-9a-f]{32})\.[^/]+$/.exec(path)?.[1];
        if (id && /^(image|font|audio|video)\//.test(mimeOf(path))) imported.add(id);
      }
      context.blobExists = id => blobs.files.has(id) || imported.has(id);
    }
    return context;
  }
  context.blobSize = (id) => blobs.files.get(id)?.size;
  context.readBlob = (id) => {
    const blob = blobs.files.get(id);
    if (blob === undefined) return null;
    try {
      return readFileSync(join(root, '_blobs', blob.name), 'utf8');
    } catch {
      return null;
    }
  };
  context.modifiedAt = (path) => {
    if (path.split('/').some((part) => part === '..' || part === '')) return undefined;
    try {
      return statSync(join(root, 'db', ...path.split('/')) + '.json').mtimeMs;
    } catch {
      return undefined;
    }
  };
  context.connectors = configuredConnectors();
  return context;
}

/** A Sheet's meta and edit log (`sheet/`), the files its check reads. */
function readSheetFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of [META_FILE, EDITS_FILE]) {
    try {
      files.set(name, readFileSync(join(root, SHEET_DIR, name), 'utf8'));
    } catch {
      // Not there yet.
    }
  }
  return files;
}

/**
 * Checks one artifact folder: the text files the check read, and the findings. `staleCopies: false` leaves out the
 * stale-copy notes, which read the source folder an installed design system records (a hosted server reads no
 * folder outside the artifact).
 */
export async function runCheck(root: string, type: TypeName, { staleCopies = true }: { staleCopies?: boolean } = {}): Promise<{ files: Map<string, string>; findings: CheckFinding[] }> {
  // A db-backed type is checked from its documents (paths already start with `db/` in findings).
  const store = TYPES[type].store;
  const files =
    store === 'db' ? readDbFiles(root) : store === 'workbook' ? readSheetFiles(root) : store === 'doc' ? readDocFiles(root) : await new ArtifactStore(root).readProject();
  const findings = TYPES[type].check(files, await checkContextOf(root, type));
  if (staleCopies) try {
    findings.push(...staleCopyFindings(root, type));
  } catch {
    // An index that cannot be read is reported by the type's own check.
  }
  return { files, findings };
}
