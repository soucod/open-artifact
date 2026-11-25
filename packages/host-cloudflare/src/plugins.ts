/**
 * Host plugins on Cloudflare. A Worker cannot load code at run time, so the plugin modules are bundled into it:
 * `deploy/cloudflare/plugins.mjs` exports `{ "<use>": plugin }` (the build makes it the virtual module
 * `open-artifact:plugins`), and the list itself is the `OA_PLUGINS` variable (JSON, as on Node; there is no list
 * file). Each entry's `use` must be a key of that object; one that is not stops the site with
 * {@link missingModuleMessage}.
 *
 * The Worker and every Durable Object (an artifact's room, the hub) start their own copy at start-up: plugins run in
 * whichever isolate the request reaches. Background work (event handlers, audit writes) is kept alive past the
 * response with the request's `waitUntil(plugins.idle())`.
 */

import { forgetPluginRoles, parsePluginList, pluginServices, startSitePlugins, type Catalog, type HostConfig, type LoadedPlugin, type SitePlugins } from '@open-artifact/host';

/** The bundled plugin modules: `use` → the plugin (a module's default export). */
export type PluginModules = Readonly<Record<string, unknown>>;

/** The file the build bundles as `open-artifact:plugins` unless `OA_PLUGINS_MODULE` names another. */
export const DEFAULT_PLUGINS_MODULE = 'deploy/cloudflare/plugins.mjs';

/**
 * Why an entry cannot run on this Worker: its `use` names no bundled module. `modulesFile`: the file the build
 * bundled (`OA_PLUGINS_MODULE`, or {@link DEFAULT_PLUGINS_MODULE}), as the build recorded it.
 */
export function missingModuleMessage(use: string, modules: PluginModules, modulesFile: string = DEFAULT_PLUGINS_MODULE): string {
  const bundled = Object.keys(modules);
  return `it is not bundled into this Worker: add it to ${modulesFile} as ${JSON.stringify(use)} and build again (bundled: ${bundled.length > 0 ? bundled.map((name) => JSON.stringify(name)).join(', ') : 'none'})`;
}

/** `OA_PLUGINS` matched to the bundled modules (a module namespace with a default export counts as its default). */
export function bundledPluginList(vars: Readonly<Record<string, string | undefined>>, modules: PluginModules, modulesFile?: string): LoadedPlugin[] {
  return parsePluginList(vars.OA_PLUGINS, 'OA_PLUGINS').map((entry) => {
    if (!Object.prototype.hasOwnProperty.call(modules, entry.use)) return { entry, loadError: missingModuleMessage(entry.use, modules, modulesFile) };
    let plugin = modules[entry.use];
    if (plugin && typeof plugin === 'object' && 'default' in plugin && !('id' in plugin)) plugin = (plugin as { default: unknown }).default;
    return { entry, plugin };
  });
}

/**
 * Starts the plugins in this isolate (throws a `PluginConfigError` for a list that cannot run). `refresh` tells live
 * pages after roles were forgotten (one artifact's object, or every awake one through the hub).
 */
export function startCloudflarePlugins(input: {
  vars: Readonly<Record<string, string | undefined>>;
  modules: PluginModules;
  /** The file the modules were bundled from (named when an entry is missing). */
  modulesFile?: string;
  catalog: Catalog;
  config: HostConfig;
  version: string;
  log: (line: string) => void;
  now?: () => Date;
  /** Forgets this isolate's own cached answers (one artifact's, or all). */
  forgetHere?: (artifactId?: string) => void;
  /** Drops live page connections whose role moved. */
  refresh?: (artifactId?: string) => Promise<void>;
}): SitePlugins {
  const loaded = bundledPluginList(input.vars, input.modules, input.modulesFile);
  if (loaded.length === 0) return { registry: null, active: undefined };
  return startSitePlugins({
    loaded,
    env: input.vars,
    catalog: input.catalog,
    log: input.log,
    ...(input.now ? { now: input.now } : {}),
    services: pluginServices({
      catalog: input.catalog,
      config: input.config,
      version: input.version,
      ...(input.now ? { now: input.now } : {}),
      invalidateAccess: async (artifactId) => {
        await forgetPluginRoles(input.catalog, artifactId);
        input.forgetHere?.(artifactId);
        await input.refresh?.(artifactId);
      },
    }),
  });
}
