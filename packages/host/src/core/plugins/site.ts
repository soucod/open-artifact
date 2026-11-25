/**
 * A site's plugins as a host starts them: the {@link PluginServices} over the catalog, and {@link startSitePlugins},
 * which every platform calls once at start-up with the modules it loaded (Node: `import()` of each `use`; a Worker:
 * the modules bundled into it). A list that cannot run throws a {@link PluginConfigError} and the host does not start.
 *
 * Platform neutral.
 */

import type { PluginEntry } from '@open-artifact/host-plugin';
import type { Catalog } from '../catalog/catalog.ts';
import type { HostConfig } from '../types.ts';
import { auditToPlugins } from './hooks.ts';
import { createPluginKv } from './kv.ts';
import { artifactInfo, createPlugins, userInfo, type PluginServices, type Plugins } from './registry.ts';

/** One entry of the list with its loaded module (or why it could not load), as `createPlugins` takes it. */
export interface LoadedPlugin {
  entry: PluginEntry;
  plugin?: unknown;
  loadError?: string;
}

/**
 * Forgets cached plugin role answers: one artifact's (its `grants_version` moves, so every instance's cache misses),
 * or every artifact's (the site's access generation moves). The caller then tells live pages (`refresh`).
 */
export async function forgetPluginRoles(catalog: Pick<Catalog, 'bumpGrantsVersion' | 'bumpAccessGeneration'>, artifactId?: string): Promise<void> {
  if (artifactId) await catalog.bumpGrantsVersion(artifactId);
  else await catalog.bumpAccessGeneration();
}

/** The host capabilities a plugin's `ctx.host` reaches, over the catalog. */
export function pluginServices(input: {
  catalog: Catalog;
  config: Pick<HostConfig, 'appOrigin'>;
  version: string;
  /** Forgets cached roles and tells live pages: the platform's (see {@link forgetPluginRoles}). */
  invalidateAccess: (artifactId?: string) => Promise<void>;
  now?: () => Date;
  fetch?: typeof fetch;
  features?: readonly string[];
}): PluginServices {
  const { catalog } = input;
  const now = input.now ?? (() => new Date());
  return {
    version: input.version,
    appOrigin: input.config.appOrigin,
    users: {
      get: async (id) => {
        const user = await catalog.getUser(id);
        return user ? userInfo(user) : null;
      },
      findByEmail: async (email) => {
        const user = await catalog.findUserByEmail(email.trim().toLowerCase());
        return user ? userInfo(user) : null;
      },
    },
    artifacts: {
      get: async (id) => {
        const artifact = await catalog.getArtifact(id);
        return artifact ? artifactInfo(artifact) : null;
      },
      list: async ({ owner, after, limit }) => {
        const rows = await catalog.listArtifactSummaries({ ...(owner ? { owner } : {}), ...(after ? { after } : {}), limit: limit + 1 });
        const page = rows.slice(0, limit);
        return { artifacts: page, next: rows.length > limit ? page.at(-1)!.id : null };
      },
    },
    invalidateAccess: (artifactId) => input.invalidateAccess(artifactId),
    audit: async ({ pluginId, action, detail }) => {
      await catalog.appendAudit({ actorKind: 'system', actorId: `plugin:${pluginId}`, action, detail });
    },
    kv: (pluginId) => createPluginKv(catalog.driver, pluginId, { now }),
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.features ? { features: input.features } : {}),
  };
}

/** {@link startSitePlugins}' answer. */
export interface SitePlugins {
  /** Every plugin of the list, running or not (for `plugin list` and the admin API); null for an empty list. */
  registry: Plugins | null;
  /** What the request context carries: the registry when a plugin runs, else undefined (then nothing extra runs). */
  active: Plugins | undefined;
}

/**
 * Starts the site's plugins from the loaded list: checks them (throwing a `PluginConfigError` for a list that cannot
 * run), and has the catalog hand every audit entry to the plugins when one listens to `audit`. An empty list starts
 * nothing.
 */
export function startSitePlugins(input: {
  loaded: readonly LoadedPlugin[];
  env: Readonly<Record<string, string | undefined>>;
  catalog: Catalog;
  services: PluginServices;
  log: (line: string) => void;
  now?: () => Date;
  waitUntil?: (promise: Promise<unknown>) => void;
}): SitePlugins {
  if (input.loaded.length === 0) return { registry: null, active: undefined };
  const registry = createPlugins({
    plugins: input.loaded,
    env: input.env,
    services: input.services,
    log: input.log,
    ...(input.now ? { now: input.now } : {}),
    ...(input.waitUntil ? { waitUntil: input.waitUntil } : {}),
  });
  if (registry.size === 0) return { registry, active: undefined };
  if (registry.listens('audit')) input.catalog.onAudit = auditToPlugins(registry);
  return { registry, active: registry };
}
