/**
 * Host plugins on the Node host: where the list comes from, how each `use` becomes a module, and the
 * `open-artifact-host plugin …` commands.
 *
 * The list is `OA_PLUGINS` (JSON) when that is set and not empty; otherwise the file `OA_PLUGINS_FILE` (default
 * `<dataDir>/plugins.json`), when it exists. `OA_PLUGINS` wins: with it set the file is not read, and the commands
 * that change the list refuse (change the variable instead).
 *
 * A `use` is:
 * - a path (starting `./`, `../` or `/`, or `file:`): relative to the list file's folder (to the working folder for
 *   `OA_PLUGINS`);
 * - otherwise a package: first under `<dataDir>/plugins/node_modules` (install there with
 *   `npm install --prefix <dataDir>/plugins <package>`), then as the host itself would import it.
 *
 * A module's default export is the plugin (a module without one: the module itself). Node runs `.ts` files by type
 * stripping (Node 22.18 and later), except inside `node_modules`, where Node refuses it: publish a package as `.js`.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ConfigField, PluginEntry } from '@open-artifact/host-plugin';
import { checkPlugin } from '@open-artifact/host-plugin/contract';
import { checkEntry, parsePluginList, PluginConfigError, preparePlugin } from '../core/plugins/config.ts';
import type { LoadedPlugin } from '../core/plugins/site.ts';

type Env = Record<string, string | undefined>;

/** Where the plugin list was read from. */
export interface PluginListSource {
  /** `OA_PLUGINS`, or the file's path. */
  source: string;
  /** The file (absent when the list is `OA_PLUGINS`). */
  file?: string;
  /** The folder relative paths in the list are resolved from. */
  baseDir: string;
  /** The list's JSON text (undefined: no list). */
  text: string | undefined;
}

/** The list file's path: `OA_PLUGINS_FILE`, else `<dataDir>/plugins.json`. */
export function pluginListFile(env: Env, dataDir: string): string {
  const given = env.OA_PLUGINS_FILE?.trim();
  return given ? resolve(given) : join(dataDir, 'plugins.json');
}

/** Reads where the list is (see the module comment): `OA_PLUGINS` wins over the file. */
export async function readPluginListSource(env: Env, dataDir: string): Promise<PluginListSource> {
  const inline = env.OA_PLUGINS;
  if (inline !== undefined && inline.trim() !== '') return { source: 'OA_PLUGINS', baseDir: process.cwd(), text: inline };
  const file = pluginListFile(env, dataDir);
  let text: string | undefined;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new PluginConfigError([`${file} could not be read: ${(error as Error).message}`]);
  }
  return { source: file, file, baseDir: dirname(file), text };
}

/** Whether a `use` is a path (not a package name). */
export function isPathUse(use: string): boolean {
  return use.startsWith('./') || use.startsWith('../') || use.startsWith('/') || use.startsWith('file:') || isAbsolute(use) || /^\.\.?$/.test(use);
}

/** The entry file of a package folder: its `exports` (`.` → `import`/`node`/`default`), else `module`/`main`, else `index.js`. */
async function packageEntry(dir: string): Promise<string | null> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return existsSync(join(dir, 'index.js')) ? join(dir, 'index.js') : null;
  }
  const pick = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = pick(item);
        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('.' in record) return pick(record['.']);
      for (const condition of ['import', 'node', 'default']) {
        if (condition in record) {
          const found = pick(record[condition]);
          if (found) return found;
        }
      }
    }
    return null;
  };
  const chosen = pick(manifest.exports) ?? (typeof manifest.module === 'string' ? manifest.module : null) ?? (typeof manifest.main === 'string' ? manifest.main : null) ?? 'index.js';
  return join(dir, chosen);
}

/**
 * The address `import()` loads for a `use` (see the module comment), or a reason it cannot be found. `baseDir` is
 * where relative paths start; `dataDir` holds `plugins/node_modules`.
 */
