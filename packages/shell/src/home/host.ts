/**
 * The home page's side of the host protocol: an app that embeds the home
 * page answers `home_hello` with `host_hello`; with `sessions` it can show
 * an artifact's owner session (`open_session`). The messages are
 * `@open-artifact/protocol`'s `HomeToHost`.
 */

import { isShellMessage, type HomeToHost, type HostCaps, type HostLibraryFilter } from '@open-artifact/protocol';
import { HOME_BOOT_GLOBAL, homeBootOf, type HomeBootRead } from '../lib/cloud.ts';
import { declaredHosts } from '../lib/host-origins.ts';
import { homeHostOf } from './model.ts';
import { useHome } from './store.ts';

/**
 * What the server inlined into the page: a cloud host replaces `HOME_BOOT_PLACEHOLDER` in `index.html` with a
 * {@link HomeBoot} as JSON (`{"cloud": {...}}`); the local daemon serves the file as it is, so it stays `null` and the
 * page is the local one.
 */
export const homeBoot: HomeBootRead = homeBootOf((window as unknown as Record<string, unknown>)[HOME_BOOT_GLOBAL]);

/** The host that embeds the home page. */
export interface HomeHost {
  origin: string;
  caps: HostCaps;
  /** The harness the host belongs to, when it said: its sessions are the ones it can open. */
  harness: string | null;
  agentName: string | null;
  /** A connected adapter declared the host's origin (else no adapter declared any: taken as before). */
  declared: boolean;
  /** What the host asked the list to show (its harness's, its workspace's), or `null` for all. */
  library: HostLibraryFilter | null;
}

const embedded = window.parent !== window;

/** Sends a message to the host's origin. Does nothing without a host. */
export function toHost(message: HomeToHost): void {
  const host = useHome.getState().host;
  if (host) window.parent.postMessage(message, host.origin);
}

function onMessage(event: MessageEvent): void {
  const message: unknown = event.data;
  if (!embedded || event.source !== window.parent || !isShellMessage(message) || message.openArtifact !== 'host_hello') return;
  const origin = event.origin;
  // As the Shell: only an origin a connected adapter declared, while any did.
  void declaredHosts().then((hosts) => {
    const declared = !!hosts?.length && hosts.includes(origin);
    if (hosts?.length && !declared) return;
    const host = homeHostOf(message, origin, declared);
    if (!host) return;
    useHome.getState().setHost(host);
    window.parent.postMessage({ openArtifact: 'home_ready' } satisfies HomeToHost, origin);
  });
}

/** Starts listening for the host and says hello when framed. Returns a function that stops. */
export function startHost(): () => void {
  window.addEventListener('message', onMessage);
  if (embedded) window.parent.postMessage({ openArtifact: 'home_hello' } satisfies HomeToHost, '*');
  return () => window.removeEventListener('message', onMessage);
}
