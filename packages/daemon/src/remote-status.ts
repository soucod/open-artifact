/**
 * `open-artifact remote status` in words. Kept apart from `link.ts` so the CLI does not load the sync machinery to
 * print it.
 */

import type { CloudStatus, RemoteStatus } from './link.ts';

/**
 * `open-artifact remote status` for people: per remote, who is signed in and whether the host answers, then each
 * published artifact with its web address and its sync state (in sync, changes waiting, or why it failed). With
 * `cloud`, also which remote is the default (when there are several), the approval a preset remote waits for, and
 * automatic publishing with what it has not got onto its site yet. `--json` prints {@link RemoteStatus} instead.
 */
export function remoteStatusText(remotes: readonly RemoteStatus[], cloud?: CloudStatus, presetProblem?: string): string {
  const tail = [
    ...(presetProblem ? [`Preset: ${presetProblem}`] : []),
    ...(cloud ? cloudLines(cloud, remotes.length) : []),
  ];
  if (!remotes.length) return ['No remotes. Add one: open-artifact remote add <name> <https://host>', ...tail].join('\n\n');
  const blocks = remotes.map((remote) => {
    const who = remote.signedIn ? `signed in as ${remote.user?.email || remote.user?.name || remote.user?.id || 'you'}` : 'not signed in';
    const link = !remote.signedIn ? '' : !remote.reachable ? ', not reachable' : remote.connected ? ', connected' : ', connecting';
    const mark = remote.default && remotes.length > 1 ? ' [default]' : '';
    const lines = [`${remote.name} (${remote.host})${mark}: ${who}${link}`];
    if (remote.insecure) lines.push('  plain http: not encrypted, only for a network you trust');
    if (remote.approval) lines.push(`  to sign this computer in, open ${remote.approval.verification_uri_complete} and approve the code ${remote.approval.user_code} (until ${remote.approval.expires_at})`);
    if (remote.lastError && remote.code !== 'signed_out') lines.push(`  last error (${remote.code ?? 'error'}): ${remote.lastError}`);
    if (remote.note) lines.push(`  ${remote.note}`);
    if (!remote.artifacts.length) lines.push('  nothing published');
    for (const artifact of remote.artifacts) {
      const waiting = artifact.pending.length ? `${artifact.pending.length} change${artifact.pending.length === 1 ? '' : 's'} waiting` : '';
      const state = artifact.lastError
        ? `sync failed (${artifact.code ?? 'error'}): ${artifact.lastError}${waiting ? `; ${waiting}` : ''}`
        : waiting || `in sync${artifact.lastSyncAt ?? artifact.syncedAt ? ` (${artifact.lastSyncAt ?? artifact.syncedAt})` : ''}`;
      lines.push(`  ${artifact.id}  ${JSON.stringify(artifact.title)}  ${artifact.view_url}`, `    ${state}`);
    }
    return lines.join('\n');
  });
  return [...blocks, ...tail].join('\n\n');
}

/** Automatic publishing in words; nothing while it is off and nothing waits. */
function cloudLines(cloud: CloudStatus, remotes: number): string[] {
  if (cloud.publish !== 'auto' && !cloud.pending.length) return [];
  const nowhere =
    remotes === 0
      ? 'Automatic publishing is on, but no site is connected, so new artifacts stay on this computer until one is: connect one with open-artifact remote add <name> <https://host> (it becomes the default, and new artifacts go there), or turn automatic publishing off with open-artifact remote auto off.'
      : 'Automatic publishing is on, but no site is chosen for it, so new artifacts stay on this computer: choose one with open-artifact remote default <name>, or turn it off with open-artifact remote auto off.';
  const lines = [
    cloud.publish === 'auto'
      ? cloud.default
        ? `New artifacts are published automatically to ${cloud.default}.`
        : nowhere
      : 'Automatic publishing is off; these were waiting when it was turned off:',
  ];
  for (const item of cloud.pending) {
    const state = item.lastError
      ? `failed ${item.attempts} time${item.attempts === 1 ? '' : 's'} (${item.code ?? 'error'}): ${item.lastError}${item.nextAt ? `; next try ${item.nextAt}` : ''}`
      : 'being published';
    lines.push(`  ${item.id}  ${JSON.stringify(item.title)}`, `    ${state}`);
  }
  return [lines.join('\n')];
}

/** What `open-artifact remote remove` did, in sentences (`--json` prints the daemon's answer instead). */
export function remoteRemovedText(removed: { removed: string; unlinked: string[]; autoPublishOff?: boolean; default?: string | null }): string {
  const lines = [`Removed the site ${removed.removed}: this computer no longer publishes or syncs there.`];
  if (removed.unlinked.length) {
    lines.push(`${removed.unlinked.length === 1 ? 'This artifact is' : 'These artifacts are'} local only now (the copies on the site stay there until someone deletes them): ${removed.unlinked.join(', ')}.`);
  }
  if (removed.autoPublishOff) {
    lines.push('Automatic publishing went to that site, so it is now off: new artifacts stay on this computer until you publish them. After connecting a site, turn it back on with open-artifact remote auto on.');
  } else if (removed.default) {
    lines.push(`Publishing without --remote now uses ${removed.default}.`);
  }
  return lines.join('\n');
}
