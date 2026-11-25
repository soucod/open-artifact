# Electron host example

An Electron agent app on `@open-artifact/harness-kit`: a chat column on the left, the artifact's page on the right in a
top-level `WebContentsView`.

> **Barely run.** Electron is not a dependency of this repository. The example has been started only far enough to
> connect: in Electron 45.2.2 (fuse on, default start) and 42.11.12 (`RunAsNode` fuse off, `OA_EXAMPLE_DAEMON=utility`),
> each time with a throwaway home, reading the daemon's health and stopping it; the chat and the artifact pane were not
> used. Everything that is not Electron comes from
> [`../harness-node`](../harness-node), whose test runs it against a real daemon; the Electron parts (`src/main.mjs`,
> `src/pane.mjs`, `src/preload.cjs`, `renderer/`) are otherwise unchecked.

## Run

Electron is not installed by the workspace; bring your own:

```bash
cd examples/harness-electron
node build.mjs                 # bundles src/main.mjs into out/main.mjs, with the kit inlined
npx electron@latest .          # or an Electron you have installed
```

Like `harness-node`, it connects through `connectHarness`, so it carries the runtime `hostRuntime()` finds: the
installed `@open-artifact/cli`, or the repository's built `skills/open-artifact` (run `npm run build` and
`node scripts/build-plugins.mjs` at the root first). A shipped app passes the runtime folder it carries inside its
bundle ([runtime](../../docs/integrating/runtime.md)).

### Starting the daemon in a utility process

By default the kit starts the daemon with this app's executable and `ELECTRON_RUN_AS_NODE=1`. An app whose `RunAsNode`
fuse is off cannot do that; it passes `daemon.spawn` and forks the daemon with `utilityProcess.fork`
(`src/daemon-spawn.mjs`). Run the example that way with:

```bash
OA_EXAMPLE_DAEMON=utility npx electron@latest .
```

Only one daemon runs per home: when one already runs, neither way starts anything. Type servers then run in worker
threads of the daemon ([runtime](../../docs/integrating/runtime.md#electron-apps-with-the-runasnode-fuse-off)).

Electron ends a utility process with the app without asking it, so on quit the example asks the daemon it forked to
stop (`child.kill()`, `SIGTERM` on macOS and Linux) and waits up to 8 s for it to end before it quits
(`stopDaemonUtilityProcess`, from `before-quit` in `src/main.mjs`). The daemon then removes `daemon.json` and its
lock, lets its type servers finish, and writes `daemon <version> stopped (SIGTERM)` to `<home>/logs/daemon.log`. A
daemon another app started is left running.

> In Electron 42.11.12 with the `RunAsNode` fuse off this option started the daemon (type servers in threads) and
> stopped it, and nothing more. The same `spawn` was checked further by hand outside this repository, in Electron
> 42.11.12 and 45.2.2 with the fuse off: the daemon ran the Docs type server in a worker thread, created and served a
> doc, and exited cleanly on `SIGTERM`.
>
> The stop on quit was checked in Electron 42.11.12 on macOS with a windowless app that forks the daemon with this
> file's functions and quits: with the stop, `daemon.json` and the lock were gone and the log ended with the stopped
> line; without it, both files stayed and the log had no such line.

Type `make My first note` to have the scripted agent create an artifact; it opens on the right. Comment on it or use
**Ask**, and the message arrives in the chat as the owner's turn. A card per artifact appears under the transcript.

## Files

| File | What it does |
| --- | --- |
| `src/main.mjs` | The app: connects with `connectHarness` (view mode, `embed.remote: 'ask'` with a dialog), attaches the session, registers tools, installs the skill, follows cards, runs the scripted turns, and adds page context to each typed message. |
| `src/daemon-spawn.mjs` | `daemon.spawn` for an app with its `RunAsNode` fuse off: forks the daemon with `utilityProcess.fork`, asks for type servers in threads, and appends its output to the log file; `stopDaemonUtilityProcess` asks that daemon to stop when the app quits. Used when `OA_EXAMPLE_DAEMON=utility`. |
| `src/pane.mjs` | `ArtifactPane`: one `WebContentsView` per artifact, driven by `embedArtifact` with a transport through the daemon (`shellCommand` / `on('shell')`). |
| `src/preload.cjs` | The chat window's only bridge (artifact pages get none). |
| `renderer/` | The chat column: transcript, cards, input with the command menu. |
| `build.mjs` | esbuild bundle of the main process, `electron` external. |

## The checklist for showing pages

`src/pane.mjs` follows each item:

- **Allowlist.** A view may load only the origins `embedOrigins()` lists, updated on every `embed/origins` event
  (`OriginAllowlist` in `harness-node/allowlist.mjs`). It never opens all of loopback. Remote origins get in only after
  the person agreed in the `allowRemote` dialog; a no is not remembered, so the next open of that page asks again.
- **Isolation.** Pages run with `sandbox`, `contextIsolation`, no Node, no preload, and their own storage partition
  (`persist:open-artifact-pages`).
- **Subframes and clipboard.** `blob:` and `about:srcdoc` subframes are allowed. The only permission granted is
  `clipboard-sanitized-write`, and only to allowed origins.
- **Links out.** New windows and navigations outside the allowlist open in the system browser (`shell.openExternal`);
  the view never navigates away.
- **Hidden, not destroyed.** Switching artifacts hides views; reopening one shows it again with its state.
- **Places.** `onPlace` is stored (`PlaceMemory`, in the app's user data) and sent back with `goto` on reopen.
- **Theme.** `nativeTheme` changes send `host_hello` again through `setTheme`.
- **Thumbnails.** `capturePage().toJPEG()` is passed as `capture`, and the kit saves it with `saveThumbnail`.
