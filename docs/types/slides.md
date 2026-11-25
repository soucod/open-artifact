# Slides

[中文](slides.zh-CN.md) · [All artifact types](../artifact-types.md)

**Slides** creates editable 16:9 (`1920×1080`) or 4:3 (`1440×1080`) presentation decks stored as plain local HTML/CSS/JSON files. Use it for pitch decks, talks, product reviews, training decks, or any presentation you want to arrange, edit in place, rehearse with speaker notes, present full screen, and export.

> **When NOT to use Slides:** Don't use it for long-form reading documents (use [Docs](docs.md)) or a one-off single-file HTML page.

## Key features

- **Direct slide editing**: Retype text, move/resize elements, tweak typography and colors, and reorder slides in the slide rail or section overview.
- **Structured sections & outline**: Organize slides into named sections with descriptions visible in the overview grid.
- **Speaker notes, builds & transitions**: Add per-slide speaker notes (`<aside>`), step-by-step element builds, and slide transitions.
- **Full-screen presenter mode**: Present directly from the browser with keyboard navigation and speaker notes.
- **Design System integration**: Install a [Design System](design-system.md) artifact so its brand colors, text styles, and font files appear in the editor pickers and slides stay on-brand.
- **Custom fonts & media**: Load Google Fonts or uploaded font files (`.woff2`, `.woff`, `.ttf`, `.otf`), plus uploaded images and video clips (`.mp4`/`.webm`).
- **Polygon clipping** supports arbitrary polygons on panels and photos with px, percentage and mixed `calc()` coordinates. Simple panels and photos export as editable PowerPoint shapes and pictures.
- **Collaboration & history**: Pin comments directly onto slides, send threads back to your agent, and browse/restore version history.
- **Exports**: Export to **PDF**, **PowerPoint (`.pptx`)**, standalone **HTML**, or **PNG** images from **Share → Export**.

## How to use (for users)

### Create a deck
```text
/open-artifact slides a 6-slide investor pitch for our developer tool
/open-artifact slides a 10-slide Q3 engineering review in 4:3 using our Acme design system
```

### Edit, review & export
- **Direct edits**: Click text to edit inline, rearrange slides in the left rail or section overview, and open speaker notes at the bottom.
- **Present**: Use the presenter button in the toolbar for full-screen delivery.
- **Request changes from your agent**: Pin a comment on a slide (e.g. *"simplify this comparison table into 3 bullets"*), then click **Send to agent**.
- **Link to a specific slide**: Add `#slide-<number>` to the artifact URL (e.g. `#slide-3`).
- **Export**: Open **Share → Export** to download PDF, PPTX, HTML, or PNG.

## How to use (for agents)

- **Type ID**: `slides` (`type_url: "open-artifact://type/slides"`)
- **Storage model**: Project files under `<root>/project/`:
  - `project/deck.json` — index (`v: 5`, `createdOnFiles`, `lists: "css"`, `format: {v: 1, shared: ["project/deck.css"]}`, `title`, `order`, `cover`, `sections`, `faces`, optional `size: "4:3"`, `designSystems`).
  - `project/deck.css` — shared CSS variables and reusable layout classes (no `@import`).
  - `project/slides/<id>.html` — one file per slide containing exactly one `<section id="<id>">...</section>` (optional `<aside>` last child for speaker notes; no `<html>`/`<head>`/`<body>`).
  - `project/ds/<folder>/` — copied design system `tokens.json`, fonts, and assets when a design system is installed.
- **Limits**: Up to 500 slides; up to 1 MB per slide; up to 4 custom font faces; uploaded media up to 25 MB each.

### Polygon shapes and picture frames

Set `clip-path: polygon(...)` on a `<div>`, `<img>` or `<x-shape>` in inline styles or shared `deck.css`. Percentage coordinates support triangles, hexagons, arrows and concave outlines. Mixed coordinates such as `calc(100% - 12px)` keep a fixed distance from an edge as the frame changes size. Put a photo's clip on its `<img>` for an editable crop and custom outline in PowerPoint. Clipped containers with children, and clips combined with a border, shadow, filter or rounded corners, export to PowerPoint as pictures. Only `polygon()` is supported: use `border-radius` for rounded or round frames. Inline `style` attributes take no `var()`, so write the px value there. [Polygon clipping reference](../../artifact-types/slides/reference/images.md#polygon-clipping)

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/slides/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/slides", title, open: "after_first_write"}` | `open-artifact open <root> --type slides --title "<title>" --json` |
| Write slides | Write `<root>/project/deck.json`, `deck.css`, and `slides/*.html` with file tools (or `Artifact publish` with `if_match`) | Write directly under `<root>/project/` |
| Upload media/fonts | `Artifact {action: "call", url, name: "upload", args: {file: "<abs path>"}}` | `open-artifact upload <root> <file>...` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| Inspect selection | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Key rules for agents
1. Check for an existing `design-system` before picking fonts/colors; if installing one, copy its `tokens.json` and referenced assets/fonts into `project/ds/<folder>/` and declare tokens in `project/deck.css`.
2. Write `project/deck.json`, `project/deck.css`, and the cover slide first, then stream remaining slides (at most 3 slides per turn) so the user watches them arrive live.
3. Never use external `http(s)` image URLs or `data:` URIs—upload images/videos/fonts via `upload` and reference `/_blob/<id>` (or `project/ds/<folder>/...`).
4. Always run `check` after writing and fix all errors, warnings, layout findings, and dropped styles.

For full format rules and craft guidelines, read [artifact-types/slides/SKILL.md](../../artifact-types/slides/SKILL.md) and `artifact-types/slides/reference/`.
