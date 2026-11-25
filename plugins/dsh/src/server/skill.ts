/**
 * The `/open-artifact` skill. A person types `/open-artifact slides a deck about our Q3 results` (or a tile of the Open
 * Artifact page puts it in a new session's input): DSH loads a user-invocable skill whose name is a `/name` word of
 * what the person sends. Its text is the daemon's rendering for DSH (`skill.get`, which ends with the types installed
 * now), else the kit's own (`renderSkill` falls back to it while the daemon is away or older).
 *
 * The candidate's `path` still names a real file: the build writes `skills/open-artifact/SKILL.md` from the protocol's
 * template ({@link SKILL_RENDER}, no installed types), a build output git ignores. The registry reads the skill through
 * `get`, which renders it fresh each time; the file is there for whatever reads the `path` itself.
 */
import { join, sep } from 'node:path';
import type { DshSkillCandidate, DshSkillProvider } from './dsh.ts';

/** The skill's name: the `/open-artifact` word. */
export const SKILL_NAME = 'open-artifact';

/** How the skill is rendered for DSH (with the config's `agentName` added at run time; the build's file says `Agent`). */
export const SKILL_RENDER = { command: SKILL_NAME, tools: 'native', opens: 'host' } as const;

/** The SKILL.md the build writes and the candidate's `path` names, under the plugin folder. */
export const skillFile = (packageRoot: string): string => join(packageRoot, 'skills', SKILL_NAME, 'SKILL.md');
/** The registry's rank for packaged skills (`BUNDLED_SKILL_RANK` in @deepseek-ai/dsh-skill). */
export const BUNDLED_SKILL_RANK = 600;

/** A rendered skill, as far as the provider reads one. */
export interface RenderedSkill {
  description: string;
  body: string;
}

/** Options of {@link skillProvider}. */
export interface SkillProviderOptions {
  /** The plugin folder: the candidate's `path` and `resourceBase` are under it. */
  packageRoot: string;
  /** Renders the skill now (the daemon's, else the kit's). */
  render(signal?: AbortSignal): Promise<RenderedSkill>;
  /** The description listed before any rendering (the kit's). */
  description: string;
  /** The provider's name in the registry. */
  provider?: string;
}

/**
 * The skill provider DSH's skill registry takes. The candidate's `path` is the SKILL.md the build wrote; the registry
 * reads the skill through `get`, which renders it each time, so the types it lists are the ones installed now.
 */
export function skillProvider({ packageRoot, render, description, provider = 'dsh-open-artifact' }: SkillProviderOptions): DshSkillProvider {
  const directory = join(packageRoot, 'skills', SKILL_NAME);
  let listed = description;
  const candidate = (): DshSkillCandidate => ({
    name: SKILL_NAME,
    description: listed,
    invocation: { modelInvocable: false, userInvocable: true },
    provider,
    source: 'bundled',
    rank: BUNDLED_SKILL_RANK,
    path: skillFile(packageRoot),
    resourceBase: { kind: 'directory', path: directory.split(sep).join('/') },
  });
  return {
    name: provider,
    list: () => Promise.resolve([candidate()]),
    async get(asked, options) {
      const skill = await render(options?.signal);
      listed = skill.description || listed;
      const { rank: _rank, ...summary } = asked.name === SKILL_NAME ? asked : candidate();
      return { ...summary, description: listed, content: `${skill.body.trim()}\n` };
    },
  };
}
