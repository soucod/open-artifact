# Data

[中文](data.zh-CN.md) · [All artifact types](../artifact-types.md)

**Data** builds live dashboards, KPI trackers, scorecards, interactive visualizations, and narrative data reports backed by small JSON documents (`db/`) and rendered with plain HTML, CSS, JavaScript, and `d3`. Every time a reader opens the page, numbers recompute transparently from their sources.

> **When NOT to use Data:** Don't use it when the user wants an editable cell/formula spreadsheet (use [Sheets](sheets.md)) or a slide presentation (use [Slides](slides.md)).

## Key features

- **Three transparent dataset kinds**:
  1. **Live MCP connector queries** (`kind: "call"`): Query databases, analytics, or SaaS tools configured in `~/.agents/open-artifact/connectors.json`—keeping metrics fresh automatically with configurable staleness/refresh policies.
  2. **Attached files** (`kind: "file"`): Upload CSV, TSV, JSON, or text files (Excel workbooks imported via the page are converted cleanly to CSV sheets by the agent).
  3. **Live calculations & loaders** (`dash.calc`, `dash.loader`): Transform, join, and compute derived metrics in the browser.
- **Built-in Sources panel**: Shows every reader where every number came from, its query/script, and how fresh it is.
- **Interactive filters & safe rules**: Bind page filters (`{{name}}`) directly into dataset parameters, validated by Rust/WASM filter rules (`open-artifact-data-rules`).
- **Hand editing, looks & Design Systems**: Users can edit words directly on the page, switch ready-made visual looks, or install a [Design System](design-system.md).
- **Remix & Read-aloud**: Remix a dashboard into a narrative scroll story or a short visual draft, and listen via built-in read-aloud support.
- **Exports**: Export to **PDF**, standalone **HTML**, or **JSON** from **Share → Export**, plus portable `.zip` archives.

## How to use (for users)

### Create a dashboard or report
```text
/open-artifact data a monthly signups and retention dashboard from ./signups.csv
/open-artifact data a live weekly engineering KPI scorecard querying our postgres MCP connector
/open-artifact data an interactive scroll story analyzing Q3 revenue by region
```

### Explore, filter & revise
- **Inspect provenance**: Open the **Sources** side panel to verify queries, attached files, and refresh timestamps.
- **Filter & edit copy**: Use interactive filters on the page, click text to hand-edit copy, or click **Import a file** on an empty dashboard to upload CSV/TSV/JSON/Excel files.
- **Remix or refine with your agent**: Pin comments on charts or numbers and click **Send to agent**, or remix a dashboard into a story/visual short.
- **Export**: Open **Share → Export** to download PDF, HTML, or JSON.

## How to use (for agents)

- **Type ID**: `data` (`type_url: "open-artifact://type/data"`)
- **Storage model**: Live JSON document store under `<root>/db/`:
  - `db/dash/meta.json` — `{title, lang?}`
  - `db/dash/params.json` — filter defaults
  - `db/dash/look.json` — ready-made look or installed design system
  - `db/dash/settings.json` — freshness/update settings
  - `db/datasets/<id>.json` — dataset definitions (`source`: `call` or `file`, `title`, `description`, `langs`, `updated`, `fixed`)
  - `db/files/index.html.json` (and supporting `files/*`) — HTML/CSS/JS + `d3` page source

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/data/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/data", title, open: "after_first_write"}` | `open-artifact open <root> --type data --title "<title>" --json` |
| Read store | `ArtifactData {action: "list" \| "get", url, ...}` | `open-artifact read-db <root> [path] [--text]` |
| Write / edit | `ArtifactData {action: "batch" \| "set" \| "update" \| "str_replace", url, ...}` | `open-artifact write-db <root> '<writes>'` (supports `{"$file":"..."}`) |
| Upload data file | `Artifact {action: "call", url, name: "upload", args: {file: "<abs path>"}}` | `open-artifact upload <root> <file>... [--name N]` |
| Validate + runtime check | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| Inspect view/selection | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Key rules for agents
1. **Read-only queries by default**: Only store read-only MCP connector calls unless the user explicitly approves a write call after seeing it. Never read `env`/`headers` from `connectors.json` and never modify `connectors.json`.
2. **Preserve freshness & honesty**: Use live queries (`kind: "call"`) for changing data and attached files (`kind: "file"`) for static uploads; always set `updated: {at, by}` on file datasets. When attaching a file, inform the user that everyone who opens the dashboard can read the whole file.
3. **Pass `if_match`** on `set`/`delete` of existing documents (or use `str_replace` for surgical edits to `files/index.html`).
4. Always run `check`—it validates both document schemas and runtime errors reported by the open page.

For dataset schemas, filters, looks, design systems, and remix formats, read [artifact-types/data/SKILL.md](../../artifact-types/data/SKILL.md) and `artifact-types/data/reference/`.
