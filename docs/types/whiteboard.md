# Whiteboard

[中文](whiteboard.zh-CN.md) · [All artifact types](../artifact-types.md)

**Whiteboard** is a shared, infinite canvas stored as small live-synced JSON documents where you and your agent think visually together. Use it for brainstorms, sprint retros, flowcharts, system architecture diagrams, mind maps, user journey maps, and collaborative workshops.

> **When NOT to use Whiteboard:** Don't use it for pixel-exact UI screens or print pieces (use [Design](design.md)), slide decks (use [Slides](slides.md)), or long-form specs (use [Docs](docs.md)).

## Key features

- **Rich visual primitives**: Sticky notes, shapes, labeled sections, free text, smart routing arrows/connectors (powered by Rust/WASM geometry), hand-drawn pen ink, uploaded images/SVGs, tables, stickers (great for dot-voting), timers, link cards, and **live working HTML embeds** (mini prototypes, calculators, interactive charts).
- **Real-time multiplayer collaboration**: Live cursors, presence avatars, shared editing, and built-in workshop timers when shared on a LAN or hosted site.
- **Spatial AI teammate**: The agent understands what you have selected or anchored a comment to, rearranges/tidies layouts cleanly, extends existing sections without duplicating them, and shifts neighboring items to prevent overlap.
- **Comments & "Send to agent"**: Pin comment threads to specific elements or areas and send them straight to your agent.
- **Exports & archives**: Export the board as **PNG** from **Share → Export**, or archive the entire board (documents, uploads, comments, history) as a portable `.zip`.

## How to use (for users)

### Create a whiteboard
```text
/open-artifact whiteboard a sprint retro board with What Went Well, Friction, and Action Items
/open-artifact whiteboard an architecture diagram of our event-driven payment pipeline
/open-artifact whiteboard a mind map of Q4 growth experiments
```

### Collaborate & export
- **Draw & rearrange**: Drag stickies, group ideas into sections, draw arrows or ink sketches, drop stickers to vote, and start a countdown timer.
- **Ask your agent in context**: Select a cluster of stickies or pin a comment (e.g. *"cluster these by theme and summarize top 3 risks"*), then click **Send to agent**.
- **Export**: Open **Share → Export** to download a PNG image.

## How to use (for agents)

- **Type ID**: `whiteboard` (`type_url: "open-artifact://type/whiteboard"`)
- **Storage model**: Live JSON document store under `<root>/db/`:
  - `db/board/meta.json` — board title and element stacking order.
  - `db/elements/<id>.json` — one JSON document per board element (sticky, shape, section, text, arrow, ink, image, table, sticker, timer, link card, embed).

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/whiteboard/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/whiteboard", title, open: "after_first_write"}` | `open-artifact open <root> --type whiteboard --title "<title>" --json` |
| Read board | `ArtifactData {action: "list", url, collection: "elements"}` / `get` `board/meta` | `open-artifact read-db <root> [elements \| board/meta]` |
| Write / batch | `ArtifactData {action: "batch", url, writes: [...]}` (`set`/`update`/`delete`) | `open-artifact write-db <root> '<writes>'` (supports `{"$file":"..."}`) |
| Upload images | `Artifact {action: "publish", url, file_path, asset: true}` (or `call` `upload`) | `open-artifact upload <root> <file>...` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| Inspect view/selection | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Key rules for agents
1. Match the spatial form to the idea (loop for cycles, lanes for handoffs, tree for breakdowns, matrix for comparisons)—avoid generic grids of identical boxes.
2. Target roughly `1500×750` for a new board so text opens at a readable zoom level, keeping clear spacing (24 px between neighbors, 64 px for arrows, 144 px for labeled arrows).
3. Respect human edits on existing boards: read fresh before writing, extend in place rather than building duplicate copies beside existing clusters, and shift neighbors/stickers together when resizing.
4. Use `ArtifactData` `batch` (up to 500 writes per batch) so updates apply atomically; use `{"__delete__": true}` inside `update` to remove fields.

For full element schemas, drawing craft, and ideation guidance, read [artifact-types/whiteboard/SKILL.md](../../artifact-types/whiteboard/SKILL.md) and `artifact-types/whiteboard/reference/`.
