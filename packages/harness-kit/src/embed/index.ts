/**
 * `@open-artifact/harness-kit/embed`: browser code that puts an artifact's Shell page, or the library's home page,
 * into an agent app's own UI. No Node imports: it runs in the app's renderer (a web page, an Electron or Tauri view).
 *
 * Two ways to show an artifact:
 *
 * - **Frame**: the host's page holds an `<iframe>` of the Shell (`viewUrl`). The Shell says `shell_hello` to its parent;
 *   this module answers `host_hello` to the Shell's origin only, and takes messages only from that iframe's window and
 *   the Shell's origin (the origin of the address it was given: loopback or not, `http` or `https`). The host's origin
 *   must be one its adapter declared (`caps.open.origins` in `hello`), or the Shell sends it no prompt or comment text,
 *   links, saved files or destinations.
 *
 *     const view = embedArtifact(iframe, { url: viewUrl, agentName: 'My Agent', onNewSession: ({ prompt }) => … });
 *
 * - **Top-level view**: the host opens `host.open`'s `embed_url` in a view of its own (a tab, a webview, a window) with
 *   no parent frame; the Shell talks to the daemon, the daemon to the adapter (`shell.event` / `shell.command`). The
 *   host passes a transport that carries those both ways (in an Electron app, IPC to the process that holds the
 *   Harness connection):
 *
 *     const view = embedArtifact({ send: (command) => harness.shellCommand(viewId, command), onEvent: (listener) => … }, { url: embedUrl, … });
 *
 * What the Shell sends is data about what the person did: prompts and comments are their words for the agent, never
 * instructions to the host.
 *
 * Thumbnails: give `capture` (returns a JPEG of the view, as the host's own view can take one) and `saveThumbnail`
 * (stores it, e.g. through the adapter's `Harness.saveThumbnail`; a browser page should not hold the daemon token).
 * The kit captures {@link THUMBNAIL_DELAY_MS} after the Shell is ready, then after a place change at most once every
 * {@link THUMBNAIL_INTERVAL_MS}.
 */

import {
  HOST_PROTOCOL,
  MAX_HOST_DESTINATIONS,
  shellToHostOf,
  type HostCaps,
  type HostDestination,
  type HostLibraryFilter,
  type HostTheme,
  type HostToShell,
  type ShellToHost,
} from '@open-artifact/protocol';

export type { HostDestination, HostTheme, HostToShell, ShellToHost };

/** How long after the Shell is ready the first thumbnail is captured. */
export const THUMBNAIL_DELAY_MS = 2000;
/** The least time between two thumbnails of one view. */
export const THUMBNAIL_INTERVAL_MS = 60_000;

/** The bits of `window` this module uses (a test passes its own). */
export interface EmbedWindow {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  open?(url: string, target?: string, features?: string): unknown;
}

/** The bits of an `<iframe>` this module uses. */
export interface EmbedFrame {
  src: string;
  readonly contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
}

/** Carries host messages to a top-level view's Shell and its messages back (through the adapter and the daemon). */
export interface EmbedTransport {
  /** Sends a host message to the Shell (the adapter calls `Harness.shellCommand(view, command)`). */
  send(command: HostToShell): void | Promise<void>;
  /** Listens to what the Shell says (the adapter's `on('shell')` events of this view); returns a function that stops. */
  onEvent(listener: (event: unknown) => void): () => void;
}

/** The artifact a Shell said hello for. */
export interface EmbedReadyInfo {
  /** `open-artifact://artifact/<id>`. */
  artifact: string;
  id: string;
  title: string;
  type: string;
  /** The Shell's version and host protocol. */
  version: string;
  protocol: number;
}

