# End-to-end tests

These tests drive the built artifact types (`artifact-types/design`, `artifact-types/design-system`) the way an agent and a person use them. The agent runs `node scripts/cli.mjs …`, and the person works in the editor page in Chrome. Each type folder is copied to a temporary folder first, outside this repository, so nothing resolves from its `node_modules`.

```bash
npm run build
```

```bash
npm run e2e
```

Options:

| Option | What it does |
| --- | --- |
| `--only design,design-system` | Run some suites only (file names in `e2e/` without `.test.mjs`). |
| `--no-browser` | Skip the Chrome checks (`E2E_BROWSER=0`). |
| `--keep` | Keep the temporary folders and print their paths (`E2E_KEEP=1`). |
| `--dir <path>` | Test another copy of `artifact-types/` (`E2E_DIR`). |

`e2e/sea/sea.test.mjs` is not one of these suites: `npm run test:sea` builds the single executable and runs it with no `node` on `PATH` (the daemon, a static and a server type's artifact, `harness --stdio` and `doctor`). It needs an official Node.js build of 25.5 or later (`OPEN_ARTIFACT_SEA_NODE`), and `npm run build` and `node scripts/build-skill.mjs` first; otherwise it is skipped and says why.

Chrome is found in its usual places, or set `E2E_CHROME` to its path. `E2E_HEADFUL=1` shows the window. Nothing has to be installed: the tests use `node:test`, and Chrome is driven over the DevTools protocol with Node's own WebSocket.

Each test file runs its own server, with its own `OPEN_ARTIFACT_TYPE_SERVER_HOME` and `HOME`. It never meets the server you use yourself, or another test file's server.

When Chrome stops a frame's renderer (Chrome shows the frame as gone and the page around it carries on), the harness says so: the page gets a `renderer crashed: <frame>` problem, and a `waitFor` that times out or an `inFrame` that finds no framed page fails with that line, not with a plain timeout. Nothing is retried. Chrome keeps the crash's minidump in its own Crashpad folder (`~/Library/Application Support/Google/Chrome/Crashpad/completed` on a Mac).

The harness asks its questions (`waitFor`, `evaluateAll`, `load`'s `ready`) in a tab's page and frames only, never in a worker: workers are attached so their errors and exits are seen, and that is all. Chrome 157 stops the renderer when `location` is read in a module worker whose script has not all arrived, and the suites' questions start with `location.hostname…`. That was the `renderer crashed: iframe …/whiteboard/…` the Cloudflare suites showed on about one first load in four (the whiteboard starts its `whiteboard-looks` worker while the test waits for the board). `browser-lib.test.mjs` holds the case.

## What is covered

`lib/editor.mjs` holds the path both types share. Each `*.test.mjs` file adds what only its type has.

**Shared, for both types**

- `--help`; an unknown command fails.
- `check`: a good artifact passes. A broken one fails, in text and in `--json`. A folder that is no artifact is named as such.
- `open`:
  - starts the server (`server.json`, live pid);
  - run again, reuses the server and the address;
  - scaffolds an empty folder (`--type`, `--title`), and the result passes `check`.
- The page and every file it names load. The session names the owner. `support.js` is served beside the project files. A token-only URL is redirected (308) to the URL with the trailing slash.
- Access:
  - a made-up token returns 404, and so does the token under the other type;
  - a request for another Host returns 403 (DNS rebinding);
  - `localhost` is allowed.
- Saving:
  - a save with `ifMatch` reaches the disk, and `_api/file` / `_api/files` report the new hash;
  - a stale `ifMatch` returns 409 `conflict` and writes nothing from the batch;
  - creating over an existing file is a conflict;
  - a save without `ifMatch` overwrites.
- Writes from another origin (`Origin`, `Sec-Fetch-Site: cross-site`) are refused. So are paths outside `project/`, `..`, and hidden files.
- Agent channel:
  - a request from the page waits in `_agent/inbox`, and `wait` hands it over and moves it to `done/`;
  - with `wait` running, the request is `delivered`;
  - a staged request is labelled as staged;
  - an empty request is refused;
  - control characters are removed;
  - `wait --timeout` exits 2 quietly;
  - `context` exits 2 before any page has written a view context.
- `upload` stores the file under `_blobs/`, and the server returns the same bytes at `/_blob/<id>`. The page's own upload of the same bytes gives the same URL.
- `status` lists the server and the open artifacts.
- `serve` (foreground, for a daemon):
  - prints the ready line;
  - `/__open-artifact/health` requires the secret;
  - `/__open-artifact/open` and `/__open-artifact/actions/check` work;
  - the server ends with its process.
- In the Open Artifact Shell (`open --shell`), the framed page:
  - sends `chrome_report`;
  - answers `chrome_hello`, `chrome_cmd exports` and `files_changed`;
  - reports a waiting agent.
- In Chrome:
  - the page opens with no errors and requests no host outside this computer;
  - it writes the view context that `context` prints;
  - a change on disk shows in the open page;
  - the session reports an agent while `wait` runs, and stops reporting it when `wait` ends.
- A second folder joins the same server at its own address, and a save through one address lands only in that address's folder. Eight editor tabs open on one server all still reach it, and each is counted as an open page. Each page's event stream is a WebSocket, so it does not use up Chrome's six HTTP connections per host. A folder of the other type joins the same server too, and `status` lists them all.
- `stop` ends the server and removes `server.json`. Run again, it says that no server is running.

**Design only** (`design.test.mjs`)

- `check` names the missing `support.js` line, and flags a board that `canvas.json` does not place.
- `list` finds design systems under the given folders, and returns none when there are none.
- In Chrome:
  - Send to agent: the composer's request reaches `wait`;
  - a board that throws shows its error, and "Ask agent to fix" sends it (`wait` receives the title and the error);
  - "1 error" at the top right lists the artboards with errors and its "Ask agent to fix" sends them all; closing an artboard's error notice leaves a mark in its name strip that brings it back;
  - a pasted image is uploaded and becomes an image note in `canvas.json`;
  - PNG and PDF exports draw an artboard in the web font its own `@font-face` loads, a Flow artboard's paper pages too;
  - zoomed out below 30 %, an artboard shows a snapshot at its own size and in its web font, and zooming back in shows the same frame without booting it again;
  - a snapshot of an artboard set in a big CJK web font carries a subset of the font that still draws the artboard's ideographs;
  - Pages → Add page writes the page to `canvas.json`;
  - an unreadable `canvas.json` shows the banner, and the file is left unchanged.

**Design system only** (`design-system.test.mjs`)

- `check` refuses a namespace that is not a JavaScript identifier, and a `design-system.json` that is not valid JSON.
- `generate` writes `tokens.css`, and on a second run says the files are up to date.
- `upload --group` prints the record and its `indexPath`. Once written into the index, the record passes `check`. A group name with a slash is refused.
- `list` finds the design system.
- In Chrome:
  - the overview shows the README, and opening the page writes the generated files;
  - an empty system's Welcome page offers "From code", and its request reaches `wait`;
  - an image dropped on an asset group is uploaded into `design-system.json`.

**Slides: polygon clipping** (`slides.test.mjs`, on the shared deck's second slide)

- `deck.css` gives a `--cut` token to a `clip-path:polygon(…)` with `calc(100% - var(--cut))`; the presenter shows the photo with that clip.
- The editable PowerPoint export draws two plain panels of different widths as custom shapes with the same 12px cut, a triangle and a concave arrow as custom shapes with their exact vertices, the clipped photo as a cropped picture cut to the polygon, and a clipped panel holding text as one picture (its text is not exported as text).

**Slides: links from the Shell** (`slides.test.mjs`, a deck the daemon opens in the real Shell)

- Copy link to slide (⌘⌥L) copies an invite link (`/s/…`) at the network address with the slide, not the `127.0.0.1`
  page (`/a/…`), and the note says the deck is shared on the network now.
- The title menu's Copy link and the Export tab's Copy link copy that same link, word for word.

**Sheets** (`sheets.test.mjs`)

- `read` on a folder with no Sheet is refused; a first `update` makes the Sheet (one blank `Sheet1`) and applies its edits.
- `read` gives values, and formulas with what they work out to; `formatCells` reads back through `readCellFormats`.
- `writeCells` takes formulas with many words of their own (Chinese or English texts in quotes), and more than 50 different ones in one edit: the page shows such formulas to the person before pasting them (`toBeShownFirst`), but an agent's write shows nothing first.
- A stale `base`, an unknown edit and an unknown key are refused as JSON on stderr, and the revision stays.
- `check` passes the Sheet. `export` writes an Excel file, and `--csv --sheet` the shown values of one sheet.
- `open` serves the page and reuses the address. In Chrome, the grid shows the sheet, and an `update` sent while it is open reaches the formula bar at once.
- `comments` lists no threads on a new Sheet; `stop` stops the server.

**Data: printing** (`data.test.mjs`, one case, Chrome only)

- The fixture dashboard, opened by `open`, is laid out for print (`Emulation.setEmulatedMedia`) and sent `beforeprint`, as the PDF button and the browser's Print both mark the dashboard's path. The dashboard prints at its full length with its title, the data note prints under it, and nothing of the editor around it shows; `afterprint` clears the marks. Before the fix for issue #24, the sheet held only the data note.

**Cloud host** (`host.test.mjs`, Chrome only)

- The real host (`packages/host`) on a free port, with its own data folder and an imported whiteboard. The app is on `localhost`, and each artifact is on its own `*.content.localhost` origin.
- The owner opens the printed sign-in address. The fragment fills the key, a click signs in, and the home page lists the artifact by its own title. Opening it frames the page on the content origin, and its session says owner.
- In Share, general access set to "Anyone with the link" shows the commenter link, which is on.
- A second Chrome with nothing in it opens the link, types a name and joins. Its page may comment (200) but not edit (403).
- The owner resets the commenter link. The guest's page loses access, and the old address says the link does not work.
- A real daemon (`open-artifact daemon run`, with its own home and port) is linked with `open-artifact remote add`; the owner approves the code in Chrome. A local whiteboard folder is published with `open-artifact publish <folder>`, and the cloud page draws it.
- On the cloud page, the owner comments with "Send to <agent>" on. `open-artifact wait` in the agent's session gets the comment.
- A file written in the local folder shows on the open cloud page without a reload. The daemon's folder watcher pushes it (the periodic rescan is off), the host's type server sees an outside change, and the page hears it over its event stream.

**A whiteboard reloads on a slow cloud host** (`host-refresh.test.mjs`, Chrome only)

- The same host with an imported whiteboard, behind a small proxy that holds `_api/db` and `_api/session` requests for 800 ms. Every load gets a new page token in its path (`/whiteboard/v1.<token>/`).
- On first open and on reload, the Shell's cover is never lifted while the board is empty or under its "Opening the board…" veil, and the Share button stays where it first showed.
- The owner zooms out with ctrl + wheel. Two reloads open at that zoom. Storage then holds one camera (`wb-camera:artifact:<id>`) and one saved copy (`wb-copy:…`). A whole-board copy and a camera that an older page filed under its own token (`wb-saved-copy:/whiteboard/v1.…`) are gone.
- Dragging an element with the real mouse while writes are slow never shows "Couldn't save". "Saving…" shows, then goes once the write lands.
- The owner drags an element and at once picks Refresh in the artifact options. The page's own address is held for 2.5 s and writes for 0.4 s, so the old page hears its move was saved and reports it before the new page comes. The cover stays until the new page's board shows: never over the old page's report, never on the new page's veil.
- With `_api/db` held past the Shell's cap, the cover goes about `CHROME_READY_TIMEOUT_MS` (10 s) after the reload. A page that reports `ready: false` cannot keep it up for longer.

**The Shell over a static page** (`shell-frame.test.mjs`, Chrome only)

- A real daemon, started in the test's own process from source in a temporary home, with a user type `linked`: a static page of two files (`index.html`, `two.html`) that link to each other.
- Following the link inside the page, with the real mouse, both ways: the new page shows and the Shell never covers it (a static page never reports, so nothing would lift a cover before `FRAME_READY_FALLBACK_MS`).
- Refresh in the artifact options covers the page, and the cover goes on the page's `load`, well before the 1.5 s fallback.

**The MCP App view in a host on a public address** (`mcp-app.test.mjs`, Chrome only)

- A real daemon, started in the test's own process from source in a temporary home, with a user type `linked`: one static page. The test reads the view resource (`ui://open-artifact/view.html`) and calls `ShowArtifact` over the daemon's `/mcp`, as an MCP Apps client does.
- A stand-in MCP Apps host: a page on 127.0.0.1 that Chrome is told is public (`--ip-address-space-overrides`), as Codex keeps its apps on a web address. It frames the view from a second such origin with the CSP of the view's `_meta.ui.csp` (or, with `?csp=codex`, the two CSPs of a Codex card: its sandbox's `frame-src 'self' https: data: blob:`, and the app's with every frame domain that is not https left out), answers `ui/initialize`, sends ShowArtifact's result as `ui/notifications/tool-result`, and answers `ui/open-link` in one of four ways (opens it, `isError`, never answers, offers no `openLinks`). It grants the page the Chrome permission for each network permission the view declares in `_meta["openai/ui"].permissions`, or denies it (Chrome DevTools `Browser.setPermission`).
- The view declares `loopbackNetwork`, and with it granted the static page shows inside the Shell inside the view; the view's notice stays hidden past its wait for the Shell's `shell_hello`.
- With it denied, Chrome blocks the frame (Local Network Access), and the view says the page did not show, naming its address, with Retry, Open in browser and the address to copy. Open in browser sends `ui/open-link` with `view_url`; the host opens it, so the notice does not say the page may not have opened. Once the permission is granted, Retry shows the page and the notice goes.
- When the host answers `ui/open-link` with `isError`, offers no `openLinks`, or never answers, Open in browser shows `view_url` to copy: at once on the host's answer, after the view's 3 s wait when none comes. Close hides it, and the page stays.
- With a Codex card's CSP, the view hears the refusal (`securitypolicyviolation`) and says so before its 4 s wait for `shell_hello` ends: the app does not let the page's address show in the conversation, with Open in browser and the address to copy, no Retry, and the browser's own error page hidden. Open in browser sends `ui/open-link`, and the notice stays as it was after the wait.

**Cloud host on a LAN, set up in advance** (`host-auto.test.mjs`, Chrome only)

- The real host on plain http under made-up private names: the app at `http://oa.lan:<port>`, each artifact at `http://<id>.oa-content.lan:<port>`. Without `OA_ALLOW_HTTP` and without a signing key: a private name is allowed both. Nothing resolves `.lan` here, so the daemon gets a `dns.lookup` preload (via `NODE_OPTIONS`) and Chrome `--host-resolver-rules`, both mapping `*.lan` to 127.0.0.1; the names are what decide whether http is allowed.
- `open-artifact-host link-token --user <email>` prints the Link token once, with the `OPEN_ARTIFACT_REMOTE` to set.
- A real daemon starts with only `OPEN_ARTIFACT_REMOTE`, `OPEN_ARTIFACT_REMOTE_TOKEN` and `OPEN_ARTIFACT_PUBLISH=auto`. With no `remote add` and no browser, `remote list` shows the remote named after the host, signed in as the person, as the default. `remote status` says the connection is plain http and that publishing is automatic.
- An artifact created through the CLI's Artifact tool is answered with its local `view_url` and a note that it is being published by itself. A later `read` gives its web address on the LAN name. The token is not in the daemon's log.
- In Chrome, the owner signs in with the printed key and opens that web address: the Shell frames the page on its `*.oa-content.lan` origin, and it draws.

**Harness compatibility** (`harness-compat.test.mjs`; the Chrome cases are skipped, and say so, with `--no-browser`)

- A real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME`) with two user types: `note`, a static page, and `farstub`, a URL type at `http://0.0.0.0:<port>/far/{id}`. It counts as remote because 0.0.0.0 is not a loopback name, but a stub on this computer answers it.
- Two hosts are built in-process from the reference host's modules (`examples/harness-node`: `connectHarness`, `ScriptedAgent`, `wakeHandler`, `registerTools`):
  - `compat-frame` frames the Shell from host page origin A, with `embed.remote: deny`, rules, a `policy.roles` entry and a profile `title` (`Compat Frame`);
  - `compat-view` shows top-level views, with `embed.remote: allow`.
- (a) `open-artifact doctor --harness compat-frame --session compat-1 --json`, run as its own process, passes every conformance step in order. Each step's verdict is `ok`, and what needs a person or a browser is `n/a`. The host gets exactly one `host.open` and one wake from the owner, and doctor removes its test artifact. The remote-type check finds the stub answering and warns that `compat-frame` denies it, naming the fallback. The stub is never sent a token.
- (d) `host.open` for a `farstub` artifact carries `remote` `{type, origins}` to the allow host. The deny host's `open` is never called, and the artifact is not reported as shown.
- (e) A host says in `hello` the runtime the DSH plugin declares (`runtimeOf()` of `plugins/dsh`, the built plugin folder). The daemon records it in `runtimes.json` with `update: bundled`, logs nothing as "not recorded", and `open-artifact runtime status --json` lists the folder as a registered runtime of that harness. Skipped, and says so, when `plugins/dsh` is not built.
- (c) Without a browser, a top-level view's `host.open` carries a ticket and `embed_url` (`/a/<id>?oa_view=<ticket>`). The ticket is claimed from Node as the Shell would claim it, and a second claim gets 404. `shell.command` comes down the stream, and a posted event reaches the adapter as `shell.event`.
- (c) In Chrome, the Shell loaded at `embed_url` claims the ticket, says `shell_hello` through the daemon, and takes the ticket out of the address bar. A `host_hello` sent with `shell.command` gets `shell_ready` back as `shell.event`, and a second claim gets 404.
- (c) In Chrome, a page on an undeclared origin frames `embed_url`. The framed Shell still talks through the daemon: `shell_hello` and `shell_ready` reach the adapter, and the parent page hears nothing.
- (b) In Chrome, a host page on each of two 127.0.0.1 ports frames the Shell and answers `shell_hello` with `host_hello`. The Ask goes through the real mouse and keys.
  - On origin A, which is declared, the Shell says `shell_ready`, and the Ask sends `comment_summon` with the text and wakes the owner session. The Ask pane names the owner session by the profile title (`Compat Frame`), never by the id `compat-frame`.
  - On origin B while A is declared, the page hears nothing after `shell_hello`, even though the Ask is sent and wakes the session.
  - On origin B once `compat-frame` has gone and no origin is declared at all, the page is taken (`shell_ready`), but `comment_summon` comes with empty text.
- The same cases against the two previous minor versions of `@open-artifact/harness-kit` from npm have a place at the end of the file. That place is skipped, and says why: the kit is not published yet. To run it, install each version into a temporary folder and build the hosts with its `createHarness`.

**Type servers in worker threads** (`node-threads.test.mjs`, no browser)

- A real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME` on a free port) with `OPEN_ARTIFACT_NODE_CHILDREN=threads`, the mode an Electron app with its `RunAsNode` fuse off ends up in. Its built-in types are copies of `slides` and `docs`; a host connects with `createHarness`.
- (a) `/__open-artifact/health` reports `nodeChildren` `{mode: threads, reason: env}`; `open-artifact doctor --json` has the `node-children` check saying worker threads; the daemon log says the mode once.
- (b) Slides: create, open (the server is ready in a thread: `(thread N)` in the log, no pid), publish a slide, the `view_url` answers 200 and `check` works.
- (c) Docs: created through the `create` call and read back.
- (d) A type change (the manifest touched, `builtin/.changed` written) stops the docs server through its `SIGTERM` handler (`--- exit 0` in its log); the next call starts a new thread.
- (e) `SIGTERM` to the daemon: it waits for its threads and exits 0, `daemon.log` has `daemon <version> stopped (SIGTERM)` once, every server log ends with `--- exit 0`, `daemon.json` and the lock are gone, the ports refuse connections and no process is left.
- Not covered here: a real Electron utility process (it was checked by hand, see `docs/integrating/runtime.md` and `examples/harness-electron/README.md`, the stop on quit included) and the other six built-in types in threads.

**Saving while a person edits** (`shell-save.test.mjs`, Chrome only)

- A real daemon from source in a temporary `OPEN_ARTIFACT_HOME` on a free port, once with `OPEN_ARTIFACT_NODE_CHILDREN=threads` and once with `process`; a host connects with `createHarness` and opens the artifacts in the Shell.
- Slides: the title of a slide is retyped at a person's pace. The Shell's save state (`header [data-shell-save-state]`), sampled all the while, is never `unsaved` ("Couldn't save — retry"), and the slide's file holds the new title.
- Whiteboard: an element is dragged with the real mouse and a note is added from the canvas menu ("Add a note here"). The save state is never `unsaved`, and the store on disk changes.
- Whiteboard through a Shell older than `db.listing` (one left open while the daemon was upgraded): a script added before the Shell's own refuses every `db.listing` call from the page as `invalid` ("unknown method"), as the 0.14.2 broker did. The board still shows (the page asked for `listing` and fell back to `list`), a dragged element reaches the store on disk, and the save state settles.
- The type servers' logs (`<home>/logs/servers/`) hold no error, no refused request and no 4xx or 5xx.

**The whiteboard in a narrow pane** (`whiteboard.test.mjs`, one case, Chrome only)

- In a 660 px wide view the board opens fitted whole, below 60%, with every element in view. "Zoom out" in the zoom menu is enabled and zooms out, ctrl + wheel zooms out and back in, and "Fit the board" fits it whole again.

**A whiteboard that missed events** (`whiteboard.test.mjs`, one case, Chrome only)

- A board of its own. The page's event stream (a WebSocket, wrapped before the page's scripts run) is closed, and its reconnects are sent to a port nobody listens on. Meanwhile the agent edits one element's file and deletes another's, and the page still shows the old board.
- Once reconnects are let through, the page shows the edit and drops the deleted element with no reload: the stream's first event says where the store stands, and the page reads the board again because it missed something.

**The Chrome harness itself** (`browser-lib.test.mjs`, Chrome only)

- A page of its own on a local server starts a module worker; the server sends the start of the worker's script and holds the rest. While it is held, the suites' usual question (`location.hostname…`) is asked forty times: only the page answers, no renderer crashes and no problem is recorded. Once the script arrives the worker runs, and is still not asked.

**Exports on a cloud host** (`host-exports.test.mjs`, Chrome only)

- The same host, with one sample of each of the 8 types imported. The owner signs in and opens each.
- Every export the page offers is started with the real mouse (the Export tab, Motion's Export dialog, the design system's Download button) and must arrive as a browser download (`Browser.setDownloadBehavior`) with the right name, size and first bytes: `%PDF`, PNG, `PK` with the Office parts for .pptx/.docx/.xlsx, `ftyp` for MP4, `GIF8`, HTML, JSON. The host never renders.
- A Docs PDF opens the print view and calls its `print()` (stubbed before the click), with a toast that says to choose "Save as PDF"; no file is downloaded. A Data PDF prints the dashboard the same way.
- MP4 is skipped, and said so, where this Chrome has no H.264 encoder.
- With "Viewers can download and export" off, a viewer who joined by link is refused with a readable message and gets no file; turned on, the same export downloads.
- A to-do case: a Docs file keeps the doc's name (it needs the type server to expose `content-disposition` to the Shell).

**A page artifact on a cloud host** (`host-page.test.mjs`, Chrome only)

- A daemon linked to a Node host publishes a synthetic poll `page` (database, comments, who is viewing) and a second page. The owner's page runs on a page host of its own (`<id>--<opaque>`), with no page token in its address; its logo loads; a vote, a comment and a note reach the computer's folder, and a database file written there shows on the page.
- With a `Host` header: the page host answers no API, a page host made up for the other artifact is refused, and the page cannot reach the shell's API.
- Shared by link as viewer, then commenter, then editor: each role can do what it may and no more, on the same page host while it keeps access. Once the guest is removed, their page host is refused and the owner's still answers.

**A person's own type on a cloud host** (`host-types.test.mjs`, Chrome only)

- Two daemons on a Node host: the owner's (an admin, linked in Chrome) and a member's (a token from `open-artifact-host link-token`). The type is synthetic (`fixtures/site-type/team-poll`).
- Publishing an artifact of a type the site lacks is refused, naming the type, `types publish` and `--with-type`; `types publish` inside an agent session is refused; `types publish` keeps the package under the site's data folder, then the artifact publishes.
- The artifact runs on a page host with no page token in its address, which answers no API; viewer, commenter and editor by share links can do what the type's db rules let them.
- A new version reaches the open page and the old version's files go; `types unpublish` delists it (the artifact still opens, a new one is refused); `publish --with-type` sends a fresh type first.
- `OA_TYPES_PUBLISH`, the host restarted each time: `admins` refuses the member, `members` lets them publish, `off` refuses the admin while what is published keeps opening.
