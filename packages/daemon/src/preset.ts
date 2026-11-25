/**
 * Install-time cloud presets: what a plugin install, a managed machine or a container sets so the daemon links to a
 * site and publishes there without a person at the keyboard.
 *
 * | Variable (and `preset.json` key) | What it presets |
 * |---|---|
 * | `OPEN_ARTIFACT_REMOTE` | the site's address: a remote with it is added at start (once) and made the default |
 * | `OPEN_ARTIFACT_REMOTE_NAME` | that remote's name (default: from the host name, `oa.example.com` -> `oa`) |
 * | `OPEN_ARTIFACT_REMOTE_TOKEN` | a Link refresh token (`open-artifact-host link-token`): signs in with no browser approval |
 * | `OPEN_ARTIFACT_PUBLISH` | `auto` or `manual`: `settings.cloud.publish` when `settings.json` does not set it |
 * | `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP` | `1`: allow plain http for a host name that is not on a private network |
 *
 * A plugin's own setting arrives as `OPEN_ARTIFACT_PLUGIN_REMOTE` (the Claude Code plugin maps its `remote` setting to
 * it, the Cursor plugin its `OPEN_ARTIFACT_SERVER` variable, so it never hides an `OPEN_ARTIFACT_REMOTE` the shell
 * exports): used when `OPEN_ARTIFACT_REMOTE` is unset. A value that is still a `${…}` placeholder counts as unset.
 *
 * `<OPEN_ARTIFACT_HOME>/preset.json` takes the same keys, for installs that cannot set the environment; it is read once,
 * when the daemon starts. Precedence, highest first: what a person set (`settings.json`, `remotes.json`), then the
 * environment, then `preset.json`, then the defaults. A preset never undoes a person's change: a preset remote the person
 * removed is not added again (the remotes file remembers which addresses presets added), a token that was used once
 * is never sent again (only its hash is kept), and `settings.json`'s `cloud.publish` wins over both.
 *
 * Secrets: a token in the environment can be read by other processes of the same user (and by whatever starts the
 * daemon), so `preset.json` with mode 0600 (owner only) is the better home for one; a `preset.json` holding a token
 * that group or others can read is still used, but the daemon says so in its log ({@link CloudPreset.warning}).
 * `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP` belongs to the address it came with: a `preset.json` flag does not relax the
 * check for an address the environment gives.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import type { CloudPublishMode } from '@open-artifact/protocol';
import { files, readJson } from './paths.ts';

/** The presets in effect (environment over `preset.json`). Never logged whole: `token` is a secret. */
export interface CloudPreset {
  /** The site's address as given (checked when it is used). */
  remote?: string;
  name?: string;
  token?: string;
  publish?: CloudPublishMode;
  insecureHttp?: boolean;
  /** Something wrong with how the preset is kept (a token in a file others can read), for the daemon's log. No secret. */
  warning?: string;
}

/** The preset keys, as environment variables and `preset.json` keys. */
export const PRESET_KEYS = {
  remote: 'OPEN_ARTIFACT_REMOTE',
  name: 'OPEN_ARTIFACT_REMOTE_NAME',
  token: 'OPEN_ARTIFACT_REMOTE_TOKEN',
  publish: 'OPEN_ARTIFACT_PUBLISH',
  insecureHttp: 'OPEN_ARTIFACT_REMOTE_INSECURE_HTTP',
} as const;

/**
 * A value an app left as written because nothing filled it in: Cursor passes an unset plugin variable or
 * `${env:NAME}` on to the MCP server as the literal `${…}` text (checked with cursor-agent 2026.11.13).
 */
const UNFILLED = /^\$\{[^}]*\}$/;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() && !UNFILLED.test(value.trim()) ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;

const yes = (value: string | undefined): boolean | undefined => (value === undefined ? undefined : /^(1|true|yes|on)$/i.test(value));

const mode = (value: string | undefined): CloudPublishMode | undefined => (value === 'auto' || value === 'manual' ? value : undefined);

/** A plugin setting's address, below {@link PRESET_KEYS}`.remote` (the environment only). */
export const PLUGIN_REMOTE_KEY = 'OPEN_ARTIFACT_PLUGIN_REMOTE';

/** One source's presets (the environment, or `preset.json`'s object). Empty values count as unset. */
function presetFrom(source: Record<string, unknown>, plugin = false): CloudPreset {
  const get = (key: keyof typeof PRESET_KEYS): string | undefined => text(source[PRESET_KEYS[key]]);
  const out: CloudPreset = {};
  const remote = get('remote') ?? (plugin ? text(source[PLUGIN_REMOTE_KEY]) : undefined);
  if (remote) out.remote = remote;
  const name = get('name');
  if (name) out.name = name;
  const token = get('token');
  if (token) out.token = token;
  const publish = mode(get('publish')?.toLowerCase());
  if (publish) out.publish = publish;
  const insecure = yes(get('insecureHttp'));
  if (insecure !== undefined) out.insecureHttp = insecure;
  return out;
}

/**
 * The presets: each key from the environment when set there, else from `<home>/preset.json`. A broken or missing file
 * is no preset. `name` and `token` belong to the `remote` they came with: a file's token is not paired with the
 * environment's address.
 */
export function readPreset(env: NodeJS.ProcessEnv = process.env): CloudPreset {
  const fromEnv = presetFrom(env, true);
  const raw = readJson<unknown>(files.preset(), null);
  const fromFile = raw && typeof raw === 'object' && !Array.isArray(raw) ? presetFrom(raw as Record<string, unknown>) : {};
  const site = fromEnv.remote ? { remote: fromEnv.remote, name: fromEnv.name, token: fromEnv.token } : { remote: fromFile.remote, name: fromFile.name, token: fromFile.token };
  const out: CloudPreset = {};
  if (site.remote) out.remote = site.remote;
  if (site.remote && site.name) out.name = site.name;
  if (site.remote && site.token) out.token = site.token;
  const publish = fromEnv.publish ?? fromFile.publish;
  if (publish) out.publish = publish;
  // The file's flag is for the file's address: it does not relax the check for an address from the environment.
  const insecure = fromEnv.insecureHttp ?? (fromEnv.remote ? undefined : fromFile.insecureHttp);
  if (insecure !== undefined) out.insecureHttp = insecure;
  const loose = fromFile.token ? readableByOthers(files.preset()) : null;
  if (loose !== null) {
    out.warning = `${files.preset()} holds a token and can be read by other users (mode ${loose.toString(8).padStart(3, '0')}): make it owner-only (chmod 600)`;
  }
  return out;
}

/** The permission bits of a file that group or others may read (`0o644` & `0o077`), or `null` (owner only, Windows, no file). */
function readableByOthers(path: string): number | null {
  if (process.platform === 'win32') return null; // no POSIX modes: the folder's ACL decides
  try {
    const mode = statSync(path).mode & 0o777;
    return mode & 0o044 ? mode : null;
  } catch {
    return null;
  }
}

/** What the remotes file keeps of a preset token: its hash, so the same token is never sent twice. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