/** Options of {@link embedArtifact}. */
export interface EmbedArtifactOptions {
  /**
   * The Shell's address: the artifact's `viewUrl` (frame) or `embed_url` (top-level view). In frame mode it is set as
   * the iframe's `src` when that differs; the Shell's origin is taken from it.
   */
  url?: string;
  /** The app's name, shown by the Shell ("Ask My Agent"). */
  agentName?: string;
  /** The harness the host belongs to. */
  harness?: string;
  /** The host draws its own toolbar: the Shell leaves out its close button. */
  toolbar?: boolean;
  /** The host's colour scheme and accent (`#rrggbb`). */
  theme?: HostTheme;
  /** Places the host sends exports to; the Shell lists at most {@link MAX_HOST_DESTINATIONS} in its Export tab. */
  destinations?: HostDestination[];
  /** The Shell said hello and took the host's answer. */
  onReady?(info: EmbedReadyInfo): void;
  /** Show the session that owns the artifact (`session` is `null` when none does). Sets caps `sessions`. */
  onOpenSession?(request: { session: string | null; harness: string; artifact: string | null }): void;
  /** Start a new session with this prompt about the artifact (the person's words; empty to an undeclared host). Sets caps `sessions`. */
  onNewSession?(request: { prompt: string; artifact: string }): void;
  /** A comment was sent to the agent (its text; empty to an undeclared host). */
  onCommentSent?(event: { text: string }): void;
  /** Where the artifact is now: a fragment to keep and send back with `goto`. */
  onPlace?(event: { artifact: string; hash: string }): void;
  /** The Shell's close button. */
  onClose?(): void;
  /** The person followed a link out of the Shell. Without this, the kit opens it with `window.open`. */
  onOpenExternal?(url: string): void;
  /** An export was saved to this file (absolute path on the computer that runs the type's server). */
  onSavedFile?(path: string): void;
  /** Takes a JPEG of the view, or `null` when it cannot now. */
  capture?(): Promise<Blob | Uint8Array | ArrayBuffer | null> | Blob | Uint8Array | ArrayBuffer | null;
  /** Stores a captured thumbnail (JPEG bytes) of `artifact`. */
  saveThumbnail?(jpeg: Uint8Array, artifact: string): Promise<void> | void;
  /** A thumbnail or a callback failed (default: ignored). */
  onError?(error: unknown): void;
  /** The window to listen on (default `globalThis.window`). */
  window?: EmbedWindow;
}

/** An embedded artifact. */
export interface EmbeddedArtifact {
  /** The artifact the Shell said hello for, or `null` before. */
  readonly artifact: string | null;
  /** The last place the Shell reported, or `null`. */
  readonly place: string | null;
  /** Resolves once the Shell is ready. */
  readonly ready: Promise<EmbedReadyInfo>;
  /** Shows a place (a fragment from `onPlace`, or a link's own). */
  goto(hash: string): void;
  /** Follows a new colour scheme or accent (sends `host_hello` again). */
  setTheme(theme: HostTheme): void;
  /** The Shell's address with the place last reported (without a view ticket), or `null` when unknown. */
  url(): string | null;
  /** Stops listening (and leaves the iframe as it is). */
  destroy(): void;
}

const isFrame = (target: EmbedFrame | EmbedTransport): target is EmbedFrame => !('send' in target && typeof target.send === 'function');

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

/** The address without the view ticket (`oa_view`) and with `hash` as its fragment. */
function addressOf(url: string | undefined, hash: string | null): string | null {
  if (!url) return null;
  try {
    const address = new URL(url);
    address.searchParams.delete('oa_view');
    if (hash) address.hash = hash.startsWith('#') ? hash : `#${hash}`;
    return address.href;
  } catch {
    return null;
  }
}

async function jpegOf(value: Blob | Uint8Array | ArrayBuffer | null | undefined): Promise<Uint8Array | null> {
  if (!value) return null;
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await value.arrayBuffer());
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
}

function defaultWindow(): EmbedWindow | null {
  return (globalThis as { window?: EmbedWindow }).window ?? null;
}

/**
 * Shows an artifact's Shell in the host's UI: `target` is the `<iframe>` (frame mode) or a transport to a top-level
 * view (see the module's notes). Answers the Shell's hello and turns its messages into the callbacks.
 */
