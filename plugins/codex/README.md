# Open Artifact for Codex and ChatGPT desktop

Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as folders of files that open in one local page where you view, edit
and comment. Ask for `/open-artifact slides …`, `design …`, `whiteboard …`, `sheets …`, `data …`, `docs …`, `motion …` or `page …` (the skill is `open-artifact:open-artifact`).

## Install

With Node.js 22.18+ installed, download `open-artifact-plugins.zip` from [GitHub Releases](https://github.com/JimLiu/open-artifact/releases)
and extract it to a permanent location. Register the extracted folder using the [Codex CLI](https://developers.openai.com/codex/cli/):

```bash
codex plugin marketplace add "/path/to/open-artifact-plugins"
```

Then install **Open Artifact** from `/plugins` in the Codex CLI or the Plugins tab of the Codex or ChatGPT desktop app
(or `codex plugin add open-artifact@open-artifact`), and start a new session. Codex runs plugin hooks only once you
approve them in `/hooks` (again after each update); the tools work before that.

## Upgrade

Replace the extracted folder at the same path with the one from the new ZIP. Restart the desktop app to refresh
the plugin. You can also run `codex plugin add open-artifact@open-artifact` again. Start a new session after updating.

If you originally registered a checkout's `dist/plugins` directory, run
`codex plugin marketplace remove open-artifact` once, then follow the installation steps to register the extracted
folder and install the plugin from there.

## Where artifacts go

New artifacts go under the thread's folder (`artifacts/<slug>`). Codex starts the MCP server in the plugin's own
folder, so the daemon looks the thread's folder up: from its hook, or from the thread's rollout file in
`~/.codex/sessions` (`$CODEX_HOME`).

## What it adds

- `mcp.json`: the `Artifact`, `ArtifactData` and `ArtifactComments` tools (stdio, through the local daemon);
- `skills/open-artifact/`: the skill, carrying the daemon;
- `hooks/hooks.json`: SessionStart, UserPromptSubmit and Stop.

## Publish to a server

Codex gives a plugin's MCP server only a few variables of its own (`HOME`, `PATH`, `USER`, …), so `OPEN_ARTIFACT_*`
variables in your shell do not reach Open Artifact. Put them in `~/.agents/open-artifact/preset.json` instead
(`{ "OPEN_ARTIFACT_REMOTE": "https://artifacts.example.com" }`), or link a site yourself with
`open-artifact remote add <name> <https://host>`. See [the plugins README](../README.md#use-a-server-instead-of-this-computer).

## Send to agent

Comments sent from the page reach the thread that made the artifact at session start, with your next message, or,
when they arrive while Codex works, by keeping its turn going (the Stop hook). Without the hooks they come with the
thread's next Open Artifact tool call. While the thread is idle, the daemon queues a short message for it with
`codex queue --thread <id> --message …` (the `codex` the ChatGPT app carries, else the one on the `PATH`;
`$OPEN_ARTIFACT_CODEX_BIN` names another). The desktop app runs a queued message as soon as the thread is idle (tried
with a thread open in the ChatGPT app), which starts a turn that handles the comments. A thread run only from the
command line (`codex exec`) gets it the next time it is resumed.

The page opens in the app's built-in browser, which the agent opens with the page's `view_url`, not in the
computer's browser.

## The card in the conversation

Codex shows MCP Apps, so the agent also gets `ShowArtifact`. Codex frames only https pages inside these cards, and the
daemon serves the page over http on this computer, so the card cannot show the page itself: it says so at once and
offers Open in browser (Codex opens the address where its *Local URL open destination* setting says) and the page's
address to copy. The agent's reply still carries `view_url`.
