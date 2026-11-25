# Open Artifact plugins

One skill, `open-artifact`, and a plugin for each agent app that carries it. Every plugin runs the same local
Open Artifact daemon: one artifact server and one page frame (the Shell at `http://127.0.0.1:<port>/a/<id>`) for
every type, with each type's own editor and comments inside. `/open-artifact slides …` makes a deck,
`/open-artifact design …` a design canvas, `/open-artifact whiteboard …` a board, `/open-artifact sheets …` a spreadsheet, `/open-artifact data …` a dashboard, `/open-artifact docs …` a doc, `/open-artifact motion …` an animated film, `/open-artifact page …` a free HTML page (a tool, mini game or explainer).

| Folder | For | Gives the agent | Comments sent from the page reach the agent |
|---|---|---|---|
| [`claude-code/`](claude-code/README.md) | Claude Code (CLI, desktop, IDE) | MCP tools, skill, hooks, monitor | at session start, with the person's next message, at the end of a turn (the turn goes on), and while the session idles (monitor) |
| [`codex/`](codex/README.md) | Codex (CLI, app) and ChatGPT desktop | MCP tools, skill, hooks | at session start, with the next message, at the end of a turn; an idle thread gets a message queued with `codex queue` |
| [`cursor/`](cursor/README.md) | Cursor (editor) | MCP tools, skill, hooks | at session start, after each tool call, and at the end of a turn as a follow-up message |
| [`copilot/`](copilot/README.md) | GitHub Copilot CLI, VS Code agent mode (Copilot harness) | MCP tools, skill, hooks | at session start, with the next message (CLI), at the end of a turn |
| [`antigravity/`](antigravity/README.md) | Google Antigravity (`agy` CLI, app) | MCP tools, skill, hooks | at session start, before each model call, at the end of a turn (the turn goes on); an idle conversation is started with `agentapi send-message` |
| [`zcode/`](zcode/README.md) | ZCode | MCP tools, skill, hooks, extension | at session start, with the person's next message, at the end of a turn (the turn goes on), and while the session idles (the extension starts a turn the moment they are sent) |
| [`dsh/`](dsh/README.md) | DeepSeek Harness | native tools, the Open Artifact sidebar page, comment cards, `/open-artifact` | right away: a new turn when the session idles, added to the running turn otherwise (a full adapter, L3) |
| [`chatgpt/`](chatgpt/README.md) | ChatGPT on the web | MCP tools over HTTPS, a card | in the next tool result, or when the person presses "Send comments to ChatGPT" on the card |
| [`../skills/open-artifact/`](../skills/open-artifact/SKILL.md) | any other agent that reads skills | the command line | in the result of any call, or by `wait` |

Whatever the app, comments also come back in the `messages` of any Open Artifact tool result, and an agent can
wait for them (`ArtifactComments {action: "wait"}`).

