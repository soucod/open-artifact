/**
 * The Node site's published types (the catalog's rows are `core/catalog/site-types.ts`'s): their packages and files
 * on disk, and what the frame engine runs for an artifact of one.
 *
 *     <dataDir>/types/<uid>/<version>/package.oatype   the package as published (what `types.archive` sends)
 *     <dataDir>/types/<uid>/<version>/files/           its folder unpacked (plain files, never run on the host)
 *
 * A package is read exactly as `open-artifact types install` reads one (`checkTypePackage`: the zip, the entries, the
 * manifest, the id, the literal declaration), and a site takes only a type its frame engine runs as it is: an
 * `index.html` with a `// artifact.json` declaration, no `entry` (no server of its own) and not a page type
 * (`openArtifact.style: "page"`, whose artifacts bring their own pages). Nothing from a package runs here: its pages
 * run on the artifact's page host, restricted, under a CSP made from its manifest's `openArtifact.network` list.
 *
 * Each type id keeps one {@link FrameTypeSource} whose files move to the new version when one is published: an open
 * artifact sees its fingerprint change and its pages reload (`FrameEngine.typeChanged`). A delisted type keeps
 * running for the artifacts of it.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installedTypeCsp, OpenArtifactError, parseTitleFrom, TYPE_PACKAGE_LIMITS, titleInFile } from '@open-artifact/protocol';
import { localTypeSource, type FrameTypeSource } from '@open-artifact/server-sdk/frame';
import { checkTypePackage } from '@open-artifact/server-sdk/type-package';
import { moveIntoPlace, unpackZip, ZipRefusal } from '@open-artifact/server-sdk/zip';
import { SITE_TYPE_UID, SITE_TYPE_VERSION, SiteTypes, type SiteTypeCandidate, type SiteTypeRow } from '../core/catalog/site-types.ts';
import type { SiteTypeServices } from '../core/link/services.ts';
import type { SqlDriver } from '../core/catalog/driver.ts';
import type { SiteFrameType, SiteFrameTypes } from './frames.ts';

/** The frame engine's side of the published types. */
export interface NodeSiteTypes {
  /** The frame type of a published type's id (listed or delisted), or null. */
  frameType(type: string): SiteFrameType | null;
  /** The row of a published type's id, or undefined. */
  row(type: string): SiteTypeRow | undefined;
  /** The ids of every published type (delisted ones too). */
  ids(): string[];
  /** Reads the rows (at start). */
  load(): Promise<void>;
  /** The title an artifact's own files hold at its type's `titleFrom`, or undefined. */
  contentTitle(type: string, root: string): Promise<string | undefined>;
  /** The Link's services; `changed` hears each type whose files or listing changed (open artifacts reload). */
  services(changed: (type: string) => void): SiteTypeServices;
}

/** Where one version is kept. */
export const siteTypeDir = (dataDir: string, uid: string, version: string): string => join(dataDir, 'types', uid, version);

/** The source the frame engine runs a published type from: its current version's folder, swapped on a new version. */
class SwappableSource implements FrameTypeSource {
  #inner: FrameTypeSource;
  #stamp: string;
  constructor(dir: string, stamp: string) {
    this.#inner = localTypeSource(dir);
    this.#stamp = stamp;
  }
  swap(dir: string, stamp: string): void {
    this.#inner = localTypeSource(dir);
    this.#stamp = stamp;
  }
  get label(): string {
    return this.#inner.label;
  }
  fingerprint(): string {
    return this.#stamp;
  }
  declaration() {
    return this.#inner.declaration();
  }
  manifest() {
    return this.#inner.manifest();
  }
  indexHtml() {
    return this.#inner.indexHtml();
  }
  file(rel: string) {
    return this.#inner.file(rel);
  }
}

const stampOf = (row: SiteTypeRow): string => `${row.uid}@${row.version}:${row.sha256.slice(0, 16)}`;

