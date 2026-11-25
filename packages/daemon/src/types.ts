/**
 * The type registry: the Artifact Types in the type roots.
 *
 * Roots, highest precedence first: the workspace's project root (runs code
 * only when trusted), the user root, the extra roots from settings, the
 * installed root (`types install`: never trusted, never a built-in id), and the
 * built-in root (the repository's `artifact-types/`, limited to
 * {@link BUILTIN_TYPE_IDS}). A type id found in a higher root shadows the
 * same id below it.
 *
 * Trust decides one thing: whether a type's own program (a manifest's
 * `entry.start`) may run. A type of an untrusted root (installed, or a project
 * not trusted yet) is still served, as static files or by frame-host (the
 * daemon's own program), whose declaration is read as literal data.
 */

import { EventEmitter } from 'node:events';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARATION_LINE,
  TYPE_ID,
  entryLocation,
  isLoopbackHost,
  isServerEntry,
  isUrlEntry,
  networkOrigins,
  type ArtifactTypeManifest,
  type ManifestHostHints,
  type ManifestI18n,
  type ManifestTemplate,
  type OpenArtifactSettings,
  type ResolvedEntry,
  type TypeLocation,
  type TypeRuntime,
  type TypeScope,
  BUILTIN_TYPE_IDS,
} from '@open-artifact/protocol';
import { files, readJson } from './paths.ts';

/** Type ids the built-in root may provide in this release (kept in the protocol: a site refuses them too). */
export { BUILTIN_TYPE_IDS };

/**
 * Why a page artifact is not published to this site: the site does not run pages (its Link `hello` has no
 * `features.pages`: an older site, or one in single-origin mode).
 */
export const PAGE_NO_SITE = 'This site does not run page artifacts (it is older than this Open Artifact, or it serves everything on one origin): a page artifact stays on this computer for now.';

/** True for a page type (`openArtifact.style: "page"`): its artifacts are free pages run by frame-host in page mode. */
export const isPageType = (type: Pick<TypeInfo, 'openArtifact'> | null | undefined): boolean => type?.openArtifact?.style === 'page';

/**
 * Why an artifact of a custom type no site runs is not published to one: a site runs only the custom types whose
 * pages frame-host runs as they are ({@link isSiteKindType}), once the type is published there.
 */
export const CUSTOM_NO_SITE = 'A site runs only the custom types whose pages are served as they are (an index.html with a // artifact.json declaration, no entry of its own, not a page type): an artifact of this type stays on this computer.';

/** True for the built-in `page` type: a site whose Link `hello` says `features.pages` runs its artifacts. */
export const isBuiltinPage = (type: Pick<TypeInfo, 'id' | 'openArtifact' | 'scope'> | null | undefined): boolean => !!type && type.scope === 'builtin' && type.id === 'page' && isPageType(type);

/**
 * True for a custom type a site can run once it is published there (`open-artifact types publish`): frame-host runs
 * its own `index.html` (runtime `frame`, so no manifest `entry`), and it is not a page type.
 */
export const isSiteKindType = (type: Pick<TypeInfo, 'openArtifact' | 'runtime' | 'scope'> | null | undefined): boolean =>
  !!type && type.scope !== 'builtin' && type.runtime === 'frame' && !isPageType(type);

/**
 * Why Link keeps the artifact of this type on this computer whatever the site, or `null`. The built-in types go (the
 * `page` type to a site that runs pages: the publish asks the site's `hello`); a custom type a site can run
 * ({@link isSiteKindType}) goes to a site that has it in its catalog (the publish asks the site); a custom page or
 * static type stays.
 */
export function siteRefusal(type: Pick<TypeInfo, 'id' | 'openArtifact' | 'runtime' | 'scope'> | null | undefined): string | null {
  if (!type || type.scope === 'builtin' || isSiteKindType(type)) return null;
  // A page type and a static one: their pages are not ones a site serves. (A type with an entry of its own is the
  // site's to answer: one it runs under the same id, or a refusal.)
  if (isPageType(type) || type.runtime === 'static') return CUSTOM_NO_SITE;
  return null;
}

