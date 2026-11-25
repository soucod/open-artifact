# Changelog

Every release of Open Artifact: the `@open-artifact/*` libraries, `@open-artifact/cli`, `dsh-open-artifact` and the
agent plugins. Since 0.9.0 they all share one version; before that `dsh-open-artifact` had its own (noted per release).

Each entry is written from the commits since the previous tag (`node scripts/changelog.mjs` lists them); see
[Releasing](README.md#releasing).

## [0.14.6] - 2026-11-23

Design lists the errors of its artboards where you can see them and asks the agent to fix them, and the MCP App card says when the app keeps the artifact's page out of the conversation, as Codex does, and always leaves a way to open the page.

### Added

- Design shows "N errors" at the top right when artboards on the page have errors. It opens a list with each artboard's messages and "Ask agent to fix" for all of them, and closes itself once no artboard has errors.
- Each artboard with errors has a notice underneath with the count, "Ask agent to fix" and ×. Closing it leaves a warning mark in the artboard's name strip that brings it back, and a closed notice comes back by itself when the artboard's errors change. The request names the files under `project/` and lists each message (deduplicated, at most 10 per artboard); when the agent can't be reached, it waits in the list with "Copy the request".

### Fixed

- In Codex, the `ShowArtifact` card showed only the browser's "This content is blocked" page, and Open in browser seemed to do nothing (#19). Codex shows only https pages inside MCP App cards, so it refuses the page the daemon serves on this computer. The card now says so at once, hides the browser's error page, and offers Open in browser and the page's address to copy.
- When the page does not show for another reason (the app may first ask the person to allow it), the card says so after a few seconds, with Retry, Open in browser and the address.
- When the app does not open the link (it answers with an error, offers no link opening, or does not answer within 3 seconds), the card points to the address to copy.

### Changed

- The card's view declares the network permission its frame needs in `_meta["openai/ui"].permissions` (`loopbackNetwork` for a daemon on this computer, `localNetwork` for one on the local network), which apps that keep MCP Apps on a public origin need before Chromium lets the frame through.

### Integrators

- The Harness API, Shell and wake messages, harness kit, stdio bridge and shipped profiles are unchanged. For MCP Apps hosts, [docs/integrating/tools.md](docs/integrating/tools.md) describes what the `ShowArtifact` view needs: its frame origin in `frame-src`, and the network permission it declares.

## [0.14.5] - 2026-11-23

Slides preserves polygon clips on panels and photos in the editor and exports, including editable PowerPoint shapes and picture crops.

### Added

- Slides accepts `clip-path: polygon(...)` in inline styles and shared `deck.css`, with px, percentage and mixed `calc()` coordinates. Shared stylesheet tokens can set fixed corner cuts that stay the same size as a frame is resized.
- Plain clipped panels export to PowerPoint as editable custom shapes, and clipped photos as pictures with editable crops and polygon outlines. HTML, PDF and PNG retain the CSS clip; clipped containers with children, crossing outlines, or clips combined with borders, shadows, filters or rounded corners become pictures in PowerPoint and are listed in the export notes. Thanks to @rodriguezst for PR #18.

### Fixed

- Unsupported clip paths now explain what to use instead: `border-radius` for rounded or round frames, `polygon(...)` or an SVG for other outlines, and the border box as the polygon reference.

### Integrators

- The Harness API, Shell and wake messages, harness kit, stdio bridge and shipped profiles are unchanged.

## [0.14.4] - 2026-11-23

Artifacts load inside Electron apps whose windows use `file://`, agents can write long formulas to Sheets, and Motion films can play captioned cuts of a video's own sound.

### Added

- A Motion narration line can name a video asset and a `from` time to play a cut of the clip's own sound with captions. Cuts use the same loudness target, ducking, live player and export mix as recorded narration; the clip is decoded once for all its cuts. Video playback adjusts its speed slightly to keep the picture with its sound.
- A Japanese README links from the English and Simplified Chinese READMEs.

### Changed

- Every MCP tool argument has a description, including its enum values where applicable, for apps that show agents descriptions without the schema's enum list.

### Fixed

- A ticketed Shell view works inside an app's iframe, including a window loaded from `file://`: it sends commands and events through the daemon without greeting or listening to its parent frame. Local built-in type pages no longer send a `frame-ancestors` directive that refuses a `file://` or custom-scheme ancestor.
- Original types served by frame-host also load under a `file://` app. They check incoming frame requests instead of sending a `frame-ancestors` list that cannot name the app, and the daemon lists each local type server's per-artifact frame origins.
- An agent's Sheets `writeCells` accepts formulas containing long Chinese or English text, including batches of more than 50 different long texts, without asking the agent to show them to the person first. The editor's own paste checks are unchanged. Fixes #17.
- Quickstart with the intent `other` recommends no type and lists all types, instead of accidentally recommending Design System from words in its description.

### Integrators

- For a window loaded from `file://`, use `mode: 'view'`, load the ticketed `embedUrl` in your iframe, and give `embedArtifact` a transport rather than the iframe. The Shell uses the daemon channel even when framed; the host protocol remains 1.
- `embed.origins` now includes a `kind: 'frame'` pattern (`http://*.frame.localhost:<port>`) for each local type server, with its `type`. Allow these patterns when enforcing the daemon's origin list so original types can load.
- Tool argument descriptions now state their accepted enum values. The Harness API methods, harness kit, wake messages, stdio bridge and shipped profiles are unchanged.

## [0.14.3] - 2026-11-23

A whiteboard fits and zooms out fully in a narrow pane, live boards, dashboards and films stay in step when answers and changes cross or a connection drops, the daemon says when it stops, and an Electron app is shown how to stop its daemon on quit.

### Changed

- A whiteboard zooms from 5% to 800% in a view of any width. Views up to 900 px wide, and touch devices, had a minimum of 60%: there "Fit the board" stopped at 60% with part of the board out of view, "Zoom out" was disabled, and ctrl/⌘ + wheel did not zoom out.
- `daemon.log` gets `daemon <version> stopped (<why>)` when the daemon stops by itself: `SIGTERM` (`open-artifact daemon stop`), `SIGINT`, `SIGHUP`, `idle` (in place of `idle: exiting`), or `leaving for runtime <version>`. A log without it ends with a daemon that was killed.
- `@open-artifact/motion-export/build` exports `RASTER_FRAME_ENTRY` and `STANDALONE_AUDIO_ENTRY` without a file extension (`./raster/frame-entry`, `./standalone/audio-entry`); the helper adds its own (`.js` from npm, `.ts` in the repository). The declarations used to name `.ts` files the npm package does not ship. The builds themselves already worked from the installed package and are unchanged.

### Fixed

- A `SIGTERM`, `SIGINT` or `SIGHUP` that reaches `open-artifact daemon run` while it starts no longer ends the process with `daemon.json` and `daemon.lock` left behind. The handlers are in place before the daemon takes its lock, and a signal that comes early is acted on once the daemon has started.
- Whiteboards, Data dashboards and Motion films no longer lose or undo changes when the answer to a page's save and someone else's change arrive out of order. A deleted element could come back, an older change could replace a newer one, and an agent's edit to a file merged into a page's save showed only after the next change. The type server now numbers its changes (`epoch` and `seq` on each `db` event, write answer and listing), and a page keeps, per document, only what is newer than what it has. (Replaces the approach of PR #15, which kept a deletion history per document; thanks to dunature for finding the races.)
- A page whose event stream dropped (sleep, a network change, a restarted type server) shows what changed while it was away, without a reload. Every stream starts with a `db` event saying where the store stands; a page that heard less reads the documents again in the background, and editing stays open.
- A whiteboard ink added on a computer whose clock is behind lands after the inks already saved, instead of sorting before them and being the first to go when the palette is full.
- The end-to-end harness no longer stops Chrome's renderer on a page that starts a module worker. It asked its questions in workers too, and Chrome 157 fails a check of its own when `location` is read in a module worker whose script has not all arrived; that was the intermittent `renderer crashed: iframe …/whiteboard/…` of the Cloudflare suites (`cloudflare-link` on a first run). Workers are now watched for errors and never asked.

### Integrators

- An Electron app that forks the daemon in a utility process should ask it to stop before it quits: `child.kill()` (`SIGTERM` on macOS and Linux), then a bounded wait for `exit` (the daemon waits up to 6 s for its type servers; the example waits 8 s). Electron otherwise ends the process without a signal, and `daemon.json` and `daemon.lock` stay behind with the type servers cut off. `docs/integrating/runtime.md` says how, and `examples/harness-electron` does it (`stopDaemonUtilityProcess` in `src/daemon-spawn.mjs`, called from `before-quit`).
- `@open-artifact/runtime`'s `db` capability gains an optional `listing(collection)` (`{documents, epoch?, seq?}`), and `write` may resolve with a receipt (`{epoch, seq, documents}`). `DbChangeEvent` gains optional `epoch`, `seq` and `resync`; an event stream now opens with `{changes: {}, resync: true, epoch, seq}`. A host or test double that sends none of these still works: pages fall back to the previous behavior. A `listing` refused as `invalid` or `not_granted` (a Shell from 0.14.2 left open while the daemon was upgraded brokers no `listing`) is asked again as `list`, and the page keeps to `list`.
- The Harness API, the Shell and wake messages, `@open-artifact/harness-kit`, the stdio bridge and the shipped profiles are unchanged.

## [0.14.2] - 2026-11-23

Whiteboards restore their view before appearing, keep it across hosted-page reloads, and show pending saves without false failure warnings.

### Changed

- The Shell keeps its loading cover over a whiteboard while it restores its camera, loads fonts and pictures, and paints drawings. History and Comments keep their toolbar slots during reloads, and a brief save no longer flashes “Saving…”.
- Editors report edits waiting for a debounced write as `saving`; `unsaved` is reserved for a failed save.

### Fixed

- A whiteboard on a cloud host keeps its camera across reloads even though its page token changes. Camera, recovery copies and remembered agent status use a stable artifact identity; recovery copies are also scoped to the viewer and role, and obsolete token-based copies are removed.
- Refreshing while the old page finishes a save no longer uncovers the new page before it is ready. A page that stops reporting readiness cannot keep the Shell covered for more than ten seconds, and static-page links appear promptly again.
- Whiteboards save their camera when leaving the page, keep drawings painted while they remain in view, and preserve the view's centre when restoring a zoom outside the compact range.
- A whiteboard that fails to load without pending edits no longer reports unsaved work. A failure while starting its services reveals the page and stops the services already started.

### Integrators

- Chrome protocol 1 adds optional `ChromeReport.ready`: send `false` before the frame loads to keep the loading cover up, then `true` when the initial view is restored. Once shown, the document ignores later `false` reports; the cover is capped by `CHROME_READY_TIMEOUT_MS` (10 seconds). Pages that omit it keep the existing behaviour.
- `@open-artifact/runtime` exports `shellArtifactId()` and exposes the same stable id as `ShellConnection.artifactId`, for page state that must survive cloud-host token changes. They return `null` outside the Shell or when no id was supplied.
- `ChromeSaved` keeps the same values: report `saving` for pending writes, including the write debounce, and `unsaved` only for a save failure. The Shell waits 500 ms before showing “Saving…”. The Harness API, host messages, harness kit, stdio bridge and shipped profiles are unchanged.

## [0.14.1] - 2026-11-22

Open Artifact runs inside an Electron app whose `RunAsNode` fuse is off: the app starts the daemon itself, and type servers run in worker threads.

### Added

- An agent app can start the daemon process itself: `createHarness({ daemon: { spawn } })` (and `ensureDaemon({ spawn })`) hands it the runtime's entry, the arguments, the environment and the log file. The kit still chooses the runtime, waits for the daemon, checks its version and tries the next runtime, and its `daemon_failed` error says what the app's start threw. An Electron app with its `RunAsNode` fuse off forks the daemon with `utilityProcess.fork`.
- When the daemon runs inside an Electron process (`process.type` is set, as in a utility process), it runs the type servers whose command is `node` in worker threads of its own process instead of child processes, since its executable must not be started as Node. Under plain Node, or Electron running as Node, it keeps child processes; it starts nothing to decide. `OPEN_ARTIFACT_NODE_CHILDREN=process|threads` decides instead. Starting, restarting on a type change, stopping when idle, crashes and logs behave as with processes.
- `open-artifact doctor` says how type servers run ("Type server processes"), the daemon's `/__open-artifact/health` answers it as `nodeChildren`, and the daemon log says it once.
- `examples/harness-electron` shows the utility-process start beside the default one (`OA_EXAMPLE_DAEMON=utility`).

### Changed

- `harness.installSkill` passes `opens: 'host'` when the app gave `createHarness` an `open` callback and did not pass `opens`, so the skill the kit renders itself (no daemon, or one without `skill.get`) says the app shows pages, as the daemon's rendering does.
- When the daemon stops, it waits for type servers running in threads to end before it exits.
- A type server's state file (`.artifact-server.json`) also records its thread when it runs in one, and is removed only by the server that wrote it.

### Fixed

- A daemon started by an Electron app with its `RunAsNode` fuse off no longer starts a copy of the app when it leaves for a newer runtime; it stops and the app's kit starts the newer one on its next connection.
- `examples/harness-electron` no longer hangs at start: it awaited `app.whenReady()` at the top level of its main module, which Electron resolves only after that module has finished.
- The type declarations in the published libraries (`@open-artifact/harness-kit`, `@open-artifact/protocol` and the rest) import `./x.js` instead of `./x.ts`, a file the package does not have. `scripts/build-npm.mjs` rewrites them and fails when one is left.
- The Shell names the harness that owns an artifact by its profile `title` instead of its id: the Ask pane ("Messages go to the Cindy session…" rather than "the cindy session"), its offline note, the open-session button and menu item, and the owner badge on the home page. A harness whose profile has no title still shows its id as it is.
- The integrator guide and the Harness API reference document the skill helpers' `opens` option (its values and its default) and what `caps.library` does: it is only recorded and shown, and can be left out by an app with no list of artifacts.

### Integrators

- New kit option `daemon.spawn` (types `DaemonSpawn`, `DaemonStart`, `DaemonExitSource`). Without it nothing changes. The Harness API, the protocol (still 1), the Shell messages, the stdio bridge and the shipped profiles did not change, so there is no new `hello` feature.
- `env` given to `spawn` has no `ELECTRON_RUN_AS_NODE`; in a utility process `process.argv` already has the shape the daemon reads, so fork the entry as it is. Pass `OPEN_ARTIFACT_NODE_CHILDREN=threads` in that `env` to say so explicitly; an app with the fuse on that forks the daemon in a utility process and wants child processes passes `process`. A daemon in a utility process ends with the app. Details and limits in `docs/integrating/runtime.md`.
- The `.d.ts` files of the npm packages now name `.js` files in their relative imports, so a project on `moduleResolution: node16`/`nodenext`, or a tool that reads the specifiers as written, finds them. Nothing else in the declarations changed.
- An artifact's `owner` (in `GET /api/open-artifact.artifact` and the library list) has a new optional `harnessTitle`: the profile's `title`, left out when the profile has none. To have the Shell show your app's name, report it as the profile title: `createHarness({ profile: { title: 'My App' } })` (an existing option; no new `hello` feature).
- Pass `opens` to `installSkill` (and `renderSkill`, `localSkill`, `keepSkillInstalled`) so the skill tells your agent how pages open in your app: `host`, `agent-browser`, `system` or `link`. Left out, `harness.installSkill` and the daemon pick `host` when you pass `open` (an `opens` you pass wins); the standalone `installSkill(client, …)`, `renderSkill` and `localSkill` use only what you pass.

## [0.14.0] - 2026-11-22

Build Open Artifact into your own agent product: an SDK for agent apps, pages shown inside the app, comments delivered to the right session, and a runtime that keeps itself current.

### Added

- `@open-artifact/harness-kit`, an SDK for agent apps. It finds or starts the daemon, reconnects, hands the app's agent the three tools, routes comments and requests sent from a page to the session that owns the artifact, and installs the skill under the app's own command name. It comes with a stand-in daemon for an app's own tests.
- Artifact pages inside an agent app, in a frame or as a top-level view: the app gets the list of origins to allow, a handshake with the page's toolbar, the app's colour scheme, export destinations, thumbnails, and what the person is looking at as context for the next message.
- An agent app can describe itself in a profile file (`open-artifact harness add | list | remove`) instead of needing code in the daemon: its agent's name, how its hooks answer, how an idle session is woken, and rules for what its agent may make.
- Types served from another computer are marked wherever a type is described, with the domain their page and content are on. An app chooses whether to show such pages (`allow`, `ask`, `deny`), and creating an artifact of a type that cannot be reached says which address failed and why.
- `open-artifact runtime status | update | pin | policy`. The runtime on a computer is the newest compatible one any app brought or the person installed; a check for a newer one runs at most once a day and downloads nothing until asked, unless the policy is `auto`. A download is checked against the registry's sha512 integrity; provenance attestations are recorded but not verified.
- `open-artifact doctor` checks a computer's setup; with `--harness <name> --session <id>` it runs a conformance script against a running agent app, and it checks that types on other computers answer.
- `open-artifact harness --stdio`, the same API over a process's stdin and stdout, for apps not written in JavaScript, with a Python example.
- A single-file executable of the runtime can be built from source (`npm run build -- --only sea`) for computers without Node.js. It was built and tested on macOS arm64 only and is not attached to releases yet.
- `open-artifact skill render | install` and `open-artifact --version`.
- A guide to integrating an agent product, topic pages and reference specifications under `docs/integrating` and `docs/spec`, in English and Chinese, with runnable examples in `examples/harness-node`, `examples/harness-electron` and `examples/harness-stdio`.
- User and agent guides and a guide for each artifact type, in English and Chinese, under `docs/`.

### Changed

- An artifact last written by a newer release of its type than the one installed opens read-only, with a line saying how to update; agents' writes to it are refused rather than risk dropping what the newer release stored.
- When a session other than the one that made an artifact changes it, the artifact's comments go to that session from then on, and the earlier session is told.
- A message sent from a page says when the app put it in the conversation for the person to send, instead of saying it was sent to the agent.
- Agents include the artifact's link in their reply whether or not the page opened by itself.
- The DeepSeek Harness and ZCode plugins run on the SDK. The DeepSeek Harness plugin starts the newest compatible runtime on the computer rather than always its own copy, shows who sent a comment, and delivers a collaborator's comment or a finished task as a notice rather than as the person's own message.
- Deleting a document with `ArtifactData` counts as an edit of the artifact, not as removing it.

### Fixed

- A type served from another computer is no longer sent the artifact's folder path on this computer, and the daemon no longer follows that server's redirects or reads answers of unbounded size from it.
- On Windows, waking an idle session no longer tries to run a `.cmd` file, which Node.js refuses; an `.exe` is looked for first.

### Integrators

- The Harness API is still protocol 1 and every change is an addition. `hello` answers a list of feature names; test for a feature before calling a method added in this release (`skill.get`, `commands.list`, `embed.origins`, `shell.command`, `view.context`, `runtime.status`, `runtime.update`).
- A wake's `source` always carries `reason` and `from`. Treat only the owner's words as the person's message; `@open-artifact/protocol` types them as required, and `wakeSourceOf` fills them in for a wake from an older daemon.
- JSON-RPC error numbers are the same on the WebSocket and the stdio bridge: `invalid_argument` is now -32602 on the WebSocket (it was -32000). Switch on `error.data.code`, which did not change.
- The Shell takes `host_hello` only from an origin a connected adapter declared in `caps.open.origins`. While no adapter declares any, a page that frames the Shell is still taken as its host but gets no prompt or comment text, links or saved files. A page loaded from `file://` has no origin to declare: use a custom scheme or the top-level view.
- What an adapter reports about its harness is data: `nudge`, `mcp`, `skillsDir` and `sessionWorkspace` are read only from a profile file on disk. Profiles now name their hook format (`hookDialect`) and wake command (`nudge`, a program and arguments run without a shell).
- Tool definitions list each action's kind (`read`, `write`, `ui`, `remove`, `person`) and the actions that reach another computer for a remote type; over MCP both are under `_meta`, and `openWorldHint` is true once a remote type is installed.
- `dsh-open-artifact` is built on `@open-artifact/harness-kit` and no longer ships `skills/open-artifact/SKILL.md` in the repository; the file is written at build time.
- `dsh-open-artifact` ships `scripts/open-artifact.mjs` and `vendor/runtime.json`, so its folder is a runtime folder: the daemon records the runtime the plugin carries, and other apps on the computer can start it.
- From this release on, `node scripts/changelog.mjs --check` requires this section whenever the protocol, the SDK, the shipped profiles or the stdio bridge changed.

## [0.13.0] - 2026-11-22

Publish artifacts to a site of your own: a cloud host for a server, a LAN machine or Cloudflare, with sign-in, sharing, plugins and a remote MCP endpoint.

### Added

- A cloud host serves artifacts on the web with sign-in (an owner key, OIDC, GitHub or Cloudflare Access), sharing with people or by link, and the owner, editor, commenter and viewer roles. Its home page lists your artifacts and those shared with you, with upload and a trash.
- The host runs as one Node process on a server or a LAN machine (plain http is allowed on a LAN), with a Dockerfile and deployment files for Docker and AWS, or on Cloudflare as a Worker with Durable Objects and D1. A same-site mode serves artifact pages under the host's own domain when you have only one.
- `open-artifact remote` connects a computer to a host: sign in with a device code, publish an artifact or a folder, and keep the local files and the published copy in sync both ways. A default site, automatic publishing and install-time presets from environment variables (`OPEN_ARTIFACT_REMOTE`, `OPEN_ARTIFACT_PUBLISH`) are supported.
- Published Data dashboards show a snapshot of their live data, refreshed from the owner's computer (every six hours unless set otherwise).
- Agents reach a host over a remote MCP endpoint (`/mcp`) with OAuth sign-in.
- Host plugins (`@open-artifact/host-plugin`) add sign-in methods, role rules, guards, event handlers, routes and UI to a host from a plain module with typed configuration. Six examples are in `examples/host-plugins`.
- Guides for hosting on a LAN, on a server and on Cloudflare, for connecting agents and for writing plugins, in English and Chinese, under `docs/`.
- A ZCode plugin.

### Changed

- On a host, exports are made in the browser, and Docs exports PDF through the browser's print dialog.

### Fixed

- The Design System editor no longer loses an undo or redo made while a save is on its way.
- Changes written to an artifact's folder in the first moments after it opens are no longer missed on macOS.

## [0.12.5] - 2026-11-22

Design snapshots and exports preserve artboard web fonts, and zooming keeps artboards ready to use.

### Added

- Design embeds the artboard's loaded web fonts in snapshots, image and PDF exports, and Copy as PNG.

### Changed

- Large CJK TrueType fonts are embedded as smaller subsets to speed up snapshots.
- Design retains recently viewed artboard frames across zoom changes, avoiding reloads when zooming back in.

### Fixed

- Design snapshots and exports use the correct web fonts instead of fallback fonts, preventing shifted or clipped text.
- Zoomed-out artboard snapshots stay sharp and wait for fonts before capture. A snapshot missing a font no longer replaces its live frame.

## [0.12.4] - 2026-11-22

Artifacts open faster, with more responsive comments and clearer controls in high-contrast mode.

### Added

- Artifact pages show a loading skeleton while their editor starts.

### Changed

- The Shell opens immediately while the artifact loads, and browsers cache editor assets across artifact visits.
- Opening an editor's framed-page address directly returns you to its Shell, including when the editor needs to reopen.

### Fixed

- Resolving or reopening a comment updates it immediately and allows one status change at a time.
- Long comments and drafts scroll inside their boxes so their controls stay within reach.
- Comment fields and solid buttons remain clearly visible in high-contrast mode, with button fills covering their full area.

## [0.12.3] - 2026-11-21

Motion supports films up to 10 hours and shows rough cuts earlier.

### Added

- The Motion voiceover guide explains how to specify and check the pronunciation of ambiguous Chinese characters
  while keeping captions unchanged.

### Changed

- Motion supports films up to 10 hours across editing, playback and audio.

### Fixed

- Motion shows the rough cut as soon as the first playable batch is ready, including while longer voiceovers
  are still being recorded or uploaded.

## [0.12.2] - 2026-11-21

New artifacts open after the first write, with fixes for Antigravity sessions, whiteboard undo and editor controls.

### Added

- After printing a dashboard that has no print layout, you can ask the agent to add one from the print reminder.

### Changed

- A newly published artifact opens in the agent app as soon as its content is first written. Set
  `open: "never"` to keep it closed.
- Slides supports arrow-key navigation in the bottom toolbar and prevents accidental file drops from leaving the editor.

### Fixed

- Antigravity binds artifacts to the right conversation more reliably. The MCP bridge refreshes its token after a
  daemon restart.
- One Undo reverses an entire whiteboard drag, including pauses, and preserves remote edits made during the drag.
- Docs hides the floating table scrollbar in print, uses the text direction of pending agent placeholders, and
  enforces the link length limit after URL encoding.
- Dashboard calculations reflect the oldest relevant input when showing when their data was updated.
- On macOS, Control–Option–Command–L no longer triggers Copy link to slide.

### Removed

- Whiteboard elements created by the agent no longer show an “Agent” badge on hover or selection.

## [0.12.1] - 2026-11-21

Record narrated Motion films, review scenes as they arrive, and hear the film from the first play.

### Added

- Motion includes a text-to-speech tool that records individual or batch voiceover clips across providers and
  reports clip durations and, on supported models, word timing for captions.
- New Motion guides cover visual explainers, historical films, and animated overlays for existing footage.

### Changed

- The Motion workflow opens the film as soon as the first scenes are available and checks stills scene by scene
  as the film takes shape.

### Fixed

- The Motion player now starts with sound when you first press Play.

## [0.12.0] - 2026-11-20

Create and export animated films with Motion, build interactive sheets, and share read-only slides and dashboards.

### Added

- **Motion** is a built-in artifact type in the CLI and agent plugins. Make animated films in HTML, CSS and
  JavaScript, synthesize a score, add captioned narration, and refine a rough cut in the timeline. Leave comments
  at a moment or on a spot in the frame.
- Motion exports MP4, GIF, MOV with alpha, standalone HTML and source ZIP. The CLI's `stills` command captures
  frames for review. The Motion libraries are available on npm as `motion-core`, `motion-stage`, `motion-audio`,
  `motion-export` and `wasm-motion` under `@open-artifact`.
- Sheets adds interactive tabs with controls linked to cells, pivot tables, saved filter and sort views, and
  links and agent walkthroughs that highlight cell ranges. Tables support column moves, and the format menu
  adds plain text, more currencies, fractions and clipped text.
- Slides and Data support read-only embeds at `#view-inline`. Embedded decks have a slide pager, and a
  `.only` link opens directly to one slide with its builds shown. Framing pages can receive the current
  location and navigate to a slide, document section or sheet through the Shell.
- Dashboards can save rows in artifact storage, including per-reader records. Forms can submit in place,
  and the source list can retry failed loads and flag stale data.
- From an empty Data artifact, choose a dashboard, visual analysis, scrollyteller or visual short, then import
  CSV, TSV, JSON or Excel files for the agent to build from.

### Changed

- Docs starts agent requests from the @ menu or an empty document. The request appears in the text as a
  chip with an agent comment, and the agent's answer replaces it. Find also matches the displayed text of
  dates, dropdowns, people and tab links.
- Slides supports flow margins, custom list markers and numbering, regular-weight phrases inside bold text,
  and link cards. PowerPoint exports carry list markers and numbering, with closer spacing and picture framing.

### Fixed

- Motion's standalone HTML and source ZIP still export from an open tab after an editor rebuild. If GIF,
  MOV or MP4 export needs a component that is no longer available, the editor offers to reload.
- Docs preserves concurrent edits when editing links, keeps rejected comment drafts available to copy or retry,
  docks a wide table's scrollbar, and wraps long identifiers in table exports.
- Slides keeps focus and Undo working after number-field drags, ignores table commands on content that changed
  while the menu was open, and offers a reload after a render error.
- Sheets restores the preceding personal sort on Undo. Dashboards report missing data at the end of print and
  PDF exports and protect uploaded images that a page still uses.

## [0.11.0] - 2026-11-20

Open live artifacts inside MCP conversations, with steadier whiteboards and more ways to style their content.

### Added

- In clients that support MCP Apps, `ShowArtifact` opens an interactive artifact in the conversation. The view can
  go full screen, open in a browser, or send comments back to the agent.
- Whiteboard drawings have seven styles in light and dark. Table cells support fills and heat maps by row or column.
  The drawing styles, fills and heat maps carry through to PNG exports.
- Whiteboard text can show a placeholder and starts editing with a click or tap. Link cards let you open, copy or
  edit a link, and F6 moves focus between the toolbars, board and panels.
- `npm run test-artifacts` opens a browser gallery of editable test artifacts, starting with a whiteboard that
  demonstrates all element types, styles and options.

### Changed

- The whiteboard skill documents drawing styles, text placeholders, table formatting and how agents coordinate
  edits on a shared board. Validation reports unknown drawing styles, how much to trim from oversized drawings,
  and claims that still mark an area as being worked on.
- Clicking a side dot on a whiteboard note or shape adds an adjacent item in available space. Read-only boards show
  a badge, and exported PNGs use the board title as the filename.
- Number fields snap to their step when dragged unless Alt is held. Color fields explain rejected values and
  announce hue and opacity values for screen readers.

### Fixed

- Whiteboard text stays visible and steady during pans and resizes. Panning survives a dropped pointer capture,
  and the board keeps fitting as its view changes size until you interact with it.
- Growing whiteboard text makes room below it. Resizing rotated notes or text keeps the anchored corner in place,
  and pasted text preserves bold, italics and links.
- Concurrent moves and resizes of a whiteboard group merge field by field. Merged table cells preserve their
  formatting, and drawings can include dashed arcs.
- Extra clicks on menus or dismissing a popover no longer activate controls underneath. Popovers configured to
  keep typed input stay open until dismissed, and stepping an empty number field starts from a valid value.
- Whiteboard crop mode can be canceled with Undo, and embedded pages receive keystrokes once you enter them.
- Type servers start without flashing a console window on Windows.

### Removed

- Whiteboards now use DOM rendering exclusively. The Whiteboard WebGL renderer and its
  `open_artifact_engine=off` URL switch are gone.

## [0.10.0] - 2026-11-20

Follow other viewers from the Shell, link-aware Design and Design System editing, and copying that works in the
Claude app's built-in browser.

### Added

- In Sheets, the Shell shows who else is viewing beside History; choose Follow to see what they see, and Stop to go
  back.
- Readable links to a place in a design: `#page-<id>`, `#artboard-<name>` (selects the artboard and brings it into
  view) and `#play-<name>` (runs it on the canvas). Agents give these links when a reply mentions an artboard or page.
- Hovering an element that sits in a link shows its address in Design, with Open for web and mail links; a selected
  element's link shows on the selection bar.
- In the Design System README, a link opens a card to open, copy, edit or remove it. ⌘Z (Ctrl+Z) undoes a change made
  in the card and ⇧⌘Z (Ctrl+Shift+Z, Ctrl+Y) makes it again; a modifier click opens a link while editing.
- A color typed into the Design System picker previews as you type; Escape puts the old color back.
- Without the Shell, the focused artboard view has its Export menu again, with the same formats as Share → Export.

### Changed

- "Send all to agent" sends every open comment at once, so the agent gets them as one message instead of one turn
  per comment.
- Design canvases no longer limit the number of notes; `canvas.json` just has to stay under 1 MiB.
- The Design skill places new, moved and resized artboards in clear space, moves neighbours out of the way when a
  frame grows, and starts from a design system's README.
- Design exports say why an upload could not be included and stop waiting sooner on font hosts that do not answer.
- Long menus fit in a short window and scroll.

### Fixed

- Copy as PNG, SVG or HTML, copying layers, and Design System copy buttons work in browsers that keep the clipboard
  from framed pages, such as the Claude app's built-in browser: the Shell writes the clipboard instead.
- Design shortcuts follow the physical key, so they work on any keyboard layout; Enter and Escape no longer end
  cropping or path drawing while you type in a field or compose with an input method.
- Property fields: font search works, Enter keeps focus, ⌘Z undoes, and starting a scrub first saves a number typed
  into another field.
- An image or video upload still lands on the right element when the artboard changed while it uploaded, and a file
  dropped where nothing takes it no longer replaces the editor.
- A component preview in a design system can no longer take focus away from the field you are editing before you use
  it.

## [0.9.2] - 2026-11-18

Install agent plugins from a prebuilt download and read release notes in DeepSeek Harness.

### Added

- GitHub Releases includes `open-artifact-plugins.zip` with Codex, Claude Code, Cursor, GitHub Copilot, Antigravity
  and the ChatGPT web connector. Download and extract the ZIP to install or upgrade without cloning or building.
- DeepSeek Harness shows release notes before you update and a What's New panel after updating. Select the installed
  version in the Open Artifact page footer to see the full changelog.

### Changed

- The installation guides explain how to move existing source-based installs to the release bundle or, for
  DeepSeek Harness, to the prebuilt npm package.

## [0.9.1] - 2026-11-18

Much smaller installs: the built-in types share one type server.

### Changed

- `@open-artifact/cli`, `dsh-open-artifact` and the agent plugins carry the type server once, in
  `vendor/type-server/`, instead of a whole copy (every editor included) in each built-in type; each type's
  `scripts/cli.mjs` runs the shared one. The npm packages go from 112 MB to 18 MB (330 MB to 50 MB unpacked), and a
  plugin folder from about 330 MB to 49 MB.
- Every release now has a CHANGELOG.md entry, which becomes its GitHub release notes; the publish workflow refuses a
  tag without one.

## [0.9.0] - 2026-11-18

One version for every package, with Docs and Sheets in every plugin.

### Added

- **Sheets**, a new artifact type: a workbook engine in Rust built as WebAssembly (`@open-artifact/wasm-sheets`),
  with `sheets-core` and `sheets-editor`.
- Sheets charts: Insert chart adds area, horizontal bar and scatter, exported to Excel as native charts; a chart's
  menu can change it to another kind that suits its cells, with no agent.
- **Docs**, a new built-in artifact type: a living document in tabs with headings, lists, tables, pictures, dates,
  mentions and dropdowns; suggested edits, comments and a version history per tab; imports Markdown, Word and PDF and
  exports Markdown, Word, PDF and HTML (`docs-core`, `docs-editor`, the docs type server and runtime doc API).
- Docs comments: the composer gets a "Send to agent" checkbox with an `@agent` tag.
- Every plugin's manifest and the marketplaces name Docs; the DSH skill knows the Docs type and vendors it; the npm
  CLI package lists Sheets.

### Changed

- The libraries, the CLI and `dsh-open-artifact` move to 0.9.0 together (`dsh-open-artifact` was 0.8.x, so the shared
  version starts above it), and the agent plugins' manifests follow.
- Docs tables fit the page: short cells stay on one line, columns hold while the caret is in a table, and a table cut
  off on the right is marked.
- Broader editing, comment and offline-recovery work across Docs, Sheets, Slides, Design, Design System and Whiteboard,
  with more editor tests.
- `publish-npm.mjs --claim` publishes a new package's staged version before trusting the workflow, since npm trusts
  only a package it has and refuses placeholder versions. `docs-core`, `sheets-core` and `wasm-sheets` get their first
  npm releases from the workflow.

### Fixed

- With six or more pages open on the daemon (easy in DeepSeek Harness), every other request queued forever and the
  Share panel stayed on "Loading...". The pages of an origin now share one library event stream (one holder elected
  with a Web Lock, messages passed on a BroadcastChannel); library reads time out after 15 s, and the Share panel's
  poll no longer piles up.

## [0.2.2] - 2026-11-17

`dsh-open-artifact` 0.8.2.

### Added

- Design System is a built-in type: every harness offers Design, Design System, Slides, Whiteboard and Data, and the
  skills and plugin descriptions name design systems.

### Changed

- A harness whose daemon is newer than the one running stops the old one and starts its own (connected harnesses
  reconnect), so upgrading a plugin brings its types and tools without stopping the daemon by hand.

## [0.2.1] - 2026-11-17

`dsh-open-artifact` 0.8.1.

### Fixed

- Design and Slides PNG, JPEG and PDF exports drew every `<img>` and CSS background picture blank; they now embed
  them again.
- Exported `<img>` pictures keep their `object-fit` and `object-position`, so cropped and stretched pictures are no
  longer letterboxed.

## [0.2.0] - 2026-11-17

`dsh-open-artifact` 0.8.0. The first release published from GitHub Actions.

### Added

- **Data**, a new artifact type: dashboards and reports from uploaded files, live queries on the owner's MCP
  connectors, and calculations, as plain HTML, CSS and d3 (`data-core`, `data-editor`, and the
  `open-artifact-data-rules` crate built as `@open-artifact/wasm-data-rules`). Every harness plugin ships it.
- `live-store`, the live document engine, taken out of `whiteboard-core` so Whiteboard and Data share it.
- An Antigravity plugin, with idle conversations woken for page comments through `agentapi send-message`.
- A Copilot CLI marketplace in `dist/plugins`, so Copilot installs its own plugin instead of the Claude Code one.
- Per-agent plugin install steps in the READMEs.
- npm publishing: `scripts/build-npm.mjs` stages the packages, `scripts/publish-npm.mjs` publishes them dependencies
  first, and the Publish to npm workflow runs on a `v*` tag by trusted publishing (OIDC). `--claim` sets the workflow
  as the trusted publisher of a package npm doesn't have yet.
- The focused view's Fill / Fit choice is kept across artboards and visits.

### Changed

- Idle Codex threads are woken for page comments (`codex queue`), and pages open in the agent app's own browser
  instead of a second copy in the computer's browser.
- Cursor gets page requests after each tool call (`postToolUse`), since it runs no session hooks on `--resume`.
- Copilot gets page messages in the prompt, which a resumed session keeps.
- The page says when an idle agent will not be woken (Cursor, Copilot, ChatGPT): comment cards and "Ask agent" toasts
  say the agent gets it on its next turn.
- One comment icon everywhere, and the whiteboard's foot toolbar reorganized with an "Ask <agent>" pill.
- The skill docs for Design, Design System, Slides and Whiteboard brought back to their original text, mapped to
  Open Artifact.

### Fixed

- Codex artifacts landed in the plugin's cache folder; they now go in the thread's folder.
- Cursor's auto-review blocked the agent's comment replies; the tools are marked local-only.
- The skill launcher no longer takes another agent's session id when an app is started from inside a Claude Code or
  Codex session.

## [0.1.0] - 2026-11-17

`dsh-open-artifact` 0.7.0. The initial version of Open Artifact (formerly baoyu-design), not tagged.

### Added

- Agent-agnostic artifact types (Slides, Design, Design System, Whiteboard) with their editors, the local daemon and
  Shell, and the `/open-artifact` skill.
- Plugins for Claude Code, Codex, Cursor, Copilot, ChatGPT and DeepSeek Harness.
- English and Chinese READMEs, under Apache-2.0.

[0.14.6]: https://github.com/JimLiu/open-artifact/compare/v0.14.5...v0.14.6
[0.14.5]: https://github.com/JimLiu/open-artifact/compare/v0.14.4...v0.14.5
[0.14.4]: https://github.com/JimLiu/open-artifact/compare/v0.14.3...v0.14.4
[0.14.3]: https://github.com/JimLiu/open-artifact/compare/v0.14.2...v0.14.3
[0.14.2]: https://github.com/JimLiu/open-artifact/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/JimLiu/open-artifact/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/JimLiu/open-artifact/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/JimLiu/open-artifact/compare/v0.12.5...v0.13.0
[0.12.5]: https://github.com/JimLiu/open-artifact/compare/v0.12.4...v0.12.5
[0.12.4]: https://github.com/JimLiu/open-artifact/compare/v0.12.3...v0.12.4
[0.12.3]: https://github.com/JimLiu/open-artifact/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/JimLiu/open-artifact/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/JimLiu/open-artifact/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/JimLiu/open-artifact/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/JimLiu/open-artifact/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/JimLiu/open-artifact/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/JimLiu/open-artifact/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/JimLiu/open-artifact/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/JimLiu/open-artifact/compare/v0.2.2...v0.9.0
[0.2.2]: https://github.com/JimLiu/open-artifact/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/JimLiu/open-artifact/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/JimLiu/open-artifact/compare/a6cd3e3...v0.2.0
[0.1.0]: https://github.com/JimLiu/open-artifact/commit/a6cd3e3
