# Open Artifact for Cursor

Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as folders of files that open in one local page where you view, edit
and comment. Type `/open-artifact slides …`, `design …`, `whiteboard …`, `sheets …`, `data …`, `docs …`, `motion …` or `page …` in the agent chat.

## Install

With Node.js 22.18+ installed, download `open-artifact-plugins.zip` from [GitHub Releases](https://github.com/JimLiu/open-artifact/releases)
and extract it. For a first install, copy the `cursor/` folder into Cursor's local plugins.

```bash
mkdir -p ~/.cursor/plugins/local
cp -R "/path/to/open-artifact-plugins/cursor" ~/.cursor/plugins/local/open-artifact
```

Run **Developer: Reload Window**. The extracted bundle also includes the Cursor team marketplace catalog at
`.cursor-plugin/marketplace.json`.

## Upgrade

Replace the entire `~/.cursor/plugins/local/open-artifact` folder with the `cursor/` folder from the new ZIP, retaining
the installed folder name `open-artifact`. Run **Developer: Reload Window**.

## What it adds

- `mcp.json`: the `Artifact`, `ArtifactData` and `ArtifactComments` tools (stdio, through the local daemon);
- `skills/open-artifact/`: the skill, carrying the daemon;
- `hooks/hooks.json`: `sessionStart`, `postToolUse` and `stop`.

## Publish to a server

A team admin can set the plugin's **Open Artifact server** variable (`OPEN_ARTIFACT_SERVER`) in the Cursor dashboard.
Otherwise `mcp.json` forwards `OPEN_ARTIFACT_REMOTE`, `OPEN_ARTIFACT_REMOTE_NAME`, `OPEN_ARTIFACT_REMOTE_TOKEN`,
`OPEN_ARTIFACT_PUBLISH` and `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP` from the environment Cursor starts in (Cursor passes
no other variables to MCP servers), and `~/.agents/open-artifact/preset.json` works however Cursor was started. See
[the plugins README](../README.md#use-a-server-instead-of-this-computer).

## Send to agent

Comments sent from the page reach the agent at the start of a chat, after any tool call it makes (as added context,
which also ties a resumed chat's Open Artifact calls to it), or at the end of its turn as a follow-up message (up to 10
in a row). Cursor's hooks cannot add them to the message you send, so while the agent is idle they arrive during or
at the end of its next turn; say "check the comments" to have them read at once. Cursor offers no way to start a turn in an idle chat from outside
(nothing like `codex queue`), so the daemon cannot wake it. The page says so: a comment sent while Cursor idles reads "Cursor gets this on
its next turn: send it a message to start one" (the profile's `wakesIdle: false`; Copilot and ChatGPT read the same).

The Cursor CLI (`cursor-agent -p`) runs the plugin's `sessionStart` (for a new chat, not on `--resume`) and
`postToolUse` hooks, but not `stop`: there, comments come with the next tool call, in tool results, and through `wait`.

Cursor's auto-review (Smart Mode) may stop an `ArtifactComments` reply it takes for a write to an outside service. The
tools say they work only on this computer's artifact folders (`openWorldHint: false`); if a reply is still stopped,
approve it on the card Cursor shows, or tell the agent to reply in the thread.
