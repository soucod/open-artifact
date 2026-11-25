/**
 * Host plugins (decisions 47-53), platform neutral:
 *
 * - `config.ts`: the operator's plugin list (`OA_PLUGINS`, `plugins.json`) and each plugin's settings, checked.
 * - `registry.ts`: {@link createPlugins}, the running plugins: one method per integration point, with ordering,
 *   time limits and the failure policy.
 * - `kv.ts`: each plugin's private key-value store over the catalog.
 * - `hooks.ts`: the guard and event helpers every call site uses (no-ops without plugins).
 * - `site.ts`: a site's plugins as a host starts them (the services over the catalog).
 *
 * The plugin API itself (types, the shared rules) is `@open-artifact/host-plugin`.
 */
export * from './config.ts';
export * from './registry.ts';
export * from './kv.ts';
export * from './hooks.ts';
export * from './site.ts';
