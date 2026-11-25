# Harness over stdio: a Python host

A host that reaches Open Artifact by spawning `open-artifact harness --stdio --harness <name>` and talking JSON-RPC
over its stdin and stdout, for an app that would rather not open a WebSocket or read `daemon.json` itself. It uses
the Python standard library only and runs on Python 3.9 or later.

| File | What it does |
| --- | --- |
| `rpc.py` | JSON-RPC 2.0, one object per line, both ways: the host's requests and their answers, the bridge's requests (answered on a thread each) and notifications. |
| `host.py` | Answers the daemon's calls (`wake.deliver`, `host.open`, `shell.event`) and handles the bridge's notifications (`bridge.state`, `bridge.reattached`, `event`). Each prints one line. |
| `main.py` | Spawns the bridge, says `hello`, subscribes, attaches a session, lists the tools, calls `quickstart` and `publish`, then answers the daemon until stopped. |
| `harness-stdio.test.mjs` | Runs `main.py` against a real daemon in a temporary home (skipped, saying so, without `python3`). |

## Run it

```bash
npm install -g @open-artifact/cli        # or pass --cli "npx @open-artifact/cli"
python3 main.py --workspace ~/notes --once
```

From a checkout of this repository, without installing anything:

```bash
python3 examples/harness-stdio/main.py --cli "node packages/daemon/src/bin/open-artifact.ts" --workspace /tmp/work --once
```

It prints `connected`, `attached`, `tools`, `open` (the page `publish` asked it to show) and `ready <url>`. Click
**Ask** on that page and send a request: the host prints `wake turn request from owner on "Hello from Python"` and,
with `--once`, exits.

Options: `--harness` (default `example-stdio`), `--session` (default `py-1`), `--workspace`, `--type` (default: what
`quickstart` recommends for a note), `--cli` (or `OPEN_ARTIFACT_CLI`) and `--once`.

## The protocol in five lines

1. Each message is one JSON object on one line ending in `\n`; stdout carries nothing else, stderr is the bridge's log.
2. `hello` comes first and carries no token (the bridge reads `daemon.json`); its `harness` must equal `--harness`.
   Its `caps` say which calls you answer: `wake` gets you `wake.deliver`, `open` gets you `host.open`.
3. Everything else is the Harness API as over the WebSocket: `session.attach`, `tools.list`, `tools.call` (with
   `caller: {session, workspace}`), `subscribe`, `skill.get`, …
4. The bridge's own requests have ids `d1`, `d2`, …; answer each with the same id. They can arrive while one of your
   requests is still waiting (`host.open` during `publish` with `open: "now"`), so read on a thread of its own.
5. `bridge.state` says when the daemon connection drops and comes back (the bridge starts the daemon again if needed
   and attaches your sessions again); `bridge.reattached` then hands over what waited for a session meanwhile.

The bridge ends when its stdin ends; the daemon keeps running. The framing is specified at the top of
`packages/daemon/src/stdio-bridge.ts`; the methods and their types are in `packages/protocol/src/harness.ts`.

## Test

```bash
node --test examples/harness-stdio/harness-stdio.test.mjs
```

It bundles the daemon from source, starts the host against it in a temporary `OPEN_ARTIFACT_HOME`, stops the daemon
once to see the session attached again, and sends the request a page's **Ask** sends. The root `npm test` runs it too.
