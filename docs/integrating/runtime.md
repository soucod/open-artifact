# Runtime and updates

[中文](runtime.zh-CN.md)

After reading this you can ship Open Artifact inside your app, know which copy starts the daemon when several apps carry
one, and choose how it updates.

## What the runtime is

The runtime is the content of the npm package `@open-artifact/cli`: `scripts/open-artifact.mjs` (the command line and
the daemon), and `vendor/` with the Shell, the type server and the built-in types. One daemon runs per Open Artifact
home (`~/.agents/open-artifact`, or `OPEN_ARTIFACT_HOME`), shared by every app on the computer.

## Carrying one

Ship the runtime folder with your app and name it when you connect:

```js
const oa = await createHarness({
  harness: 'my-agent',
  runtime: { dir: '/Applications/MyAgent.app/Contents/Resources/open-artifact', version: '0.14.6', update: 'prompt' },
});
```

`hello` registers it with the daemon (kept in `<home>/runtimes.json`), and the daemon copies the newest runtime a host
brought into the shared folder `<home>/runtime/<version>/`, so uninstalling your app does not take the computer back to
an older daemon. A registered folder that is gone is skipped.

The examples find the runtime they carry with `hostRuntime()` in
[`examples/harness-node/harness.mjs`](../../examples/harness-node/harness.mjs): the installed `@open-artifact/cli`
package, or in this repository the built skill, read for its version. It returns nothing when
`OPEN_ARTIFACT_DAEMON_BIN` is set, and throws when it finds no runtime.

With no `runtime`, the kit chooses among the runtimes other apps registered and the shared ones.
`OPEN_ARTIFACT_DAEMON_BIN` (an `open-artifact` entry file) skips the choice. When there is nothing to start it throws `no_daemon`, fix line: `Set OPEN_ARTIFACT_DAEMON_BIN to the open-artifact entry, or pass bin (createHarness:
runtime.dir).`

## Which one starts

When no daemon runs, the kit starts the **newest** runtime among your own, the registered ones and the shared ones, whose
Harness API versions meet yours, within the person's pin (`open-artifact runtime pin ^0.14`) when one is set. A tie goes
to your own. A running daemon older than your own runtime is replaced.

