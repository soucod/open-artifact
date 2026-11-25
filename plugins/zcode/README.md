# Open Artifact for ZCode

Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as folders of files that open in one local page where you view, edit
and comment. Type `/open-artifact slides a 6-slide pitch for this repo` (or `design …`, `whiteboard …`, `sheets …`, `data …`, `docs …`, `motion …`, `page …`).

## Install

With Node.js 22.18+ installed, download `open-artifact-plugins.zip` from [GitHub Releases](https://github.com/JimLiu/open-artifact/releases)
and extract it to a permanent location. In ZCode, open Plugin Marketplace and add the extracted `zcode/` folder as a plugin marketplace,
then install **Open Artifact** from the listing. From a source checkout, point the marketplace at the
built `dist/plugins/zcode` folder the same way.

The first time it is needed, ZCode asks once to authorize the extension's `sessions.write` grant. One dialog. Declining it keeps
everything else working: page messages then ride the session hooks, and the agent's own background `wait` still brings them in.

## Upgrade

Replace the marketplace folder at the same path with the one from the new release (or rebuild `dist/plugins/zcode`). Then open the plugin
store, check for updates in the top bar, and update when a newer version shows.

## What it adds

| Part | File | Does |
|---|---|---|
| MCP server `open-artifact` | `.mcp.json` | the `Artifact`, `ArtifactData` and `ArtifactComments` tools, through the local daemon |
| Skill `/open-artifact` | `skills/open-artifact/` | how to pick the type, create, fill, check and show an artifact; carries the daemon |
| Hooks | `hooks/hooks.json` | SessionStart, UserPromptSubmit and Stop: comments sent from the page reach ZCode at session start, with your next message, or keep its turn going when they arrive while it works |
| Extension | `extension/index.mjs` | keeps ZCode sessions visible to the daemon, and starts a turn the moment a page message is sent to an idle session |

## Send to agent

Press "Send to agent" (or "Ask ZCode") on the page. The comments reach the session that made the artifact: as it starts, with your next
message, right after a running turn (the Stop hook continues it), and, while the session idles, the moment they are sent through the
extension. With the grant declined, an agent that keeps the skill's background `wait` command running still receives everything.