/** The published types of a Node site over its catalog's database. */
export function nodeSiteTypes(input: { dataDir: string; driver: SqlDriver; log?: (line: string) => void }): NodeSiteTypes {
  const rows = new Map<string, SiteTypeRow>();
  const sources = new Map<string, { source: SwappableSource; type: SiteFrameType }>();
  const filesOf = (row: SiteTypeRow): string => join(siteTypeDir(input.dataDir, row.uid, row.version), 'files');

  const put = (row: SiteTypeRow): void => {
    rows.set(row.id, row);
    const have = sources.get(row.id);
    const policy = { contentSecurityPolicy: installedTypeCsp(row.network), allowedNetworkOrigins: [...row.network] };
    if (have) {
      have.source.swap(filesOf(row), stampOf(row));
      have.type.policy = policy;
      return;
    }
    const source = new SwappableSource(filesOf(row), stampOf(row));
    sources.set(row.id, { source, type: { source, page: false, policy } });
  };

  return {
    frameType: (type) => sources.get(type)?.type ?? null,
    row: (type) => rows.get(type),
    ids: () => [...rows.keys()],

    async load() {
      for (const row of await new SiteTypes(input.driver).all()) put(row);
    },

    async contentTitle(type, root) {
      const spec = sources.get(type)?.source.manifest().titleFrom;
      const parsed = typeof spec === 'string' ? parseTitleFrom(spec) : null;
      if (!parsed) return undefined;
      const text = await readFile(join(root, ...parsed.file.split('/')), 'utf8').catch(() => null);
      return text === null ? undefined : titleInFile(parsed.file, text, parsed.pointer)?.trim().slice(0, 200) || undefined;
    },

    services(changed) {
      return {
        async read(bytes): Promise<SiteTypeCandidate> {
          const pkg = await checkTypePackage(bytes, 'The package', { idFix: 'Give the type another slug in its artifact-type.json.' });
          const manifest = pkg.manifest as Record<string, unknown> & { entry?: unknown; openArtifact?: { style?: unknown } };
          if (manifest.entry !== undefined) throw new OpenArtifactError('unsupported', `${pkg.id} has an entry (a server of its own): a site runs only types that are pages.`);
          if (manifest.openArtifact?.style === 'page') throw new OpenArtifactError('unsupported', `${pkg.id} is a page type (openArtifact.style "page"): a site runs page artifacts as its own page type.`);
          if (!pkg.declared) throw new OpenArtifactError('unsupported', `${pkg.id} has no index.html with a // artifact.json declaration: a site runs only types that are pages.`);
          if (!SITE_TYPE_UID.test(pkg.uid)) throw new OpenArtifactError('invalid_argument', `The package's uid ${JSON.stringify(pkg.uid)} is not one a site keeps.`);
          if (!SITE_TYPE_VERSION.test(pkg.version)) throw new OpenArtifactError('invalid_argument', `The package's version ${JSON.stringify(pkg.version)} is not one a site keeps.`);
          return {
            id: pkg.id,
            uid: pkg.uid,
            name: pkg.name,
            version: pkg.version,
            description: pkg.description,
            sha256: pkg.sha256,
            bytes: pkg.bytes,
            capabilities: pkg.capabilities,
            network: pkg.network,
            // Kept for `store`: the checked entries (not part of the row).
            ...({ [CHECKED]: pkg } as object),
          };
        },

        async store(candidate, bytes) {
          const pkg = (candidate as { [CHECKED]?: Awaited<ReturnType<typeof checkTypePackage>> })[CHECKED] ?? (await checkTypePackage(bytes, 'The package'));
          const dir = siteTypeDir(input.dataDir, candidate.uid, candidate.version);
          await rm(dir, { recursive: true, force: true });
          await mkdir(dir, { recursive: true });
          let temp: string;
          try {
            // Plain files only: nothing of a package looks runnable on the host.
            temp = (await unpackZip(bytes, pkg.files.map((f) => ({ ...f, mode: 0o644 })), join(dir, 'files'), TYPE_PACKAGE_LIMITS.totalBytes)).temp;
          } catch (error) {
            await rm(dir, { recursive: true, force: true });
            if (error instanceof ZipRefusal) throw new OpenArtifactError(error.code === 'too_large' ? 'too_large' : 'bad_archive', `The package: ${error.message}`);
            throw error;
          }
          await moveIntoPlace(temp, join(dir, 'files'));
          await writeFile(join(dir, 'package.oatype'), bytes, { mode: 0o644 });
        },

        async package(uid, version) {
          if (!SITE_TYPE_UID.test(uid) || !SITE_TYPE_VERSION.test(version)) return null;
          return readFile(join(siteTypeDir(input.dataDir, uid, version), 'package.oatype')).catch(() => null);
        },

        async removeFiles(uid, version) {
          if (!SITE_TYPE_UID.test(uid) || (version !== undefined && !SITE_TYPE_VERSION.test(version))) return;
          await rm(version === undefined ? join(input.dataDir, 'types', uid) : siteTypeDir(input.dataDir, uid, version), { recursive: true, force: true });
        },

        async activated(row) {
          put(row);
          changed(row.id);
        },

        async removed(row) {
          rows.delete(row.id);
          sources.delete(row.id);
          changed(row.id);
        },
      };
    },
  };
}

