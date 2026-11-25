# Sheets

[中文](sheets.zh-CN.md) · [All artifact types](../artifact-types.md)

**Sheets** is a shared multi-sheet spreadsheet powered by a Rust/WASM formula engine and stored locally as an operational edit log (`sheet/edits.jsonl`). Use it for budgets, trackers, project schedules, inventories, record tables, and financial models that both you and your agent edit together.

> **When NOT to use Sheets:** Don't use it when the user explicitly asks for a raw `.csv` or `.xlsx` file without an interactive sheet, or for narrative/d3 executive dashboards connected to live MCP data sources (use [Data](data.md)).

## Key features

- **Full Rust/WASM formula engine**: Formulas recalculate automatically as cells change across multiple worksheets, with locale-aware formatting.
- **Formatting & layout**: Number/currency/percent/date formats, fonts, fills, borders, merged cells, auto-styled tables with column filter buttons, frozen panes, and grouped rows/columns.
- **Data controls & rules**: Dropdown validation menus, checkboxes, and conditional formatting rules.
- **Charts & interactive panels**: Embed charts drawn directly from cell ranges, plus custom **interactive panels** (sliders, buttons, and inputs on their own tab wired to live assumption cells and formulas).
- **Real-time collaboration & history**: Live cursors, cell/range-anchored comments, full version history, and per-cell edit history.
- **Imports & exports**: Import **CSV** files; export to **Excel (`.xlsx`)** or **CSV** (per worksheet) from **Share → Export** or CLI, plus portable `.zip` archives.

## How to use (for users)

### Create a spreadsheet
```text
/open-artifact sheets a monthly household budget with categories, actual vs plan, and totals
/open-artifact sheets a SaaS 12-month financial model with interactive pricing & churn sliders
/open-artifact sheets a hiring tracker with status dropdowns, checkboxes, and conditional formatting
```

### Edit, analyze & export
- **Direct cell editing**: Type values and formulas (`=SUM(...)`, `=IF(...)`, etc.), filter tables, add worksheets, or format cells right in the browser.
- **Comment on specific cells**: Select a cell or range (e.g. `B4:C6`), leave a comment (e.g. *"add a YoY growth column and chart it"*), and click **Send to agent**.
- **Audit changes**: Inspect version history or cell-level history to see how a number changed.
- **Export**: Open **Share → Export** to download an Excel (`.xlsx`) workbook or a worksheet as CSV.

## How to use (for agents)

- **Type ID**: `sheets` (`type_url: "open-artifact://type/sheets"`)
- **Storage model**: Structured operational workbook under `<root>/sheet/` (`sheet/sheet.json` + `sheet/edits.jsonl`). **Never edit these files directly**—always use the `read`, `update`, `batch`, and `widget` actions.

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/sheets/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/sheets", title, open: "after_first_write"}` | `open-artifact open <root> --type sheets --title "<title>" --json` |
| Read workbook / cells | `Artifact {action: "call", url, name: "read", args: {payload: {kind: "readSheets" \| "readCells" \| ...}}}` | `open-artifact read <root> '<payload>'` |
| Apply edits | `Artifact {action: "call", url, name: "update", args: {payload: {kind: "applyEdits", base: <rev>, edits: [...]}}}` | `open-artifact update <root> '<payload>'` |
| Add chart / interactive | `Artifact {action: "call", url, name: "batch", args: {calls: [...]}}` | `open-artifact batch <root> <file>` |
| Inspect selection | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root> [--json]` |
| Export XLSX / CSV | `Artifact {action: "call", url, name: "export", args: {file?: "<abs path>"}}` | `open-artifact export <root> [file.xlsx \| --csv --sheet <name>]` |

### Key rules for agents
1. Read `artifact-types/sheets/reference/core.md` (and `building.md` for tables, `charts.md` / `interactives.md` for visuals) before your first write.
2. Always read current cells before calling `writeCells` (writes cannot be undone and replace every cell in the block) and always pass the latest `base` revision (`0` on a brand-new empty folder). On a revision refusal, call `readSheets` and re-read before retrying.
3. Put the most important columns first (typical narrow panes show ~6 columns), place summary/input blocks above tables with an empty row between, and freeze rows down through the table header.
4. For dashboards with interactive assumptions (sliders/buttons), build an interactive panel on its own tab driving formula cells on a data tab.

For complete edit ops, formula functions, charts, and interactive panel specs, read [artifact-types/sheets/SKILL.md](../../artifact-types/sheets/SKILL.md) and `artifact-types/sheets/reference/`.
