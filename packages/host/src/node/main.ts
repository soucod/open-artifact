#!/usr/bin/env node
/**
 * `open-artifact-host`: the Node cloud host's command line.
 *
 *     open-artifact-host [serve]                         start the host (the default)
 *     open-artifact-host import <folder|zip> [--owner <email>]   add an artifact (owned by the owner-key owner, or <email>)
 *     open-artifact-host owner-key                       replace the owner key and print a fresh sign-in address
 *     open-artifact-host link-token --user <email> [--label <text>]   mint a Link refresh token for a computer's daemon
 *     open-artifact-host link-token --revoke <id>        revoke one
 *     open-artifact-host audit [--artifact <id>] [--actor <id>] [--action <prefix>] [--before <time>] [--limit <n>] [--json]
 *                                                        the audit log, newest first (site admins: GET /api/open-artifact.admin.audit)
 *     open-artifact-host plugin list|check               the site's plugins, and whether each can run
 *     open-artifact-host plugin role <artifact id> --as <email> [--json]   that person's role and what decided it
 *     open-artifact-host plugin add <use> [--config <json>] [--optional] [--disabled] [--timeout-ms <n>] [--cache-seconds <n>]
 *     open-artifact-host plugin remove|enable|disable <id or use>   change the list file (at the next restart)
 *     open-artifact-host plugin set <id or use> <setting>=<value>… [--secret <setting>=<ENV_NAME>] [--timeout-ms <n>] [--cache-seconds <n>] [--optional]
 *     open-artifact-host plugin unset <id or use> <setting>…         change an entry's settings, checked against the plugin
 *
 * Messages name the command as it was started (`invokedAs`): `open-artifact-host` through the bin link, else
 * `node <script>` (a source checkout; the Docker image's `node packages/host/src/node/main.ts`).
 *
 * Settings come from the environment: `HostConfig`'s (`OA_APP_ORIGIN`, `OA_CONTENT_ORIGIN`, `OA_SIGNING_KEYS`,
 * `OA_AUTH`, …), the Node ones (`OA_DATA_DIR`, `OA_PORT`, `OA_BIND`, `OA_ASSETS_DIR`), `OA_UI_DIR` (a built
 * `dist/daemon`), `OA_TRUST_PROXY=1` (honour `X-Forwarded-Host`/`-Proto`) and `OA_INTERNAL_PORT`/`OA_INTERNAL_BIND`
 * (the internal listener with the on-demand TLS ask endpoint, `tls-ask.ts`; off when unset), and the plugin list:
 * `OA_PLUGINS` (JSON), which wins over the file `OA_PLUGINS_FILE` (default `<dataDir>/plugins.json`; see `plugins.ts`).
 *
 * Without `OA_SIGNING_KEYS` a host on this computer or a private network (`isPrivateNetworkHostName`) generates a key
 * and keeps it in `<dataDir>/keys.json` (mode 0600); a host on a public domain refuses to start without one.
 */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateNetworkHostName, OpenArtifactError } from '@open-artifact/protocol';
