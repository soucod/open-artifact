/**
 * Reading a type package (`<id>-<version>.oatype`) before anything of it is kept: the one set of checks behind a local
 * `open-artifact types install` and a site's `types.import`, so both refuse the same packages for the same reasons.
 *
 * The whole zip is read first (`checkZip`: one top folder, plain files, no `..`, absolute path, backslash, NUL or
 * name given twice by case or Unicode form, the package limits on what it declares), then the entries' paths and kinds
 * (`packageEntryProblems`, as `types check --for-share`), the manifest (`manifestPackageProblems`: the fields, no
 * `entry.start` or `entry.url`, the network list), the id (a type id, not built in, not reserved) and the declaration
 * of `index.html` (`readStaticDeclaration`: literal data, never run). Nothing is written and nothing from the package
 * runs; the caller unpacks `files` with `unpackZip` once it has decided to keep it.
 */

import { createHash } from 'node:crypto';
import {
  BUILTIN_TYPE_IDS,
  DeclarationError,
  OpenArtifactError,
  RESERVED_TYPE_IDS,
  TYPE_ID,
  TYPE_PACKAGE_LIMITS,
  manifestPackageProblems,
  networkOrigins,
  packageEntryProblems,
  readStaticDeclaration,
  type ArtifactTypeManifest,
  type TypeCheckProblem,
} from '@open-artifact/protocol';
import { checkZip, unpackZipFile, ZipRefusal, type CheckedZipFile } from './zip.ts';

/** A package read and checked: what it is, and its files (not unpacked). */
export interface CheckedTypePackage {
  /** The id it would install under (`as`, else the manifest's `slug`). */
  id: string;
  uid: string;
  name: string;
  version: string;
  description: string;
  manifest: ArtifactTypeManifest & Record<string, unknown>;
  /** The zip's one top folder. */
  top: string;
  files: CheckedZipFile[];
  /** Whether `index.html` is there and carries a `// artifact.json` declaration (a frame type). */
  declared: boolean;
  /** The capabilities the declaration names. */
  capabilities: string[];
  /** The https origins `openArtifact.network` lets its pages reach. */
  network: string[];
  /** The type's instructions (`SKILL.md`, or the manifest's `skill`), or null. */
  skill: { path: string; text: string } | null;
  sha256: string;
  bytes: number;
}

const listed = (problems: TypeCheckProblem[]): string => problems.map((p) => `  - ${p.message}`).join('\n');

/**
 * Reads and checks a package's bytes (see the module comment). `source` names it in messages; `as` takes another id;
 * `fix` is the hint a refused id gets (default: install it under another id). Refusals are `OpenArtifactError`s:
 * `too_large`, `bad_archive`, `invalid_argument`.
 */
export async function checkTypePackage(bytes: Uint8Array, source: string, o: { as?: string | null; idFix?: string } = {}): Promise<CheckedTypePackage> {
  let checked: ReturnType<typeof checkZip>;
  try {
    checked = checkZip(bytes, { noun: 'a type package', maxFiles: TYPE_PACKAGE_LIMITS.files, maxBytes: TYPE_PACKAGE_LIMITS.totalBytes, maxFileBytes: TYPE_PACKAGE_LIMITS.fileBytes, folders: true });
  } catch (error) {
    if (error instanceof ZipRefusal) throw new OpenArtifactError(error.code === 'too_large' ? 'too_large' : 'bad_archive', `${source}: ${error.message}`);
    throw error;
  }
  const paths = checked.files.map((f) => f.path);
  const entryProblems = packageEntryProblems([
    { path: `${checked.top}/`, kind: 'dir', size: 0 },
    ...checked.files.map((f) => ({ path: `${checked.top}/${f.path}`, kind: 'file' as const, size: f.entry.size })),
  ]);
  if (entryProblems.length) throw new OpenArtifactError('bad_archive', `${source} is not a type package that can be installed:\n${listed(entryProblems)}`);
  const read = async (path: string): Promise<string | null> => {
    const item = checked.files.find((f) => f.path === path);
    if (!item) return null;
    try {
      return (await unpackZipFile(bytes, item)).toString('utf8');
    } catch (error) {
      if (error instanceof ZipRefusal) throw new OpenArtifactError('bad_archive', `${source}: ${error.message}`);
      throw error;
    }
  };
  const manifestText = await read('artifact-type.json');
  if (manifestText === null) throw new OpenArtifactError('bad_archive', `${source} has no artifact-type.json in its folder ${checked.top}/.`);
  let manifest: ArtifactTypeManifest & Record<string, unknown>;
  try {
    const parsed = JSON.parse(manifestText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
    manifest = parsed as ArtifactTypeManifest & Record<string, unknown>;
  } catch (error) {
    throw new OpenArtifactError('bad_archive', `${source}: artifact-type.json does not parse (${(error as Error).message}).`);
  }
  const manifestProblems = manifestPackageProblems(manifest, paths);
  if (manifestProblems.length) throw new OpenArtifactError('bad_archive', `${source} is not a type package that can be installed:\n${listed(manifestProblems)}`);
  const id = o.as ?? String(manifest.slug);
  const fix = o.idFix ?? 'Install it under another id with --as <id>.';
  const refuse = (message: string): OpenArtifactError => new OpenArtifactError('invalid_argument', message, { fix });
  if (!TYPE_ID.test(id)) throw refuse(`${JSON.stringify(id)} is not a type id: letters, digits, ".", "_" and "-", at most 64.`);
  if (BUILTIN_TYPE_IDS.includes(id)) throw refuse(`${id} is a built-in type's id: an installed type never takes one.`);
  if (RESERVED_TYPE_IDS.includes(id)) throw refuse(`${id} is reserved.`);

  let capabilities: string[] = [];
  let declared = false;
  const html = await read('index.html');
  if (html !== null) {
    try {
      const decl = readStaticDeclaration(html);
      if (decl) {
        if (decl.lexical.length) throw new DeclarationError(`${decl.lexical.join(', ')} declared with let or const`, 0, 0);
        capabilities = Object.keys(decl.capabilities);
        declared = true;
      }
    } catch (error) {
      if (error instanceof DeclarationError) throw new OpenArtifactError('bad_archive', `${source}: the // artifact.json declaration of index.html is not literal data (${error.message}).`);
      throw error;
    }
  }
  const skillPath = manifest.skill === false ? null : typeof manifest.skill === 'string' ? manifest.skill : 'SKILL.md';
  const skillText = skillPath ? await read(skillPath) : null;
  return {
    id,
    uid: String(manifest.uid),
    name: String(manifest.name),
    version: String(manifest.version),
    description: String(manifest.description),
    manifest,
    top: checked.top,
    files: checked.files,
    declared,
    capabilities,
    network: networkOrigins(manifest),
    skill: skillText !== null && skillPath ? { path: skillPath, text: skillText } : null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
}