/**
 * Why this type may not be published to a site's catalog (`open-artifact types publish`), or `null`. Only a type of
 * this computer's own: a user type, one of an extra root, or one of a trusted project. An installed type is someone
 * else's package (its uid is theirs): its author publishes it, and a site that has it already runs its artifacts.
 */
export function typePublishRefusal(type: TypeInfo): string | null {
  if (type.scope === 'builtin') return `${type.id} is built in: every site has it already.`;
  if (type.scope === 'installed') {
    return `${type.id} is an installed type (someone else's package, uid ${type.uid ?? 'none'}): only its author publishes it to a site. Once a site has it (the same uid), artifacts of it publish there as they are.`;
  }
  if (type.scope === 'project' && !type.trusted) return `${type.id} is a type of a project this computer does not trust yet: trust the project first (open-artifact types trust <its folder>).`;
  if (!isSiteKindType(type)) return `${type.id}: ${CUSTOM_NO_SITE.replace(': an artifact of this type stays on this computer.', '.')}`;
  if (!type.uid) return `${type.id} has no uid in its artifact-type.json: a site tells types apart by it.`;
  return null;
}

/**
 * The built-in type root: `$OPEN_ARTIFACT_BUILTIN_TYPES`, else the repository's
 * `artifact-types/` folder resolved from this module's location.
 */
export function defaultBuiltinTypesDir(): string {
  return process.env.OPEN_ARTIFACT_BUILTIN_TYPES || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'artifact-types');
}

/** One type root. */
export interface TypeRoot {
  root: string;
  scope: TypeScope;
  /** Its types may run their own code (a manifest's `entry.start`). */
  trusted: boolean;
  /** When set, only these ids are read from the root. */
  allow?: readonly string[];
  /** Ids never read from the root (the installed root: the built-in ids). */
  deny?: readonly string[];
}

/** A type folder as the registry read it. */
export interface TypeInfo {
  id: string;
  /** The type folder (absolute). */
  dir: string;
  /** The root it was found in. */
  root: string;
  scope: TypeScope;
  /** Its root is trusted: {@link ownCode} may run. */
  trusted: boolean;
  /**
   * The type runs a program of its own: a manifest `entry.start` (runtime `server`). Only such a type needs a trusted
   * root; frame-host (runtime `frame`) and static files are the daemon's own, and run for any root.
   */
  ownCode: boolean;
  /** The `https://` origins its page may reach (`openArtifact.network`); enforced for installed types only. */
  network: string[];
  name: string;
  title: string;
  description: string;
  summary: string | null;
  category: string | null;
  version: string | null;
  /** The manifest's `uid`, when it has one. */
  uid: string | null;
  command: string;
  intents: string[];
  when: string | null;
  i18n: ManifestI18n;
  /** Icon file, relative to {@link dir}. */
  icon: string | null;
  artifactTitle: string | null;
  templates: ManifestTemplate[];
  flags: Record<string, boolean>;
  hasSkill: boolean;
  skillFile: string | null;
  entry: ResolvedEntry | null;
  runtime: TypeRuntime;
  runnable: boolean;
  dependencies: string[];
  detect: string[];
  titleFrom: string | null;
  /** Document store the type keeps, from `openArtifact.store`. */
  store: string | null;
  /** Formats the page exports, from `openArtifact.exports`. */
  exports: string[];
  /** Types whose artifacts this one builds on, from `openArtifact.uses`. */
  uses: string[];
  /** When an agent may offer the type unasked, from `openArtifact.offer`. */
  offer: string | null;
  openArtifact: ManifestHostHints;
  problems: string[];
}