import { auditPage, type AuditPage } from '../core/app/audit.ts';
import { accessExplanationText, explainAccess } from '../core/authz/explain.ts';
import { archiveEntries, isTypeName, writeZip } from '@open-artifact/type-server';
import { signInWith } from '../core/auth/accounts.ts';
import { ensureOwnerKey, OWNER_KEY_ATTEMPTS, OWNER_KEY_HASH, OWNER_KEY_PROVIDER, OWNER_SUBJECT } from '../core/auth/owner-key.ts';
import { SIGN_IN_PATH } from '../core/auth/routes.ts';
import { newArtifactId, type Catalog } from '../core/catalog/catalog.ts';
import { ConfigError, DEFAULT_APP_ORIGIN, parseConfig } from '../core/config.ts';
import { parseTrashDays } from '../core/catalog/trash.ts';
import { LINK_ACCESS_TTL_MS, LINK_REFRESH_TTL_MS, LINK_SCOPE } from '../core/link/services.ts';
import type { HostConfig } from '../core/types.ts';
import { dataDirOf, parseNodeEnv } from './env.ts';
import { HOST_VERSION, importInto, openCatalog, startHost } from './host.ts';
import { nodeSiteTypes } from './site-types.ts';
import { uiDirOf } from './static.ts';
import { pageHostSource } from '../core/page-host.ts';
import { PAGE_TYPE, parsePageNetwork } from './frames.ts';
import { parseInternalEnv, parsePageHostOnDemand, startTlsAsk } from './tls-ask.ts';
import { PluginConfigError } from '../core/plugins/config.ts';
import { createPlugins, type PluginDescription } from '../core/plugins/registry.ts';
import { pluginServices } from '../core/plugins/site.ts';
import { changePluginList, invokedAs, loadSitePlugins } from './plugins.ts';

/** This command as it was started (`open-artifact-host`, or `node …/main.ts` from a checkout or the Docker image). */
const CMD = invokedAs();

type Env = Record<string, string | undefined>;

/** Whether an origin is this computer or a private network (a generated signing key is only allowed there). */
function isLocalOrigin(origin: string): boolean {
  return isPrivateNetworkHostName(new URL(origin).hostname);
}

/**
 * The environment with `OA_SIGNING_KEYS` filled in from `<dataDir>/keys.json` (made on first use) when it is unset
 * and the app origin is local; unchanged otherwise (`parseConfig` then refuses a missing key).
 */
export async function withSigningKeys(env: Env, dataDir: string, log: (line: string) => void = () => undefined): Promise<Env> {
  if (env.OA_SIGNING_KEYS?.trim()) return env;
  const appOrigin = env.OA_APP_ORIGIN?.trim() || DEFAULT_APP_ORIGIN;
  let local = false;
  try {
    local = isLocalOrigin(appOrigin);
  } catch {
    return env; // parseConfig says what is wrong with it
  }
  if (!local) return env;
  const file = join(dataDir, 'keys.json');
  let keys: string[] | null = null;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { signingKeys?: unknown };
    if (Array.isArray(parsed.signingKeys) && parsed.signingKeys.every((k) => typeof k === 'string' && k.length >= 32)) keys = parsed.signingKeys as string[];
  } catch {
    keys = null;
  }
  if (!keys) {
    keys = [randomBytes(32).toString('base64url')];
    // The rest of the settings first: a configuration that is refused leaves nothing behind (the next good run still
    // says it made the key).
    try {
      parseConfig({ ...env, OA_SIGNING_KEYS: keys.join(',') });
    } catch {
      return env;
    }
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify({ signingKeys: keys }, null, 2)}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
    log(`Generated a signing key for this local host in ${file}.`);
  }
  return { ...env, OA_SIGNING_KEYS: keys.join(',') };
}

/** The config and Node settings from the environment (with a local signing key when needed). */
async function settings(env: Env, log: (line: string) => void): Promise<{ config: HostConfig; node: ReturnType<typeof parseNodeEnv>; env: Env }> {
  const node = parseNodeEnv(env);
  const filled = await withSigningKeys(env, node.dataDir, log);
  return { config: parseConfig(filled), node, env: filled };
}

/** The owner-key sign-in address with the key in the fragment (kept out of access logs). */
export function ownerSignInUrl(config: Pick<HostConfig, 'appOrigin'>, key: string): string {
  return `${config.appOrigin}${SIGN_IN_PATH}#key=${encodeURIComponent(key)}`;
}

