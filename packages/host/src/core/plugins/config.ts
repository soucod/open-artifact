/**
 * The operator's plugin list and each plugin's settings, checked before the host starts (decision 51).
 *
 * The list comes from `OA_PLUGINS` (JSON) or, on the Node host, `plugins.json`: a list of entries
 * `{use, config?, enabled?, optional?, timeoutMs?, cacheSeconds?}` (a bare string is `{use}`; `{"plugins": [...]}` is the list too).
 * Loading a module by its `use` is the platform's (Node imports it; Cloudflare bundles it): this module checks the
 * list, then each loaded plugin object and its settings with the rules of `@open-artifact/host-plugin/contract`, so
 * the host and the plugin test kit say the same things.
 *
 * Platform neutral.
 */

import type { PluginEntry } from '@open-artifact/host-plugin';
import { checkPlugin, DEFAULT_TIMEOUT_MS, didYouMean, kindOf, MAX_CACHE_SECONDS, MAX_TIMEOUT_MS, redact, runValidate, validateConfig, type CheckedPlugin } from '@open-artifact/host-plugin/contract';

/** The plugin configuration is wrong: every problem found, each a sentence naming the plugin and the setting. */
export class PluginConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.length === 1 ? problems[0]! : `The plugin configuration has ${problems.length} problems:\n- ${problems.join('\n- ')}`);
    this.name = 'PluginConfigError';
    this.problems = problems;
  }
}

const ENTRY_KEYS = ['use', 'config', 'enabled', 'optional', 'timeoutMs', 'cacheSeconds'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One entry of the list, checked: the entry, or why it is wrong. `where` names it (`OA_PLUGINS[2]`). */
export function checkEntry(value: unknown, where: string): { entry: PluginEntry | null; errors: string[] } {
  if (typeof value === 'string') value = { use: value };
  if (!isRecord(value)) return { entry: null, errors: [`${where} must be {"use": "<package or path>", "config": {…}}, not ${kindOf(value)}.`] };
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.includes(key)) errors.push(`${where}: unknown key ${JSON.stringify(key)}.${didYouMean(key, ENTRY_KEYS)} An entry has ${ENTRY_KEYS.join(', ')}.`);
  }
  if (typeof value.use !== 'string' || !value.use.trim()) errors.push(`${where}: "use" must name the plugin's package or path.`);
  const label = typeof value.use === 'string' && value.use.trim() ? `${where} (${value.use.trim()})` : where;
  if (value.config !== undefined && !isRecord(value.config)) errors.push(`${label}: "config" must be an object of settings.`);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') errors.push(`${label}: "enabled" must be true or false.`);
  if (value.optional !== undefined && typeof value.optional !== 'boolean') errors.push(`${label}: "optional" must be true or false.`);
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > MAX_TIMEOUT_MS)) {
    errors.push(`${label}: "timeoutMs" must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}.`);
  }
  if (value.cacheSeconds !== undefined && (typeof value.cacheSeconds !== 'number' || !Number.isInteger(value.cacheSeconds) || value.cacheSeconds < 0 || value.cacheSeconds > MAX_CACHE_SECONDS)) {
    errors.push(`${label}: "cacheSeconds" must be a whole number of seconds from 0 to ${MAX_CACHE_SECONDS}.`);
  }
  if (errors.length > 0) return { entry: null, errors };
  return {
    entry: {
      use: (value.use as string).trim(),
      ...(value.config !== undefined ? { config: value.config as Record<string, unknown> } : {}),
      ...(value.enabled !== undefined ? { enabled: value.enabled as boolean } : {}),
      ...(value.optional !== undefined ? { optional: value.optional as boolean } : {}),
      ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs as number } : {}),
      ...(value.cacheSeconds !== undefined ? { cacheSeconds: value.cacheSeconds as number } : {}),
    },
    errors,
  };
}

