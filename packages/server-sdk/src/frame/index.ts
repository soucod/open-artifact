/**
 * frame-host: serves an original artifact type (a folder whose index.html
 * declares itself in an inline `// artifact.json` block) so its page runs as
 * it would in its first home.
 *
 * Three windows take part:
 *
 *     the outer Shell (the daemon's /a/<id>)
 *       └─ embeds ─▶ the inner shell (this server, /f/<token>/, Site.page)
 *            └─ embeds ─▶ the original page on its own origin
 *                 (http://<id>.frame.localhost:<port>/_f/<ver>/, Site.content)
 *
 * The page gets `window.openartifact` from the Frame Runtime this server injects
 * first in its <head> (client/runtime.ts). Every capability call is a
 * `__frame_cap` postMessage to the inner shell (client/shell.ts), which
 * carries it here over HTTP and pushes events (db changes, room, file and
 * comment changes, rewiring) back from one event stream.
 *
 * Backends live in the artifact folder: db/ (db.ts), comments.json
 * (comments.ts), the files the page publishes and _blobs/ (files.ts). An
 * agent's edits land on disk; a watcher sends them to open pages.
 *
 * The parts: core.ts serves one artifact to any number of viewers from plain
 * data, and takes everything about where it runs from an environment (env.ts,
 * `FrameEnv`); local.ts is that environment on this computer, with the Node
 * HTTP adapter frame-host mounts (`FrameSite`, `mountFrameSite`). A hosted site
 * imports core.ts and env.ts only.
 */

export { CONTRACT, FrameCore, frameActions, mountFrameCore, pageDeclaration, replyBytes, storedFile, wireUser } from './core.ts';
export { CLIENT_DIR, FrameSite, localFrameEnv, localTypeSource, localUser, mountFrameSite, type FrameSiteContext, type LocalFrameOptions } from './local.ts';
export { parseDeclaration, readDeclaration, DECLARATION_LINE, type Declaration } from './declaration.ts';
export { FrameError, LINK_GUARD, PLAIN_GUARD, type PathGuard } from './files.ts';
export { FRAME_LEVELS } from './env.ts';
export type * from './env.ts';
export type * from './wire.ts';