/** A type as {@link TypeRegistry.list} returns it. */
export interface ListedType extends TypeInfo {
  enabled: boolean;
  /** Scope of the root whose type of the same id wins over this one. */
  shadowedBy: TypeScope | null;
}

/** The frontmatter of a `SKILL.md`: a small YAML subset (key: value, folded / literal blocks, quoted strings). */
export function readFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    const key = kv[1]!;
    let value = kv[2]!;
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      value = value.startsWith('>') ? block.join(' ') : block.join('\n');
    } else if (/^["'].*["']$/.test(value)) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    out[key] = value;
  }
  return out;
}

const stripFrontmatter = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** True for a loopback http(s) URL (templates allowed): only those may carry `{root}` or be a server's address. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value.replace(/\{[a-z]+\}/g, 'x'));
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a type lives on another computer, and where: a URL entry that is not loopback (`entryLocation`). What is
 * sent to such a type leaves this computer, whatever `effect` its actions declare.
 */
export function typeLocation(type: Pick<TypeInfo, 'entry'> | null | undefined): TypeLocation {
  return entryLocation(type?.entry);
}

/** True when the type lives on another computer ({@link typeLocation}). */
export const isRemoteType = (type: Pick<TypeInfo, 'entry'> | null | undefined): boolean => typeLocation(type).remote;

