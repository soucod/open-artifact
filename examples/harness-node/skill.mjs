/**
 * The skill and the commands: the agent learns how to use Open Artifact from a SKILL.md the daemon renders for this
 * harness (with the installed types), written into the folder the app reads skills from — again whenever it changes.
 * `commands()` lists one entry per installed type for the app's command menu (`/open-artifact slides`, …).
 */

/** Installs the skill into `<dir>/open-artifact/SKILL.md`; returns what happened and the command menu. */
export async function installSkill(oa, dir) {
  const result = await oa.installSkill({ dir, agentName: 'Example', tools: 'native', opens: 'link' });
  const commands = await oa.commands().catch(() => []);
  return { ...result, commands };
}
