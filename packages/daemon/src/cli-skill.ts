/**
 * `open-artifact skill render | install`: the `/open-artifact` skill rendered for a harness, without a daemon.
 *
 *   open-artifact skill render [--command X] [--harness H] [--form entry|full] [--workspace D] [--json]
 *   open-artifact skill install --command X --dir D [--harness H] [--form entry|full] [--workspace D] [--force]
 *
 * Both render what `skill.get` answers that harness (its profile's command, agent name, tools, rules…; the installed
 * types after it). `install` writes `<D>/<X>/SKILL.md`, and only when its `etag` changed; a SKILL.md there that Open
 * Artifact did not write stays, unless `--force`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenArtifactError, SKILL_COMMAND_NAME, SKILL_GENERATED_BY, renderedSkillFile, skillFileKey, type SkillParams, type SkillResult } from '@open-artifact/protocol';
import pkg from '../package.json' with { type: 'json' };
import { skillFor } from './harness-skill.ts';
import { loadSettings } from './settings.ts';
import { TypeRegistry } from './types.ts';

/** The runtime's version, as `skill.get` says it. */
const VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

/** What `skill render | install` take. */
export interface SkillCliOptions {
  command?: string;
  harness?: string;
  form?: string;
  workspace?: string;
  /** How the agent runs the command line (default: this runtime's own launcher). */
  cli?: string;
}

/** The skill for a harness, rendered here: the installed types of `workspace` after it. */
export function renderSkillFor(options: SkillCliOptions): SkillResult {
  const form = options.form ?? 'full';
  if (form !== 'full' && form !== 'entry') throw new OpenArtifactError('invalid_argument', '--form entry | full');
  const registry = new TypeRegistry(loadSettings);
  try {
    const harness = options.harness || 'cli';
    const workspace = resolve(options.workspace ?? process.cwd());
    const params: Partial<SkillParams> = { form, ...(options.command ? { command: options.command } : {}) };
    return skillFor(params, {
      harness,
      caller: { harness, session: null, workspace },
      version: VERSION,
      ...(options.cli ? { cli: options.cli } : {}),
      tools: { skillCatalog: (ws: string | null) => ({ types: registry.list(ws), offers: [...(loadSettings().offers ?? [])] }) },
    });
  } finally {
    registry.close();
  }
}

/** Writes `<dir>/<command>/SKILL.md` when its etag changed. */
export function installSkillFile(options: SkillCliOptions & { dir: string; force?: boolean }): { file: string; written: boolean; etag: string; reason?: 'unchanged' } {
  if (!options.command || !SKILL_COMMAND_NAME.test(options.command)) {
    throw new OpenArtifactError('invalid_argument', '--command <name>: lowercase letters, digits, - and _, without the slash.');
  }
  const skill = renderSkillFor(options);
  const folder = join(resolve(options.dir), skill.name);
  const file = join(folder, 'SKILL.md');
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    if (!options.force && !skillFileKey(text, SKILL_GENERATED_BY)) {
      throw new OpenArtifactError('conflict', `${file} was not written by Open Artifact: it stays.`, { fix: 'Pass --force to replace it, or choose another --dir or --command.' });
    }
    if (skillFileKey(text, 'etag') === skill.etag) return { file, written: false, etag: skill.etag, reason: 'unchanged' };
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, renderedSkillFile(skill));
  return { file, written: true, etag: skill.etag };
}

/** `open-artifact skill <sub>`; `flag` takes `--name <value>` out of the arguments, `has` a bare `--name`. */
export function skillCommand(sub: string | undefined, flag: (name: string) => string | undefined, has: (name: string) => boolean): string {
  const options: SkillCliOptions = { command: flag('command'), harness: flag('harness'), form: flag('form'), workspace: flag('workspace') };
  switch (sub) {
    case 'render': {
      const skill = renderSkillFor(options);
      return has('json') ? JSON.stringify(skill, null, 2) : renderedSkillFile(skill).replace(/\n$/, '');
    }
    case 'install': {
      const dir = flag('dir');
      if (!dir) throw new OpenArtifactError('invalid_argument', 'skill install --command <name> --dir <skills folder>');
      const done = installSkillFile({ ...options, dir, force: has('force') });
      return done.written ? `Wrote ${done.file} (etag ${done.etag}).` : `${done.file} is up to date (etag ${done.etag}).`;
    }
    default:
      throw new OpenArtifactError('invalid_argument', 'skill render [--command X] [--harness H] [--form entry|full] | skill install --command X --dir D [--harness H] [--form entry|full]');
  }
}
