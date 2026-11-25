/**
 * How the local Share tab is laid out. Pure: no DOM, no store.
 *
 * An artifact published to the web has one page people should use: its web address (opening it on this computer goes
 * there too). So the published state leads with "Publish to the web" (the address, Copy, Open, the sync line, Manage
 * access on the web) and keeps sharing on this computer's network under a closed disclosure. An artifact that is not
 * published keeps the panel as it always was.
 */

import { publishedOf, type RemoteInfo } from './publish.ts';
import type { MessageKey } from './i18n.ts';

/** `lan`: the panel as it always was (network sharing, then publishing); `published`: publishing first. */
export type ShareLayout = 'lan' | 'published';

/**
 * The layout for artifact `id`: published when `GET remotes` lists it under a site, or, before that answer is in,
 * when the artifact's own view says where it is published (so the panel does not jump once the answer comes).
 */
export function shareLayout(input: { id: string; remotes: readonly RemoteInfo[] | null; publishedUrl: string | null | undefined }): ShareLayout {
  if (input.remotes !== null) return publishedOf(input.remotes, input.id) ? 'published' : 'lan';
  return input.publishedUrl ? 'published' : 'lan';
}

/**
 * What "Share on this network instead" says beside its title while closed: that sharing on the network is on now (so
 * closing it never hides that links work), else nothing.
 */
export function networkStatus(view: { lan: boolean } | null): MessageKey | null {
  return view?.lan ? 'sharedOnNetwork' : null;
}
