/**
 * The browser half of `host.open` (src/server/host-open.ts): the agent called `open` on an artifact, or asked for its
 * share or export panel, and the daemon asked DSH to show it. This window follows those requests (the host-opens route)
 * and shows each in a Browser tab of the conversation's right sidebar, switching to the conversation when it is not the
 * one on screen, then says whether it did. A window on another device, or an app without the sidebar's Browser, says no:
 * the agent then gives the person the link.
 *
 * The tab is a top-level view: it loads the request's `embed_url`, whose Shell talks to the daemon. What it says comes
 * on the same stream (`event: shell`) and is answered through the shell-command route, by the kit's `embedArtifact` in
 * transport mode: "Ask the agent" in a new session starts one with the person's words in its input, the owner's
 * session is brought to the front, and a comment sent shows the conversation it went to.
 */
import { embedArtifact, type EmbeddedArtifact, type EmbedTransport } from '@open-artifact/harness-kit/embed';
import type { HostToShell, ShellEventParams } from '@open-artifact/protocol';
import { PATHS, SHELL_EVENT, type HostOpenRequest } from '../shared/routes.ts';
import { routeUrl } from './api.ts';
import { linkState, openInSidebar, service, sidebarBrowser, type ClientContext, type SessionsSnapshot, type UiWorkspace, type WorkspacesSnapshot } from './host.ts';
import { onAnotherDevice } from './remote.ts';

/** How many views this window answers at once: the oldest is let go past it (its tab stays, without the host's answers). */
export const MAX_VIEWS = 16;

/** A store's current value, or undefined. */
function snapshot<T>(ctx: Pick<ClientContext, 'get'>, name: string): T | undefined {
  const list = service<{ list?: { getSnapshot?(): T } }>(ctx, name)?.list;
  return typeof list?.getSnapshot === 'function' ? list.getSnapshot() : undefined;
}

/** Shows one request; true when the Browser tab is there. */
export async function showRequest(ctx: Pick<ClientContext, 'get'>, request: HostOpenRequest): Promise<boolean> {
  if (onAnotherDevice()) return false;
  const sidebar = sidebarBrowser(ctx);
  if (!sidebar) return false;
  // The conversation on screen takes the tab at once.
  if (await openInSidebar(sidebar, request.session, request.url, 0)) return true;
  const workspace = service<UiWorkspace>(ctx, 'uiWorkspace');
  if (typeof workspace?.openSession !== 'function') return false;
  const state = linkState(request.session, snapshot<SessionsSnapshot>(ctx, 'sessions'), snapshot<WorkspacesSnapshot>(ctx, 'workspaces'));
  if (state !== 'available') return false;
  workspace.openSession(request.session);
  return openInSidebar(sidebar, request.session, request.url);
}

/** Sends a host message to the Shell of a view, through the shell-command route. */
export type SendCommand = (view: string, command: HostToShell) => Promise<void>;

const postCommand: SendCommand = async (view, command) => {
  const response = await fetch(routeUrl(PATHS.shellCommand, { view }), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`shell command: HTTP ${response.status}`);
};

/** The views this window shows and answers, by view ticket. */
export class ShellViews {
  private readonly views = new Map<string, { embed: EmbeddedArtifact; listeners: Set<(event: unknown) => void> }>();
  private readonly ctx: Pick<ClientContext, 'get'>;
  private readonly send: SendCommand;

  constructor(ctx: Pick<ClientContext, 'get'>, send: SendCommand = postCommand) {
    this.ctx = ctx;
    this.send = send;
  }

  /** Answers the Shell of a request's view, which this window now shows. */
  add(request: HostOpenRequest): void {
    const view = request.view;
    if (!view || this.views.has(view)) return;
    const listeners = new Set<(event: unknown) => void>();
    const transport: EmbedTransport = {
      send: (command) => this.send(view, command),
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const workspace = () => service<UiWorkspace>(this.ctx, 'uiWorkspace');
    const embed = embedArtifact(transport, {
      url: request.url,
      harness: 'dsh',
      // The sidebar's Browser has its own close: the Shell leaves out its own.
      toolbar: true,
      ...(request.agentName ? { agentName: request.agentName } : {}),
      onOpenSession: ({ session }) => {
        const id = session ?? request.session;
        if (id) workspace()?.openSession?.(id);
      },
      onNewSession: ({ prompt }) => workspace()?.startSession?.(undefined, { prompt, whenDraftExists: 'append' }),
      // The comment went to the owner's session: show that conversation.
      onCommentSent: () => workspace()?.openSession?.(request.session),
      onError: () => undefined,
    });
    this.views.set(view, { embed, listeners });
    while (this.views.size > MAX_VIEWS) this.drop(this.views.keys().next().value!);
  }

  /** What the Shell of a view said, from the stream. */
  event(params: ShellEventParams): void {
    for (const listener of this.views.get(params.view)?.listeners ?? []) listener(params.event);
  }

  /** Stops answering one view. */
  drop(view: string): void {
    this.views.get(view)?.embed.destroy();
    this.views.delete(view);
  }

  /** Stops answering every view. */
  clear(): void {
    for (const view of [...this.views.keys()]) this.drop(view);
  }

  get size(): number {
    return this.views.size;
  }
}

/** Follows the server half's `host.open` requests while the plugin is on; the returned function stops. */
export function followHostOpens(ctx: Pick<ClientContext, 'get'>): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource(routeUrl(PATHS.hostOpens));
  const views = new ShellViews(ctx);
  const answer = (id: string, opened: boolean) =>
    void fetch(routeUrl(PATHS.hostOpened, { id, opened: opened ? '1' : '0' }), { method: 'POST' }).catch(() => {});
  source.onmessage = (event: MessageEvent<string>) => {
    let request: HostOpenRequest;
    try {
      request = JSON.parse(event.data) as HostOpenRequest;
    } catch {
      return;
    }
    if (!request?.id) return;
    void showRequest(ctx, request).then(
      (opened) => {
        if (opened) views.add(request);
        answer(request.id, opened);
      },
      () => answer(request.id, false),
    );
  };
  source.addEventListener(SHELL_EVENT, (event) => {
    try {
      views.event(JSON.parse((event as MessageEvent<string>).data) as ShellEventParams);
    } catch {
      // not a Shell message
    }
  });
  return () => {
    source.close();
    views.clear();
  };
}