async function serve(env: Env): Promise<void> {
  const log = (line: string): void => console.log(line);
  const { config, node, env: filled } = await settings(env, log);
  const internal = parseInternalEnv(filled);
  const { loaded, source } = await loadSitePlugins(filled, node.dataDir);
  const host = await startHost({ config, env: node, uiDir: uiDirOf(filled), trustProxy: filled.OA_TRUST_PROXY === '1', trashDays: parseTrashDays(filled), log, plugins: loaded, pluginEnv: filled });
  const frames = host.rooms.frames;
  const pageHostsOnDemand = parsePageHostOnDemand(filled);
  const ask = internal ? await startTlsAsk({ config, catalog: host.catalog, ...internal, log, pageHostsOnDemand, ...(frames ? { pageHost: (name: string) => frames.pageHostAllowed(name) } : {}) }) : null;
  log(`Open Artifact host ${HOST_VERSION} listening on ${host.listening}`);
  log(`  app:     ${config.appOrigin}`);
  log(`  content: ${config.contentOrigin}${config.contentSameSite ? ' (same site as the app: OA_CONTENT_SAME_SITE)' : ''}`);
  log(`  data:   ${node.dataDir}`);
  log(
    frames
      ? `  pages:   on (each page on its own host, ${pageHostSource(config).replace('*', '<id>--<opaque>')}; network: ${parsePageNetwork(filled)})`
      : '  pages:   off: page artifacts need an artifact domain of their own (OA_CONTENT_SAME_SITE puts both on one), so publishing one here is refused',
  );
  if (ask) {
    log(
      `  tls-ask: ${ask.listening}/tls-ask (internal; page hosts ${
        pageHostsOnDemand ? 'allowed (OA_PAGE_HOST_ON_DEMAND_TLS=true: their names reach the public Certificate Transparency logs)' : 'refused: serve page artifacts with a wildcard certificate for the content domain'
      })`,
    );
  }
  if (host.plugins) {
    const all = host.plugins.describe();
    log(`  plugins: ${all.filter((p) => p.enabled).map((p) => p.id).join(', ') || 'none running'} (from ${source.source})`);
  }
  if (host.ownerKey) {
    log('');
    log(`Sign in as the owner (shown this once; \`${CMD} owner-key\` makes a new one):`);
    log(`  ${ownerSignInUrl(config, host.ownerKey)}`);
  }
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: stopping…`);
    Promise.all([ask?.stop(), host.stop()]).then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

/** The user an imported artifact belongs to: `--owner <email>` (made when missing), else the owner-key owner. */
async function ownerFor(catalog: Catalog, config: HostConfig, email: string | undefined): Promise<string> {
  const ctx = { config, catalog, now: () => new Date(), log: () => undefined };
  if (email) {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw new ConfigError('--owner', `"${email}" is not an email address.`);
    const known = await catalog.findUserByEmail(address);
    // The operator names the address, so it counts as verified.
    return known?.id ?? (await catalog.createUser({ name: address, email: address, emailVerified: true })).id;
  }
  const identity = await catalog.findIdentity(OWNER_KEY_PROVIDER, OWNER_SUBJECT);
  if (identity) return identity.userId;
  const owner = config.owners[0];
  const user = await signInWith({ provider: OWNER_KEY_PROVIDER, subject: OWNER_SUBJECT, ...(owner ? { email: owner, emailVerified: true } : {}) }, ctx);
  return user.id;
}

/** A folder's artifact archive as bytes (what the Shell's "Download .zip" makes). */
async function zipOf(folder: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  await writeZip(await archiveEntries(folder), async (chunk) => {
    chunks.push(chunk);
  });
  return new Uint8Array(Buffer.concat(chunks));
}

async function importCommand(env: Env, args: string[]): Promise<void> {
  const log = (line: string): void => console.log(line);
  let source: string | undefined;
  let ownerEmail: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--owner') ownerEmail = args[++i];
    else if (args[i]!.startsWith('--owner=')) ownerEmail = args[i]!.slice('--owner='.length);
    else if (!source) source = args[i];
    else throw new ConfigError('import', `unexpected argument ${args[i]}.`);
  }
  if (!source) throw new ConfigError('import', `usage: ${CMD} import <folder|zip> [--owner <email>]`);
  const path = resolve(source);
  const info = await stat(path).catch(() => null);
  if (!info) throw new ConfigError('import', `${path} does not exist.`);
  const bytes = info.isDirectory() ? await zipOf(path) : new Uint8Array(await readFile(path));

  const { config, node } = await settings(env, log);
  const { catalog, driver } = await openCatalog(node.dataDir, config);
  try {
    const ownerUser = await ownerFor(catalog, config, ownerEmail);
    const id = newArtifactId();
    const root = join(node.dataDir, 'artifacts', id);
    let imported: { type: string; title: string };
    try {
      // A page artifact (told by its .artifact.json) only where pages run: an artifact domain of their own.
      const pages = !config.contentSameSite;
      // A published type's artifact too (by its .artifact.json type and typeUid), where pages run.
      const siteTypes = pages ? nodeSiteTypes({ dataDir: node.dataDir, driver }) : null;
      await siteTypes?.load();
      imported = await importInto(root, id, bytes, { pages, siteTypes });
      if (!isTypeName(imported.type) && !(pages && (imported.type === PAGE_TYPE || siteTypes?.row(imported.type)))) throw new ConfigError('import', `the ${imported.type} type is not installed on this host.`);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
    const row = await catalog.createArtifact({ id, type: imported.type, title: imported.title.slice(0, 200) || 'Untitled', ownerUser });
    await catalog.appendAudit({ actorKind: 'system', artifactId: id, action: 'artifact.import', detail: { type: row.type, from: path } });
    log(`Imported "${row.title}" (${row.type}) as ${row.id}`);
    log(`  ${config.appOrigin}/a/${row.id}`);
  } finally {
    driver.close();
  }
}

async function ownerKeyCommand(env: Env): Promise<void> {
  const log = (line: string): void => console.log(line);
  const { config, node } = await settings(env, log);
  if (config.ownerKey) throw new ConfigError('OA_OWNER_KEY', 'is set: the owner key comes from the environment; change it there.');
  if (!config.auth.some((auth) => auth.kind === 'owner-key')) throw new ConfigError('OA_AUTH', 'has no owner-key sign-in on this host.');
  const { catalog, driver } = await openCatalog(node.dataDir, config);
  try {
    await catalog.deleteSite(OWNER_KEY_HASH);
    await catalog.deleteSite(OWNER_KEY_ATTEMPTS);
    const key = await ensureOwnerKey({ config, catalog, now: () => new Date(), log: () => undefined });
    if (!key) throw new Error('No owner key was made.');
    await catalog.appendAudit({ actorKind: 'system', action: 'auth.owner_key_replaced' });
    log('A new owner key replaces the old one. Sign in as the owner at:');
    log(`  ${ownerSignInUrl(config, key)}`);
  } finally {
    driver.close();
  }
}

/** The arguments of `link-token`: `--name value` or `--name=value`. */
function options(args: string[], names: readonly string[], command: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const name = names.find((n) => arg === `--${n}` || arg.startsWith(`--${n}=`));
    if (!name) throw new ConfigError(command, `unexpected argument ${arg}.`);
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
    if (!value) throw new ConfigError(command, `--${name} needs a value.`);
    out[name] = value;
  }
  return out;
}

/**
 * `link-token --user <email> [--label <text>]`: mints a Link refresh token for a person (made when missing, as
 * `import --owner` does), so a computer's daemon can be preset to sign in without a browser
 * (`OPEN_ARTIFACT_REMOTE_TOKEN`). The token is printed once, never stored in clear and never logged; it rotates on
 * first use, and the daemon's sign-in shows in the person's agent tokens, where it can be revoked.
 * `link-token --revoke <id>` revokes one. Both are written to the audit log (without the token).
 */
async function linkTokenCommand(env: Env, args: string[]): Promise<void> {
  const usage = `usage: ${CMD} link-token --user <email> [--label <text>] | --revoke <id>`;
  const given = options(args, ['user', 'label', 'revoke'], 'link-token');
  if (!given.revoke && !given.user) throw new ConfigError('link-token', usage);
  if (given.revoke && (given.user || given.label)) throw new ConfigError('link-token', usage);
  const log = (line: string): void => console.log(line);
  const { config, node } = await settings(env, () => undefined);
  const { catalog, driver } = await openCatalog(node.dataDir, config);
  try {
    if (given.revoke) {
      const token = await catalog.getAgentToken(given.revoke);
      if (!token || !token.scopes.includes(LINK_SCOPE)) throw new ConfigError('link-token', `no Link token ${given.revoke}.`);
      if (token.revokedAt) return log(`${token.id} was already revoked.`);
      await catalog.revokeAgentToken(token.id);
      await catalog.appendAudit({ actorKind: 'system', action: 'link.token_revoked', detail: { tokenId: token.id, userId: token.userId } });
      return log(`Revoked ${token.id}: the computer that used it is signed out.`);
    }
    const address = given.user!.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw new ConfigError('--user', `"${given.user}" is not an email address.`);
    const known = await catalog.findUserByEmail(address);
    const userId = known?.id ?? (await catalog.createUser({ name: address, email: address, emailVerified: true })).id;
    const label = (given.label ?? 'Preset link token').slice(0, 100);
    const issued = await catalog.issueAgentToken({ userId, label, harness: null, scopes: [LINK_SCOPE], accessTtlMs: LINK_ACCESS_TTL_MS, refreshTtlMs: LINK_REFRESH_TTL_MS });
    await catalog.appendAudit({ actorKind: 'system', actorId: userId, action: 'link.token_issued', detail: { tokenId: issued.token.id, label, userId } });
    log(`A Link token for ${address} (${issued.token.id}) on the site at ${config.appOrigin}. It is shown this once; set it on the computer as`);
    log(`  OPEN_ARTIFACT_REMOTE=${config.appOrigin}`);
    log(`  OPEN_ARTIFACT_REMOTE_TOKEN=${issued.refreshToken}`);
    // The address is this command's own environment's: without OA_APP_ORIGIN it is the default, which is the server's
    // only when the server runs without it too.
    if (!env.OA_APP_ORIGIN?.trim()) {
      log(`OA_APP_ORIGIN is not set here, so ${config.appOrigin} is only the default address, not necessarily the server's.`);
      log('Run this command with the same environment as the server (with Docker: `docker compose exec host …`), or replace');
      log('OPEN_ARTIFACT_REMOTE above with the address people open the site at.');
    }
    log(`It is good for one sign-in within ${Math.round(LINK_REFRESH_TTL_MS / 86_400_000)} days. Revoke it: ${CMD} link-token --revoke ${issued.token.id}`);
  } finally {
    driver.close();
  }
}