/**
 * The plugin list from its JSON text (`OA_PLUGINS`, or a `plugins.json` file's content); `source` names it in
 * messages. No text (or only spaces) is an empty list. Throws a {@link PluginConfigError} with every problem.
 */
export function parsePluginList(text: string | undefined, source = 'OA_PLUGINS'): PluginEntry[] {
  if (text === undefined || text.trim() === '') return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PluginConfigError([`${source} is not JSON (${error instanceof Error ? error.message : String(error)}). It is a list: [{"use": "<package or path>", "config": {…}}].`]);
  }
  if (isRecord(value) && Array.isArray(value.plugins) && Object.keys(value).length === 1) value = value.plugins;
  if (!Array.isArray(value)) throw new PluginConfigError([`${source} must be a list of plugins ([{"use": "<package or path>", "config": {…}}]), not ${kindOf(value)}.`]);
  const entries: PluginEntry[] = [];
  const problems: string[] = [];
  value.forEach((item: unknown, index) => {
    const { entry, errors } = checkEntry(item, `${source}[${index}]`);
    if (entry) entries.push(entry);
    problems.push(...errors);
  });
  if (problems.length > 0) throw new PluginConfigError(problems);
  return entries;
}

/** A plugin ready to run: checked, its settings validated. */
export interface PreparedPlugin {
  entry: PluginEntry;
  plugin: CheckedPlugin;
  /** The settings, defaults filled in, `{env}` references resolved (frozen). */
  config: Readonly<Record<string, unknown>>;
  /** Its secret settings' values, blanked out of everything it logs. */
  secrets: string[];
  timeoutMs: number;
  /** What was ignored or is unwise (unknown hooks, an inline secret): reported, not fatal. */
  warnings: string[];
}

/** {@link preparePlugin}'s answer: the plugin, or why it cannot run. `id` when the object had a usable one. */
export interface Preparation {
  prepared: PreparedPlugin | null;
  id: string | null;
  errors: string[];
  warnings: string[];
}

/**
 * Checks one loaded plugin (`plugin`, the module's default export) against its entry: the object
 * (`checkPlugin`), then its settings (`validateConfig`) with `{env}` references read from `env`, then the plugin's own
 * `validate(config)`. The entry's `cacheSeconds` replaces the plugin's `authz.cacheSeconds`. `loadError` is why the
 * platform could not load the module at all.
 */
export function preparePlugin(
  input: { plugin?: unknown; entry: PluginEntry; loadError?: string },
  env: Readonly<Record<string, string | undefined>>,
  hostVersion?: string,
): Preparation {
  const { entry } = input;
  const label = `The plugin ${JSON.stringify(entry.use)}`;
  if (input.loadError !== undefined) return { prepared: null, id: null, errors: [`${label} could not be loaded: ${input.loadError}`], warnings: [] };
  const checked = checkPlugin(input.plugin, label, hostVersion ? { hostVersion } : {});
  const id = checked.plugin?.id ?? (isRecord(input.plugin) && typeof input.plugin.id === 'string' ? input.plugin.id : null);
  if (!checked.plugin) return { prepared: null, id, errors: checked.errors, warnings: checked.warnings };
  const settings = validateConfig(checked.plugin.id, checked.plugin.schema, entry.config, env);
  const warnings = [...checked.warnings, ...settings.warnings];
  if (settings.errors.length > 0) return { prepared: null, id, errors: settings.errors, warnings };
  const refused = runValidate(checked.plugin, settings.config).map((problem) => redact(problem, settings.secrets));
  if (refused.length > 0) return { prepared: null, id, errors: refused, warnings };
  return {
    prepared: {
      entry,
      plugin: entry.cacheSeconds !== undefined ? { ...checked.plugin, cacheSeconds: entry.cacheSeconds } : checked.plugin,
      config: settings.config,
      secrets: settings.secrets,
      timeoutMs: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      warnings,
    },
    id,
    errors: [],
    warnings,
  };
}