`/open-artifact new-type` asks the agent to make a type of its own rather than an artifact, with the skill's
`reference/new-type.md` and the `open-artifact types new | check | from | list | pack` commands
([Making your own artifact types](../docs/custom-types.md)); `types from` takes a page artifact or a page saved from
claude.ai (a folder or `.html`). `types enable`, `types disable`, `types trust`,
`types untrust`, `types install`, `types update`, `types uninstall`, `types publish`, `types unpublish` and
`publish --with-type` are the person's: like `cloud` and `remote`, they refuse to run inside an agent's session
(`types publish` puts a type of this computer in a site's catalog, so artifacts of it publish there). `open-artifact import <zip>` brings an artifact's archive in from
another computer.

Pages open where the person already is: in the app itself when its adapter can show them (DeepSeek Harness), else
in the agent app's built-in browser (Codex, Cursor, Claude, Antigravity, VS Code), which the agent opens with the page's
`view_url`. The daemon opens the computer's browser only when the agent asks it to (`Artifact {action: "open"}`), which
it does when it has no browser of its own.

Building your own agent app rather than using one of these? Read
[Integrating Open Artifact into an agent product](../docs/integrating.md): the same tools, pages in your UI, and
comments into your sessions, on `@open-artifact/harness-kit` or over `open-artifact harness --stdio`.

## Install and upgrade

Follow your app's guide above. GitHub Releases includes `open-artifact-plugins.zip` with the prebuilt plugin
folders, the ChatGPT web connector and the local marketplace catalogs. The
[quick start](../README.md#1-as-a-plugin-in-your-agent-app-recommended) covers installation from npm for DeepSeek Harness.

## Build from source

```bash
npm ci && npm run build            # the Shell, frame-host and the types' editors (dist/, artifact-types/*/scripts/)
node scripts/build-plugins.mjs     # builds the skill, then dist/plugins/<name>/ and the marketplace files
```

`dist/plugins/` is then a marketplace folder for Claude Code (`.claude-plugin/marketplace.json`), Codex
(`.agents/plugins/marketplace.json`), Cursor (`.cursor-plugin/marketplace.json`) and the Copilot CLI
(`.github/plugin/marketplace.json`), with one installable folder per
plugin. Each plugin carries the skill with the daemon vendored in `skills/open-artifact/vendor/`.

`node scripts/build-plugins.mjs --only codex` builds one; `--no-skill` reuses the built skill.

`dsh/` is different: it is an npm workspace package (`dsh-open-artifact`) with its own build, `node plugins/dsh/scripts/build.mjs`
(run by `npm run build`), which writes `lib/` and vendors the daemon into `vendor/`. DeepSeek Harness installs it from
that folder; `build-plugins.mjs` leaves it alone.

## Use a server instead of this computer

Each plugin can link the daemon to an Open Artifact server, so artifacts are published there. The daemon reads
`OPEN_ARTIFACT_REMOTE`, `OPEN_ARTIFACT_REMOTE_NAME`, `OPEN_ARTIFACT_REMOTE_TOKEN`, `OPEN_ARTIFACT_PUBLISH` and
`OPEN_ARTIFACT_REMOTE_INSECURE_HTTP` once, when it starts ([README](../docs/connecting-agents.md#set-computers-up-in-advance)).
It takes them from the process that started it, usually a plugin's MCP bridge, and the bridge gets only what its app
gives it: Claude Code and the Copilot CLI pass their own environment on, Codex and Cursor do not (see the table). One
daemon serves every app on the computer, so whichever app starts it first decides its environment; a daemon that is
already running keeps what it started with (`open-artifact daemon stop`, and the next tool call starts it again).

`preset.json` in the Open Artifact folder takes the same keys and works for every app, however it was started:

```json
{ "OPEN_ARTIFACT_REMOTE": "https://artifacts.example.com", "OPEN_ARTIFACT_PUBLISH": "auto" }
```

| Plugin | Point it at a site | Turn on publishing by itself | Verified how |
| --- | --- | --- | --- |
| Claude Code | The plugin's **Open Artifact server** setting (`userConfig.remote`, asked when the plugin is enabled; reaches the daemon as `OPEN_ARTIFACT_PLUGIN_REMOTE`, used only when `OPEN_ARTIFACT_REMOTE` is unset); or `OPEN_ARTIFACT_REMOTE` in the environment `claude` starts in; or `preset.json`. | `OPEN_ARTIFACT_PUBLISH=auto` in that environment or `preset.json`; or `open-artifact remote auto on`, or the Share panel. | Claude Code 2.1.318, `claude -p --plugin-dir` with a probe MCP server: a `userConfig` value reaches `.mcp.json`'s `env` (empty when unset) and the shell's variables reach the server. `claude plugin validate` passes. |
| Codex | `preset.json`. Codex starts MCP servers with only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `USER`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `TZ` and the server entry's own `env`, so variables in your shell never reach the plugin's bridge; the plugin format (Agent Plugins 1.0 `mcp.json`) has no install-time setting. | `OPEN_ARTIFACT_PUBLISH: "auto"` in `preset.json`; or `open-artifact remote auto on`, or the Share panel. | Read from Codex's source (`codex-rs/rmcp-client/src/utils.rs`, `DEFAULT_ENV_VARS`) and the Agent Plugins `mcp.json` schema. Not run (no Codex here). |
| Cursor | A team admin sets the plugin variable **Open Artifact server** (`OPEN_ARTIFACT_SERVER`) in the Cursor dashboard (Plugins, Configure); or `OPEN_ARTIFACT_REMOTE` in the environment Cursor starts in (the plugin's `mcp.json` forwards the five variables with `${env:…}`, since Cursor passes no other environment to MCP servers); or `preset.json`. | `OPEN_ARTIFACT_PUBLISH=auto` in that environment or `preset.json`; or `open-artifact remote auto on`, or the Share panel. | cursor-agent 2026.11.13, `--plugin-dir` with the plugin's own `plugin.json` and `mcp.json` around a probe server: a variable from the shell arrives; the shell's environment is not inherited otherwise; an unset variable or plugin variable arrives as the literal `${…}`, which the daemon treats as unset. Setting the variable in the team dashboard and the Cursor app itself were not tried. |
| Copilot (CLI, VS Code agent mode) | `OPEN_ARTIFACT_REMOTE` in the environment `copilot` starts in, or `preset.json`. No install-time setting in the plugin format. | `OPEN_ARTIFACT_PUBLISH=auto` there or in `preset.json`; or `open-artifact remote auto on`, or the Share panel. | Copilot CLI 1.0.114, `copilot -p --plugin-dir` with a probe server: the shell's variables reach a plugin's MCP server (GitHub's docs say only `PATH` and a few others are inherited: if a later version follows the docs, use `preset.json`). VS Code agent mode not tried. |
| Antigravity | `preset.json`. No install-time setting in the plugin format, and whether the app passes its environment to a plugin's MCP server is not documented. | `OPEN_ARTIFACT_PUBLISH: "auto"` in `preset.json`; or `open-artifact remote auto on`, or the Share panel. | Antigravity's plugin and MCP docs read; not run. |
| DeepSeek Harness (`dsh/`) | `OPEN_ARTIFACT_REMOTE` in the environment DeepSeek Harness runs in (the plugin starts the daemon with its whole environment), or `preset.json`. | `OPEN_ARTIFACT_PUBLISH=auto` there or in `preset.json`; or `open-artifact remote auto on`, or the Share panel. | Read from the plugin's code (`daemonOptions` copies `process.env`). Not run. Its `cordis.patch.yml` config has no server setting: whether DeepSeek Harness shows a plugin's config to the person could not be confirmed. |
| ChatGPT on the web | The environment of `open-artifact chatgpt`, or `preset.json`. | `OPEN_ARTIFACT_PUBLISH=auto` there or in `preset.json`; or `open-artifact remote auto on`. | Read from the code (the command starts the daemon with its own environment). Not run. |
| Any agent using the skill | The environment the agent runs `open-artifact` in, or `preset.json`. | `OPEN_ARTIFACT_PUBLISH=auto` there or in `preset.json`; or `open-artifact remote auto on`. | Read from the code, as above. Not run. |

An app opened from the Dock or the Start menu does not see variables from your shell profile: use `preset.json` there.
Turning publishing by itself off again, and choosing the default server, are left to the person (`open-artifact remote
auto off`, `open-artifact remote default <name>`, or the Share panel). No agent tool changes them.

### Rolling a preset out to a team

- **Where:** `preset.json` in the Open Artifact folder, `~/.agents/open-artifact/preset.json` on macOS and Linux and
  `%USERPROFILE%\.agents\open-artifact\preset.json` on Windows (or `$OPEN_ARTIFACT_HOME/preset.json` when that is
  set; Codex and Cursor do not pass `OPEN_ARTIFACT_HOME` to the plugin either, so keep the default folder there). It is
  read when the daemon starts. A management tool can drop it before the person first uses an agent app.
- **Precedence:** what the person set wins (`settings.json`, `remotes.json`, `open-artifact remote …`, the Share
  panel), then the environment, then `preset.json`, then the defaults. A preset adds its site once: a site the person
  removed is not added again, and a token that was used is never sent again. An address, its name and its token
  travel together: a token in `preset.json` is not paired with an address from the environment, nor is
  `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP`.
- **Signing in:** without a token, the daemon starts a device sign-in that the person approves in the browser (the
  link is in `open-artifact remote status`, the Share panel and the agent's next tool result). This is the safest
  route. A token (`open-artifact-host link-token --user <email>`) signs the computer in with no approval; put it in
  `preset.json` with mode 0600 (owner only: `chmod 600`), not in an environment variable, which other processes of
  the same user can read. The daemon still uses a `preset.json` holding a token that others can read, but says so
  in its log (`daemon.log`).
- **Plain http:** only for this computer and a private network (private addresses, `.local`, `.lan`, `.home.arpa`,
  `.internal`, one-word names, `nip.io`/`sslip.io` names that spell only private addresses); decided by the name,
  never by what it resolves to. `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1` allows any host and makes the daemon warn
  that the token and the artifacts cross the network unencrypted: do not roll it out for a site on the internet.

## How a plugin reaches the daemon

- **MCP server:** `node <plugin>/skills/open-artifact/scripts/open-artifact.mjs mcp --harness <name>`, a stdio
  bridge to the daemon's `/mcp`, which it starts when none runs.
  The `--harness` it names wins over the session variables of other agent apps (`CLAUDECODE`, `CODEX_THREAD_ID`), which
  an app started from inside another agent's session inherits.
- **Hooks:** `… open-artifact.mjs hook <event> --harness <name>` registers the session (and its processes, so the MCP
  bridge's calls are tied to it) and prints the messages that wait, in the app's own hook format: Claude Code and
  Codex `hookSpecificOutput.additionalContext` and Stop `decision: "block"`; Cursor `additional_context` and stop
  `followup_message`; Copilot `additionalContext`, `userPromptTransformed` → `modifiedTransformedPrompt`, and
  `agentStop` `decision: "block"`; Antigravity `injectSteps` system messages and Stop `decision: "continue"`.
- **Version:** `… open-artifact.mjs --version` (or `-v`) prints the version of the runtime a plugin carries.
- **Harness profiles** (`packages/daemon/harnesses/<name>.json`) give the page the agent's name ("Ask Claude",
  "Ask Codex", …) and the session variable.

## What was checked

| | |
|---|---|
| Claude Code 2.1.318 | `claude plugin validate` passes for the plugin and the marketplace. A headless run with `--plugin-dir` lists the types through the plugin's MCP tools; with a page request queued for the session, the SessionStart hook handed it to Claude, which edited the board. |
| GitHub Copilot CLI 1.0.105, 1.0.112 | A run with `--plugin-dir`: the plugin's MCP server and hooks load (`${PLUGIN_ROOT}` expands in the hook command); a queued page request reached Copilot, which edited the board. With 1.0.112, `copilot plugin marketplace add ./dist/plugins` and `copilot plugin install open-artifact@open-artifact` enable the plugin from `dist/plugins/copilot`; `copilot -p` used the skill and made a whiteboard in the run's folder, owned by the session (the page says "Ask Copilot"). A comment sent from the page reached a resumed session, which moved the card and replied, resolving the thread; one sent mid-turn came back from `agentStop` and the turn went on. `sessionStart` added context is not kept across a resume (the next resume no longer knew the request), so a session started with a prompt now gets the messages in that prompt (`userPromptTransformed`), which is kept: Copilot made the change and, resumed again, quoted the request. |
| Antigravity 2.32.1 (app) | Installed by copying `dist/plugins/antigravity` to `~/.gemini/config/plugins/open-artifact/` (no `agy` CLI here, so no `agy plugin validate`), conversations started with the app's `agentapi`. The skill is listed; after an app restart the MCP server loads as `open-artifact_open-artifact` and `Artifact {action: "list", scope: "types"}` returns the types (Antigravity asks the person to allow the call). With page messages queued for the conversation, `SessionStart` started the daemon and registered the `conversationId`, `PreInvocation` added them as a system message, and `Stop` kept the turn going once with them as its reason. |
| Codex 0.169.0-alpha.11.1 (in ChatGPT.app) | `codex plugin marketplace add dist/plugins` and `codex plugin add open-artifact@open-artifact`; runs with `codex exec --approve-for-me`. The MCP server loads, the skill is read from the plugin, and a whiteboard was made in the run's folder (`artifacts/<slug>`), owned by the thread. Codex starts the MCP server in the plugin's folder and names only the thread (`_meta.threadId`) on each call, so the daemon takes the thread's folder from its hook, or, before the hooks are trusted, from the thread's rollout file (`~/.codex/sessions/…/rollout-…-<thread>.jsonl`). A page comment sent to the agent waited for the thread; `codex exec resume <thread>` read it, renamed the note and replied, resolving the thread. In the ChatGPT desktop app, a comment sent from a deck while its thread was idle was queued with `codex queue` and ran at once: Codex changed the title and replied. The hooks were not run here (they need trust in `/hooks`). |
| Cursor CLI 2026.11.13 (`cursor-agent`) | Installed by copying `dist/plugins/cursor` to `~/.cursor/plugins/local/open-artifact`; runs with `cursor-agent -p --force` (without it every tool call is refused). The MCP server loads as `plugin-open-artifact-open-artifact`, and a whiteboard was made in the run's folder (`artifacts/<slug>`), owned by the chat: `sessionStart` registered it. `cursor-agent -p` runs `sessionStart` (not on `--resume`), `beforeMCPExecution`, `postToolUse` and `sessionEnd`, never `stop`, and gives the MCP server no session variable (its folder is the workspace). With a page request waiting, a resumed chat asked only to run `ls` got it from `postToolUse` as added context and renamed the note. In the Cursor app (3.30.8), a deck was made and opened in its built-in browser; a comment sent to the agent while the chat was idle waited (Cursor has no way to start a turn in an idle chat from outside) and was handed over by the hooks on the person's next message: Cursor added the subtitle, but its auto-review (Smart Mode) blocked the reply as an outside write, and the model did not ask for approval, so the thread stayed waiting. The tools now carry `openWorldHint: false`, and their words say the threads are the person's own, kept in the artifact's folder. |
| ChatGPT | The connector was driven over MCP (initialize, tools, the card resource, publish with files, read, ShowArtifact, comments in the next result, a wrong path, a foreign Origin); the card was rendered with a stand-in `window.openai`. Not tried in ChatGPT itself. |
| ZCode 3.19.1 | Installed and updated through a local-folder marketplace (a built `dist/plugins/zcode`; the release ZIP's `zcode/` folder is the same layout). The first-use `sessions.write` grant dialog appears once. Sessions show present with their running/idle status, and a message sent to an idle session is delivered the moment it is sent. The queued paths (session start, the person's next message, the end of a turn) were verified before the wake delivery was reworked, and not re-run after. Not individually checked: several comments sent at once, delivery of what waited through a reconnect, and session removal (the app has no close-session control). On Windows the daemon ends with the app, so pages cannot send while ZCode is closed. |
