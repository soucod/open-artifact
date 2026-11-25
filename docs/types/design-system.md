# Design System

[中文](design-system.zh-CN.md) · [All artifact types](../artifact-types.md)

**Design System** turns your brand guidelines, frontend codebase, design files, or raw assets into a structured, browsable, and editable local **brand book**—and acts as the single source of truth that **Design**, **Slides**, **Data**, and **Motion** artifacts can install and reuse.

> **When NOT to use Design System:** Don't use it for one-off UI mockups or free-form HTML style guides (use [Design](design.md)).

## Key features

- **Multi-theme design tokens with WCAG contrast checks**: Manage `color` (multiple themes like Light/Dark with automatic contrast inspection), `type` (font files, families, text style groups), `spacing`, `radius`, `shadow`, and custom token families (`opacity`, `zIndex`, `motion`, …) in `project/tokens.json`.
- **Living brand book**: Author `project/README.md` plus up to 24 extra Markdown guideline sections, topped by a live visual cover (`components/Cover/preview.html`).
- **Live component previews & API props**: Showcase real components via `components/<Comp>/preview.html` alongside usage guidelines (`README.md`) and TypeScript prop tables (`<Comp>.d.ts`), loaded from a local component bundle (`components/bundle.js` + `bundle.css`).
- **Organized brand asset library**: Group logos, icons, illustrations, videos, and PDFs under `project/assets/<Group>/` with configurable tile sizes (`xl` to `xs`).
- **Auto-generated outputs**: Every save (or `open-artifact generate`) automatically regenerates `tokens.css`, `manifest.json`, `api/` cards, and the README usage block from `tokens.json`—keeping one source of truth.
- **Built from real sources**: Extract exact tokens, fonts, and exported components directly from an existing code repository, design tool export, or brand folder—or start lean from scratch.
- **Cross-artifact reuse**: Other artifacts (`design`, `slides`, `data`, `motion`) install a Design System so their color/type menus, fonts, and components stay synced with your brand.

## How to use (for users)

### Create a design system
```text
/open-artifact design-system extract our brand tokens, fonts and React components from ./src
/open-artifact design-system create a brand book for Acme from these logo files and guidelines
```

### Browse, edit & apply across artifacts
- **Edit tokens live**: Adjust hex/oklch colors, check contrast ratios across Light/Dark themes, tweak type scale/spacing, or drop brand media into asset groups.
- **Reuse in other artifacts**: When creating a deck, UI design, dashboard, or film, tell your agent *"use our Acme design system"*.
- **Keep in sync**: If a system is synced from code (`"editing": "code"`), edit the source code and ask your agent to re-sync.
- **Comment & revise**: Pin comments on tokens, components, or docs and click **Send to agent**.

## How to use (for agents)

- **Type ID**: `design-system` (`type_url: "open-artifact://type/design-system"`)
- **Storage model**: Project files under `<root>/project/`:
  - `project/design-system.json` — index (`v: 3`, `layout: "files"`, `createdOnFiles`, `title`, `namespace`, `libraries`, `groups`, `assetGroups`, `lastChange`). **Always write this file LAST.**
  - `project/tokens.json` — structured list-based tokens (`{"tokens": [{"name","value","usage"}]}` per family; `type` uses `fonts`, `families`, `groups`). *Note: Convert W3C DTCG map-shaped JSON to list shape before writing.*
  - `project/README.md` (+ optional `*.md` sections) — brand book; never edit inside the `<!-- open-artifact:usage -->` block.
  - `project/components/<Comp>/` — `preview.html`, `README.md`, `<Comp>.d.ts`, plus `components/bundle.js`, `bundle.css`, `index.d.ts`, `lib/*.js`, and `components/Cover/preview.html`.
  - `project/assets/<Group>/<file>` & `project/fonts/<file>` — prefer real files over uploads so they copy cleanly when installed into other artifacts.
  - **Generated (never hand-write)**: `tokens.css`, `manifest.json`, `api/*`.

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/design-system/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/design-system", title, open: "after_first_write"}` | `open-artifact open <root> --type design-system --title "<name>" --json` |
| Generate derived files | `Artifact {action: "call", url, name: "generate"}` | `open-artifact generate <root>` |
| Upload media to group | `Artifact {action: "call", url, name: "upload", args: {file, group}}` | `open-artifact upload <root> <file> --group <Group>` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |

### Key rules for agents
1. Write `project/design-system.json` **once, last** after reading it fresh—so you never clobber edits or media a user added in the page. Update `lastChange`.
2. Never write generated files (`tokens.css`, `manifest.json`, `api/*`); let the open page or `generate` produce them.
3. In `tokens.json`, avoid CSS functions (`var()`, `calc()`, `color-mix()`) and named colors (`red`, `transparent`), which are dropped by the parser; run `check` to catch any dropped tokens.
4. When building from code or a design tool, read `artifact-types/design-system/reference/from-code.md` or `from-design-tool.md` first.

For complete schema, cover, and bundling rules, read [artifact-types/design-system/SKILL.md](../../artifact-types/design-system/SKILL.md) and `artifact-types/design-system/reference/`.
