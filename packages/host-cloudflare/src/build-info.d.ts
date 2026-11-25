/**
 * `open-artifact:build`, made by `deploy/cloudflare/build.mjs` when it bundles `worker.ts`: the version, the type
 * table (with each type's manifest and skill text) and the Shell's and home page's templates.
 */
declare module 'open-artifact:build' {
  import type { SiteBuild } from './site.ts';

  const build: SiteBuild;
  export default build;
}

/**
 * `open-artifact:plugins`, made by `deploy/cloudflare/build.mjs` from `deploy/cloudflare/plugins.mjs` (or the file
 * `OA_PLUGINS_MODULE` names): `use` → the plugin, for `OA_PLUGINS` to name.
 */
declare module 'open-artifact:plugins' {
  const plugins: Readonly<Record<string, unknown>>;
  export default plugins;
}
