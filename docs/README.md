# Open Artifact documentation

[中文](README.zh-CN.md)

Guides written for both **people** (fast overview, concrete workflows, examples) and **AI agents** (exact tools, CLI commands, decision rules, and safety checks).

## Getting started & core concepts

| Guide | Read it when |
| --- | --- |
| [What is Open Artifact?](overview.md) | You want to understand what Open Artifact is, its core advantages, how the daemon/Shell/agent loop works, and how to get started. |
| [Artifact types overview](artifact-types.md) | You want to compare all 9 built-in artifact types, decide which type fits a task, or understand the storage models. |
| [How agents use Open Artifact](agent-guide.md) | You are an AI agent (or setting up one) and need the exact MCP tools, CLI fallback, creation lifecycle, comment handling, and safety rules. |
| [Making your own artifact types](custom-types.md) | You want a kind of page you make again and again as a type of its own: make, check and try one, turn a page into a type, turn types off, trust a project's types. |

## Artifact type guides

Detailed feature breakdowns and usage guides (for both users and agents) for each built-in type:

| Type | Guide | Best for | Exports |
| --- | --- | --- | --- |
| `slides` | [Slides](types/slides.md) | 16:9 / 4:3 decks, speaker notes, builds, full-screen presenter | PDF, PPTX, HTML, PNG |
| `design` | [Design](types/design.md) | Infinite canvas of live `.dc.html` artboards, prototypes, print pieces | PNG, JPEG, PDF, HTML (+ Figma, ZIP) |
| `design-system` | [Design System](types/design-system.md) | Brand book, multi-theme tokens, live component previews, asset groups | Installed by Design, Slides, Data, Motion |
| `whiteboard` | [Whiteboard](types/whiteboard.md) | Shared infinite board: stickies, shapes, arrows, ink, tables, live embeds | PNG |
| `sheets` | [Sheets](types/sheets.md) | Multi-sheet spreadsheets with Rust/WASM formula engine, tables, charts, interactive panels | XLSX, CSV |
| `data` | [Data](types/data.md) | Live dashboards & reports from MCP connectors, CSV/JSON files, calculations | PDF, HTML, JSON |
| `docs` | [Docs](types/docs.md) | Multi-tab living documents with smart chips, tracked suggestions, Mermaid diagrams | Markdown, Word (`.docx`), PDF, HTML |
| `motion` | [Motion](types/motion.md) | Short animated films drawn from time `t`, score, voiceover, by-hand editing | MP4, GIF, HTML player, ZIP |
| `page` | [Page](types/page.md) | A free HTML page the agent writes, with the runtime capabilities it declares | — |

## Self-hosting & extensions

Guides for putting artifacts on a **site** (a server that gives them a web address that works when your computer is off) and connecting your computers and agents to it:

| Guide | Read it when |
| --- | --- |
| [Putting artifacts on a site](hosting.md) | You want to know how a site works and which kind to run. Start here. |
| [A site on your home or office network](hosting-lan.md) | Everyone is on one network; no domain, plain http. Includes systemd, launchd and Docker set-ups. |
| [A site on your own server, with a domain](hosting-server.md) | A VPS or EC2 with Docker Compose and Caddy, sign-in providers, AWS CloudFormation, backups. |
| [A site on Cloudflare](hosting-cloudflare.md) | No server to look after: a Worker, D1 and Durable Objects. |
| [Connecting your computers and agents](connecting-agents.md) | Connecting a computer, publishing, publishing by itself, install-time presets per agent app, remote MCP, dashboards' data. |
| [Plugins](plugins.md) | People should sign in with your company's login, permissions should come from your own service or a table, an action must be refused by policy, or other systems must hear what happens. Using plugins on Node and Cloudflare, five worked examples, and writing one. |

Each hosting guide works for a person reading it and for an agent doing it on someone's behalf: the steps are numbered, each with the exact command, the output to expect, a check and what to do if it fails, and each guide starts with the questions an agent must ask rather than guess.

## Integrating Open Artifact into an agent product

For engineers who ship an agent app (desktop, IDE extension, command-line agent, web app with a local helper) and want
its agent to make artifacts, show their pages in the app, and get people's comments back:

| Guide | Read it when |
| --- | --- |
| [Integrating Open Artifact](integrating.md) | Start here: the levels from a skill file to pages in your UI, with code from the examples and a checklist. |
| [The agent tools](integrating/tools.md) | Callers, action kinds for approval prompts, what leaves the computer, session permissions, ownership. |
| [Wake](integrating/wake.md) | Comments and page requests reaching the right session; owner versus collaborator. |
| [Showing pages in your UI](integrating/embedding.md) | Frames and top-level views, allowed origins, the Shell's requests, thumbnails. |
| [Remote types](integrating/remote-types.md) | Types whose pages live on another computer. |
| [Runtime and updates](integrating/runtime.md) | Shipping the runtime with your app, which copy starts, update policy. |
| [Apps not written in JavaScript](integrating/non-node.md) | The stdio bridge, with a Python sketch. |
| [Security](integrating/security.md), [Testing](integrating/testing.md), [Known limits](integrating/limits.md) | Trust boundaries, the fake daemon and `doctor`, what does not work yet. |
| [Harness API](spec/harness-api.md), [Embed](spec/embed.md), [Profile](spec/profile.md) references | Every method, message and field. |

Runnable code: [examples/](../examples/README.md).

## More detail for operators & contributors

- [AGENTS.md](../AGENTS.md) and `docs/references/` — Coding-agent guide, architecture, build/test/release, and documentation sync rules.
- [plugins/README.md](../plugins/README.md) — Every supported agent app, hooks, and MCP wiring.
- [packages/host/README.md](../packages/host/README.md) — Every setting of the Node site.
- [deploy/cloudflare/README.md](../deploy/cloudflare/README.md) — The Worker's internals, limits and costs.
- [deploy/aws/README.md](../deploy/aws/README.md) — AWS deployment details.
