# Open Artifact

English · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

> **Formerly `baoyu-design`.** This project started as
> [baoyu-design](https://github.com/JimLiu/baoyu-design) (the old URL redirects here), which brought claude.ai-style
> Artifact types to local coding agents as one skill per type. Open Artifact rebuilds them as an open, agent-agnostic
> format: one local daemon, one page frame, one `/open-artifact` skill, and a plugin for each agent app.

**Open Artifact lets any coding agent make things people can open, edit and comment on, not just files.** You ask
your agent for a slide deck, a UI design, a design system, a whiteboard, a spreadsheet, a data dashboard, a doc or a short animated film. The agent writes a plain folder of files.
A local page opens it in a real editor, where you can fix a title, move a sticky note, leave comments, and export. Then
"Send to agent" sends your comments back to the agent's session.

https://github.com/user-attachments/assets/9f34dc69-2e90-4118-92fd-63f36d7bc5f9

Everything runs on your machine. No account, no upload, no specific model or vendor.

```
  you ──"/open-artifact slides a 6-slide pitch"──▶ agent (Claude Code, Codex, Cursor, Copilot, …)
                                                     │ writes files
                                                     ▼
                                           ./my-deck/project/deck.json + slides/*.html
                                                     │ served by the local daemon
                                                     ▼
  you ◀── edit · comment · export (PDF/PPTX/PNG/HTML) ── http://127.0.0.1:<port>/a/<id>
   └──────────────── "Send to agent" ──────────────▶ comments arrive back in the agent's session
```

## Documentation

Start in [docs/](docs/README.md) for full bilingual (English / 中文) guides for both users and AI agents:

- [What is Open Artifact?](docs/overview.md) — Core concept, key advantages, and quick start.
- [Artifact types overview](docs/artifact-types.md) — Compare all 9 types, how to choose, and storage models.
- [How agents use Open Artifact](docs/agent-guide.md) — MCP tools, CLI fallback, workflow lifecycle, comments, and safety rules.

### Building an agent product?

If you ship an agent app (desktop, IDE extension, command line, or a web app with a local helper), you can make Open
Artifact part of it: your agent makes artifacts through its own tools, the pages show in your UI, and the comments
people send from a page arrive in the right session. Start at
[Integrating Open Artifact into an agent product](docs/integrating.md); the Node SDK is
[`@open-artifact/harness-kit`](packages/harness-kit/README.md), and [examples/](examples/README.md) has runnable
adapters. Apps not written in JavaScript use the stdio bridge (`open-artifact harness --stdio`).

## Artifact types

| Type | What you get | Folder marker | Exports | Guides |
|---|---|---|---|---|
| **Slides** | A 1920×1080 (or 4:3) deck: slide rail, overview, speaker notes, builds, transitions, presenter mode, polygon picture frames | `project/deck.json` | PDF, PPTX, HTML, PNG | [Guide](docs/types/slides.md) · [SKILL](artifact-types/slides/SKILL.md) |
| **Design** | An infinite canvas of live `.dc.html` artboards: screens, components, click-through prototypes, notes, pages | `project/canvas.json` | PNG, JPEG, PDF, HTML | [Guide](docs/types/design.md) · [SKILL](artifact-types/design/SKILL.md) |
| **Design System** | A brand book: tokens, colors with contrast checks, type specimens, live component previews, assets. Designs, decks, dashboards, and films can install it | `project/design-system.json` | — | [Guide](docs/types/design-system.md) · [SKILL](artifact-types/design-system/SKILL.md) |
| **Whiteboard** | A shared infinite board: stickies, shapes, arrows, ink, images, tables, embeds, live cursors, timer | `db/board/meta.json` | PNG | [Guide](docs/types/whiteboard.md) · [SKILL](artifact-types/whiteboard/SKILL.md) |
| **Sheets** | A shared spreadsheet: several sheets of cells, a full formula engine, number formats, borders, merged cells, tables with filters, dropdowns, checkboxes, conditional formats, frozen and grouped rows, charts from cells, CSV import, cell history | `sheet/sheet.json` | XLSX, CSV | [Guide](docs/types/sheets.md) · [SKILL](artifact-types/sheets/SKILL.md) |
| **Data** | A live dashboard or report: datasets from CSV/JSON/text uploads, live MCP connector queries or calculations, drawn by a plain HTML/CSS/d3 page; Sources shows where each number comes from; filters, hand edits, remix drafts | `db/dash/meta.json` | PDF, HTML, JSON | [Guide](docs/types/data.md) · [SKILL](artifact-types/data/SKILL.md) |
| **Docs** | A living document in tabs: headings, lists, tables, pictures, dates, mentions and dropdowns; suggested edits to accept or reject, comments, a version history per tab; imports Markdown, Word and PDF | `doc/doc.json` | Markdown, Word, PDF, HTML | [Guide](docs/types/docs.md) · [SKILL](artifact-types/docs/SKILL.md) |
| **Motion** | A short animated film: scenes in HTML/CSS/JS drawn from time, a generated score, rough cut then final, captions and voiceover; retype, recolor, refont, recut and restyle by hand; comments pinned to a moment or a spot in the frame | `db/film/meta.json` | MP4, GIF, HTML, ZIP | [Guide](docs/types/motion.md) · [SKILL](artifact-types/motion/SKILL.md) |
| **Page** | A free HTML page the agent writes whole: a widget, tool, mini game or explainer page, with the runtime capabilities it declares (a shared database, uploads, comments, live messages); publishes to a self-hosted Node or Cloudflare site | `index.html` | — | [Guide](docs/types/page.md) · [SKILL](artifact-types/page/SKILL.md) |

Each type folder is a self-contained skill: `SKILL.md` tells the agent how to write it, `reference/` documents the
file format, `artifact-type.json` describes it to hosts, and `scripts/` (built) holds the CLI and editors.

## Quick start

### 1. As a plugin in your agent app (recommended)

Install **Node.js 22.18+**, then download `open-artifact-plugins.zip` from the **Assets** section of a
[GitHub Release](https://github.com/JimLiu/open-artifact/releases). Extract it to a permanent location and use the
extracted `open-artifact-plugins/` folder in the steps below. The plugins include the skill, daemon and editors.
DeepSeek Harness installs its prebuilt package directly from npm.

| Agent app | Install |
|---|---|
| [Claude Code](plugins/claude-code/README.md) (CLI, desktop, IDE) | Add the extracted root as a marketplace, then install `open-artifact@open-artifact`. |
| [Codex](plugins/codex/README.md) (CLI, app) and ChatGPT desktop | Add the extracted root with `codex plugin marketplace add`, then install **Open Artifact** in Plugins. |
| [Cursor](plugins/cursor/README.md) | Copy the extracted `cursor/` folder to `~/.cursor/plugins/local/open-artifact`, then run **Developer: Reload Window**. |
| [GitHub Copilot](plugins/copilot/README.md) CLI | Add the extracted root as a marketplace, then install `open-artifact@open-artifact`. |
| [GitHub Copilot](plugins/copilot/README.md) in VS Code | Run **Chat: Install Plugin from Source** and select the extracted `copilot/` folder. |
| [Antigravity](plugins/antigravity/README.md) | Install the extracted `antigravity/` folder with `agy plugin install` or copy it to `~/.gemini/config/plugins/open-artifact`, then restart the app. |
| [ZCode](plugins/zcode/README.md) | In Plugin Marketplace, add the extracted `zcode/` folder as a plugin marketplace, then install **Open Artifact** from the listing. |
| [ChatGPT on the web](plugins/chatgpt/README.md) | Run the prebuilt connector from the extracted `chatgpt/` folder and connect it over HTTPS. |
| [DeepSeek Harness](https://www.npmjs.com/package/dsh-open-artifact) | In Plugins, choose **Add plugin** and enter `dsh-open-artifact` as the npm package. In the CLI, run `dsh plugin --profile web add dsh-open-artifact` for the web profile. |

To upgrade, download the new ZIP, replace the extracted folder at the same path, and follow your app's
update steps in the linked guide. If your marketplace still points to a source checkout, register the extracted
folder using the migration steps in your app's guide.

In DeepSeek Harness, use **Update** on the Open Artifact page when a new version is offered. If you previously
linked a local checkout, remove the linked plugin in Plugins and add `dsh-open-artifact` from npm.

In a new session, try one of these prompts.

```text
/open-artifact slides a 6-slide pitch for this repo
/open-artifact design three landing page options for a coffee shop
/open-artifact whiteboard a retro board for last sprint
/open-artifact sheets a monthly budget with categories and totals
/open-artifact data a dashboard of signups by month from signups.csv
/open-artifact docs a hiring plan for 2027 with roles, budget and timeline
/open-artifact motion a 20-second launch animation for this app
/open-artifact page a team lunch poll that remembers every vote
```

The plugin adds the `Artifact`, `ArtifactData` and `ArtifactComments` MCP tools, the skill, and hooks that bring
page comments back into the session. How each app gets comments back, and what was tested in each, is in
[plugins/README.md](plugins/README.md).

In an app that shows [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps), the agent also gets a
`ShowArtifact` tool: it puts the artifact's live page in the conversation, where you can edit and comment without
leaving the chat, go full screen, open it in a browser or send your comments to the agent. Apps that don't show
MCP Apps never see the tool. Codex shows only https pages in these cards, so there the card offers Open in browser and
the page's address instead.

### 2. As a skill for any other agent

Copy `codex/skills/open-artifact/` from the extracted plugin bundle to your agent's skill directory. It carries
the daemon, and the agent drives it from the command line. From the extracted bundle root, you can try:

```bash
node codex/skills/open-artifact/scripts/open-artifact.mjs artifact '{"action":"list","scope":"types"}'
```

### 3. One type on its own

After [building from source](#build-from-source), every built type folder runs by itself, without the daemon:

```bash
node artifact-types/design/scripts/cli.mjs open ./my-design --type design   # starts a local server, prints the URL
node artifact-types/design/scripts/cli.mjs wait ./my-design                 # blocks until someone presses "Send to agent"
```

Other commands: `check`, `generate`, `upload`, `context`, `comments`, `history`, `share`, `status`, `stop`, … Run the
CLI with no arguments for the full list.

## Deploy to your own server

A site gives your artifacts a web address that works when your computer is off: people sign in, open what is shared
with them, edit and comment together, and your agents publish to it. The guides are in [docs/](docs/README.md):

- [Putting artifacts on a site](docs/hosting.md): how a site works and which kind to run. Start here.
- [On your home or office network](docs/hosting-lan.md): no domain, plain http.
- [On your own server, with a domain](docs/hosting-server.md): Docker Compose with Caddy, sign-in providers, AWS.
- [On Cloudflare](docs/hosting-cloudflare.md): a Worker with D1 and Durable Objects.
- [Connecting your computers and agents](docs/connecting-agents.md): `open-artifact remote add`, publishing,
  publishing new artifacts by themselves, install-time presets, remote MCP, dashboards' data.
- [Plugins](docs/plugins.md): your company's sign-in, permissions from your own service, rules, events and
  invitation e-mails; using plugins and writing one.

## Development

### Build from source

From a source checkout, install dependencies and build the workspace and plugin folders.

```bash
npm ci
npm run build
node scripts/build-plugins.mjs
```

For local plugin development, use `dist/plugins/` wherever the installation guides use the extracted folder.

```bash
npm run typecheck
npm test             # unit tests (node --test)
npm run e2e          # end-to-end: drives the built types with the CLI and Chrome, see e2e/README.md
```

The Rust crates in `crates/` compile to WebAssembly. Their output is committed under `packages/wasm-*/generated/`,
so you only need Rust when you change a crate:

```bash
node scripts/build-wasm.mjs   # needs cargo + wasm32-unknown-unknown, wasm-bindgen, wasm-opt
```

### Releasing

`node scripts/build-npm.mjs` stages the npm packages in `dist/npm/`: the `@open-artifact/*` libraries (compiled to
JavaScript with type declarations), `@open-artifact/cli` (the `open-artifact` command with the daemon vendored) and
`dsh-open-artifact`. To release:

1. Raise the versions (every package and plugin manifest shares one version).
2. Run `node scripts/changelog.mjs` for the commits since the last tag, and add a `## [x.y.z] - date` entry at the top
   of [CHANGELOG.md](CHANGELOG.md) that says what changed for people using it (Added / Changed / Fixed), plus its
   compare link at the bottom.
3. Commit, then push a tag (`v0.9.0`). The [Publish to npm](.github/workflows/publish-npm.yml) workflow requires a
   changelog entry for the tag. It publishes new package versions through npm trusted publishing, attaches
   `open-artifact-plugins.zip` to the tag's GitHub release and uses the changelog entry as its release notes.

A package npm doesn't have yet is claimed once from a computer before its first release:
`node scripts/publish-npm.mjs --claim` publishes its staged version and sets the workflow as its trusted publisher.
`node scripts/publish-npm.mjs` publishes from a computer too (`--dry-run` to look first).

## Repository layout

| Path | Contents |
|---|---|
| `artifact-types/` | The nine types as skills: `SKILL.md`, `reference/`, `artifact-type.json` (`page` has no editor or CLI of its own). |
| `skills/open-artifact/` | The one `/open-artifact <type>` skill; `vendor/` (built) carries the daemon. |
| `plugins/` | The skill packaged per agent app, with hooks and MCP config ([README](plugins/README.md)). |
| **Platform** | |
| `packages/daemon` | The `open-artifact` daemon: type registry, artifact library, agent tools, MCP, wake routing, the Harness API. |
| `packages/shell` | The daemon's pages: the Shell frame around every artifact, and the home page. |
| `packages/protocol` | Typed contracts shared by the daemon, harness adapters, type servers, the Shell and pages. |
| `packages/harness-kit` | The SDK an agent app uses to connect to the daemon, show pages and receive wakes ([README](packages/harness-kit/README.md)). |
| `packages/runtime` | `window.openartifact`, the capability API pages use (files, uploads, user, agent, presence, downloads). |
| `packages/type-server`, `packages/server-sdk` | The per-type local server and `cli.mjs`; shared server code. |
| **Types** | |
| `packages/slides-core`, `slides-editor` | Slides model (HTML subset, `deck.json`) and editor. |
| `packages/design-core`, `design-editor`, `dc` | Design model (`canvas.json`), editor, and the `.dc.html` artboard format. |
| `packages/design-system-core`, `design-system-editor` | Design System model (token grammar, CSS compiler) and editor. |
| `packages/whiteboard-core`, `whiteboard-editor` | Whiteboard model (schema, live sync, geometry) and editor. |
| `packages/sheets-core`, `sheets-editor` | Sheets model (workbook, cells, styles, tables, charts) and editor. |
| `packages/data-core`, `data-editor` | Data model (datasets, queries, rules, the dashboard page) and editor. |
| `packages/docs-core`, `docs-editor` | Docs model (blocks and characters with ids, ops, suggestions, markdown) and editor. |
| `packages/motion-core`, `motion-stage`, `motion-audio`, `motion-export`, `motion-editor` | Motion model (film store, scenes, by-hand records), the sandboxed stage and its `kit`, score synthesis, MP4/GIF/HTML/ZIP export, and the player. |
| **Shared** | |
| `packages/live-store` | Live document sync shared by Whiteboard, Data and Motion. |
| `packages/ui`, `editor-kit`, `export-kit` | UI kit (Base UI + Tailwind), what editors share (comments, history, presence…), browser-side exports. |
| `packages/canvas-engine`, `wasm-*`, `crates/` | WebGL2 canvas engine and the Rust/WebAssembly crates behind it, exports, whiteboard geometry, data rules, the sheets formula engine and motion (GIF/MOV encoding, flash analysis). |
| `examples/` | Runnable integrations of an agent app ([README](examples/README.md)). |
| `e2e/` | End-to-end tests. |
| `scripts/` | `build.mjs`, `build-plugins.mjs`, `build-skill.mjs`, `build-wasm.mjs`. |

## License

[Apache License 2.0](LICENSE). Copyright 2026 Jim Liu 宝玉; see [NOTICE](NOTICE).
