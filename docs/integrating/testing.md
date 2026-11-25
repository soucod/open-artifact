# Testing an integration

[中文](testing.zh-CN.md)

After reading this you can test your adapter without a real daemon, run it against a real one in CI, and check a
person's computer when something does not work.

## A fake daemon in your unit tests

`@open-artifact/harness-kit/testing` speaks the Harness API over a real WebSocket on a free port, in your test process,
and writes `daemon.json` in a home of its own, so the kit finds it the way it finds the real daemon.

```js
import { startFakeDaemon } from '@open-artifact/harness-kit/testing';
import { createHarness } from '@open-artifact/harness-kit';

const fake = await startFakeDaemon();          // lists the real daemon's features
const oa = await createHarness({ harness: 'my-agent', home: fake.home, autoStart: false, wake: (params) => 'delivered' });
await oa.attach({ session: 's1', workspace: '/w' });
await fake.waitFor('session.attach');           // the first attach

assert.deepEqual(await fake.wake({ session: 's1', text: 'hi' }), { status: 'delivered' });
fake.drop();                                    // the kit reconnects and attaches s1 again
assert.equal((await fake.waitFor('session.attach')).connection, 2);
oa.close();
await fake.close();
```

| Member | Does |
| --- | --- |
| `wake(params)` | sends `wake.deliver` (a comment from the owner unless you pass `source`); answers `{ status }` or `{ status, session }` |
| `open(params)` | sends `host.open`; with `view` set it plays a top-level view |
| `shellEvent(view, event)` | sends what that view's Shell said |
| `request(method, params)` | sends any daemon-to-adapter call |
| `emit(event)` | sends an event to subscribed adapters |
| `queueInbox(session, message)` | the next `session.attach` or `inbox.take` returns it |
| `setArtifact`, `removeArtifact` | what the Library API answers for an id (so `on('artifact')` can report it) |
| `setContext(id, context)` | what `view.context` answers |
| `runtimeUpdate(available, installed)` | sends `runtime/update` |
| `calls`, `hellos`, `sessions`, `shellCommands`, `thumbnails`, `connected` | what your adapter did |
| `waitFor(method)` | resolves with the next call of that method |
| `drop()` | drops the connection as a daemon that went away |
| `close()` | stops it and removes its home |

Options: `home`, `token`, `version`, `protocols`, `features`, `types`, `onSkill`, `onCommands`, `tools`,
`onToolCall`, `handle`, `origins`, `runtimeStatus`, `onRuntimeUpdate`.

Three things to know:

- **It lists the real daemon's features by default** (`HARNESS_FEATURES`, exported from `@open-artifact/protocol`).
  Pass `features: []` to play an older daemon and test your fallbacks, or a shorter list to drop one feature.
- **It answers `skill.get` and `commands.list`.** `skill.get` renders the protocol's skill template for your caps;
  `commands.list` gives `/<command> <type> ` for each of `types` (default one, `slides`). Pass `onSkill` or
  `onCommands` to answer them yourself. The default skill is the template, not the real daemon's full text for its
  installed types.
- **It answers `runtime.status` and `runtime.update`** (`runtimeStatus`, `onRuntimeUpdate`), so `oa.runtime.status()`
  and `oa.runtime.update()` work against it.

## Against a real daemon

Run the real daemon in a temporary home, with the browser off, as
[`examples/harness-node/harness-node.test.mjs`](../../examples/harness-node/harness-node.test.mjs) does:

| Variable | Set to |
| --- | --- |
| `OPEN_ARTIFACT_HOME` | a temporary folder |
| `OPEN_ARTIFACT_DAEMON_BIN` | the `open-artifact` entry to start (or pass `runtime` to `createHarness`) |
| `OPEN_ARTIFACT_PORT` | `0`: any free port |
| `OPEN_ARTIFACT_BROWSER` | `none` |
| `OPEN_ARTIFACT_USER_TYPES` | a folder with a small type of your own, so the test needs no built types |
| `OPEN_ARTIFACT_BUILTIN_TYPES` | an empty folder |
| `OPEN_ARTIFACT_WAKE_MERGE_MS` | a short merge window, e.g. `20` |

A page request reaches your session the way the Shell's **Ask** sends it, through the Library API:

```js
import { api, readDaemon } from '@open-artifact/harness-kit';

const state = await readDaemon(process.env.OPEN_ARTIFACT_HOME);
const answer = await api(state, 'artifacts.ask', { id, text: 'Make the title bigger' });
// answer.via is 'live' when your adapter took it
```

Stop the daemon when the test ends: `open-artifact daemon stop`, or kill the `pid` in `daemon.json`.

## On a person's computer

```text
open-artifact doctor --harness my-agent
```

It checks Node, the home folder, `settings.json`, the daemon (and that `daemon.json` is readable only by the person),
whether type servers run as processes or in worker threads,
the runtime, the types, the harness's profile, whether an adapter of the harness is connected, the tools, and each enabled remote type. It exits
non-zero when a check fails; `--json` gives the findings to a script.

`GET /api/open-artifact.harnesses` (with the token) lists the connected adapters, their caps, and the sessions.

## A conformance run

With your app running and one of its sessions attached, check the whole path as that session:

```text
open-artifact doctor --harness my-agent --session chat-1 --json
```

Doctor connects under your harness name with no caps of its own, so the daemon never sends it your wakes or pages, and
calls the tools as your session through `caller`. It never attaches your session. It makes a test artifact (a local
type, in a temporary folder) and removes it at the end, even when a step failed. Each step says `ok`, `warn`, `fail`
or `n/a` with one line of what to do; `n/a` means your app did not declare that capability, or the step needs a person.

| Step | Checks |
| --- | --- |
| `discovery` | the daemon runs, and an adapter of the harness is connected |
| `profile` | the harness's profile and the caps your adapter said |
| `session` | the session is attached, live, through which adapter |
| `tools` | `tools.list` has the three tools; `quickstart` and `publish` make the test artifact, owned by the session |
| `commands` | `skill.get` renders your first command (and `commands.list` when you have a menu) |
| `open` | `Artifact open` reaches your `host.open`, answered within 30 s |
| `wake` | a page request reaches the session live and you answer `resumed`, `delivered` or `drafted` |
| `rules` | your `rules` reach `quickstart`; a role `policy.roles` refuses is refused `not_granted` |
| `context` | `view.context` answers for the test artifact |
| `registration` | `artifacts/changed` events arrive on create and on a write, with the session as owner |
| `cleanup` | the test artifact and its folder are removed |

The `wake` step starts a turn of your agent; its text says there is nothing to do. With `--json`, a CI gate reads the
findings whose `id` starts with `conformance.` and fails on `status: "fail"`; the process exits 1 when any check fails.
Fields of the JSON are only ever added.

## In this repository

`npm run e2e -- --only harness-compat` connects two hosts built from `examples/harness-node` to a real daemon: it runs
the conformance run above end to end, the declared, refused and undeclared frame hosts in Chrome, a top-level view
with its ticket, and a remote type that the `allow` host is given and the `deny` host never is. `--no-browser` skips the Chrome cases. The run
against earlier releases of the kit is skipped until the kit is published.
