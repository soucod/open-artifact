# Artifact types overview

[中文](artifact-types.zh-CN.md)

Open Artifact ships with **9 built-in artifact types**. Each type combines a plain on-disk storage format, a dedicated interactive web editor, comment anchoring, version history, export pipelines, and a self-contained skill (`artifact-types/<type>/SKILL.md`) that teaches any AI agent how to author and revise it. The exception is `page`: a free HTML page the agent writes whole, with no editor or exports of its own.

## All 9 built-in types at a glance

| Type ID | Guide | Best for | Storage & folder marker | Imports | Exports | Uses Design System |
| --- | --- | --- | --- | --- | --- | --- |
| `slides` | [Slides](types/slides.md) | Presentations, pitch decks, talks, review decks | Project files (`project/deck.json`) | Images, video, fonts | PDF, PPTX, HTML, PNG | Yes |
| `design` | [Design](types/design.md) | UI screens, landing pages, app mockups, clickable prototypes, posters, print pieces | Project files (`project/canvas.json`) | Images, fonts, CSS/JS | PNG, JPEG, PDF, HTML (+ Figma capture, full-canvas ZIP) | Yes |
| `design-system` | [Design System](types/design-system.md) | Brand books, design tokens, typography, live component previews, asset libraries | Project files (`project/design-system.json`) | Codebases, design files, brand assets | Installed by other types (auto-generates `tokens.css`, `manifest.json`, `api/`) | — (is the source) |
| `whiteboard` | [Whiteboard](types/whiteboard.md) | Brainstorms, retros, flowcharts, architecture diagrams, mind maps, workshops | Live doc store (`db/board/meta.json`) | Images, SVGs, embeds | PNG (+ `.zip` archive) | No |
| `sheets` | [Sheets](types/sheets.md) | Budgets, trackers, schedules, record tables, financial models with live formulas | Workbook edit log (`sheet/sheet.json`) | CSV | XLSX, CSV (+ `.zip` archive) | No |
| `data` | [Data](types/data.md) | Live dashboards, KPI scorecards, interactive charts, recurring reports, scroll stories | Live doc store (`db/dash/meta.json`) | CSV, TSV, JSON, text, Excel (converted), live MCP connectors | PDF, HTML, JSON (+ `.zip` archive) | Yes |
| `docs` | [Docs](types/docs.md) | Proposals, specs, plans, reports, handbooks, memos, meeting notes | Tabbed block/char store (`doc/doc.json`) | Markdown, text, Word (`.docx`), PDF | Markdown, Word (`.docx`), PDF, HTML (+ `.zip` archive) | No |
| `motion` | [Motion](types/motion.md) | Product promos, explainers, launch clips, walkthroughs, title cards, animated GIFs | Live doc store (`db/film/meta.json`) | Images, fonts, video/audio clips | MP4, GIF, standalone HTML player, source ZIP | Yes |
| `page` | [Page](types/page.md) | Small interactive pages no other type fits: widgets, tools, calculators, mini games, explainer pages, polls and checklists | The folder itself (`index.html`, capabilities in `.artifact.json`) | Any files the page loads | — (publishes to a Node or Cloudflare site) | No |

## Which type should I choose?

Both users and agents can use these rules to pick the right type quickly:

- **Slides vs. Docs**: Choose **`slides`** when presenting in stages on a fixed 16:9 or 4:3 screen with speaker notes and builds; choose **`docs`** for long-form reading, multi-tab plans/specs, tracked suggestions, or exporting to Word/Markdown.
- **Design vs. Whiteboard**: Choose **`design`** when visual craft, pixel-accurate UI layout, typography, clickable prototypes, or print/export fidelity matters; choose **`whiteboard`** for spatial brainstorming, stickies, flowcharts, architecture sketches, and freeform team collaboration.
- **Data vs. Sheets**: Choose **`data`** for executive dashboards, custom d3 charts, narrative scroll stories, or live queries against MCP data connectors; choose **`sheets`** when people need a grid of cells, spreadsheet formulas, tables with filters, dropdowns, or an Excel (`.xlsx`) workbook.
- **Motion vs. Slides**: Choose **`motion`** when time, motion choreography, music/voiceover, and exporting an MP4 or GIF is the point; choose **`slides`** when a human speaker drives the pacing slide by slide.
- **Page last**: Choose **`page`** only when none of the above fits: a small interactive thing (a tool, a calculator, a mini game, an explainer page) the agent writes as one HTML page, with the runtime capabilities it declares.
- **Design System first**: If you have brand guidelines, a product codebase, or recurring visual deliverables, build a **`design-system`** first—then **`design`**, **`slides`**, **`data`**, and **`motion`** can install and reuse its exact colors, typography, fonts, and components.

