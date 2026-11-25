# What is Open Artifact?

[中文](overview.zh-CN.md)

**Open Artifact lets any coding agent produce live, editable, commentable deliverables—not just static files or chat walls of text.**

When you ask your AI agent for a slide deck, a UI design, a design system, a whiteboard, a spreadsheet, a live data dashboard, a living document, or a short animated film, the agent writes an ordinary folder of files on your computer. The local Open Artifact daemon serves that folder in a dedicated web editor (wrapped in a unified **Shell**), where you can view, directly edit, pin comments, inspect version history, share, and export to standard formats (PDF, PPTX, XLSX, DOCX, PNG, MP4, GIF, and more). When you press **Send to agent**, your comments go straight back to the agent's session so it can revise the artifact with full context.

```text
  You ── "/open-artifact slides a 6-slide pitch" ──▶ Coding Agent (Claude Code, Codex, Cursor, Copilot, …)
                                                        │ writes plain folder
                                                        ▼
                                            ./artifacts/my-pitch/project/deck.json + slides/*.html
                                                        │ served by local Open Artifact daemon
                                                        ▼
  You ◀── view · edit · comment · export ── http://127.0.0.1:<port>/a/<id> (Shell + Type Editor)
   └──────────────── "Send to agent" ──────────────▶ comments return to the agent's session
```

## Why Open Artifact? Key advantages

| Advantage | What it means in practice |
| --- | --- |
| **Direct editing + AI feedback loop** | Fix a slide title, move a sticky note, tweak a spreadsheet formula, or retype animation copy yourself instead of prompting the agent for every tiny change. Leave anchored comments on specific slides, elements, cells, text ranges, or video timestamps and click **Send to agent** for larger revisions. |
| **Open, local-first plain folders** | Every artifact lives as a plain directory on your disk (`project/`, `db/`, `sheet/`, `doc/`). No vendor lock-in, no mandatory cloud account, works offline, easy to back up or version in Git. |
| **Agent- and model-agnostic** | Built around one local daemon, one `/open-artifact` skill, standard MCP tools (`Artifact`, `ArtifactData`, `ArtifactComments`, `ShowArtifact`), and a CLI fallback. Works with Claude Code, Codex, Cursor, GitHub Copilot, Antigravity, ZCode, DeepSeek Harness, ChatGPT, and any CLI-capable agent—with any LLM. |
| **Purpose-built editors & real exports** | Not a generic HTML preview pane. Types include a WebGL2 infinite canvas, a Rust/WASM spreadsheet formula engine, a full-screen slide presenter, live MCP-connected dashboards, suggested-edit docs, and deterministic HTML/CSS/JS video rendering—exporting cleanly to PPTX, PDF, XLSX, DOCX, PNG, MP4, GIF, and HTML. |
| **Composable design systems** | Capture brand tokens, typography, fonts, component previews, and assets once in a **Design System** artifact, then install it into **Design**, **Slides**, **Data**, and **Motion** artifacts so every deliverable stays on-brand. |
| **Private by default, self-hostable when needed** | Starts 100% private on `127.0.0.1`. Share temporarily on your LAN, or publish to your own Open Artifact [site](hosting.md) (LAN server, VPS/Docker + Caddy, or Cloudflare Workers + D1 + Durable Objects) for multi-user real-time collaboration even when your laptop is off. |
| **Extensible architecture** | Each artifact type is a self-contained skill folder (`artifact-type.json` + `SKILL.md` + `reference/` + editor). Sites also support [plugins](plugins.md) for enterprise SSO, custom permissions, policy hooks, and event webhooks. |

## How the pieces fit together

1. **One local daemon**: A single background `open-artifact` process on your machine manages your artifact library, starts type servers on demand, exposes MCP tools to agent apps, and routes comments back to agent sessions.
2. **One unified Shell**: Every artifact opens at `http://127.0.0.1:<port>/a/<id>` (or inline inside apps that support [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) via `ShowArtifact`). The Shell provides the title bar, version history, **Share**, **Export**, and **Send to agent**, while hosting each type's specialized editor inside.
3. **Nine built-in artifact types**: `slides`, `design`, `design-system`, `whiteboard`, `sheets`, `data`, `docs`, `motion`, and `page` (a free HTML page). See [Artifact types overview](artifact-types.md) to compare them all.
4. **Optional site hosting**: Connect your computer to a self-hosted site with `open-artifact remote add` to get shareable web URLs and real-time team editing. See [Putting artifacts on a site](hosting.md).

## Quick start for users

1. **Install the plugin** for your agent app (requires **Node.js 22.18+**). Download `open-artifact-plugins.zip` from [GitHub Releases](https://github.com/JimLiu/open-artifact/releases) and follow the install table in the [README](../README.md#1-as-a-plugin-in-your-agent-app-recommended) (DeepSeek Harness installs `dsh-open-artifact` directly from npm).
2. **Ask your agent using `/open-artifact <type> <what to make>`**:
   ```text
   /open-artifact slides a 6-slide pitch for this repo
   /open-artifact design three landing page options for a coffee shop
   /open-artifact design-system a brand kit from our frontend codebase
   /open-artifact whiteboard a retro board for last sprint
   /open-artifact sheets a monthly budget with categories and totals
   /open-artifact data a dashboard of signups by month from signups.csv
   /open-artifact docs a hiring plan for 2027 with roles, budget and timeline
   /open-artifact motion a 20-second launch animation for this app
   ```
3. **Collaborate in the live page**: Edit directly, pin comments on anything you want changed, click **Send to agent** to push feedback back to your agent, or open **Share → Export** to download files.

## Quick start for agents

If you are an AI agent creating or editing an Open Artifact:

- Read [How agents use Open Artifact](agent-guide.md) for the complete tool reference (`Artifact`, `ArtifactData`, `ArtifactComments`, `ShowArtifact`), CLI fallback (`open-artifact.mjs`), lifecycle rules, and safety boundaries.
- Read [Artifact types overview](artifact-types.md) to pick the right type and see how each type stores data.
- When creating an artifact with `Artifact {action: "publish", type_url: "open-artifact://type/<type>", title}`, always follow the type-specific `instructions` returned by the tool (sourced from `artifact-types/<type>/SKILL.md`).

## Next steps

- [Artifact types overview](artifact-types.md) — Compare all 9 types and learn when to use each one.
- [How agents use Open Artifact](agent-guide.md) — Exact workflows, tools, and rules for AI agents.
- [Putting artifacts on a site](hosting.md) — Share artifacts on your LAN, own server, or Cloudflare.
