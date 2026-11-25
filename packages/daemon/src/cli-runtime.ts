/**
 * `open-artifact runtime status | update | pin | policy` (design 10.2).
 *
 *   runtime status [--json] [--check]     the runtimes here, which one starts, the update policy and the last check
 *                                         (`--check` asks the registry now)
 *   runtime update [--version <x.y.z>]    install the newest compatible runtime (the person's decision)
 *   runtime pin <range> | --clear         keep the runtime within a version range (the person's decision)
 *   runtime policy [auto|prompt|bundled|default] [--json]
 *                                         with no word: the update policy in effect and where it comes from; with one:
 *                                         sets it in settings.json (`default` removes the person's setting)
 *
 * `update`, `pin` and setting the policy are refused inside an agent session, like `harness add`: they decide which code
 * runs here. The person's own `runtime update` works under `bundled` (they typed it); only the machine switch refuses it.
 */

import { readDaemon, validRange } from '@open-artifact/harness-kit';
import { OpenArtifactError } from '@open-artifact/protocol';
import type { PersonAct } from './agent-session.ts';
import { ownRuntime } from './client.ts';
import { checkForUpdate, effectivePolicy, runtimeStatus, runtimeStatusText, saveRuntimeSettings, updateRuntime } from './runtime.ts';

const POLICY_SOURCE: Record<string, string> = {
  machine: 'the machine switch: OPEN_ARTIFACT_RUNTIME_UPDATE or the policy file of this computer',
  settings: 'your setting in settings.json',
  adapter: 'what the installed hosts said (one that bundles its own runtime abstains)',
  default: 'nothing set',
};

/** What the command line gives this module. */
export interface RuntimeCommandIo {
  args: string[];
  out: (value: unknown) => void;
  /** Ends the command when `act` is the person's and this runs inside an agent session. */
  personOnly: (act: PersonAct, command: string) => void;
}

const has = (args: string[], name: string): boolean => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

const valueOf = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};

/** Runs `open-artifact runtime <sub>`. Throws `OpenArtifactError` on a usage error or a failed update. */
export async function runtimeCommand(sub: string | undefined, io: RuntimeCommandIo): Promise<void> {
  const { args, out } = io;
  const json = has(args, 'json');
  const running = (await readDaemon())?.version ?? null;
  const own = ownRuntime();
  switch (sub ?? 'status') {
    case 'status': {
      if (has(args, 'check')) await checkForUpdate({ own });
      const status = runtimeStatus({ running, own });
      return out(json ? status : runtimeStatusText(status));
    }
    case 'update': {
      const version = valueOf(args, 'version');
      io.personOnly('runtime-update', `open-artifact runtime update${version ? ` --version ${version}` : ''}`);
      const result = await updateRuntime({ ...(version ? { version } : {}), own, running });
      return out(json ? result : result.message);
    }
    case 'pin': {
      const clear = has(args, 'clear');
      const range = args[0];
      if (!clear && !range) throw new OpenArtifactError('invalid_argument', 'runtime pin <range> | --clear (a range like ^0.14 or 0.13.x)');
      io.personOnly('runtime-pin', `open-artifact runtime pin ${clear ? '--clear' : range}`);
      if (clear) {
        saveRuntimeSettings({ pin: null });
        return out(json ? { pin: null } : 'The runtime is not pinned any more: the newest compatible one starts.');
      }
      if (!validRange(range!)) throw new OpenArtifactError('invalid_argument', `Not a version range: ${range} (try ^0.14, ~0.14.2, 0.14.x or >=0.14 <0.16).`);
      saveRuntimeSettings({ pin: range!.trim() });
      return out(json ? { pin: range!.trim() } : `Pinned the runtime to ${range!.trim()}: only versions in it start or are installed.`);
    }
    case 'policy': {
      const word = args[0];
      if (word === undefined) {
        const policy = effectivePolicy();
        return out(json ? policy : `${policy.update === 'off' ? 'off for this computer' : policy.update} (${policy.source}: ${POLICY_SOURCE[policy.source] ?? policy.source})`);
      }
      if (!['auto', 'prompt', 'bundled', 'default'].includes(word)) throw new OpenArtifactError('invalid_argument', `runtime policy auto | prompt | bundled | default (not ${word}).`);
      io.personOnly('runtime-policy', `open-artifact runtime policy ${word}`);
      saveRuntimeSettings({ update: word === 'default' ? null : (word as 'auto' | 'prompt' | 'bundled') });
      const policy = effectivePolicy();
      const now = `${policy.update === 'off' ? 'off for this computer' : policy.update} (${policy.source})`;
      return out(json ? policy : word === 'default' ? `Removed your update policy; in effect now: ${now}.` : `Set the update policy to ${word}; in effect now: ${now}.`);
    }
    default:
      throw new OpenArtifactError('invalid_argument', 'runtime status [--json] [--check] | update [--version <x.y.z>] | pin <range> | --clear | policy [auto|prompt|bundled|default]');
  }
}