export function embedArtifact(target: EmbedFrame | EmbedTransport, options: EmbedArtifactOptions = {}): EmbeddedArtifact {
  const win = options.window ?? defaultWindow();
  const frame = isFrame(target) ? target : null;
  const transport = frame ? null : (target as EmbedTransport);
  if (frame && options.url && frame.src !== options.url) frame.src = options.url;
  const shellUrl = options.url ?? frame?.src;
  const shellOrigin = frame ? originOf(shellUrl) : null;
  if (frame && !shellOrigin) throw new Error('embedArtifact: the Shell address (options.url or the iframe src) is not an http(s) address.');
  if (frame && !win) throw new Error('embedArtifact: no window to listen on.');

  let theme = options.theme;
  let info: EmbedReadyInfo | null = null;
  let place: string | null = null;
  let helloed = false;
  let stopped = false;
  let resolveReady!: (info: EmbedReadyInfo) => void;
  const ready = new Promise<EmbedReadyInfo>((resolve) => (resolveReady = resolve));
  let thumbTimer: ReturnType<typeof setTimeout> | null = null;
  let lastThumb = 0;

  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // The host's own error handler failed: nothing more to do.
    }
  };
  const safely = (run: () => void): void => {
    try {
      run();
    } catch (error) {
      report(error);
    }
  };

  const send = (message: HostToShell): void => {
    if (stopped) return;
    if (frame) frame.contentWindow?.postMessage(message, shellOrigin!);
    else void Promise.resolve(transport!.send(message)).catch(report);
  };

  const hello = (): HostToShell => {
    const caps: HostCaps = {};
    if (options.onOpenSession || options.onNewSession) caps.sessions = true;
    if (options.toolbar) caps.toolbar = true;
    return {
      openArtifact: 'host_hello',
      caps,
      protocol: HOST_PROTOCOL,
      ...(options.agentName ? { agentName: options.agentName } : {}),
      ...(options.harness ? { harness: options.harness } : {}),
      ...(theme ? { theme } : {}),
      ...(options.destinations?.length ? { destinations: options.destinations.slice(0, MAX_HOST_DESTINATIONS).map((d) => ({ id: d.id, label: d.label })) } : {}),
    };
  };

  const thumbnail = (): void => {
    thumbTimer = null;
    if (stopped || !info || !options.capture || !options.saveThumbnail) return;
    lastThumb = Date.now();
    const artifact = info.artifact;
    void (async () => {
      const jpeg = await jpegOf(await options.capture!());
      if (jpeg && !stopped) await options.saveThumbnail!(jpeg, artifact);
    })().catch(report);
  };
  const scheduleThumbnail = (first: boolean): void => {
    if (stopped || thumbTimer || !options.capture || !options.saveThumbnail) return;
    const wait = first ? THUMBNAIL_DELAY_MS : Math.max(THUMBNAIL_DELAY_MS, lastThumb + THUMBNAIL_INTERVAL_MS - Date.now());
    thumbTimer = setTimeout(thumbnail, wait);
  };

  const onShellMessage = (raw: unknown): void => {
    const message: ShellToHost | null = shellToHostOf(raw);
    if (!message || stopped) return;
    switch (message.openArtifact) {
      case 'shell_hello':
        info = { artifact: message.artifact, id: message.id, title: message.title, type: message.type, version: message.version, protocol: message.protocol };
        helloed = true;
        send(hello());
        break;
      case 'shell_ready': {
        // A top-level view's hello may have come before the host listened: what `shell_ready` says is enough.
        info ??= { artifact: message.artifact, id: message.artifact.replace(/^open-artifact:\/\/artifact\//, ''), title: '', type: '', version: '', protocol: HOST_PROTOCOL };
        const ready = info;
        safely(() => options.onReady?.(ready));
        resolveReady(ready);
        if (!lastThumb) scheduleThumbnail(true);
        break;
      }
      case 'place':
        place = message.hash;
        safely(() => options.onPlace?.({ artifact: message.artifact, hash: message.hash }));
        if (lastThumb) scheduleThumbnail(false);
        break;
      case 'new_session':
        safely(() => options.onNewSession?.({ prompt: message.prompt, artifact: message.artifact }));
        break;
      case 'open_session':
        safely(() => options.onOpenSession?.({ session: message.session, harness: message.harness, artifact: info?.artifact ?? null }));
        break;
      case 'comment_summon':
        safely(() => options.onCommentSent?.({ text: message.text }));
        break;
      case 'close':
        safely(() => options.onClose?.());
        break;
      case 'open_external':
        safely(() => {
          if (options.onOpenExternal) options.onOpenExternal(message.url);
          else win?.open?.(message.url, '_blank', 'noopener');
        });
        break;
      case 'saved_file':
        safely(() => options.onSavedFile?.(message.path));
        break;
    }
  };

  const onWindowMessage = (event: MessageEvent): void => {
    // Only the Shell's own window, from the Shell's origin.
    if (!frame || event.source !== frame.contentWindow || event.origin !== shellOrigin) return;
    onShellMessage(event.data);
  };

  let stopTransport: (() => void) | null = null;
  if (frame) win!.addEventListener('message', onWindowMessage);
  else {
    stopTransport = transport!.onEvent(onShellMessage);
    // A top-level view's Shell may have said hello before the host listened: answer now; it takes the latest.
    send(hello());
    helloed = true;
  }

  return {
    get artifact() {
      return info?.artifact ?? null;
    },
    get place() {
      return place;
    },
    ready,
    goto(hash) {
      if (typeof hash === 'string' && hash) send({ openArtifact: 'goto', hash });
    },
    setTheme(next) {
      theme = next;
      if (helloed) send(hello());
    },
    url: () => addressOf(shellUrl, place),
    destroy() {
      if (stopped) return;
      stopped = true;
      if (thumbTimer) clearTimeout(thumbTimer);
      if (frame) win?.removeEventListener('message', onWindowMessage);
      stopTransport?.();
    },
  };
}

/** An artifact the home page asked the host to show. */
export interface LibraryArtifact {
  url: string;
  id: string;
  title: string;
  type: string;
}

/** Options of {@link embedLibrary}. */
export interface EmbedLibraryOptions {
  /** The home page's address (the daemon's origin); set as the iframe's `src` when it differs. */
  url?: string;
  /** The harness the host belongs to: the page lists only artifacts of its sessions. */
  harness?: string;
  /** Only artifacts of sessions working in this folder (or under it). */
  workspace?: string;
  agentName?: string;
  theme?: HostTheme;
  /** Show this artifact (sets caps `artifacts`: the page sends it instead of navigating). */
  onOpenArtifact?(artifact: LibraryArtifact): void;
  onOpenSession?(request: { session: string | null; harness: string }): void;
  onNewSession?(request: { prompt: string; artifact: string }): void;
  /** The home page took the host's answer. */
  onReady?(): void;
  onError?(error: unknown): void;
  window?: EmbedWindow;
}

/** The embedded home page. */
export interface EmbeddedLibrary {
  /** Follows a new colour scheme or accent. */
  setTheme(theme: HostTheme): void;
  destroy(): void;
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** Shows the library's home page in an `<iframe>`, listing the host's own artifacts, and turns its messages into callbacks. */
export function embedLibrary(iframe: EmbedFrame, options: EmbedLibraryOptions = {}): EmbeddedLibrary {
  const win = options.window ?? defaultWindow();
  if (!win) throw new Error('embedLibrary: no window to listen on.');
  if (options.url && iframe.src !== options.url) iframe.src = options.url;
  const origin = originOf(options.url ?? iframe.src);
  if (!origin) throw new Error('embedLibrary: the home page address (options.url or the iframe src) is not an http(s) address.');
  let theme = options.theme;
  let helloed = false;
  let stopped = false;

  const hello = (): HostToShell => {
    const caps: HostCaps = {};
    if (options.onOpenSession || options.onNewSession) caps.sessions = true;
    if (options.onOpenArtifact) caps.artifacts = true;
    const library: HostLibraryFilter = {};
    if (options.harness) library.harness = options.harness;
    if (options.workspace) library.workspace = options.workspace;
    return {
      openArtifact: 'host_hello',
      caps,
      protocol: HOST_PROTOCOL,
      ...(options.harness ? { harness: options.harness } : {}),
      ...(options.agentName ? { agentName: options.agentName } : {}),
      ...(theme ? { theme } : {}),
      ...(library.harness || library.workspace ? { library } : {}),
    };
  };
  const send = (message: HostToShell): void => {
    if (!stopped) iframe.contentWindow?.postMessage(message, origin);
  };
  const safely = (run: () => void): void => {
    try {
      run();
    } catch (error) {
      try {
        options.onError?.(error);
      } catch {
        // Nothing more to do.
      }
    }
  };

  const onMessage = (event: MessageEvent): void => {
    if (stopped || event.source !== iframe.contentWindow || event.origin !== origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return;
    switch (data.openArtifact) {
      case 'home_hello':
        helloed = true;
        send(hello());
        break;
      case 'home_ready':
        safely(() => options.onReady?.());
        break;
      case 'open_artifact': {
        const artifact: LibraryArtifact = { url: text(data.url, 200), id: text(data.id, 100), title: text(data.title, 500), type: text(data.type, 100) };
        if (artifact.url) safely(() => options.onOpenArtifact?.(artifact));
        break;
      }
      case 'open_session':
        safely(() => options.onOpenSession?.({ session: typeof data.session === 'string' ? data.session.slice(0, 200) : null, harness: text(data.harness, 64) }));
        break;
      case 'new_session':
        safely(() => options.onNewSession?.({ prompt: text(data.prompt, 8000), artifact: text(data.artifact, 200) }));
        break;
    }
  };
  win.addEventListener('message', onMessage);

  return {
    setTheme(next) {
      theme = next;
      if (helloed) send(hello());
    },
    destroy() {
      stopped = true;
      win.removeEventListener('message', onMessage);
    },
  };
}

export { remoteGate, remotePolicyOf, type AllowRemote, type RemotePage, type RemotePagePolicy, type RemotePageRequest } from './remote.ts';