/**
 * `audit [--artifact <id>] [--actor <id>] [--action <prefix>] [--before <time or next>] [--limit <n>] [--json]`: the
 * audit log, newest first (as `GET /api/open-artifact.admin.audit` answers a site admin). One line per entry, or the
 * page as JSON with `--json`; `next` (when more follow) goes in `--before` for the next page.
 */
async function auditCommand(env: Env, args: string[]): Promise<void> {
  const asJson = args.includes('--json');
  const given = options(args.filter((a) => a !== '--json'), ['artifact', 'actor', 'action', 'before', 'limit'], 'audit');
  if (given.limit !== undefined && !/^\d+$/.test(given.limit)) throw new ConfigError('--limit', 'is a whole number.');
  const { config, node } = await settings(env, () => undefined);
  const { catalog, driver } = await openCatalog(node.dataDir, config);
  try {
    let page: AuditPage;
    try {
      page = await auditPage(catalog, { ...given, ...(given.limit !== undefined ? { limit: Number(given.limit) } : {}) });
    } catch (error) {
      if (error instanceof OpenArtifactError) throw new ConfigError('audit', error.message);
      throw error;
    }
    if (asJson) return console.log(JSON.stringify(page, null, 2));
    if (page.entries.length === 0) return console.log('No audit entries match.');
    for (const entry of page.entries) {
      const actor = entry.actorId ? `${entry.actorKind}:${entry.actorId}` : entry.actorKind;
      const detail = entry.detail === null || entry.detail === undefined ? '' : `  ${JSON.stringify(entry.detail)}`;
      console.log(`${entry.at}  ${entry.action}  ${actor}${entry.artifactId ? `  ${entry.artifactId}` : ''}${detail}`);
    }
    if (page.next) console.log(`More: ${CMD} audit --before '${page.next}'${[...Object.entries(given)].filter(([k]) => k !== 'before').map(([k, v]) => ` --${k} ${v}`).join('')}`);
  } finally {
    driver.close();
  }
}

