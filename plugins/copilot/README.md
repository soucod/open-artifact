# Open Artifact for GitHub Copilot

For the Copilot CLI and VS Code agent mode (the Copilot harness). Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as
folders of files that open in one local page where you view, edit and comment: `/open-artifact slides …`,
`design …`, `whiteboard …`, `sheets …`, `data …`, `docs …`, `motion …` or `page …`.

## Install

With Node.js 22.18+ installed, download `open-artifact-plugins.zip` from [GitHub Releases](https://github.com/JimLiu/open-artifact/releases)
and extract it to a permanent location.

For Copilot CLI, register the extracted folder as a marketplace and install the plugin.

```bash
copilot plugin marketplace add "/path/to/open-artifact-plugins"
copilot plugin install open-artifact@open-artifact
```

To try it in one CLI session, run `copilot --plugin-dir "/path/to/open-artifact-plugins/copilot"`.

In VS Code, run **Chat: Install Plugin from Source** and select the extracted `copilot/` folder.

## Upgrade

Replace the extracted folder at the same path with the one from the new ZIP. Copilot CLI loads local marketplace
plugins from the folder, so start a new session or run `/restart` to load the new files.

If you originally registered a checkout's `dist/plugins` directory, remove the old registration, then follow the
installation steps to switch sources.

```bash
copilot plugin uninstall open-artifact@open-artifact
copilot plugin marketplace remove open-artifact
```

In VS Code, rerun **Chat: Install Plugin from Source** with the updated `copilot/` folder and start a new chat.
If the installed plugin still points to a different folder, uninstall it in **Chat: Open Customizations** before
installing from the new path.

## What it adds

- `.mcp.json`: the `Artifact`, `ArtifactData` and `ArtifactComments` tools (stdio, through the local daemon);
- `skills/open-artifact/`: the skill, carrying the daemon;
- `hooks.json`: `sessionStart`, `userPromptTransformed` and `agentStop`.

## Publish to a server

The Copilot CLI passes its environment to the plugin's MCP server, so `OPEN_ARTIFACT_REMOTE` (and the other
`OPEN_ARTIFACT_*` preset variables) set where `copilot` starts reach Open Artifact. For VS Code, or an app started from
the Dock or Start menu, use `~/.agents/open-artifact/preset.json`. See
[the plugins README](../README.md#use-a-server-instead-of-this-computer).

## Send to agent

Comments sent from the page reach Copilot with your next message (CLI), or, when they arrive while it works, by
keeping its turn going (`agentStop`, up to 8 times in a row). A session started or resumed with a prompt gets them
added to that prompt (`userPromptTransformed`), which Copilot keeps in the session's history; added context from
`sessionStart` is not kept across a resume, so `sessionStart` hands them over only when there is no prompt. Copilot
has no way to start a turn in an idle session from outside, so the page says the comment waits for your next
message. The cloud agent loads no plugins.