> **For agents:** If the user does not specify a type word after `/open-artifact`, call `Artifact {action: "quickstart", intent: "<what they asked for>"}`. The daemon recommends the best installed type and returns `related` artifacts (such as existing `design-system` folders) you can reuse.

## How artifact types store data (for agents & developers)

Open Artifact uses three storage styles, plus the free page—knowing which style a type uses tells you immediately how agents read and write it:

1. **Project files (`slides`, `design`, `design-system`)**
   - Content lives as human-readable files under `<root>/project/` (index JSON + HTML/CSS/Markdown/tokens).
   - Agents write files directly into `<root>/project/` with their normal file tools (or `Artifact {action: "publish", url, files}`), and validate with `Artifact {action: "call", url, name: "check"}`.
2. **Live JSON document store (`whiteboard`, `data`, `motion`)**
   - Content lives as small JSON documents under `<root>/db/<collection>/<id>.json`, synced in real time via `@open-artifact/live-store`.
   - Agents read and write through `ArtifactData` (`get`, `list`, `query`, `set`, `update`, `delete`, `str_replace`, `batch`) under a host, or `open-artifact read-db` / `write-db` standalone.
3. **Structured operational stores (`sheets`, `docs`)**
   - Content is maintained as structured revisions/operations (`sheet/edits.jsonl` for Sheets; block & character-ID trees in `doc/` for Docs).
   - Agents never edit the JSON files by hand; instead they call type actions via `Artifact {action: "call", url, name: "read" | "update" | "batch" | ...}` (or standalone `open-artifact read` / `update` / `batch`).

4. **A free page (`page`)**
   - The folder itself: `<root>/index.html` is the page, written whole by the agent, with files beside it. It has no editor of its own; it keeps data through the runtime capabilities it declares (`db/`, `_blobs/`, `comments.json`).
   - Agents write `index.html` with their file tools (or `Artifact {action: "publish", url, files}`) and declare capabilities with `publish`'s `capabilities` argument.

All types share `<root>/_blobs/` (content-addressed uploads via `upload`), `<root>/comments.json`, and `<root>/history/`.

## Cross-type workflows

- **Design System → Design / Slides / Data / Motion**: Create a brand kit once (`design-system`), then tell your agent *"use our Acme design system"* when making a UI mockup, pitch deck, dashboard, or launch animation. The agent installs the system's tokens, fonts, and (for Design) live component bundles so the editor's color/type pickers reflect your brand.
- **Your own types**: Because each type is a self-contained folder with `artifact-type.json`, you can make your own: `open-artifact types new <id>` (or **New type** in the home page's Types tab) writes one that works as is, `open-artifact types from <page artifact | saved page>` turns a page (or one saved from claude.ai) into one, and `open-artifact types check` says what is wrong. A project's types are limited (like an installed type's) until you trust the project; you can turn any type off. `open-artifact types publish <id>` puts a type of your own on a Node site, so artifacts of it publish there. See [Making your own artifact types](custom-types.md). Agents discover everything available via `Artifact {action: "list", scope: "types"}`.

## Detailed guides by type

- [Slides](types/slides.md) — 16:9 / 4:3 decks, speaker notes, builds, presenter mode, polygon clips on panels and photos, PDF/PPTX export
- [Design](types/design.md) — Infinite canvas of live `.dc.html` artboards, prototypes, responsive & print export
- [Design System](types/design-system.md) — Brand book, multi-theme tokens with contrast checks, live component previews, asset groups
- [Whiteboard](types/whiteboard.md) — Shared infinite board with stickies, shapes, arrows, ink, tables, live embeds, cursors
- [Sheets](types/sheets.md) — Multi-sheet workbook with Rust/WASM formula engine, tables, charts, interactive panels, XLSX/CSV
- [Data](types/data.md) — Live dashboards & reports from MCP connectors, CSV/JSON uploads, calculations, Sources & Remix
- [Docs](types/docs.md) — Tabbed living documents with smart chips, tracked suggestions, Mermaid diagrams, Word/PDF import & export
- [Motion](types/motion.md) — Deterministic HTML/CSS/JS animated films with score, voiceover, by-hand editing, MP4/GIF export
- [Page](types/page.md) — A free HTML page the agent writes, with the runtime capabilities it declares (database, uploads, comments, live messages)