/**
 * How an artifact archive names a published type: its `.artifact.json` `type` (the id) and `typeUid`. The marker
 * types to take and the check of a marker: a published id with another uid is `type_mismatch`, one with no uid too;
 * an id that is neither built in nor published is `type_missing`, naming the id and uid; a delisted type takes no new
 * artifacts. `builtIn` says which ids the site runs itself.
 */
export function siteTypeImport(site: NodeSiteTypes | null, builtIn: (type: string) => boolean): { markerTypes: string[]; inspect: (marker: Record<string, unknown> | null) => void } {
  return {
    markerTypes: site ? site.ids() : [],
    inspect(marker) {
      const type = typeof marker?.type === 'string' ? marker.type : null;
      if (!type || builtIn(type)) return;
      const uid = typeof marker?.typeUid === 'string' && marker.typeUid ? marker.typeUid : null;
      const row = site?.row(type);
      if (!row) {
        throw new OpenArtifactError('type_missing', `The archive was made with the type ${type}${uid ? ` (uid ${uid})` : ''}, and this site has no published type ${uid ? 'with that id and uid' : 'with that id'}.`, {
          fix: `Publish the type to this site first (open-artifact types publish ${type} --remote <site>), or publish the artifact with --with-type.`,
        });
      }
      if (!uid) throw new OpenArtifactError('type_mismatch', `The archive names the type ${type} without its uid, so it cannot be told from the type ${type} published here (uid ${row.uid}).`, { fix: 'Publish it from the computer that made it: its .artifact.json there carries the type\'s uid.' });
      if (uid !== row.uid) {
        throw new OpenArtifactError('type_mismatch', `The archive was made with the type ${type} (uid ${uid}), but the type ${type} published on this site is another one (uid ${row.uid}).`, {
          fix: 'Give one of the two types another id, then publish the type and the artifact again.',
        });
      }
      if (row.unpublished) throw new OpenArtifactError('not_granted', `The type ${type} was unpublished from this site: it takes no new artifacts.`, { fix: `Publish the type again (open-artifact types publish ${type} --remote <site>), then publish the artifact.` });
    },
  };
}

const CHECKED = Symbol('open-artifact.site-type.checked');

/** The site's frame types: the built-in ones, then the published ones. */
export function withSiteTypes(base: SiteFrameTypes, site: NodeSiteTypes): SiteFrameTypes {
  return { typeOf: (type) => base.typeOf(type) ?? site.frameType(type), client: base.client };
}
