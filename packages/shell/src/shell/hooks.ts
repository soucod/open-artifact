/** Derived values the Shell's components share. */

import type { ArtifactRole, ArtifactView, CloudAgentView, ShellCloud } from '@open-artifact/protocol';
import { cloudAgentBadge, mayAsk, roleOf } from '../lib/cloud.ts';
import { t } from '../lib/i18n.ts';
import { agentNameOf, canOpenSession, isWorking, ownerState, type OwnerState } from './model.ts';
import { useShell } from './store.ts';

/** What the Shell calls the agent: the host's name, else the boot's, else "Agent". */
export function useAgentName(): string {
  const host = useShell((state) => state.host);
  const boot = useShell((state) => state.boot);
  return agentNameOf(host, boot, t('agent'));
}

/** The artifact's title: the library's (it follows renames), else the boot's. */
export function useTitle(): string {
  return useShell((state) => (state.boot?.type === 'docs' && state.report.title) || state.artifact?.title || state.boot?.title || '');
}

/** The owner session, as the library reports it. */
export function useOwner(): ArtifactView['owner'] {
  return useShell((state) => state.artifact?.owner ?? null);
}

/** The agent is working. */
export function useWorking(): boolean {
  const owner = useOwner();
  const report = useShell((state) => state.report);
  return isWorking(owner, report);
}

/**
 * On a cloud host, the owner's agent: the artifact's latest (`artifacts/changed` brings it again when the owner's
 * computer comes or goes), else the boot's. `null` locally and on a host that does not say.
 */
export function useCloudAgent(): CloudAgentView | null {
  return useShell((state) => (state.boot?.cloud ? (state.artifact?.agent ?? state.boot.cloud.agent ?? null) : null));
}

/** The owner status chip's state (on a cloud host, its agent's: no session owns a published artifact there). */
export function useOwnerState(): OwnerState {
  const owner = useOwner();
  const report = useShell((state) => state.report);
  const cloudAgent = useCloudAgent();
  if (cloudAgent && !isWorking(owner, report)) return cloudAgentBadge(cloudAgent);
  return ownerState(owner, report);
}

/** The host can show the owner session (never on a cloud host: the session runs on the owner's computer). */
export function useCanOpenSession(): boolean {
  const host = useShell((state) => state.host);
  const owner = useOwner();
  const cloud = useShell((state) => !!state.boot?.cloud);
  return !cloud && canOpenSession(host, owner);
}

/** A cloud host's boot data, or `null` for the local daemon and a type server. */
export function useCloud(): ShellCloud | null {
  return useShell((state) => state.boot?.cloud ?? null);
}

/** The person's role on this artifact ({@link roleOf}). */
export function useRole(): ArtifactRole {
  return useShell((state) => roleOf(state.boot));
}

/**
 * The person may ask the owner's agent from the Shell: never on a type server's own Shell; otherwise by role, and
 * for an editor on a cloud host while the owner allows it (as far as the sharing state shows).
 */
export function useMayAsk(): boolean {
  const standalone = useShell((state) => !!state.boot?.typeServer);
  const role = useRole();
  const settings = useShell((state) => state.share.view?.cloud?.settings ?? state.boot?.cloud?.settings);
  return !standalone && mayAsk(role, settings);
}