The kit starts it as `<your Node or Electron> <runtime>/scripts/open-artifact.mjs daemon run`, detached, with
`ELECTRON_RUN_AS_NODE=1`, so an Electron app needs no separate Node. Its output goes to `<home>/logs/daemon.out`; a
start that fails throws `daemon_failed` naming that file. An Electron app with its `RunAsNode` fuse off starts it itself
([below](#electron-apps-with-the-runasnode-fuse-off)).

## Electron apps with the RunAsNode fuse off

An Electron app whose `RunAsNode` fuse is off cannot run a script with `ELECTRON_RUN_AS_NODE=1`, so the kit's own start
fails. Give the kit `daemon.spawn` and start the daemon with
[`utilityProcess.fork`](https://www.electronjs.org/docs/latest/api/utility-process) instead:

```js
const { utilityProcess } = require('electron');
const { createWriteStream } = require('node:fs');

const oa = await createHarness({
  harness: 'my-agent',
  runtime: { dir: runtimeDir, version: '0.14.6' },
  daemon: {
    spawn: ({ bin, args, env, logFile }) => {
      const child = utilityProcess.fork(bin, args, {
        env: { ...env, OPEN_ARTIFACT_NODE_CHILDREN: 'threads' },
        stdio: 'pipe',
        serviceName: 'Open Artifact',
      });
      const log = createWriteStream(logFile, { flags: 'a' });
      child.stdout?.pipe(log);
      child.stderr?.pipe(log);
      return child; // optional: lets the kit try the next runtime as soon as this one ends
    },
  },
});
```

The kit hands `spawn` the entry (`bin`), `['daemon', 'run']`, the environment with `OPEN_ARTIFACT_HOME` and without
`ELECTRON_RUN_AS_NODE`, and the log file (`<home>/logs/daemon.out`, whose folder exists). It still chooses the runtime,
waits for the daemon, checks its version, and tries the next runtime when one does not start; a start that throws is
named in the `daemon_failed` message. Return the process (anything with `once('exit')`) to move on as soon as it ends;
otherwise the kit waits until its timeout. With no `spawn` nothing changes.

Inside a utility process `process.argv` is `[<Electron Helper>, <bin>, ...args]`, the same shape as Node's, so the
daemon reads its arguments without a wrapper (checked with Electron 42, 44 and 45).

**Stop the daemon when your app quits.** Electron ends a utility process with the app, without a signal the daemon
could act on: `daemon.json` and `daemon.lock` stay in the home, the type servers are cut off wherever they were, and
`daemon.log` says nothing. Ask the daemon to stop first and wait a bounded time for it to end:

```js
let daemon = null; // in `spawn`: daemon = child; child.once('exit', () => { daemon = null; });
let leaving = false;

app.on('before-quit', (event) => {
  if (leaving || !daemon) return; // this app forked no daemon: another app's was already running
  leaving = true;
  event.preventDefault();
  const timer = setTimeout(() => app.quit(), 8000); // the daemon waits up to 6 s for its type servers
  daemon.once('exit', () => {
    clearTimeout(timer);
    app.quit();
  });
  daemon.kill(); // SIGTERM on macOS and Linux
});
```

On `SIGTERM` the daemon stops its type servers through their own handlers, waits for them, removes `daemon.json` and
`daemon.lock`, and writes `daemon <version> stopped (SIGTERM)` to `<home>/logs/daemon.log`; it usually ends within
milliseconds, and takes up to 6 s when a type server is slow to finish. Stop only a daemon your app forked: when
another app's daemon already ran, `spawn` was never called and there is nothing to stop. On Windows `kill()` ends the
process at once, as quitting does. Files left behind are replaced by the next daemon that starts, unless the process
id written in `daemon.lock` now belongs to another running process: then that daemon refuses to start until the lock
is removed. [`examples/harness-electron`](../../examples/harness-electron/src/daemon-spawn.mjs) does this
(`stopDaemonUtilityProcess`; checked with Electron 42 on macOS, with and without the stop).

**Type servers.** The daemon starts the built-in types' servers as child processes of its own executable. When the
daemon runs inside an Electron process, that executable is an Electron helper or your app and must not be started as
Node, so the daemon runs them in worker threads of its own process instead. It decides from how it runs itself, without
starting anything:

- `OPEN_ARTIFACT_NODE_CHILDREN=process|threads` in the daemon's environment wins (the snippet above sets `threads` in
  the `env` it passes to `fork`, to say so explicitly);
- under plain Node it uses child processes;
- under Electron running as Node (`ELECTRON_RUN_AS_NODE` honoured, no `process.type`) it uses child processes;
- inside an Electron process (`process.type` is set, as in a utility process) it uses threads. An app whose fuse is on
  that forks the daemon in a utility process and wants child processes sets `OPEN_ARTIFACT_NODE_CHILDREN=process`.

`ELECTRON_RUN_AS_NODE` in the environment does not decide it: an app with the fuse off may have it set and ignore it.

`open-artifact doctor` shows the choice ("Type server processes"), `GET /__open-artifact/health` returns it as `nodeChildren`, and
the daemon log says it once. A third-party type whose server command is not `node` still runs as a child process.

Limits of threads mode:

- A type server shares the daemon's memory: no memory isolation, and a server that runs out of memory takes the daemon
  with it. Each thread loads its own WebAssembly, so the daemon uses more memory than one process would.
- The daemon ends with your app, since a utility process does not outlive it; ask it to stop before you quit (above),
  or its state files stay behind. The next app that connects starts it again.
- When a newer runtime should replace the running daemon, the daemon stops and leaves the start to your app's kit,
  which does it on the next connection; it does not start a copy of your app.
- A stop asks a server to end (its `SIGTERM` handler runs); one that does not end in time is terminated, and its
  `exit` handlers do not run.
- Processes a threaded server started itself, such as a connector's stdio MCP server, are stopped by that server's
  `exit` handler. When the server is terminated or the daemon process dies abruptly, that handler does not run: those
  processes are not signalled and end when their stdin closes, as a stdio MCP server does.
- `process.cwd()` in a server returns its type folder, but the operating system's working directory is still the
  daemon's, so relative file paths passed straight to native code resolve against the daemon's folder.

## Updates

| Policy | What the daemon does |
| --- | --- |
| `prompt` (default) | checks the registry at most once a day and tells subscribed adapters (`runtime/update` event); downloads nothing until someone says yes |
| `auto` | also downloads in the background |
| `bundled` | never checks; uses the runtimes on this computer |

Which policy is in effect, first match wins:

1. **The machine.** `OPEN_ARTIFACT_RUNTIME_UPDATE=off`, or a machine policy file with `{"runtimeUpdate": "off"}`
   (`$OPEN_ARTIFACT_MACHINE_POLICY`, else `/Library/Application Support/Open Artifact/policy.json`,
   `/etc/open-artifact/policy.json`, `%ProgramData%\Open Artifact\policy.json`) switches checks and updates off.
2. **The person.** `settings.json` `runtime.update`, set with `open-artifact runtime policy auto|prompt|bundled`
   (`default` removes it).
3. **The adapters.** The most conservative `update` of the registered runtimes; an adapter that says `bundled` abstains
   unless every one says `bundled`.
4. `prompt`.

`open-artifact runtime policy` with no word prints the policy and where it comes from.

### Saying yes from your app

```js
oa.on('event', (event) => {
  if (event.type === 'runtime/update' && event.available) offerUpdate(event.available);
});
// when the person agrees:
const { installed, pending, message } = await oa.runtime.update();   // or update('0.14.6')
const status = await oa.runtime.status();
```

`oa.runtime.status()` answers what `open-artifact runtime status --json` prints: the running version, the one that
would start, every runtime here, the policy and its source, the pin, the registry, the last check and a pending switch.
`oa.runtime.update(version?)` installs the newest compatible runtime, or that version; it is refused with `not_granted`
when the person chose `bundled` or the machine switched updates off. Both throw `unsupported` (fix line: `Update the
Open Artifact runtime this computer runs.`) when the daemon does not list the feature `runtime.update`.

### How an update is checked

- The source is `@open-artifact/cli` on the npm registry: `$OPEN_ARTIFACT_REGISTRY`, else `settings.json`
  `runtime.registry`, else the usual npm configuration, else `registry.npmjs.org`. Plain `http` only for a loopback
  registry.
- The check sends no credentials, no cookies and nothing about the person or their artifacts. It picks the newest
  version that is not a pre-release, not deprecated, within the pin, runs on this Node, and speaks the Harness API of
  every adapter seen lately.
- The tarball is refused unless its sha512 matches the registry's `dist.integrity`. The registry's provenance
  attestation is recorded and shown by `runtime status`, **not verified**.
- A tarball may be 256 MiB, unpacked 1 GiB. Three shared runtimes are kept.
- The daemon switches to the new runtime once it is idle (no open page, no tool call or long action running), or at the
  next start. Updates are logged to `<home>/logs/daemon.log`.

## Commands

| Command | Does |
| --- | --- |
| `open-artifact runtime status [--json] [--check]` | the runtimes here and which one starts; `--check` asks the registry now |
| `open-artifact runtime update [--version <x.y.z>]` | installs the newest compatible runtime, or that version |
| `open-artifact runtime pin <range> \| --clear` | keeps the runtime within a range |
| `open-artifact runtime policy [auto\|prompt\|bundled\|default] [--json]` | prints or sets the person's policy |

`update`, `pin` and `policy` are the person's decisions: run inside an agent's session they are refused.

## Artifacts from a newer release

Two apps may carry different runtimes, and a person may open on an older one an artifact a newer type release wrote.
The tools then treat it as read-only ([tools](tools.md#artifacts-written-by-a-newer-release)).

## A single executable

For an app with neither Node nor Electron, `open-artifact-<platform>-<arch>` (`.exe` on Windows) is Node with the
runtime inside. It has the same command line as `open-artifact`, so your app ships it and runs
`open-artifact-darwin-arm64 harness --stdio --harness my-agent` ([other languages](non-node.md)).

On first use it unpacks the runtime into the shared folder `<home>/runtime/<version>/`, checked by sha512 as an update
is, and runs it from there. That folder is an ordinary shared runtime: a newer one on the computer may still start
instead, run by the executable's Node. The daemon and the type servers it starts run on the executable too, so the
computer needs no `node`.

The commands the daemon gives an agent (in the skill text and in tool answers) start with the executable's path instead
of `node`, quoted when it has spaces or shell characters (on Windows that is always, because of the backslashes), and `open-artifact doctor` says `Node.js <version> (inside the single-file
executable <path>)`. Two limits:

- In PowerShell a quoted program path must be called with `&` (`& "C:\Program Files\My Agent\open-artifact-win32-x64.exe" …`).
  The daemon's text does not add the `&`, so an agent running such a command in PowerShell has to.
- The executable has been built and tested on macOS arm64 only. Other platforms build with the same script but are
  untested.

It is not published yet: build it yourself for each platform you ship, on that platform.

```text
npm run build
node scripts/build-skill.mjs
node scripts/build.mjs --only sea      # dist/sea/open-artifact-<platform>-<arch>
```

The Node that builds it is the one inside it: an official nodejs.org build of Node 25.5 or later (`--node <path>` or
`OPEN_ARTIFACT_SEA_NODE` to choose one). A Node built without single executable support, such as Homebrew's, cannot
be used. On macOS the result is signed ad hoc; sign it with your own identity before you ship it.
