# @open-artifact/harness-kit

The SDK an agent app uses to integrate [Open Artifact](https://github.com/JimLiu/open-artifact). It finds or starts the
local daemon, holds a Harness API connection that reconnects by itself, gives the app's agent the tools, hands comment
wakes to the app's sessions and page opens to its UI, and reports the artifacts its sessions make.

It depends only on `@open-artifact/protocol` and Node built-ins (Node 22.18+, or Electron's Node), and bundles into a
single file. The guide is [docs/integrating.md](../../docs/integrating.md); this page is the summary of the package.

## Use

```ts
import { createHarness } from '@open-artifact/harness-kit';

const harness = await createHarness({
  harness: 'my-app',                  // ^[a-z0-9][a-z0-9._-]{0,40}$
  agentName: 'Assistant',
  commands: ['artifact'],
  runtime: { dir: '/path/to/@open-artifact/cli', version: '0.14.6' }, // starts the daemon when none runs
  // Give a message to a session: 'delivered' | 'resumed' | 'drafted' | 'queued' | 'failed' (the daemon keeps it),
  // or { status, session }. Only the owner's words (source.from.kind === 'owner') should become a user turn.
  wake: async ({ session, text, source }) => ((await myApp.deliver(session, text, source)) ? 'delivered' : 'failed'),
  // Show a page in the app's own UI; return false when it was not shown.
  embed: { origins: [], mode: 'view', remote: 'ask' },
  allowRemote: ({ origin, type }) => myApp.confirm(`Show a ${type} page from ${origin}?`),
  open: ({ embedUrl, title }) => myApp.openTab(embedUrl, title),
});

await harness.attach({ session: 's1', workspace: '/path/to/project', title: 'Chat 1' });
const tools = await harness.tools();                       // the daemon's, or the bundled definitions offline
const result = await harness.call('Artifact', args, { session: 's1', workspace: '/path/to/project' });
harness.on('artifact', ({ session, artifact, change }) => myApp.card(session, artifact, change));
```

- The connection reconnects with backoff (1 s doubling to 30 s), says hello again and attaches every session again.
- What waited in a session's inbox goes to `wake` on attach; `attach()` returns what `wake` did not take.
- A `wake` callback that throws or takes longer than `wakeTimeoutMs` (25 s) answers `failed`.
- `caps` in `hello` follow from the callbacks: `wake` only with a `wake` callback, `open` only with an `open` callback
  (`{ embed, origins, remote }` with `embed`). `options.caps` adds `tools`, `library`, `wake.resume`, `wake.mode`.
- Under `embed.remote: 'ask'` (the default) a remote type's page reaches `open` only after `allowRemote` said yes.
- Check `harness.features` by name before using anything newer than the base protocol.
- `daemon: { spawn }` starts the daemon process yourself. The kit passes `{ bin, args, env, logFile }` (no
  `ELECTRON_RUN_AS_NODE` in `env`) and still chooses the runtime, waits for the daemon, checks its version and tries
  the next runtime; return the process (anything with `once('exit')`) so a failed one is left at once. An Electron app
  with its `RunAsNode` fuse off uses `utilityProcess.fork(bin, args, { env, stdio: 'pipe' })`; type servers then run
  in worker threads of the daemon, and the app asks the daemon to stop (`child.kill()`, then a bounded wait for
  `exit`) before it quits, so `daemon.json` and the lock do not stay behind
  ([runtime guide](../../docs/integrating/runtime.md#electron-apps-with-the-runasnode-fuse-off)).

## The `Harness` object

| Member | Does |
| --- | --- |
| `ready()` | connects now (starting the daemon unless `autoStart: false`) |
| `connected`, `features`, `client` | the state, the daemon's features, the raw `HarnessClient` |
| `attach`, `status`, `detach`, `rename` | sessions |
| `tools()`, `call(name, args, caller)` | the tools |
| `wrote(paths, caller)` | files the agent wrote with its own tools |
| `open(url, caller)` | shows an artifact (through your `open` when you show pages) |
| `owns(args)` | whether a tool call is about an `open-artifact://` link |
| `viewUrl(url)`, `publicUrl(url)` | the local Shell page, and the site address when published |
| `embedOrigins()` | the origins a view may load (feature `embed.origins`) |
| `shellCommand(view, command)` | a host message to a top-level view's Shell (feature `shell.command`) |
| `context(url, caller)`, `contextBlock(context)` | what the person selected on the page, as prompt text (feature `view.context`) |
| `saveThumbnail(url, jpeg)` | a thumbnail for the library |
| `installSkill({ dir, … })`, `commands()` | the skill file and the command menu (features `skill.get`, `commands.list`; rendered by the kit without them). `opens` (`host` \| `agent-browser` \| `system` \| `link`) sets how the skill tells the agent to show a page; left out, `host` when you pass `open` (the daemon's rendering and, through `harness.installSkill`, the kit's own), else a general step; the standalone helpers take it only as given ([commands and the skill](../../docs/integrating.md#commands-and-the-skill)) |
| `runtime.status()`, `runtime.update(version?)` | the runtimes on this computer and which starts; the person's yes to an update (feature `runtime.update`; `update` is `not_granted` when updates are off) |
| `on('artifact' \| 'shell' \| 'event' \| 'state', listener)` | artifact reports, Shell messages, every daemon event, the connection state |
| `close()` | closes the connection for good |

A call that needs a feature the daemon does not list throws `unsupported`, fix line `Update the Open Artifact runtime
this computer runs.`

## Testing an adapter

`@open-artifact/harness-kit/testing` runs a fake daemon in the test process: the Harness API over a real WebSocket on
an ephemeral port, and `daemon.json` in a temporary home.

```ts
import { startFakeDaemon } from '@open-artifact/harness-kit/testing';

const fake = await startFakeDaemon();                         // the real daemon's features; [] plays an older one
const harness = await createHarness({ harness: 'my-app', home: fake.home, autoStart: false, wake });
fake.queueInbox('s1', { text: 'Make it blue', source });     // handed to wake by the next attach
await fake.wake({ session: 's1', text: 'hi' });              // { status } as the adapter answered
fake.setArtifact({ id: 'art_…', title: 'Deck' });
fake.emit({ type: 'artifacts/changed', id: 'art_…' });       // on('artifact') reports it
fake.drop();                                                 // the adapter reconnects and attaches again
fake.calls;                                                  // every call it took, in order
await fake.close();
```

It answers `skill.get` (the protocol's template for your caps) and `commands.list` (one entry per `types`, default
`slides`); `onSkill` and `onCommands` replace them, and `handle` answers any other method. More in
[docs/integrating/testing.md](../../docs/integrating/testing.md).

## Entry points

- `.`: `createHarness`, `HarnessClient`, `ensureDaemon`, `readDaemon`, `api`, `isOlderVersion`, `openArtifactHome`,
  the runtime choice (`selectRuntime`, `rankRuntimes`, `runtimeCandidates`, …), `remoteGate`, `contextBlock`,
  `installSkill`, `renderSkill`, `commands`.
- `./testing`: `startFakeDaemon`.
- `./embed`: browser code with no Node imports, for the app's renderer: `embedArtifact` (a Shell page in an iframe or a
  top-level view) and `embedLibrary` (the home page). Reference: [docs/spec/embed.md](../../docs/spec/embed.md).
