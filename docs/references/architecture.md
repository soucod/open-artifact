# Architecture reference

Load this reference when working across packages, daemon/Shell communication, MCP tools, hooks, hosting, or WASM crates.

## High-level data flow

```text
Agent app (Claude Code, Codex, Cursor, Copilot, Antigravity, ZCode, DSH, ChatGPT, or CLI)
   │  MCP tools (Artifact, ArtifactData, ArtifactComments, ShowArtifact) or CLI
   ▼
packages/daemon (local open-artifact daemon, one per machine)
   ├── Type Registry (reads artifact-types/*/artifact-type.json + SKILL.md)
   ├── Artifact Store (maps artifact ids <-> local folders, tracks changed_files)
   ├── Type Servers (spawns per-type servers via packages/type-server)
   ├── Shell & Home UI (packages/shell served at http://127.0.0.1:<port>/a/<id>)
   ├── Inbox & Wake Routing (routes page comments/"Send to agent" back to agent sessions via hooks/adapters)
   └── Remote Link (syncs published artifacts to a self-hosted Node or Cloudflare site)
```

## Package map

### Core platform

| Package | Responsibility |
| --- | --- |
| `packages/protocol` | Shared TypeScript types, tool schemas (`Artifact`, `ArtifactData`, `ArtifactComments`), error codes, and Shell/page/daemon contracts. |
| `packages/daemon` | Local daemon: type registry, artifact library, tool handlers (`src/tools.ts`), MCP server (`src/mcp.ts`), MCP Apps (`src/mcp-app.ts`), Harness API, wake/nudge routing, remote link client. |
| `packages/shell` | Global frame around every artifact (title bar, Share/Export panels, comments/history triggers, "Send to agent") and the local home library page. |
| `packages/runtime` | `window.openartifact` capability API exposed to editor pages (files, uploads, user session, agent channel, presence, downloads, history). |
| `packages/type-server` | Local per-type HTTP/WebSocket server and `cli.mjs` entrypoint copied into `artifact-types/<type>/scripts/`. |
| `packages/server-sdk` | Shared server primitives and frame-host support used by `type-server` and hosts; `./zip` (`src/zip.ts`) is the one zip reader and writer (archives, type packages, imports: `checkZip`, `unpackZip`, `zipBytes`, `archiveEntries`), which the daemon uses too. |
| `packages/live-store` | Real-time JSON document sync store shared by `whiteboard`, `data`, and `motion`. |
| `packages/harness-kit` | The SDK an agent app builds its adapter on: `createHarness` (connect, start the newest compatible runtime, reconnect, sessions, tools, wakes, pages, `runtime.status()`/`runtime.update()`), `./embed` (Shell embedding in a renderer, no Node), `./testing` (a fake daemon that lists the real daemon's features). See `packages/harness-kit/README.md`. |

### Artifact type packages

| Type | Packages |
| --- | --- |
| Slides | `packages/slides-core`, `packages/slides-editor` |
| Design | `packages/design-core`, `packages/design-editor`, `packages/dc` (`.dc.html` format & `support.js` runtime) |
| Design System | `packages/design-system-core`, `packages/design-system-editor` |
| Whiteboard | `packages/whiteboard-core`, `packages/whiteboard-editor` |
| Sheets | `packages/sheets-core`, `packages/sheets-editor` |
| Data | `packages/data-core`, `packages/data-editor` |
| Docs | `packages/docs-core`, `packages/docs-editor` |
| Motion | `packages/motion-core`, `packages/motion-stage`, `packages/motion-audio`, `packages/motion-export`, `packages/motion-editor` |

### Shared UI, canvas, export & WASM

| Package / Crate | Responsibility |
| --- | --- |
| `packages/ui` | Shared UI primitives (Base UI + Tailwind CSS). |
| `packages/editor-kit` | Shared editor controllers & React views (comments, version history, presence, find, merge, Shell bridge). See `packages/editor-kit/README.md`. |
| `packages/export-kit` | Browser-side export helpers (PDF, PNG, HTML, etc.). |
| `packages/canvas-engine` | Shared WebGL2 infinite canvas rendering engine. |
| `crates/open-artifact-canvas` → `packages/wasm-canvas` | Rust/WASM canvas engine core. |
| `crates/open-artifact-export` → `packages/wasm-export` | Rust/WASM binary exporters (e.g., PPTX/XLSX/PDF helpers). |
| `crates/open-artifact-wb-geom` → `packages/wasm-wb-geom` | Rust/WASM whiteboard geometry & routing. |
| `crates/open-artifact-data-rules` → `packages/wasm-data-rules` | Rust/WASM data filter & parameter validation rules. |
| `crates/open-artifact-sheets` → `packages/wasm-sheets` | Rust/WASM spreadsheet formula parser & calculation engine. |
| `crates/open-artifact-motion` → `packages/wasm-motion` | Rust/WASM motion encoding (GIF/MOV) and flash-safety analysis. |

### Self-hosting & plugins

| Path | Responsibility |
| --- | --- |
| `packages/host` | Node.js self-hosted site server (`packages/host/README.md`). |
| `packages/host-cloudflare` | Cloudflare Workers + D1 + Durable Objects site (`deploy/cloudflare/README.md`). |
| `packages/host-plugin` | Plugin contract for custom auth, permissions, policy rules, webhooks, and invite emails (`packages/host-plugin/README.md`). |
| `plugins/` | Per-agent-app bundles (MCP stdio bridge, hooks, monitors/extensions, skill). See `plugins/README.md`. |
| `examples/` | Runnable agent-app integrations (`harness-node`, `harness-electron`, `harness-stdio`) and host plugins. See `examples/README.md`. |

## Agent tools & wake loop

- **Tools** (defined in `packages/protocol/src/tools.ts`, implemented in `packages/daemon/src/tools.ts`):
  - `Artifact`: `quickstart`, `list`, `publish`, `read`, `open`, `call`, `adopt`, `delete`, `share`.
  - `ArtifactData`: `get`, `list`, `query`, `set`, `update`, `delete`, `str_replace`, `batch`.
  - `ArtifactComments`: `read`, `reply`, `resolve`, `reopen`, `wait`.
  - `ShowArtifact` (`packages/daemon/src/mcp-app.ts`): exposed only to MCP clients declaring the `io.modelcontextprotocol/ui` extension. Its view frames the Shell from the daemon's loopback origin (`_meta.ui.csp.frameDomains`) and declares `_meta["openai/ui"].permissions.loopbackNetwork` (`localNetwork` for a private-network origin), so a host that keeps apps on a public origin may let the frame past Chromium's Local Network Access. Codex keeps only https frame domains in a card's CSP, so it refuses the page; the view hears the refusal (`securitypolicyviolation`) and shows a notice with Open in browser and the address to copy at once. It takes the Shell's `shell_hello` as the sign the page showed; when none comes in time, the notice adds Retry. When `ui/open-link` fails or gets no answer, the notice points to the address.
- **CLI parity**: `skills/open-artifact/scripts/open-artifact.mjs` invokes the exact same daemon tool handlers over local HTTP (`artifact`, `data`, `comments`, `open`, `wait`, `mcp`, `hook`). `open-artifact --version` / `-v` prints the runtime's version.
- **Wake routing**: When a user clicks **Send to agent** in the Shell, comments go to the session that owns the artifact: live to a connected Harness API adapter of its harness (`wake.deliver`), else into the daemon inbox, delivered via app-specific hooks (`packages/daemon/harnesses/<name>.json`), background monitors/extensions, the `messages` array in tool responses, or `ArtifactComments {action: "wait"}`.

- **Types people make**: `open-artifact types new | check | from | enable | disable | trust | untrust | list` and the
  Library routes `types.new`, `types.check`, `types.from`, `types.enable`, `types.disable`, `types.trust`
  (`packages/daemon/src/type-authoring.ts`). The routes refuse any `Origin` but the daemon's own (`http://<one of its
  hosts>`), even with the token, and a cross-site `Sec-Fetch-Site`; `types.enable`, `types.disable` and `types.trust`
  also refuse a call that says it comes from an agent's session (`X-Open-Artifact-Agent`), and the CLI refuses them
  there (`personOnly`, `type-enable`/`type-disable`/`type-trust`/`type-untrust`). Each change is logged as an
  `audit:` line, reloads the settings and broadcasts `types/changed`. The `types` route's `projects` lists the types of
  known project folders (session workspaces, trusted projects, the home workspace, projects a type was made in) for
  the home page's Types tab. `type.icon` is a Library read: `api()` sends every other `type.*` name to the Type API.
  `types.from` takes `{artifact}` (a page artifact) or, with the token only, `{path}` (an absolute path to a page saved
  from claude.ai, `typeFromSaved`: `stripFrameRuntime`, `withInferredCapabilities` from `capabilitiesUsed`,
  `metadata.json` read as untrusted one-line text, `SKILL.md` from the `notes-for-claude` block via `pageNotes`).

- **Type packages** (`packages/protocol/src/type-package.ts` for the rules, `packages/daemon/src/type-packages.ts`,
  `packages/daemon/src/artifact-import.ts`): `types pack` (in the CLI process: `types check --for-share`, then
  `zipBytes`), `types install | update | uninstall` and `import` (through the daemon's routes `types.preview`,
  `types.install`, `types.update`, `types.uninstall`, `artifacts.import`, so each is an `audit:` line). A preview reads
  and checks the whole package (`checkZip`, `packageEntryProblems`, `manifestPackageProblems`, the declaration with
  `readStaticDeclaration`) and stages the bytes by sha256 in `<home>/types-staging`; install takes `{sha256}` and
  unpacks exactly those bytes into a dot folder of `<home>/types/` (`OPEN_ARTIFACT_INSTALLED_TYPES`), checks the
  unpacked tree again and renames it into place; `<home>/types.json` records `uid`, `source`, `version`, `sha256`.
  The registry's `installed` root sits between `extra` and `builtin`, is never trusted (`TypeInfo.ownCode` with an
  untrusted root is refused in `servers.ts`; `untrustedEntryRefused` in `types.ts` drops an installed manifest's
  `entry` and an untrusted project's `entry.url`) and never takes a built-in id. Unpacked files are written `0644`.
  The routes go through `typesRefusal` (own origin only, no cross-site; install, update and uninstall refused with
  `X-Open-Artifact-Agent`). Restrictions follow `TypeInfo.trusted`, not scope: frame-host gets
  `OPEN_ARTIFACT_TYPE_SCOPE` and `OPEN_ARTIFACT_TYPE_RESTRICTED` (`stampOf` includes `trusted`, so trusting a project
  restarts it); when restricted it sets `installedTypeCsp(network)` on every content-origin response and its session
  answers `sandbox: RESTRICTED_FRAME_SANDBOX`, which the outer page sets on the inner frame. The daemon does the same
  for a restricted static type in `staticEntry`, puts `sandbox` in `ShellBoot` for the Shell's `Stage` frame and sends
  `frame-src http://*.frame.localhost:<port>` on that Shell page. `restrictedTypeNotice` gives the type's
  `third_party_notice`; reads of such an artifact add `PAGE_CONTENT_NOTICE` (`pageContentFields` in `tools.ts`).
  Links out of a folder are neither served nor written through (`realInside` in `paths.ts`, `staysInside` in the
  server-sdk's `frame/files.ts`, used by publish, db, assets, comments and `artifact-type/`; the stores take it as
  `LINK_GUARD`, a host without links passes `PLAIN_GUARD`). Artifacts record `typeUid` (and `typeSource`) in the record and `.artifact.json`;
  `typeMismatch` refuses open and writes, and `readArtifactArchive` finds an import's type by that uid. A static type's
  `artifact.archive` is zipped by the daemon (`archiveEntries`); frame-host answers `/__open-artifact/archive` itself.

- **Page artifacts**: `Artifact publish` takes `capabilities` for a `page` artifact only (omitted keeps, `{}` clears,
  an object is the whole set), kept in the record (`ArtifactRecord.capabilities`) and `.artifact.json`; frame-host in
  page mode grants exactly those (plus `artifact` and `permissions`). The frame runtime defines `window.claude` as a
  read-only alias of `window.openArtifact` unless the page already has one. `LinkHub` publishes a page only to a site
  whose `hello` says `features.pages` (`PAGE_NO_SITE` otherwise; custom static and page-style types stay
  `CUSTOM_NO_SITE`; a custom frame type, `isSiteKindType`, goes to a site whose catalog has it: see Site types). The declaration does not travel with files (`.artifact.json` is not `linkSynced`): after a
  publish the daemon sends a changed one by `link.capabilities`, and takes the owner's change on the site from the
  `artifact` event's `capabilities`; `ArtifactRemote.capabilities` is the last agreed one, so neither side echoes.

- **Page artifacts on the Node site** (`packages/host/src/node/frames.ts`, `core/page-host.ts`): the rooms send
  `/page/…` on an artifact's content host (the inner shell and its API, under the viewer's page token) and every page
  host (`<idlabel>--<opaque>`, the page's files) to a frame engine, everything else to the type server. The engine
  runs one `FrameCore` per artifact with a site `FrameEnv`: the viewer from the page token and the live role
  (viewer→`view`, commenter→`view`+comments, editor→`admin`, owner→`owner`; guests marked), `withholdIdentity`,
  `restricted`, no watcher (Link pushes and the site MCP's writes call `noteChanges`), `people()` the owner and user
  grants, the network policy of `OA_PAGE_NETWORK` (`installedTypeCsp`), wakes and touches through the rooms' type API
  (the outbox, as built-in types). The opaque part is an HMAC of the signing key over artifact, principal and site
  epoch (24 base32 characters); an index under `<dataDir>/page-hosts/` maps it back, and every request checks the HMAC
  and the live role again. `hostKindOf` names page hosts (`kind: "page"`), TLS ask allows only placed ones, and with
  `OA_CONTENT_SAME_SITE` the engine is off. The site MCP's `publish` takes `capabilities` for a page (owner only);
  `link.import` and library uploads take a page by its `.artifact.json` (`importArchive`'s `markerTypes`).

- **Site types** (`packages/host/src/core/catalog/site-types.ts`, `core/link/types-routes.ts`,
  `packages/host/src/node/site-types.ts`): migration 10 adds the `types` table (uid primary key, id unique, version,
  publisher, visibility, sha256, capabilities, network, `unpublished`). `SiteTypes` holds the rules, pure over a
  `SqlDriver` (`plan`: built-in, reserved and taken ids, uid and version shape, who manages it, same version other bytes;
  `mayPublishTypes` for `OA_TYPES_PUBLISH`, forced `off` with `OA_CONTENT_SAME_SITE`; `mayListSiteType` /
  `mayDownloadSiteType` for visibility; unpublish delists while `artifactCount` > 0, else removes). The Link routes
  `types.import` (policy, `SiteTypeServices.read`, `plan`, the `type.publish` guard, `store`, `save`, `activated`, the
  old version's files removed, audit), `types.list` (with `THIRD_PARTY_NOTICE`), `types.archive` and `types.unpublish`
  are registered only with `LinkServices.siteTypes`; `hello` then says `features.types` and `typesPublish`. The Node
  side reads a package with the server-sdk's `checkTypePackage` (the daemon's install check), keeps only page-kind
  types (no `entry`, not `style: "page"`, a declaration), unpacks it `0644` into
  `<dataDir>/types/<uid>/<version>/files/` with `package.oatype` beside it, and gives the frame engine one
  `SwappableSource` per id (`withSiteTypes`; fingerprint `uid@version:sha`): `FrameEngine.typeChanged` updates the CSP
  (`installedTypeCsp(row.network)`, never `OA_PAGE_NETWORK`) and reloads open pages. A catalog artifact runs restricted
  under `/page/` (`rooms.pageFor`), with its type's declared capabilities. Imports (`importInto`, `siteTypeImport`)
  take a catalog type by `.artifact.json` `type` plus `typeUid` (`type_missing`, `type_mismatch`; a delisted type
  takes no new artifact). The site MCP adds `third_party_notice` (`THIRD_PARTY_NOTICE` + `PAGE_CONTENT_NOTICE`) to
  results about such an artifact (`McpServices.publishedType`). The daemon: `isSiteKindType`, `typePublishRefusal`
  (user, extra and trusted-project types only), `packTypeBytes`, `LinkHub.publishType` / `unpublishType` and
  `publish(…, {withType})` (the type first with `link` visibility when the site lacks it), the Library routes
  `types.publish` / `types.unpublish` (refused with `X-Open-Artifact-Agent` in `typesRefusal`, as is
  `artifacts.publish {withType}`); automatic publishing skips custom site-kind types. Cloudflare has no
  `siteTypes` yet: it needs a `SiteTypeServices` over object storage and a frame engine.

- **The frame core** (`packages/server-sdk/src/frame/`): `core.ts` (`FrameCore`, `mountFrameCore`) serves one
  artifact to any number of viewers from plain data (`FrameRequest` → `FrameReply`; `connect` for an event
  connection) and takes everything about where it runs from a `FrameEnv` (`env.ts`): the viewer of each request, the
  shell and page origins, admission, the type's files, the client files, the change watcher (null: every write goes
  through the core, a host's own writes come in by `noteChanges`), restricted or not, and the stores' `PathGuard`.
  A restricted page whose origin is one the inner shell uses is refused at mount (`same_origin`). `local.ts` is
  frame-host's environment (`localFrameEnv`: loopback admission, the owner as every viewer, the type folder,
  `CLIENT_DIR`, `fs.watch`) and its Node HTTP adapter (`FrameSite`, `mountFrameSite`); `core.ts` imports no Node-only
  module (`test/frame-env.test.ts` walks its import graph).
  The `snapshot` action of page-kind types is local too: `frame/snapshot-action.ts` (`localFrameActions`, what
  frame-host passes; the core's `frameActions`, which a hosted site serves, has no `snapshot`) and the camera
  `src/snapshot.ts` (headless Chrome over CDP, shared with `type-server`, which re-exports it). The camera loads the
  inner shell at `/snapshot/<one-time credential>/` (`FrameSite.beginSnapshot`, claimed only while the visit lasts):
  a viewer of its own with the owner's level whose calls pass a read list (`SNAPSHOT_READS`) and are refused
  otherwise, with a quiet event stream (`hello` only, never the core's `connect()`: no peer, no reload). The shell
  marks `<html data-open-artifact-shell="revealed|problem">`, which is what the camera waits for. Pictures go to
  `<root>/_agent/snapshots/`, which is never served, archived, duplicated, synced or counted as content.

- **Enforcement in the frame core**: every call is checked on the server against the request's `FrameViewer` (its
  `level`, `view < interact < admin < owner`, and `canComment`), never against what the page or the inner shell
  says. `access.ts` holds the rules as pure functions (`test/frame-levels.test.ts` runs every level against every
  rule kind); `core.ts` applies them (`test/frame-site.test.ts` runs several viewers on one instance):
  - `db`: the declaration's `rules` (`{path, read?, write?}`; `{self}` subtrees; the `self` level nobody holds; the
    built-in `data/users/{self}`, so another viewer's `data/users/<id>/` is private, the owner's view included, unless a
    rule at `data/users`, or a rule at `data` beside `data/{self}` (`data/users` is then a sibling's subtree), opens it). With
    no rules, `view` reads and `interact` writes. A refused read looks like a missing document (`get`, `query`, whose
    limit counts only readable rows), a refused write is `invalid_argument`, and change events reach a connection
    only for paths its viewer may read. A lease's holder is the viewer's id plus the page's string; a busy answer
    names the holder only when it is the viewer's own (another tab). Rules that break the grammar fail closed (only the owner reads or writes).
  - `artifact` publish, sync and edit: `admin` and up (`not_writer`); on a site `{artifact: {publish: false}}` makes
    them `not_granted` for everyone (locally the declaration is not read for it, as before). The `title` and
    `agent`/`activity` routes follow the same levels.
  - `assets`: granted at `admin`, or at `interact` with `{assets: {upload: "interact"}}`, checked before an upload's
    body is read; the blob's metadata records its `uploaders` (the same bytes from two people are one asset both
    claim; older metadata's single `uploader` reads as one claim, none as the owner's). Below `admin` a viewer lists
    only what it claims and deletes only its claim (`not_uploader` without one), the bytes going with the last claim;
    an editor's delete removes the asset.
  - `comments`: granted only with `canComment`, authored as the viewer; resolve, move and delete need the thread's
    starter or an editor (`forbidden`); comment events and counts go only to viewers who may comment. On a site the
    threads a page gets (`list` and every answer that carries a thread) name an author only under the `profile` scope
    and carry its `principal` only when `user` is declared; the viewer's own messages carry `author.mine`. The inner
    shell's own comments UI marks its calls `shell: true` in the `/api/frame/cap` envelope (a call it relays from the
    page never does) and gets the threads as stored.
  - `user`: where `FrameEnv.withholdIdentity` (a site), name and avatar only under the `profile` scope, email only
    under `email` (in `session.me` too); `profiles`, `search` (only under `profile`, for a viewer who edits or
    comments) and `access` answer only about `FrameEnv.people()`. Locally as before: names, no email, an empty search.
  - `room`: on a site, `from` (and the publish echo's) is the viewer's own connection (a client id that is not one
    sends nothing; locally the id as given, as before); on a site `by` only
    when `user` is declared and names only under `profile`; topics are `admin`-only unless
    `capabilities.room.topics` opens one to `interact` (`not_permitted`).
  - The owner's agent (`comments.sendToAgent`, `room.sendToAgentSession`, `/agent`): an editor who may comment.
  - Origins: the page's origin answers from `FrameEnv.reader` (the page's own read-only token, never the viewer's;
    `GET`/`HEAD` of files only), and a viewer marked `readOnly` is refused on every inner-shell route, the event
    stream and WebSocket included; `/_blob/<id>` on the inner shell's origin is served only once admitted; both
    origins send `Referrer-Policy: no-referrer` (the page frame keeps `referrerpolicy="origin"`, so the page origin
    still sees who framed it). `FrameEnv.pageOrigin(viewer)` is the origin the inner shell frames
    the page on (`session.contentOrigin`): a site puts the page's read-only token in it as a host label and resolves
    the reader from `Host`, since the page's own addresses are root-relative; the session refuses one that is a shell
    origin.

  On this computer the one viewer is the owner and may comment, its reader is the owner, its people are itself, and
  identity is not withheld, so what a page can do here is unchanged.

## Live document sync (`db`)

`whiteboard`, `data` and `motion` pages edit `<root>/db/` through the runtime's `db` capability
(`packages/runtime/src/capabilities.ts`), synced by `@open-artifact/live-store` (`packages/live-store/src/engine.ts`):
what the page shows is the server's documents with the page's own unsaved and unanswered writes on top.

- **Order**: the type server's `DbHost` (`packages/type-server/src/db-host.ts`) keeps `{epoch, seq}`: a random epoch per
  instance, and `seq` counts its change events. Events carry it; so do write answers (`{epoch, seq, documents}`, each
  written document as stored, `null` when absent) and listings (`db.listing(collection)`: `{epoch, seq, documents}`).
  The engine keeps, per document, the newest `seq` it has taken and ignores anything older. Events arrive in order on
  one stream; a write answer or a listing can arrive before or after events about older or newer changes, and the
  `seq` sorts them out (a deleted document is not brought back, an agent's edit merged into a write shows at once).
- **Reconnects**: every event stream starts with a `db` event `{changes: {}, resync: true, epoch, seq}`. When the
  events heard or the listings already reach that `seq`, nothing was missed; otherwise (or on a new epoch, after a
  restart) the engine lists the collections again in the background, with editing still open.
- A store without an order (a plain `DbCapability` with no `epoch`/`seq`) still works: write answers are then held
  over later events for a few seconds, as before.
- A Shell can outlive a daemon upgrade (it frames the page across reconnects), so a new page may talk to an older
  broker that does not know `db.listing` and refuses it as `invalid`. The engine then asks `list` instead and keeps to
  it (`listCollection` in `engine.ts`; `e2e/shell-save.test.mjs` (c)).
- Whiteboard inks are ordered by `at`; `addInk` stamps one past the newest so a page with a slow clock still lands last.

## Harness API & agent-product integration

Agent apps integrate through the Harness API, JSON-RPC 2.0 over the WebSocket `/__harness` (subprotocol
`open-artifact-harness`), over HTTP long polling, or over `open-artifact harness --stdio`. The user-facing guide is
`docs/integrating.md`; the references are `docs/spec/harness-api.md`, `docs/spec/embed.md` and `docs/spec/profile.md`.

| Module (`packages/daemon/src/`) | Responsibility |
| --- | --- |
| `harness.ts` | The WebSocket and polling endpoints, `hello`, sessions, tool calls, `host.open`, `wake.deliver`, events. |
| `harness-features.ts` | The feature names `hello` lists and the protocol versions (`PROTOCOL_MIN`/`PROTOCOL_MAX`). Within a version, only additions. |
| `stdio-bridge.ts` | `harness --stdio`: JSON lines on stdin/stdout; starts the daemon, says `hello` with the token, reconnects and attaches sessions again. |
| `harness-profiles.ts`, `hook-dialects.ts`, `nudge.ts` | Shipped (`packages/daemon/harnesses/*.json`), adapter-reported and person-added profiles; hook input/output formats; waking idle sessions. |
| `harness-skill.ts` | `skill.get` and `commands.list`: the skill and the per-type commands rendered for a harness. |
| `harness-embed.ts`, `harness-view.ts` | Declared host origins and view tickets for top-level views; `view.context` for the owner session. |
| `ownership.ts`, `release-guard.ts` | Which session owns an artifact (and when that moves); artifacts written by a newer type release are read-only. |
| `runtime.ts`, `cli-runtime.ts`, `sea.ts` | Runtimes on this computer, update policy and checked updates, `open-artifact runtime …`; the single executable's entry (`scripts/build-sea.mjs`). |
| `doctor.ts`, `doctor-checks.ts`, `doctor-remote.ts`, `doctor-conformance.ts` | `open-artifact doctor`: setup checks (including `node-children`, how type servers run), remote-type probes, and with `--session` the conformance run of a running app. |
| `servers.ts`, `node-children.ts` | Type servers: start, ready, restart on a type change, idle stop. A server whose command is `node` runs as a child process (the daemon's executable with `ELECTRON_RUN_AS_NODE=1`) or, when the daemon runs inside an Electron process (`process.type` set, as in a utility process, which an app with the `RunAsNode` fuse off uses), in a worker thread of the daemon; decided from how the daemon runs, nothing is started to find out. `OPEN_ARTIFACT_NODE_CHILDREN=process\|threads` forces one; the choice is in `/__open-artifact/health` as `nodeChildren`. |

The kit (`packages/harness-kit/src/`) mirrors this from the app side: `harness.ts` (`createHarness`), `client.ts`
(the JSON-RPC client), `runtimes.ts` (which runtime to start), `daemon.ts` (`ensureDaemon`; a host's `daemon.spawn` starts
the process itself, as an Electron app does with `utilityProcess.fork`), `skill.ts`, `context.ts`, `embed/` and `testing.ts`.
Shell-side, `packages/shell/src/shell/bridge.ts`, `view-channel.ts` and `lib/host-origins.ts` speak the host messages
of `packages/protocol/src/shell.ts`.

Between the Shell and its framed page, `bridge.ts` speaks the chrome messages of the same file (`chrome_hello`,
`chrome_report`, `chrome_cmd`). The Shell covers the frame while its document loads and lifts the cover on the page's
first report, on `load` for a static page, or `FRAME_READY_FALLBACK_MS` after `load`. A static page never reports, so
a document it navigates to shows at once, with no cover. A page that reports `ready: false` keeps the cover until it
reports otherwise, for at most `CHROME_READY_TIMEOUT_MS`; once the page has been shown, `ready: false` is ignored until
the frame loads another document. When the Shell itself reloads the frame (Refresh, or files changed under a static
page), reports that come before the next `load` are the old document's and are ignored: the new one answers that
`load`'s `chrome_hello`. `saved: 'saving'` covers edits waiting
out a write debounce (the Shell shows it after `SAVING_SHOWN_AFTER_MS`); `unsaved` means a save failed. The runtime's
`shellArtifactId()` (also `ShellConnection.artifactId`) reads the artifact id the Shell puts on the page address: on a
cloud host the page path carries a page token that changes on every load, so per-artifact memory in the page's browser
storage is keyed by that id (the whiteboard keeps its camera, saved copy, load marker and agent status this way).