/** One plugin as `plugin list` prints it: `on`, `off` (disabled in the list) or `failed` with why. */
export function describePlugin(plugin: PluginDescription): string[] {
  const head = `${plugin.state.padEnd(6)}  ${plugin.id}${plugin.version ? ` ${plugin.version}` : ''}  (${plugin.use})`;
  const lines = [head];
  const pad = '        ';
  if (plugin.name !== plugin.id) lines.push(`${pad}${plugin.name}`);
  if (plugin.hooks.length > 0) lines.push(`${pad}hooks: ${plugin.hooks.join(', ')}`);
  if (plugin.settings.length > 0) lines.push(`${pad}settings: ${plugin.settings.join(', ')}`);
  for (const problem of plugin.problems) lines.push(`${pad}! ${problem}`);
  return lines;
}

/**
 * `plugin list` and `plugin check`: loads the list and checks every plugin as the host would at start-up (settings
 * from this environment). `check` fails (exit 1) when the host would not start; `list` only shows.
 */
async function pluginShow(env: Env, check: boolean): Promise<void> {
  const log = (line: string): void => console.log(line);
  const { config, node, env: filled } = await settings(env, () => undefined);
  const { loaded, source } = await loadSitePlugins(filled, node.dataDir);
  if (loaded.length === 0) {
    log(`No plugins (${source.text === undefined ? `no OA_PLUGINS and no ${source.source}` : `the list in ${source.source} is empty`}).`);
    return;
  }
  const { catalog, driver } = await openCatalog(node.dataDir, config);
  try {
    const services = pluginServices({ catalog, config, version: HOST_VERSION, invalidateAccess: async () => undefined });
    const quiet: string[] = [];
    let described: PluginDescription[];
    let failure: PluginConfigError | null = null;
    try {
      const plugins = createPlugins({ plugins: loaded, env: filled, services, log: (line) => quiet.push(line) });
      described = plugins.describe();
    } catch (error) {
      if (!(error instanceof PluginConfigError)) throw error;
      failure = error;
      // Every plugin on its own, so the list still shows what each one is.
      described = loaded.map(({ entry, plugin, loadError }) => {
        try {
          return createPlugins({ plugins: [{ entry: { ...entry, optional: true }, ...(plugin !== undefined ? { plugin } : {}), ...(loadError !== undefined ? { loadError } : {}) }], env: filled, services, log: () => undefined }).describe()[0]!;
        } catch {
          return { id: entry.use, use: entry.use, name: entry.use, version: null, apiVersion: null, enabled: false, state: 'failed' as const, hooks: [], settings: [], problems: [] };
        }
      });
    }
    log(`Plugins from ${source.source}:`);
    for (const plugin of described) for (const line of describePlugin(plugin)) log(`  ${line}`);
    if (failure) {
      if (!check) log('');
      log(`The host would not start: ${failure.message}`);
      if (check) process.exitCode = 1;
    } else if (check) {
      log(`All ${described.filter((p) => p.enabled).length} plugin(s) that are on can run.`);
    }
  } finally {
    driver.close();
  }
}

