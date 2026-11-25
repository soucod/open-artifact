# Headless host example

The smallest complete agent app on `@open-artifact/harness-kit`: one chat session, no window. It shows each step an
app takes to integrate Open Artifact, with a scripted stand-in where a real app has its model.

```bash
node examples/harness-node/main.mjs --workspace /tmp/demo [--type slides] [--once]
```

It needs Node 22.18 or later and the repository's dependencies (`npm install` at the root). It connects to the
running daemon, or starts one from the runtime it carries: `hostRuntime()` in [`harness.mjs`](harness.mjs) takes the
installed `@open-artifact/cli` package, or in this repository the built `skills/open-artifact` folder, and passes it
with its version as `runtime`. With neither it stops and says how to get one (`npm install @open-artifact/cli`, or
`npm run build` then `node scripts/build-plugins.mjs`), unless `OPEN_ARTIFACT_DAEMON_BIN` names an `open-artifact`
entry file. An app of your own passes the runtime folder it ships ([runtime](../../docs/integrating/runtime.md)).

Then it attaches session `chat-1`, registers the tools in the
agent's own tool registry, installs the skill, makes an artifact (`quickstart` → `publish` → writes a file → `open`),
reads the page context, and then prints every message the page sends until you stop it (`--once`: after the first).
Open the printed page address, comment on the artifact or use **Ask**, and the line `wake turn …` appears.

## Files

Each file covers one part of the integration. `examples/harness-electron` imports the same modules.

| File | What it shows |
| --- | --- |
| `harness.mjs` | `connectHarness`: the one `createHarness` call, with the caps a native-tools host declares. |
| `agent.mjs` | `ScriptedAgent`: a session with a transcript and a tool registry (your app's agent goes here). |
| `tools.mjs` | Registers `oa.tools()` in the agent, each call going back through `oa.call` with the session as caller; `oa.wrote` for files the agent wrote itself. |
| `wakes.mjs` | The `wake` callback: routes by `source.from.kind` — the owner's words start a turn, a collaborator's comment or a finished task is a notice. |
| `artifacts.mjs` | Artifact cards from `on('artifact')`, one per artifact and session, keyed by the `open-artifact://` link. |
| `skill.mjs` | `installSkill` into the app's skill folder, and `commands()` for the command menu. |
| `allowlist.mjs` | The origins an artifact view may load, from `embedOrigins()` and `embed/origins` events; remote origins only once trusted. |
| `places.mjs` | Where each artifact was last looked at, so reopening it goes back there (`goto`). |
| `main.mjs` | The run above, putting the pieces together. |

## Test

```bash
node --test examples/harness-node/harness-node.test.mjs
```

The test covers the shared modules, then bundles the daemon from source into a temporary folder, starts `main.mjs`
against it in a temporary `OPEN_ARTIFACT_HOME` with a small user type, sends a page request
(`POST /api/open-artifact.artifacts.ask`, what the Shell's **Ask** sends), and checks that the session got it live as
the owner's turn. The root `npm test` runs it.