export async function resolvePluginUse(use: string, options: { baseDir: string; dataDir: string }): Promise<{ url: string } | { error: string }> {
  if (isPathUse(use)) {
    const path = use.startsWith('file:') ? fileURLToPath(use) : resolve(options.baseDir, use);
    // The file looked for, and where a relative `use` was read from (the list file's folder, or the working folder).
    if (!existsSync(path)) return { error: `there is no file ${path}${isAbsolute(use) || use.startsWith('file:') ? '' : ` (${JSON.stringify(use)} from ${options.baseDir})`}` };
    return { url: pathToFileURL(path).href };
  }
  const installed = join(options.dataDir, 'plugins', 'node_modules', ...use.split('/'));
  if (existsSync(installed)) {
    const entry = await packageEntry(installed);
    if (entry && existsSync(entry)) return { url: pathToFileURL(entry).href };
    return { error: `the package in ${installed} has no entry file` };
  }
  try {
    return { url: import.meta.resolve(use) };
  } catch {
    return { error: `no package "${use}" in ${join(options.dataDir, 'plugins', 'node_modules')} (install it with: npm install --prefix ${join(options.dataDir, 'plugins')} ${use}) nor where the host can import it` };
  }
}

/** The plugin API's modules a plugin may import without installing them, and the host's own copy of each. */
const HOST_PLUGIN_API = ['@open-artifact/host-plugin', '@open-artifact/host-plugin/testing', '@open-artifact/host-plugin/contract'];
let apiProvided = false;

/**
 * Lets every plugin import `@open-artifact/host-plugin` (and `/testing`, `/contract`) without installing it: a plugin
 * file copied anywhere (the data dir, `/etc`, a mounted volume) gets the host's own copy, the one it was built
 * against. A module resolve hook (`module.registerHooks`, in this thread, synchronous) answers just these names and
 * passes every other import on unchanged. It writes nothing, so it works in a read-only app tree (the Docker image),
 * for `.mjs` and `.ts` plugins alike, wherever they live; a `node_modules` link or an import map would need a
 * writable folder beside each plugin, or a flag on the host's command line. A plugin's own installed copy is not
 * used: one version of the API (and of `answers`, `verifyJwt`) runs on a site.
 */
export function provideHostPluginApi(): void {
  if (apiProvided) return;
  apiProvided = true;
  const own = new Map(HOST_PLUGIN_API.map((name) => [name, import.meta.resolve(name)]));
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = own.get(specifier);
      return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
}

