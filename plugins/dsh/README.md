# Open Artifact for DeepSeek Harness

`dsh-open-artifact` is the DeepSeek Harness (DSH) plugin of Open Artifact. It is a full adapter (level 3) built on
`@open-artifact/harness-kit`, and the reference for an integration that shows pages inside the app. The integrator
guide is [docs/integrating.md](../../docs/integrating.md).

## What it gives DSH

| Part | What it does | Code |
| --- | --- | --- |
| Tools | `Artifact`, `ArtifactData` and `ArtifactComments` as native DSH tools, each call made as the calling session (`caller: { session: <agent id>, workspace: <its folder> }`) | `src/server/index.ts` |
| Wakes | A comment or request from a page reaches the session that owns the artifact right away: a new turn when it idles, added to the running turn otherwise. The owner's words go in as the person's; a collaborator's message or a task result goes in as a notice. A session with no live agent is resumed through DSH's session controller; when nothing can take it, the answer is `failed` and the daemon keeps it in the inbox. | `src/server/wake.ts` |
| Pages | `host.open` shows the Shell's `embed_url` in the session's Browser in the right sidebar, as a top-level view; what the Shell says comes back as `shell.event` | `src/server/host-open.ts`, `src/client/` |
| Library | The Open Artifact page in the sidebar lists the library, with update checks and release notes | `src/server/routes.ts`, `updates.ts`, `changelog.ts` |
| Skill | `/open-artifact <type> …`, rendered by the daemon for DSH | `src/server/skill.ts` |
| Status | A session going `running` and back to `idle` is passed on, so the Shell shows the agent working only while it is | `src/server/index.ts` |

Not wired, for want of a DSH API: cards of the artifacts a turn made, the person's selection on a page as context, and
`agent.wrote` for files DSH's own tools write ([limits](../../docs/integrating/limits.md)).

## Install

In DSH's Plugins, choose **Add plugin** and enter `dsh-open-artifact` as the npm package. In the CLI:

```bash
dsh plugin --profile web add dsh-open-artifact
```

## Settings

| Setting | Default | |
| --- | --- | --- |
| `agentName` | `Agent` | what the Shell calls the agent |
| `autoStart` | `true` | start the daemon when none runs |
| `daemonBin` | — | an `open-artifact.mjs` to start, skipping the runtime choice |
| `workspace` | — | the folder new artifacts go to when a session has none |

## How it starts the daemon

DSH installs no dependencies of a plugin, so the build puts what the daemon needs into `vendor/`: the daemon as one
file (`vendor/open-artifact.mjs`), the Shell and home pages, the type server and the built-in types, and the harness
profiles (`src/server/vendor.ts`). It also writes `scripts/open-artifact.mjs` (the open-artifact skill's launcher) and
`vendor/runtime.json`, so the plugin folder is a runtime folder like the skill's: the plugin names it in `hello`, the
daemon records it, and another app on this computer can start it.

When no daemon runs, the kit chooses among this vendored runtime, the runtimes other apps registered and the shared
ones under `<home>/runtime/<version>/`, and starts the newest compatible one. A newer runtime already on the computer
wins; the vendored one is never older than what runs, since `hello` declares it and the daemon replaces an older
running one. The plugin declares its runtime with `update: "bundled"`: DSH's plugin manager updates the plugin, and the
runtime with it ([runtime](../../docs/integrating/runtime.md)). `daemonBin` or `OPEN_ARTIFACT_DAEMON_BIN` names one
entry instead and skips the choice.

## Remote type pages

DSH declares `embed: { origins: [], mode: 'view', remote: 'allow' }` (`src/server/index.ts`): a remote type's page
(one served from another computer) is shown without asking. DSH chose `allow` because its Browser tab is a
general-purpose browser that goes wherever the person or the agent sends it, with no allowlist for Open Artifact to
widen, and remote pages opened in that tab before the move to the kit too. `ask` would need an `allowRemote` dialog,
for which DSH has no API. `open-artifact doctor --harness dsh` shows the policy for each remote type
([remote types](../../docs/integrating/remote-types.md)).

## Build and test

```bash
node plugins/dsh/scripts/build.mjs     # lib/, vendor/, scripts/open-artifact.mjs and skills/open-artifact/SKILL.md (run by npm run build)
node --test plugins/dsh/test/*.test.ts # part of npm test
```

`--no-vendor` leaves `vendor/` as it is.
