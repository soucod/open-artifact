# Motion

[中文](motion.zh-CN.md) · [All artifact types](../artifact-types.md)

**Motion** creates short animated films—explainers, product promos, launch clips, UI walkthroughs, title sequences, and animated GIFs—built as deterministic HTML, CSS, and JavaScript scenes drawn as a pure function of time `t`, backed by small JSON documents (`db/`).

> **When NOT to use Motion:** Don't use it when a human presenter wants to step through static slides at their own pace (use [Slides](slides.md)) or for static marketing graphics (use [Design](design.md)).

## Key features

- **Deterministic time-driven scenes**: Each scene (`modules/scene-<id>.js`) renders cleanly from time `t`, ensuring smooth interactive scrubbing in the browser and frame-accurate video export.
- **Rough cut → live finalize workflow**: Opens immediately after the rough cut (`stage: "rough"`), so you watch the storyboard play while the agent builds out scenes, drawings, music, and polish live.
- **Procedural score & captioned voiceover**: Synthesize background music and sound effects in code (`modules/score.js`), attach recorded voiceover clips with synced captions (`modules/narration.js`), or play a video clip's own sound (an interview, a talk) sentence by sentence under captions, with no audio file cut by hand.
- **Direct by-hand editing without code**: Right inside the player, you can **retype** text, **recolor** palettes, **refont** typography, **recut** scene lengths, and **retouch** individual element styles—stored in separate non-destructive records that the agent respects on future turns.
- **Design System & real UI assets**: Install a [Design System](design-system.md) or upload your product's real logos, icons, fonts, screenshots, and clips.
- **Flash-safety & visual verification**: Built-in Rust/WASM flash analysis enforces safe motion (no flashing/cutting > 3 times/sec), and agents can render headless Chromium `stills` at exact timestamps to inspect every scene visually.
- **Moment & spot comments**: Pin comments to an exact timestamp or a specific point in the frame, then click **Send to agent**.
- **Exports**: Export to **MP4**, **GIF**, a **standalone HTML player**, or a **source ZIP** from **Share → Export**.

## How to use (for users)

### Create an animated film
```text
/open-artifact motion a 20-second launch animation for our open-source CLI tool
/open-artifact motion a 30-second animated explainer showing how DNS resolution works
/open-artifact motion a 10-second looping promo GIF using our Acme design system
```

### Play, tweak by hand & export
- **Watch & scrub**: Play/pause, scrub the timeline, toggle captions/audio, and watch scenes arrive live starting from the rough cut.
- **Tweak directly**: Click on-screen copy to retype it, swap colors or fonts, trim/extend scene durations, or restyle single elements by hand.
- **Pin feedback in time & space**: Pause on any frame, pin a comment to that moment or a spot on screen (e.g. *"slow down the reveal here and make the headline punchier"*), and click **Send to agent**.
- **Export**: Open **Share → Export** to render MP4, GIF, standalone HTML player, or source ZIP.

## How to use (for agents)

- **Type ID**: `motion` (`type_url: "open-artifact://type/motion"`)
- **Storage model**: Live JSON document store under `<root>/db/`:
  - `db/film/meta.json` — `{"v": 1, "title", "updatedAt"}`
  - `db/film/script.json` — `{"code": "window.CUT = kit.scenes();"}` (written last in the first batch)
  - `db/modules/scenes.json.json` — scene list, stage (`"rough"` → `"final"`), dimensions, FPS, palettes, fonts
  - `db/modules/base.css.json`, `shared.js.json`, `scene-<id>.js.json`, `score.js.json`, `narration.js.json`
  - `db/assets/<name>.json` — uploaded images, fonts, video/audio clips (`/_blob/<id>`)
  - **Page-owned by-hand records (read-only for agents)**: `retyped.json`, `recolored.json`, `refaced.json`, `fetched-fonts.json`, `recut.json`, `retouched.json`.
- **Limits**: 1–24 scenes; 200 KiB per document (larger modules split into `<name>~1`…`~99`); up to 500 modules (16 MiB total) and 96 assets; batches up to 50 writes / 1 MB.

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/motion/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/motion", title, open: "after_first_write"}` | `open-artifact open <root> --type motion --title "<title>" --json` |
| Read store | `ArtifactData {action: "list" \| "get", url, ...}` | `open-artifact read-db <root> [path] [--text]` |
| Write / batch | `ArtifactData {action: "batch" \| "set" \| "update" \| "str_replace", url, ...}` | `open-artifact write-db <root> '<writes>'` (supports `{"$file":"..."}`) |
| Upload media/audio | `Artifact {action: "call", url, name: "upload", args: {file: "<abs path>"}}` | `open-artifact upload <root> <file>... [--name N]` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| Inspect frames (`stills`) | `Artifact {action: "call", url, name: "stills", args: ...}` (or `snapshot`) | `open-artifact stills <root> --at <t1,t2,...> [--scale n]` |
| Signal waiting for user | `Artifact {action: "call", url, name: "asking"}` | `open-artifact asking <root> [--done]` |
| Inspect time/scene | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Key rules for agents
1. **Open early on rough cut**: Write `film/meta`, `modules/scenes.json` (`"stage": "rough"`), `modules/base.css`, and `film/script` first and show the page immediately—before authoring final scenes or score—so the user watches progress live.
2. **Respect by-hand edits**: Never write the page's six by-hand records (`retyped.json`, `recolored.json`, `refaced.json`, `fetched-fonts.json`, `recut.json`, `retouched.json`). If any exist on a film, read `artifact-types/motion/reference/by-hand.md` in full before editing.
3. **Call `asking`** before asking the user a question while the film page is open so the UI shows *"Waiting for you"*.
4. **Safety & honesty**: No scene shorter than 1 second; nothing flashes/blinks/cuts more than 3 times per second; no deceptive countdowns or external URLs. Always run `check` and verify scenes with `stills`.

For complete `kit` API, rough-cut/finalize guides, sound synthesis, voiceover, and explainer craft, read [artifact-types/motion/SKILL.md](../../artifact-types/motion/SKILL.md) and `artifact-types/motion/reference/`.