/** Loads each entry's module (a disabled entry too, so `plugin list` can name it). A failure becomes its `loadError`. */
export async function loadPluginModules(entries: readonly PluginEntry[], options: { baseDir: string; dataDir: string }): Promise<LoadedPlugin[]> {
  provideHostPluginApi();
  const out: LoadedPlugin[] = [];
  for (const entry of entries) {
    const found = await resolvePluginUse(entry.use, options);
    if ('error' in found) {
      out.push({ entry, loadError: found.error });
      continue;
    }
    try {
      const module = (await import(found.url)) as { default?: unknown };
      out.push({ entry, plugin: module.default !== undefined ? module.default : module });
    } catch (error) {
      out.push({ entry, loadError: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

/** The list (from `OA_PLUGINS` or the file) with every module loaded. Throws a `PluginConfigError` for a bad list. */
export async function loadSitePlugins(env: Env, dataDir: string): Promise<{ loaded: LoadedPlugin[]; source: PluginListSource }> {
  const source = await readPluginListSource(env, dataDir);
  const entries = parsePluginList(source.text, source.source);
  return { loaded: await loadPluginModules(entries, { baseDir: source.baseDir, dataDir }), source };
}

// ---------------------------------------------------------------------------
// Changing the list file

/** The list file's entries as written (an absent file: none). */
async function readListFile(file: string): Promise<Array<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  parsePluginList(text, file);
  if (text.trim() === '') return [];
  const value = JSON.parse(text) as unknown;
  const list = Array.isArray(value) ? value : (value as { plugins: unknown[] }).plugins;
  return list as Array<Record<string, unknown>>;
}

/** Writes the list file (through a temporary file, mode 0600: settings may hold secrets). */
async function writeListFile(file: string, entries: ReadonlyArray<Record<string, unknown>>): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

/** The sentence every command that changes the list ends with. */
export const RESTART_NOTE = 'The change takes effect when the host restarts.';

/**
 * The host's command as this process was started, for messages that tell the person what to run next:
 * `open-artifact-host` through the package's bin link, else `node <the script>` (a source checkout, or the Docker
 * image's `node packages/host/src/node/main.ts`), relative to the working folder when it is under it.
 */
export function invokedAs(argv: readonly string[] = process.argv, cwd: string = process.cwd()): string {
  const script = argv[1];
  if (!script || basename(script) === 'open-artifact-host') return 'open-artifact-host';
  const shown = relative(cwd, script);
  return `node ${shown && !shown.startsWith('..') && !isAbsolute(shown) ? shown : script}`;
}

/** The list entry a command names: by `use`, else by the id of the plugin it loads. */
async function findEntry(entries: ReadonlyArray<Record<string, unknown>>, name: string, options: { baseDir: string; dataDir: string }): Promise<number> {
  const byUse = entries.findIndex((entry) => entry.use === name);
  if (byUse >= 0) return byUse;
  for (let i = 0; i < entries.length; i++) {
    const { entry } = checkEntry(entries[i], `entry ${i}`);
    if (!entry) continue;
    const [loaded] = await loadPluginModules([entry], options);
    const plugin = loaded?.plugin as { id?: unknown } | undefined;
    if (plugin && typeof plugin === 'object' && plugin.id === name) return i;
  }
  return -1;
}

/** Whether `child` is inside the folder `parent`. */
function isInside(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

/**
 * The `use` `plugin add` writes for what the person typed. A package name stays as it is. A path is the file the
 * person named, from the folder they ran the command in; it is written relative to the list file's folder when both
 * the list file and the plugin file are in the data folder (so the data folder can move, or be mounted elsewhere, as
 * one), and absolute otherwise. A file that does not exist is refused.
 */
export function storedUse(use: string, file: string, dataDir: string, cwd: string = process.cwd()): string {
  if (!isPathUse(use)) return use;
  const path = use.startsWith('file:') ? fileURLToPath(use) : resolve(cwd, use);
  if (!existsSync(path)) throw new PluginConfigError([`there is no file ${path}.`]);
  const data = resolve(dataDir);
  if (isInside(resolve(file), data) && isInside(path, data)) {
    const from = relative(dirname(resolve(file)), path);
    return from.startsWith('../') ? from : `./${from}`;
  }
  return path;
}

/** A setting's value as typed on the command line, read as its schema's type (JSON for maps, lists and json). */
function settingValue(text: string, field: ConfigField | undefined): unknown {
  const json = (): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };
  switch (field?.type) {
    case 'number': {
      const n = Number(text);
      return text.trim() !== '' && Number.isFinite(n) ? n : text;
    }
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : text;
    case 'string[]':
      return text.trim().startsWith('[') ? json() : text.split(',').map((item) => item.trim()).filter(Boolean);
    case 'map':
    case 'json':
      return json();
    default:
      return text;
  }
}

/** `name=value` split at the first `=`. */
function assignment(text: string, what: string): [string, string] {
  const eq = text.indexOf('=');
  if (eq <= 0) throw new PluginConfigError([`${what} is <name>=<value>, not ${JSON.stringify(text)}.`]);
  return [text.slice(0, eq), text.slice(eq + 1)];
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * `plugin add|remove|enable|disable|set|unset` on the list file. Answers the lines to print. Refuses while
 * `OA_PLUGINS` is set (it wins over the file). `as`: the host's command, for the next step's message
 * ({@link invokedAs}); `cwd`: where a relative path `plugin add` is given starts from.
 */
export async function changePluginList(
  env: Env,
  dataDir: string,
  command: 'add' | 'remove' | 'enable' | 'disable' | 'set' | 'unset',
  args: readonly string[],
  options: { as?: string; cwd?: string } = {},
): Promise<string[]> {
  const cmd = options.as ?? invokedAs();
  if (env.OA_PLUGINS !== undefined && env.OA_PLUGINS.trim() !== '') {
    throw new PluginConfigError(['OA_PLUGINS is set, and it wins over the plugin list file: change OA_PLUGINS instead (or unset it to use the file).']);
  }
  const file = pluginListFile(env, dataDir);
  const where = { baseDir: dirname(file), dataDir };
  const entries = await readListFile(file);
  if (command === 'add') {
    let use: string | undefined;
    const entry: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const value = (): string => {
        const text = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
        if (text === undefined) throw new PluginConfigError([`${arg.split('=')[0]} needs a value.`]);
        return text;
      };
      if (arg === '--config' || arg.startsWith('--config=')) {
        try {
          entry.config = JSON.parse(value()) as unknown;
        } catch (error) {
          throw new PluginConfigError([`--config is JSON: ${(error as Error).message}`]);
        }
      } else if (arg === '--optional') entry.optional = true;
      else if (arg === '--disabled') entry.enabled = false;
      else if (arg === '--timeout-ms' || arg.startsWith('--timeout-ms=')) entry.timeoutMs = Number(value());
      else if (arg === '--cache-seconds' || arg.startsWith('--cache-seconds=')) entry.cacheSeconds = Number(value());
      else if (arg.startsWith('--')) throw new PluginConfigError([`unknown option ${arg} (--config <json>, --optional, --disabled, --timeout-ms <n>, --cache-seconds <n>).`]);
      else if (use === undefined) use = arg;
      else throw new PluginConfigError([`unexpected argument ${arg}.`]);
    }
    if (!use) throw new PluginConfigError([`usage: ${cmd} plugin add <package or path> [--config <json>] [--optional] [--disabled] [--timeout-ms <n>] [--cache-seconds <n>]`]);
    const stored = storedUse(use, file, dataDir, options.cwd);
    if (entries.some((existing) => existing.use === stored)) throw new PluginConfigError([`${stored} is in the list already (${file}).`]);
    const added = { use: stored, ...entry };
    const { errors } = checkEntry(added, stored);
    if (errors.length > 0) throw new PluginConfigError(errors);
    await writeListFile(file, [...entries, added]);
    const lines = [`Added ${stored} to ${file}.`];
    if (stored !== use) lines.push(`(${use} is ${isPathUse(stored) && !isAbsolute(stored) ? `${stored} from the list file's folder` : stored}.)`);
    return [...lines, RESTART_NOTE, `Run \`${cmd} plugin check\` to see whether it can run.`];
  }
  const name = args[0];
  const usage = command === 'set'
    ? `usage: ${cmd} plugin set <id or use> [<setting>=<value>…] [--secret <setting>=<ENV_NAME>…] [--timeout-ms <n>] [--cache-seconds <n>] [--optional | --required]`
    : command === 'unset'
      ? `usage: ${cmd} plugin unset <id or use> <setting>…`
      : `usage: ${cmd} plugin ${command} <id or use>`;
  if (!name || name.startsWith('--') || ((command === 'remove' || command === 'enable' || command === 'disable') && args.length > 1)) throw new PluginConfigError([usage]);
  const index = await findEntry(entries, name, where);
  if (index < 0) throw new PluginConfigError([`No plugin "${name}" in ${file} (name it by its id or its "use").`]);
  const target = entries[index]!;
  const next = [...entries];
  if (command === 'remove') {
    next.splice(index, 1);
    await writeListFile(file, next);
    return [`Removed ${String(target.use)} from ${file}. Its stored data (ctx.kv) is kept.`, RESTART_NOTE];
  }
  if (command === 'enable' || command === 'disable') {
    const changed = { ...target };
    if (command === 'enable') delete changed.enabled;
    else changed.enabled = false;
    next[index] = changed;
    await writeListFile(file, next);
    return [`${command === 'enable' ? 'Enabled' : 'Disabled'} ${String(target.use)} in ${file}.`, RESTART_NOTE];
  }
  return setSettings(env, file, entries, index, command, args.slice(1), { ...where, usage, cmd });
}

/** `plugin set` and `plugin unset`: the entry's settings and options, checked against the plugin before writing. */
async function setSettings(
  env: Env,
  file: string,
  entries: ReadonlyArray<Record<string, unknown>>,
  index: number,
  command: 'set' | 'unset',
  args: readonly string[],
  options: { baseDir: string; dataDir: string; usage: string; cmd: string },
): Promise<string[]> {
  const target = entries[index]!;
  const { entry } = checkEntry(target, `entry ${index}`);
  if (!entry) throw new PluginConfigError([`The entry for ${String(target.use)} in ${file} is not valid: fix it by hand first.`]);
  const [loaded] = await loadPluginModules([entry], options);
  if (!loaded || loaded.loadError !== undefined) throw new PluginConfigError([`${entry.use} could not be loaded, so its settings cannot be checked: ${loaded?.loadError ?? 'unknown'}`]);
  const checked = checkPlugin(loaded.plugin, entry.use);
  if (!checked.plugin) throw new PluginConfigError(checked.errors);
  const schema = checked.plugin.schema;
  const config: Record<string, unknown> = { ...(entry.config ?? {}) };
  const changed: Record<string, unknown> = { ...target };
  const named: string[] = [];
  if (command === 'unset') {
    if (args.length === 0) throw new PluginConfigError([options.usage]);
    for (const name of args) {
      if (!(name in config)) throw new PluginConfigError([`${checked.plugin.id} has no setting ${JSON.stringify(name)} in the list${Object.keys(config).length ? ` (set: ${Object.keys(config).join(', ')})` : ''}.`]);
      delete config[name];
      named.push(name);
    }
  } else {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const value = (): string => {
        const text = arg.includes('=') && arg.startsWith('--') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
        if (text === undefined) throw new PluginConfigError([`${arg.split('=')[0]} needs a value.`]);
        return text;
      };
      if (arg === '--secret') {
        const [setting, variable] = assignment(value(), '--secret');
        if (!ENV_NAME.test(variable)) throw new PluginConfigError([`--secret ${setting}=<ENV_NAME>: ${JSON.stringify(variable)} is not an environment variable name (letters, digits and _).`]);
        config[setting] = { env: variable };
        named.push(setting);
      } else if (arg === '--timeout-ms' || arg.startsWith('--timeout-ms=')) {
        changed.timeoutMs = Number(value());
        named.push('timeoutMs');
      } else if (arg === '--cache-seconds' || arg.startsWith('--cache-seconds=')) {
        changed.cacheSeconds = Number(value());
        named.push('cacheSeconds');
      } else if (arg === '--optional') {
        changed.optional = true;
        named.push('optional');
      } else if (arg === '--required') {
        delete changed.optional;
        named.push('optional');
      } else if (arg.startsWith('--')) {
        throw new PluginConfigError([`unknown option ${arg}. ${options.usage}`]);
      } else {
        const [setting, text] = assignment(arg, 'A setting');
        config[setting] = settingValue(text, schema[setting]);
        named.push(setting);
      }
    }
    if (named.length === 0) throw new PluginConfigError([options.usage]);
  }
  if (Object.keys(config).length > 0) changed.config = config;
  else delete changed.config;
  const { entry: next, errors } = checkEntry(changed, String(target.use));
  if (!next) throw new PluginConfigError(errors);
  // As the host will check it at start-up, with this shell's environment; a variable only the host's environment has
  // is not held against the change (it is named, to set there).
  const first = preparePlugin({ entry: next, plugin: loaded.plugin }, env);
  const unset = [...new Set(first.errors.flatMap((error) => /the environment variable (\w+) is not set/.exec(error)?.[1] ?? []))];
  // Those stand in for a value here, so the rest (types, the plugin's own validate) is still checked.
  const prep = unset.length === 0 ? first : preparePlugin({ entry: next, plugin: loaded.plugin }, { ...env, ...Object.fromEntries(unset.map((name) => [name, 'x'.repeat(32)])) });
  const blocking = prep.errors.filter((error) => !unset.some((name) => error.includes(name)));
  if (blocking.length > 0) throw new PluginConfigError(blocking);
  const all = [...entries];
  all[index] = changed;
  await writeListFile(file, all);
  const lines = [`${command === 'set' ? 'Set' : 'Unset'} ${[...new Set(named)].join(', ')} of ${checked.plugin.id} in ${file}.`];
  if (unset.length > 0) lines.push(`Not set in this shell: ${unset.join(', ')}. The host needs ${unset.length === 1 ? 'it' : 'them'} in its environment; then \`${options.cmd} plugin check\` there checks the rest.`);
  for (const warning of prep.warnings) lines.push(`Note: ${warning}`);
  return [...lines, RESTART_NOTE];
}
