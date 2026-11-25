/**
 * The Open Artifact tools, registered in the agent's own tool registry (`caps.tools: 'native'`).
 *
 * `oa.tools()` gives the definitions — the daemon's when connected, else the ones the kit carries — and each call goes
 * back through `oa.call` with the session as the caller, so the daemon knows who made the artifact (that session owns
 * it, and its comments wake that session).
 */
import { callerOf } from './harness.mjs';

/** Registers every tool for one session; returns the names registered. */
export async function registerTools(oa, agent) {
  const definitions = await oa.tools();
  for (const tool of definitions) {
    agent.register(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      run: (args) => oa.call(tool.name, args, callerOf(agent)),
    });
  }
  return definitions.map((tool) => tool.name);
}

/**
 * The agent wrote files with its own file tools (not through Open Artifact): say so, so pages showing them reload and
 * the artifact's change reaches `on('artifact')`. Paths are absolute.
 */
export function reportWrites(oa, agent, paths) {
  return oa.wrote(paths, callerOf(agent));
}