/**
 * `plugin role <artifact id> --as <email> [--json]`: the role that person has on the artifact, or would have once they
 * sign in, and what decided it: the host's own rule, then each plugin's `authz.role` (run with this environment's
 * settings, as the host runs them). The site admin's `GET /api/open-artifact.admin.access` answers the same.
 */
async function pluginRole(env: Env, args: string[]): Promise<void> {
  const asJson = args.includes('--json');
  const rest = args.filter((a) => a !== '--json');
  const artifactId = rest[0] && !rest[0].startsWith('--') ? rest.shift() : undefined;
  const given = options(rest, ['as'], 'plugin role');
  const usage = `usage: ${CMD} plugin role <artifact id> --as <email> [--json]`;
  if (!artifactId || !given.as) throw new ConfigError('plugin role', usage);
  if (!/^[^\s@]+@[^\s@]+$/.test(given.as.trim())) throw new ConfigError('--as', `"${given.as}" is not an email address.`);
  const { config, node, env: filled } = await settings(env, () => undefined);
  const { loaded } = await loadSitePlugins(filled, node.dataDir);
  const { catalog, driver } = await openCatalog(node.dataDir, config);
  try {
    const services = pluginServices({ catalog, config, version: HOST_VERSION, invalidateAccess: async () => undefined });
    const plugins = loaded.length > 0 ? createPlugins({ plugins: loaded, env: filled, services, log: (line) => console.error(line) }) : undefined;
    const answer = await explainAccess({ catalog, config, ...(plugins ? { plugins } : {}) }, artifactId, given.as);
    if (!answer) throw new ConfigError('plugin role', `there is no artifact ${artifactId} on this host.`);
    console.log(asJson ? JSON.stringify(answer, null, 2) : accessExplanationText(answer));
  } finally {
    driver.close();
  }
}

