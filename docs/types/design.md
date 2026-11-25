# Design

[中文](design.zh-CN.md) · [All artifact types](../artifact-types.md)

**Design** is an infinite WebGL2-accelerated canvas of live `.dc.html` artboards (Design Components) saved as local files. Use it for UI screens, web and landing page explorations, multi-option comparisons, clickable prototypes, diagrams, posters, flyers, and print layouts.

> **When NOT to use Design:** Don't use it for slide decks (use [Slides](slides.md)) or freeform team sticky-note brainstorming (use [Whiteboard](whiteboard.md)).

## Key features

- **Infinite multi-page canvas**: Place multiple artboards side by side, organize them across up to 40 pages, add section titles, sticky notes, shapes, arrows, and freehand annotations.
- **Live `.dc.html` artboards & interactive prototypes**: Artboards render real HTML/CSS/JS; interactive artboards (`is_interactive: true`) get a **Play** mode for click-through prototypes and live controls.
- **Responsive viewport testing**: Preview artboards full-window in Fill/Fit mode at Phone (`390`), Tablet (`768`), `1024`, `1280`, `1440`, or `1920` widths, and capture full-page screenshots at any width (1× or 2×).
- **Direct visual editing & tweaks**: Retype copy inline, move/resize frames, adjust colors and text styles, and compare variations side by side.
- **Design System integration**: Install a [Design System](design-system.md) to bind brand tokens to the editor's pickers and mount real UI components from the system's bundle (`window.<Ns>`).
- **Print & pagination support**: Configure Letter or A4 paper and flow pagination (`print: "flow"`) for multi-page print PDFs.
- **Rich exports**:
  - **PNG / JPEG** (single artboards or responsive full-page captures at 1×/2×)
  - **PDF** (fixed frames or paginated print flow)
  - **HTML** — Standalone web page, **Figma capture HTML** (open in Chrome and capture with Figma's Chrome extension), or **Whole canvas ZIP** (every artboard, assets, runtime, index, and README)

## How to use (for users)

### Create a design canvas
```text
/open-artifact design three landing page options for a specialty coffee roaster
/open-artifact design mobile onboarding flow (4 screens) with interactive Play mode
/open-artifact design an A4 conference poster using our brand design system
```

### Edit, preview & export
- **Pan, zoom & edit**: Navigate the infinite canvas, move frames, click text to edit directly, or switch pages in the sidebar.
- **Test prototypes**: Click the **Play** button in the toolbar to run interactive artboards and test responsive screen widths.
- **Collaborate with your agent**: Pin comments directly onto an artboard and click **Send to agent**.
- **Fix errors**: An artboard that fails to run shows a notice underneath it with **Ask agent to fix**, and **N errors** at the top right lists every artboard with errors on the page and asks the agent to fix them all. Close a notice with **×**; the warning mark it leaves next to the artboard's name brings it back. If the agent can't be reached, the list keeps the request for you to copy into its conversation.
- **Deep links**: Append `#artboard-<name>`, `#play-<name>`, or `#page-<id>` to the artifact URL to jump straight to a board or page.
- **Export**: Use **Share → Export** for PNG, JPEG, PDF, Figma-ready HTML, or a full-canvas ZIP.

## How to use (for agents)

- **Type ID**: `design` (`type_url: "open-artifact://type/design"`)
- **Storage model**: Project files under `<root>/project/`:
  - `project/canvas.json` — index (`v: 3`, `createdOnFiles`, `title`, `launch`, `pages`, `boards`, `order`, `notes`, `designSystems`).
  - `project/<path>.dc.html` — one Design Component file per artboard (`Main.dc.html` as entry; frame `w`/`h` between 40 and 8000 px).
  - `project/ds/<folder>/` — copied design system `tokens.json`, `tokens.css`, component bundles, fonts, and assets.
- **Limits**: Up to 512 files and 256 MB total per canvas; `canvas.json` under 1 MiB.

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/design/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/design", title, open: "after_first_write"}` | `open-artifact open <root> --type design --title "<title>" --json` |
| Write artboards | Write `<root>/project/canvas.json` and `*.dc.html` with file tools (or `Artifact publish` with `if_match`) | Write directly under `<root>/project/` |
| Upload assets | `Artifact {action: "call", url, name: "upload", args: {file: "<abs path>"}}` | `open-artifact upload <root> <file>...` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| Inspect selection | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Key rules for agents
1. Check for an existing `design-system` first. If using one with a component bundle (`window.<Ns>`), mount its real components rather than hand-coding look-alikes, and copy its files under `project/ds/<folder>/`.
2. Write `project/canvas.json` and the first artboard first, show the page, then write subsequent artboards **one per turn** in `order` so the user watches each artboard appear cleanly.
3. Upload images, fonts, and external assets via `upload` (`/_blob/<id>`); never embed `data:` URIs or bare filenames.
4. Run `check` after finishing and fix all errors (missing `support.js`, unmatched `$preview` dimensions, broken `/_blob/` URLs, or stale installed design systems).

For full `.dc.html` syntax, layout, shader, and print references, read [artifact-types/design/SKILL.md](../../artifact-types/design/SKILL.md) and `artifact-types/design/reference/`.
