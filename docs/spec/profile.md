# Harness profile reference

[中文](profile.zh-CN.md)

A harness profile is what the daemon knows about an agent app before (and beside) what its adapter says: how its agent
reaches the tools, how wakes reach it, its hooks, its rules. This page lists every field, who may set it, and the
profiles that ship. The type is `HarnessProfile` in `packages/protocol/src/harness.ts`.

## Where a profile comes from

| Order | Source | File | `source` |
| --- | --- | --- | --- |
| 1 | the person's own, `open-artifact harness add <profile.json>` | `<home>/harnesses/<name>.json` | `user` (or none) |
| 2 | what your adapter reported in `hello` (`profile`) | the same file | `adapter` |
| 3 | shipped with Open Artifact | `packages/daemon/harnesses/<name>.json` (`$OPEN_ARTIFACT_HARNESS_PROFILES` to override the folder) | `shipped` |
| 4 | none of these | — | the default: `level: "L1"`, `entry: "mcp"`, `wake: ["inbox"]`, `agentName: "Agent"` |

- The person's file **replaces** the shipped profile (laid over the default). An adapter's report never overwrites it.
- An adapter's report is laid over the shipped profile. Fields an adapter may not set, or with the wrong shape, are
  dropped.
- `open-artifact harness list [--json]` shows the profile in effect for each harness and where it comes from.
- `open-artifact harness remove <name>` removes the file in `<home>/harnesses/`; the shipped profile is in effect again.
  A shipped profile is never removed.
- `harness add` and `harness remove` are the person's decisions: run inside an agent's session they are refused.

## Fields