/** Resolves a manifest's `entry`: static, url or server. */
export function entryOf(
  manifest: ArtifactTypeManifest,
  dir: string,
  hasIndex: boolean,
  problems: string[],
): { entry: ResolvedEntry | null; runtime: TypeRuntime } {
  const raw = manifest.entry;
  if (typeof raw === 'string') {
    if (/^https?:\/\//i.test(raw)) return urlEntry(raw, false, false, false, problems);
    const file = resolve(dir, raw);
    if (!file.startsWith(resolve(dir) + sep)) {
      problems.push(`entry ${raw} leaves the type folder.`);
      return { entry: null, runtime: 'static' };
    }
    if (!existsSync(file)) {
      problems.push(`entry ${raw} is not in the type folder.`);
      return { entry: null, runtime: 'static' };
    }
    return { entry: { kind: 'static', file: relative(dir, file).split(sep).join('/') }, runtime: 'static' };
  }
  if (raw && typeof raw === 'object') {
    const flags = { open: raw.open === true, share: raw.share === true, actions: raw.actions === true };
    if (isServerEntry(raw)) {
      const start = raw.start;
      if (typeof start.command !== 'string' || !start.command) {
        problems.push('entry.start.command is missing.');
        return { entry: null, runtime: 'server' };
      }
      if (raw.url !== undefined && (typeof raw.url !== 'string' || !isLoopbackUrl(raw.url))) {
        problems.push('entry.url with entry.start must be a loopback http(s) address.');
        return { entry: null, runtime: 'server' };
      }
      if (!flags.open && !raw.url) problems.push('entry.start needs open: true or a url template.');
      const env = start.env && typeof start.env === 'object' ? Object.fromEntries(Object.entries(start.env).map(([k, v]) => [k, String(v)])) : {};
      return {
        entry: { kind: 'server', start: { command: start.command, args: Array.isArray(start.args) ? start.args.map(String) : [], env }, url: raw.url ?? null, ...flags },
        runtime: 'server',
      };
    }
    if (isUrlEntry(raw)) return urlEntry(raw.url, flags.open, flags.share, flags.actions, problems);
    problems.push('entry needs a url or start.');
    return { entry: null, runtime: 'url' };
  }
  // A page type (`openArtifact.style: "page"`): no index.html of its own; frame-host runs each artifact's own one.
  const page = manifest.openArtifact?.style === 'page';
  if (page || (hasIndex && hasInlineDeclaration(dir))) {
    const bin = frameHostBin();
    if (!bin) {
      problems.push(`${page ? 'A page type' : 'An original artifact type'}: frame-host is not there (build it with node scripts/build.mjs --only frame).`);
      return { entry: null, runtime: 'frame' };
    }
    return { entry: { kind: 'server', start: { command: 'node', args: [bin], env: {} }, url: null, open: true, share: false, actions: true }, runtime: 'frame' };
  }
  if (hasIndex) return { entry: { kind: 'static', file: 'index.html' }, runtime: 'static' };
  problems.push('No entry: add "entry" to artifact-type.json or an index.html.');
  return { entry: null, runtime: 'static' };
}

/** True when the folder's index.html declares an original artifact type; only its first 64 KB are read. */
export function hasInlineDeclaration(dir: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(join(dir, 'index.html'), 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return DECLARATION_LINE.test(buf.toString('utf8', 0, n));
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * frame-host's entry script, or `null`: `OPEN_ARTIFACT_FRAME_HOST`; next to this file
 * (`frame-host/frame-host.mjs`: the DSH plugin's vendor/ holds open-artifact.mjs and
 * frame-host/ side by side); then, in the repository, the source bin when
 * the daemon itself runs from source, else the bundle in dist/daemon/.
 */
export function frameHostBin(): string | null {
  if (process.env.OPEN_ARTIFACT_FRAME_HOST) return resolve(process.env.OPEN_ARTIFACT_FRAME_HOST);
  const self = fileURLToPath(import.meta.url);
  const here = dirname(self);
  const source = resolve(here, '..', '..', 'server-sdk', 'bin', 'frame-host.ts');
  const built = resolve(here, '..', '..', '..', 'dist', 'daemon', 'frame-host', 'frame-host.mjs');
  const candidates = [join(here, 'frame-host', 'frame-host.mjs'), ...(self.endsWith('.ts') ? [source, built] : [built, source])];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function urlEntry(url: string, open: boolean, share: boolean, actions: boolean, problems: string[]): { entry: ResolvedEntry | null; runtime: TypeRuntime } {
  if (!/^https?:\/\//i.test(url)) {
    problems.push('entry.url must be an http(s) address.');
    return { entry: null, runtime: 'url' };
  }
  if (url.includes('{root}') && !isLoopbackUrl(url)) {
    problems.push('{root} may only be used in a loopback entry.url.');
    return { entry: null, runtime: 'url' };
  }
  return { entry: { kind: 'url', url, open, share, actions }, runtime: 'url' };
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** Reads one type folder; `null` when it is not a type (no `index.html` and no `artifact-type.json`). */
export function readTypeFolder(dir: string, where: TypeRoot): TypeInfo | null {
  const id = basename(dir);
  if (!TYPE_ID.test(id)) return null;
  const hasIndex = existsSync(join(dir, 'index.html'));
  const manifestFile = join(dir, 'artifact-type.json');
  const hasManifest = existsSync(manifestFile);
  if (!hasIndex && !hasManifest) return null;
  const read = hasManifest ? readJson<ArtifactTypeManifest | null>(manifestFile, null) : {};
  const problems: string[] = [];
  if (hasManifest && (!read || typeof read !== 'object')) problems.push('artifact-type.json is not valid JSON.');
  const m: ArtifactTypeManifest = read && typeof read === 'object' ? read : {};
  const skillName = m.skill === false ? null : typeof m.skill === 'string' ? m.skill : 'SKILL.md';
  const skillFile = skillName ? resolve(dir, skillName) : null;
  let skillText: string | null = null;
  if (skillFile && skillFile.startsWith(resolve(dir) + sep)) {
    try {
      skillText = readFileSync(skillFile, 'utf8');
    } catch {
      skillText = null;
    }
  }
  const fm = skillText ? readFrontmatter(skillText) : {};
  const { entry, runtime } =
    !where.trusted && untrustedEntryRefused(m, where.scope, problems) ? { entry: null, runtime: 'static' as const } : entryOf(m, dir, hasIndex, problems);
  const iconFile = m.icon?.file;
  const icon =
    typeof iconFile === 'string' && !iconFile.includes('..') && existsSync(join(dir, iconFile)) ? iconFile : existsSync(join(dir, 'icon.svg')) ? 'icon.svg' : null;
  const name = str(m.name) ?? str(m.title) ?? str(fm.name) ?? id;
  return {
    id,
    dir,
    root: where.root,
    scope: where.scope,
    trusted: where.trusted,
    ownCode: entry?.kind === 'server' && runtime === 'server',
    network: networkOrigins(m),
    name,
    title: str(m.title) ?? str(m.name) ?? str(fm.name) ?? id,
    description: String(m.description ?? fm.description ?? '').trim(),
    summary: str(m.summary),
    category: str(m.category),
    version: str(m.version),
    uid: str(m.uid),
    command: str(m.command) ?? id,
    intents: Array.isArray(m.intents) ? m.intents.map(String) : [],
    when: str(m.when),
    i18n: m.i18n && typeof m.i18n === 'object' ? m.i18n : {},
    icon,
    artifactTitle: str(m.artifactTitle),
    templates: Array.isArray(m.templates) ? m.templates : [],
    flags: m.flags && typeof m.flags === 'object' ? m.flags : {},
    hasSkill: !!skillText,
    skillFile: skillText ? skillFile : null,
    entry,
    runtime,
    runnable: !!entry,
    dependencies: Array.isArray(m.dependencies) ? m.dependencies.map(String) : [],
    detect: Array.isArray(m.detect) ? m.detect.map(String) : [],
    titleFrom: str(m.titleFrom),
    store: str(m.openArtifact?.store),
    exports: Array.isArray(m.openArtifact?.exports) ? m.openArtifact.exports.filter((f): f is string => typeof f === 'string' && !!f.trim()).map((f) => f.trim().toLowerCase()).slice(0, 20) : [],
    uses: Array.isArray(m.openArtifact?.uses) ? [...new Set(m.openArtifact.uses.filter((t): t is string => typeof t === 'string' && TYPE_ID.test(t.trim())).map((t) => t.trim()))].slice(0, 10) : [],
    offer: str(m.openArtifact?.offer),
    openArtifact: m.openArtifact && typeof m.openArtifact === 'object' ? m.openArtifact : {},
    problems,
  };
}

/**
 * An installed type's manifest asks for what no installed type may have: a program of its own (`entry.start`) or a
 * page elsewhere (`entry.url`, or an address as `entry`). `types install` refuses such a package; this is the same
 * rule again for a folder changed after it was installed, with no fall back to frame-host or to its index.html.
 */
/**
 * A type of an untrusted root never points at another address, so its page is always the one served here, with the
 * restricted policy. An installed type is refused any `entry` that is not a file of its own; a type of a project not
 * trusted yet keeps an `entry.start` (it is refused when it would start, with a message to trust the project) but not
 * an address.
 */
function untrustedEntryRefused(m: ArtifactTypeManifest, scope: TypeScope, problems: string[]): boolean {
  const raw = m.entry as unknown;
  if (raw === undefined) return false;
  if (typeof raw === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  if (scope === 'installed') {
    problems.push('An installed type cannot start a program or point at an address ("entry" in artifact-type.json): it is not run.');
    return true;
  }
  if (raw && typeof raw === 'object' && (raw as { start?: unknown }).start !== undefined) return false;
  problems.push('A type of a project that is not trusted yet cannot point at an address ("entry" in artifact-type.json): its page is served as files until the project is trusted.');
  return true;
}

/** The type's `SKILL.md` without its frontmatter, or `null`. */
export function skillBody(type: TypeInfo | null | undefined): string | null {
  if (!type?.skillFile) return null;
  try {
    return stripFrontmatter(readFileSync(type.skillFile, 'utf8'));
  } catch {
    return null;
  }
}

/** Options of {@link TypeRegistry}. */
export interface TypeRegistryOptions {
  /** The built-in root; `null` turns it off. Default {@link defaultBuiltinTypesDir}. */
  builtinDir?: string | null;
  /** The installed root; `null` turns it off. Default `files.installedTypes()` (`$OPEN_ARTIFACT_INSTALLED_TYPES`). */
  installedDir?: string | null;
}

/** Reads the type roots and watches them. Emits `changed` (debounced) when a root changes. */
export class TypeRegistry extends EventEmitter<{ changed: [] }> {
  private readonly settings: () => OpenArtifactSettings;
  private readonly builtinDir: string | null;
  private readonly installedDir: (() => string) | null;
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(settings: () => OpenArtifactSettings, options: TypeRegistryOptions = {}) {
    super();
    this.settings = settings;
    this.builtinDir = options.builtinDir === undefined ? defaultBuiltinTypesDir() : options.builtinDir;
    const installed = options.installedDir;
    this.installedDir = installed === null ? null : installed === undefined ? files.installedTypes : () => installed;
  }

  /** The roots for a workspace, highest precedence first. */
  roots(workspace?: string | null): TypeRoot[] {
    const s = this.settings();
    const roots: TypeRoot[] = [];
    if (workspace) {
      const project = resolve(workspace, s.typeRoots.project);
      const trusted = process.env.OPEN_ARTIFACT_TRUST_PROJECTS === '1' || (s.trustedProjects ?? []).map((p) => resolve(p)).includes(resolve(workspace));
      roots.push({ root: project, scope: 'project', trusted });
    }
    roots.push({ root: resolve(s.typeRoots.user), scope: 'user', trusted: true });
    for (const extra of s.typeRoots.extra ?? []) roots.push({ root: resolve(extra), scope: 'extra', trusted: true });
    if (this.installedDir) roots.push({ root: resolve(this.installedDir()), scope: 'installed', trusted: false, deny: BUILTIN_TYPE_IDS });
    if (this.builtinDir) roots.push({ root: resolve(this.builtinDir), scope: 'builtin', trusted: true, allow: BUILTIN_TYPE_IDS });
    return roots;
  }

  /** The types in one root. */
  scanRoot(where: TypeRoot): TypeInfo[] {
    let names: string[];
    try {
      names = readdirSync(where.root);
    } catch {
      return [];
    }
    this.watch(where.root);
    const out: TypeInfo[] = [];
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue;
      if (where.allow && !where.allow.includes(name)) continue;
      if (where.deny?.includes(name)) continue;
      const dir = join(where.root, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const type = readTypeFolder(dir, where);
      if (type) out.push(type);
    }
    return out;
  }

  /** Every type visible from `workspace`; shadowed ones only with `includeShadowed`. */
  list(workspace?: string | null, options: { includeShadowed?: boolean } = {}): ListedType[] {
    const disabled = new Set(this.settings().disabledTypes ?? []);
    const seen = new Map<string, TypeScope>();
    const all: ListedType[] = [];
    for (const where of this.roots(workspace)) {
      for (const type of this.scanRoot(where)) {
        const shadowedBy = seen.get(type.id) ?? null;
        if (!shadowedBy) seen.set(type.id, type.scope);
        if (!shadowedBy || options.includeShadowed) all.push({ ...type, enabled: !disabled.has(type.id), shadowedBy });
      }
    }
    return all;
  }

  /** The visible type of an id, or `null`. */
  get(id: string, workspace?: string | null): ListedType | null {
    return this.list(workspace).find((t) => t.id === id) ?? null;
  }

  private watch(dir: string): void {
    if (this.watchers.has(dir)) return;
    try {
      const watcher = watch(dir, { persistent: false }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.emit('changed'), 300);
        this.timer.unref?.();
      });
      watcher.on('error', () => undefined);
      this.watchers.set(dir, watcher);
    } catch {
      /* a root that is not there yet */
    }
  }

  /** Stops watching. */
  close(): void {
    clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
