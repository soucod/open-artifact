/**
 * The runtime capabilities of a frame page, and how a `page` artifact declares them: `Artifact` publish's
 * `capabilities` argument, kept in the artifact's record and `.artifact.json` (never in the page, which can rewrite
 * itself). Shared by frame-host, which grants them, and the daemon, which checks and stores them.
 */

/** Capabilities frame-host backs on this computer; a declared one is granted. `artifact` and `permissions` always are. */
export const FRAME_BACKED_CAPABILITIES: readonly string[] = Object.freeze(['db', 'artifact', 'assets', 'downloads', 'comments', 'user', 'room', 'permissions', 'network']);

/** Declared capabilities that answer, but only with this error code: nothing on this computer can serve them. */
export const FRAME_STUBBED_CAPABILITIES: Readonly<Record<string, string>> = Object.freeze({
  mcp: 'server_not_connected',
  sample: 'tools_unavailable',
  tts: 'capability_disabled',
  paste: 'capability_disabled',
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * What is wrong with a `capabilities` argument, or null: an object of `{name: true | false | {options}}`, as a page's
 * own declaration would be. Names are not checked here: one nothing serves only gets a note.
 */
export function capabilitiesProblem(value: unknown): string | null {
  if (!isObject(value)) return 'capabilities: an object such as {"db": true, "assets": true}; {} declares none.';
  for (const [name, config] of Object.entries(value)) {
    if (typeof config !== 'boolean' && !isObject(config)) return `capabilities.${name}: true, or an object of its options.`;
  }
  return null;
}

/** The capabilities a declaration turns on: its names whose value is not `false`. */
export function declaredCapabilities(value: Record<string, unknown> | null | undefined): Record<string, true | Record<string, unknown>> {
  const out: Record<string, true | Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(isObject(value) ? value : {})) {
    if (config === true) out[name] = true;
    else if (isObject(config)) out[name] = config;
  }
  return out;
}