async function pluginCommand(env: Env, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case 'list':
      return pluginShow(env, false);
    case 'check':
      return pluginShow(env, true);
    case 'role':
      return pluginRole(env, rest);
    case 'add':
    case 'remove':
    case 'enable':
    case 'disable':
    case 'set':
    case 'unset': {
      for (const line of await changePluginList(env, dataDirOf(env), sub, rest, { as: CMD })) console.log(line);
      return;
    }
    default:
      throw new ConfigError('plugin', `unknown command ${sub} (list, check, role, add, remove, enable, disable, set, unset).`);
  }
}

/** Runs the command line. */
export async function main(argv: string[] = process.argv.slice(2), env: Env = process.env): Promise<void> {
  const [command = 'serve', ...rest] = argv;
  switch (command) {
    case 'serve':
      return serve(env);
    case 'import':
      return importCommand(env, rest);
    case 'owner-key':
      return ownerKeyCommand(env);
    case 'link-token':
      return linkTokenCommand(env, rest);
    case 'plugin':
    case 'plugins':
      return pluginCommand(env, rest);
    case 'audit':
      return auditCommand(env, rest);
    case '--version':
    case 'version':
      console.log(HOST_VERSION);
      return;
    case '--help':
    case 'help':
      console.log(`usage: ${CMD} [serve] | import <folder|zip> [--owner <email>] | owner-key | link-token --user <email> [--label <text>] | link-token --revoke <id> | audit [--artifact <id>] [--actor <id>] [--action <prefix>] [--before <time>] [--limit <n>] [--json] | plugin list|check|role|add|remove|enable|disable|set|unset`);
      return;
    default:
      throw new ConfigError('command', `unknown command ${command} (serve, import, owner-key, link-token, audit, plugin).`);
  }
}

/** Whether this module is the program being run (directly, or through the `open-artifact-host` bin link). */
function isMain(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((error: unknown) => {
    if (error instanceof ConfigError || error instanceof PluginConfigError) console.error(`open-artifact-host: ${error.message}`);
    else console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
}
