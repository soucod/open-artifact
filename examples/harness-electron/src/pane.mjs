/**
 * The artifact pane: each artifact's page in its own top-level `WebContentsView` beside the chat (`caps.open.embed:
 * 'view'`), talked to through the daemon (`embedArtifact` with a transport) instead of `postMessage`.
 *
 * Appendix C of the integration design, item by item:
 * - Only the origins `embed.origins` lists may load, kept current from `embed/origins` (never all of loopback).
 * - The page gets no Node, no preload of the host's, a sandbox, and a storage partition of its own.
 * - Subframes (`blob:`, `about:srcdoc`) and clipboard writes are allowed; other permissions are not.
 * - Links out and new windows go to the system browser (`onOpenExternal`, `setWindowOpenHandler`); the view itself
 *   never navigates away.
 * - A hidden view is kept, not destroyed; where it was (`onPlace`) is remembered and sent back with `goto`.
 * - A theme change sends `host_hello` again (`setTheme`).
 * - Thumbnails: `capturePage()` as JPEG, saved with `saveThumbnail`.
 */
import { WebContentsView, nativeTheme, session as electronSession, shell } from 'electron';
import { embedArtifact } from '@open-artifact/harness-kit/embed';

/** The views' own storage: nothing the chat window keeps (or a page sets) is shared with it. */
export const PARTITION = 'persist:open-artifact-pages';

/** Permissions a page may have: copying to the clipboard. */
const PERMISSIONS = new Set(['clipboard-sanitized-write']);

const httpish = (url) => /^https?:\/\//i.test(url);
/** A subframe address with no origin of its own: the page made it. */
const ownSubframe = (url) => url.startsWith('blob:') || url === 'about:srcdoc' || url === 'about:blank';

export const themeOf = () => ({ scheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' });

export class ArtifactPane {
  /**
   * `window`: the BrowserWindow the pane sits in; `oa`: the harness; `allowlist`: an `OriginAllowlist` following the
   * daemon; `places`: a `PlaceMemory`; `chat`: what the Shell asks of the chat (`focus()`, `draft(prompt)`).
   */
  constructor({ window, oa, allowlist, places, chat, agentName = 'Example' }) {
    this.window = window;
    this.oa = oa;
    this.allowlist = allowlist;
    this.places = places;
    this.chat = chat;
    this.agentName = agentName;
    /** Artifact link → `{ view, embed }`. */
    this.views = new Map();
    this.current = null;
    this.guardSession(electronSession.fromPartition(PARTITION));
    nativeTheme.on('updated', () => {
      for (const { embed } of this.views.values()) embed.setTheme(themeOf());
    });
    window.on('resize', () => this.layout());
  }

  /** Permissions for every page in the partition. */
  guardSession(ses) {
    const allowed = (permission, origin) => PERMISSIONS.has(permission) && !!origin && this.allowlist.allows(origin);
    ses.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowed(permission, details.requestingUrl)));
    ses.setPermissionCheckHandler((contents, permission, origin) => allowed(permission, origin));
  }

  /** The `open` callback of `createHarness`: shows the artifact, reusing its view when it has one. */
  show(request) {
    const known = this.views.get(request.url);
    if (known) {
      this.focus(request.url);
      const place = this.places.get(request.url);
      if (place) known.embed.goto(place);
      return true;
    }
    // A remote type's page reaches here only once the person agreed (`allowRemote`): let its origins in. A declined
    // page never reaches here (the kit answers the daemon `opened: false`) and nothing remembers the no: the kit's
    // `ask` gate keeps only a yes per origin, so the next open of that page asks again.
    for (const origin of request.remote?.origins ?? []) this.allowlist.trust(origin);
    if (!httpish(request.embedUrl) || !this.allowlist.allows(request.embedUrl)) return false;
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false },
    });
    this.guardNavigation(view.webContents);
    const embed = embedArtifact(this.transport(request.view), {
      url: request.embedUrl,
      harness: 'electron-example',
      agentName: this.agentName,
      toolbar: false,
      theme: themeOf(),
      onReady: () => {
        const place = this.places.get(request.url);
        if (place) embed.goto(place);
      },
      onPlace: ({ artifact, hash }) => this.places.set(artifact, hash),
      onOpenSession: () => this.chat.focus(),
      onNewSession: ({ prompt }) => this.chat.draft(prompt),
      onClose: () => this.hide(),
      onOpenExternal: (url) => {
        if (httpish(url)) void shell.openExternal(url);
      },
      capture: async () => (await view.webContents.capturePage()).toJPEG(70),
      saveThumbnail: (jpeg, artifact) => this.oa.saveThumbnail(artifact, jpeg),
      onError: (error) => console.warn('[pane]', error),
    });
    this.views.set(request.url, { view, embed });
    this.window.contentView.addChildView(view);
    void view.webContents.loadURL(request.embedUrl);
    this.focus(request.url);
    return true;
  }

  /**
   * Messages between this host and the Shell of one view, through the daemon: the view's ticket names it. Without a
   * ticket (an older daemon) the view still shows the page, but host messages cannot reach it.
   */
  transport(ticket) {
    return {
      send: (command) => (ticket ? this.oa.shellCommand(ticket, command) : undefined),
      onEvent: (listener) => this.oa.on('shell', (event) => event.view === ticket && listener(event.event)),
    };
  }

  /** The page may move within the allowed origins; anything else opens in the system browser instead. */
  guardNavigation(contents) {
    const keep = (event, legacyUrl) => {
      const url = event.url ?? legacyUrl;
      if (this.allowlist.allows(url)) return;
      event.preventDefault();
      if (httpish(url)) void shell.openExternal(url);
    };
    contents.on('will-navigate', keep);
    contents.on('will-redirect', keep);
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      if (ownSubframe(event.url) || this.allowlist.allows(event.url)) return;
      event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (httpish(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  focus(url) {
    this.current = url;
    for (const [key, { view }] of this.views) view.setVisible(key === url);
    this.layout();
  }

  /** Hides the pane; the views stay, with their state, for the next open. */
  hide() {
    this.current = null;
    for (const { view } of this.views.values()) view.setVisible(false);
    this.layout();
  }

  /** The chat takes the left part; the visible view the rest. */
  layout() {
    const { width, height } = this.window.getContentBounds();
    const chat = this.current ? Math.min(420, Math.floor(width / 2)) : width;
    this.chatWidth = chat;
    const shown = this.current && this.views.get(this.current);
    if (shown) shown.view.setBounds({ x: chat, y: 0, width: width - chat, height });
  }

  close() {
    for (const { view, embed } of this.views.values()) {
      embed.destroy();
      view.webContents.close();
    }
    this.views.clear();
  }
}
