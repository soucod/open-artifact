/**
 * The skill a harness installs for its agent, and its command menu.
 *
 * `installSkill` writes `<dir>/<command>/SKILL.md`: the daemon's rendering for this harness (`skill.get`) when it has
 * the feature, else the template this kit carries (without the installed types). The file says which runtime wrote it
 * (`generated-by: open-artifact <version>`) and its `etag`; it is written again only when the etag changes, and a file
 * Open Artifact did not write stays unless `force`. {@link keepSkillInstalled} runs it again after a reconnect to
 * another runtime. `commands` lists one command per installed type (`commands.list`): their starting prompts go into
 * the person's input box, never sent by themselves.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  OpenArtifactError,
  SKILL_ARGUMENT_HINT,
  SKILL_COMMAND,
  SKILL_COMMAND_NAME,
  SKILL_GENERATED_BY,
  renderSkillBody,
  renderedSkillFile,
  skillDescription,
  skillFileKey,
  skillTypesSection,
  type CommandEntry,
  type SkillParams,
  type SkillResult,
} from '@open-artifact/protocol';
import type { HarnessClient, HarnessConnectionState } from './client.ts';
import pkg from '../package.json' with { type: 'json' };

/** What {@link installSkill} takes. */
export interface InstallSkillOptions extends Omit<SkillParams, 'command'> {
  /** The folder the harness reads skills from (the skill goes in `<dir>/<command>/`). */
  dir: string;
  /** The command, without the slash (default `open-artifact`). */
  command?: string;
  /** Replace a SKILL.md there that Open Artifact did not write. */
  force?: boolean;
}

/** What {@link installSkill} did. */
export interface InstallSkillResult {
  file: string;
  /** false: the file there already had this etag. */
  written: boolean;
  etag: string;
  /** The runtime that rendered it (the kit's own version when rendered here). */
  version: string;
  /** `daemon`: `skill.get`; `kit`: the template this kit carries (the daemon is not there or lacks the feature). */
  source: 'daemon' | 'kit';
}

/** The skill rendered by the kit itself, for a daemon without `skill.get`: no installed types, no harness profile. */
export function localSkill(options: Omit<InstallSkillOptions, 'dir' | 'force'>): SkillResult {
  const name = options.command || SKILL_COMMAND;
  const render = {
    command: name,
    ...(options.agentName ? { agentName: options.agentName } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.toolNames ? { toolNames: options.toolNames } : {}),
    ...(options.opens ? { opens: options.opens } : {}),
    // The kit's skill is not in the daemon's skill folder, so the command line is the one on the PATH.
    cli: 'open-artifact',
  };
  const body = `${renderSkillBody(render, options.form ?? 'full')}\n\n${skillTypesSection(null)}`;
  const description = skillDescription(render);
  const etag = createHash('sha256').update(JSON.stringify([name, description, SKILL_ARGUMENT_HINT, body, null])).digest('hex').slice(0, 16);
  return { name, description, argumentHint: SKILL_ARGUMENT_HINT, body, version: (pkg as { version?: string }).version ?? '0.0.0', etag };
}

/**
 * The skill for this harness without writing it anywhere, for a harness that hands skills to its agent itself: the
 * daemon's rendering (`skill.get`) when connected to one that has it, else this kit's ({@link localSkill}).
 */
export async function renderSkill(client: HarnessClient | null, params: Omit<InstallSkillOptions, 'dir' | 'force'>): Promise<{ skill: SkillResult; source: InstallSkillResult['source'] }> {
  if (params.command !== undefined && !SKILL_COMMAND_NAME.test(params.command)) {
    throw new OpenArtifactError('invalid_argument', 'command: lowercase letters, digits, - and _ (at most 32), without the slash.');
  }
  if (client?.connected && client.features.includes('skill.get')) return { skill: await client.request('skill.get', params), source: 'daemon' };
  return { skill: localSkill(params), source: 'kit' };
}

/** Writes the skill where the harness reads skills, when its etag changed. */
export async function installSkill(client: HarnessClient | null, options: InstallSkillOptions): Promise<InstallSkillResult> {
  const { dir, force, ...params } = options;
  const { skill, source } = await renderSkill(client, params);
  const folder = join(resolve(dir), skill.name);
  const file = join(folder, 'SKILL.md');
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    if (!force && !skillFileKey(text, SKILL_GENERATED_BY)) {
      throw new OpenArtifactError('conflict', `${file} was not written by Open Artifact: it stays.`, { fix: 'Pass force: true to replace it, or another dir or command.' });
    }
    if (skillFileKey(text, 'etag') === skill.etag) return { file, written: false, etag: skill.etag, version: skill.version, source };
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, renderedSkillFile(skill));
  return { file, written: true, etag: skill.etag, version: skill.version, source };
}

/**
 * {@link installSkill} now, and again whenever the connection comes back to a runtime of another version (or to one
 * that renders it, after the kit's own). `onState` registers a state listener and returns its remover. Returns the
 * first result and a function that stops.
 */
export async function keepSkillInstalled(
  client: HarnessClient,
  options: InstallSkillOptions,
  onState: (listener: (state: HarnessConnectionState) => void) => () => void,
  log: (line: string) => void = () => undefined,
): Promise<{ result: InstallSkillResult; stop: () => void }> {
  const result = await installSkill(client, options);
  let last = `${result.source}:${client.hello?.daemon ?? ''}`;
  const stop = onState((state) => {
    if (state !== 'connected') return;
    const now = `${client.features.includes('skill.get') ? 'daemon' : 'kit'}:${client.hello?.daemon ?? ''}`;
    if (now === last) return;
    last = now;
    installSkill(client, options).then(
      (again) => again.written && log(`open-artifact: ${again.file} rewritten for runtime ${again.version}`),
      (error: Error) => log(`open-artifact skill: ${error.message}`),
    );
  });
  return { result, stop };
}

/** The command menu: one entry per installed type (`[]` from a daemon without `commands.list`). */
export async function commands(client: HarnessClient | null, options: { command?: string; locale?: string } = {}): Promise<CommandEntry[]> {
  if (!client?.connected || !client.features.includes('commands.list')) return [];
  const answer = await client.request('commands.list', options);
  return Array.isArray(answer?.commands) ? answer.commands : [];
}