| Field | Type | Adapter may set | Means |
| --- | --- | --- | --- |
| `name` | string | no (it is `hello.harness`) | the harness name |
| `title` | string | yes | shown to people: the Shell's Ask pane, open-session button and menu, and the home page's owner badge (left out, the harness name is shown as it is) |
| `agentName` | string | yes | what the harness calls its agent |
| `level` | `L1` \| `L2` \| `L3` | yes | a short name: MCP only, MCP and hooks, a full adapter |
| `entry` | `harness-api` \| `mcp` \| `mod` | yes | how the harness reaches the daemon |
| `plugin` | string | yes | the package of the harness plugin |
| `mcp` | `{ command, args }` | **no** | how to start the MCP bridge |
| `sessionEnv` | string | yes | the environment variable that holds the session id in a tool's process |
| `skillsDir` | path | **no** | where the harness looks for skills |
| `wake` | `("live" \| "inbox")[]` | yes | wake routes, in order |
| `wakesIdle` | boolean | yes | `false`: nothing can start a turn in an idle session; messages wait for the person's next turn |
| `open` | `"browser"` | yes | where a page goes when no adapter shows it; left out: the agent gives the link |
| `markers` | string[] | yes | environment variables the harness sets in its agent's commands (person-only commands are refused where they are set) |
| `hookDialect` | name or mapping | yes | the hook format ([below](#hook-dialects)) |
| `nudge` | `{ command, args, env?, envFile? }` | **no** | the command that starts a turn in an idle session |
| `sessionWorkspace` | `"codex-rollout"` | **no** | how to find a session's folder when nothing said it |
| `caps` | `AdapterCaps` | yes | how far the harness goes in each dimension ([Harness API](harness-api.md#adaptercaps)) |
| `policy` | `{ offer?, reuse?, roles?, confirm? }` | yes | rules that are data ([below](#policy)) |
| `rules` | string, at most 4000 characters | yes | rules that are text: the agent reads them first, and they win over the instructions that follow; they change no permission |
| `commands` | string[] | yes | the harness's command names, e.g. `["artifact"]` |
| `toolNames` | `{ Artifact?, ArtifactData?, ArtifactComments? }` | yes | the names the harness gave the tools |
| `source` | `shipped` \| `adapter` \| `user` | no | where the profile came from |

The fields an adapter may not set are the ones that would make the daemon run a command (`mcp`, `nudge`), write
somewhere (`skillsDir`) or read files (`sessionWorkspace`). They come only from a shipped file or the person's own.

### `policy`

| Field | Values | Means |
| --- | --- | --- |
| `offer` | `asked` (default), `allowed` | make artifacts only when asked, or offer them for the types the person allowed |
| `reuse` | `workspace` (default), `session`, `none` | how far `quickstart` looks for an existing artifact to reuse |
| `roles` | `{ <role>: { create?, modify?, remove?, reply? } }` | what a session of each role may do ([tools](../integrating/tools.md#session-permissions)) |
| `confirm` | `ActionKind[]` | the action kinds the person approves each time; the skill tells the agent so |

### `nudge`

```json
{
  "nudge": {
    "command": ["${env:OPEN_ARTIFACT_CODEX_BIN}", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", "codex"],
    "args": ["queue", "--thread", "${session}", "--message", "${text}"]
  }
}
```

`command` is a program, or a list to try in order (a path, `~/…`, a name on `PATH`, or `${env:NAME}`; a list inside the
list is a program with arguments that go first). `${session}` and `${text}` in `args` become one argument each. No shell
is used. `env` adds variables (`${file.<field>}` reads `envFile`, `${env:NAME}` the daemon's own). `envFile` is
`{ dir, pattern, pid? }`: a JSON file the running app writes; with none whose process is alive, nothing runs. On Windows
only an `.exe` runs.

### Hook dialects

`open-artifact hook <event> --harness <name>` maps the harness's hook events to the daemon's `SessionStart`,
`UserPromptSubmit` and `Stop`.

| Name | Used by |
| --- | --- |
| `claude-code` | Claude Code, Codex, ZCode |
| `cursor` | Cursor |
| `copilot` | GitHub Copilot |
| `antigravity` | Antigravity |

Or a mapping: `{ events: { <their event>: "SessionStart" | "UserPromptSubmit" | "Stop" }, answer: { <their event>: {
field, wrap? } }, session?: [<input field names>], workspace?: [<input field names>] }`.

## `harness add`

`open-artifact harness add <profile.json>` checks the file before writing it: `name` must be a harness name, `rules` at
most 4000 characters, `nudge` `{ command, args }`, `markers` environment variable names, `hookDialect` a known name or a
mapping, `sessionWorkspace` a known name. A bad field is refused with a sentence saying its shape.

```json
{
  "name": "my-agent",
  "title": "My Agent",
  "agentName": "My Agent",
  "level": "L2",
  "entry": "mcp",
  "wake": ["inbox"],
  "sessionEnv": "MY_AGENT_SESSION_ID",
  "markers": ["MY_AGENT_SESSION_ID"],
  "hookDialect": "claude-code",
  "open": "browser",
  "caps": { "tools": "mcp", "commands": { "names": ["open-artifact"] } }
}
```

## Shipped profiles

| Name | Level | Entry | Wake | Hooks | Nudge | Session variable |
| --- | --- | --- | --- | --- | --- | --- |
| `antigravity` | L2 | mcp | inbox | `antigravity` | yes | `ANTIGRAVITY_CONVERSATION_ID` |
| `chatgpt` | L1 | mcp | inbox (`wakesIdle: false`) | — | — | — |
| `claude-code` | L2 | mcp | inbox | `claude-code` | — | `CLAUDE_CODE_SESSION_ID` |
| `codex` | L2 | mcp | inbox | `claude-code` | yes (`codex queue`) | `CODEX_THREAD_ID` |
| `copilot` | L2 | mcp | inbox (`wakesIdle: false`) | `copilot` | — | — |
| `cursor` | L2 | mcp | inbox (`wakesIdle: false`) | `cursor` | — | — |
| `dsh` | L3 | harness-api | live, inbox | — | — | — |
| `zcode` | L2 | mcp | inbox (`wakesIdle: false`) | `claude-code` | — | — |

Every shipped profile but `chatgpt` and `dsh` says `"open": "browser"`.
