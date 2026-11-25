# Docs

[中文](docs.zh-CN.md) · [All artifact types](../artifact-types.md)

**Docs** creates living, multi-tab rich-text documents backed by a block- and character-ID store (`doc/doc.json`). Use it for proposals, specs, project plans, reports, memos, handbooks, guides, meeting notes, and any document you want to write, review with tracked suggestions, comment on, share, and export.

> **When NOT to use Docs:** Don't use it for one-off answers read once in chat, for editing an existing `.docx` in place as Word, or for slide presentations (use [Slides](slides.md)).

## Key features

- **Tabs & nested subtabs**: Organize complex proposals, specs, or handbooks into multiple tabs and subtabs inside one artifact, with live cross-tab link chips.
- **Rich blocks & Mermaid diagrams**: Headings, paragraphs, bullet/numbered/check lists, tables, code blocks, quotes, horizontal rules, uploaded images, and fenced `mermaid` diagrams rendered live.
- **Inline smart chips**: Insert structured dates (`YYYY-MM-DD`), `@`-mentions, live tab links (which auto-update if a tab is renamed), and custom dropdown status lists (`enums`).
- **Tracked suggestions (Suggesting mode)**: Agents or collaborators can propose edits as suggestions that you accept or reject one by one—and comment directly on suggestions.
- **Live progressive drafting (`pending` blocks)**: Agents lay out a document skeleton with `pending` section placeholders, open the page immediately, and fill sections one by one while you watch.
- **Comments, reactions, find & replace, per-tab history**: Anchor comments to specific words or suggestions, react inline, search/replace across the tab, and inspect or restore per-tab version history.
- **Imports & exports**:
  - **Import**: Markdown (`.md`), plain text, **Word (`.docx`)**, and **PDF** (as a new doc or a new tab in an existing doc).
  - **Export**: **Markdown**, **Word (`.docx`)**, **PDF** (Letter or A4), and **HTML** from **Share → Export** or CLI, plus portable `.zip` archives.

## How to use (for users)

### Create or import a doc
```text
/open-artifact docs a 2027 hiring plan with tabs for Roles, Budget, and Timeline
/open-artifact docs import ./spec.docx and propose edits for clarity as suggestions
/open-artifact docs a technical RFC for migrating our auth service, including a Mermaid sequence diagram
```

### Edit, review suggestions & export
- **Write & organize**: Edit directly in the rich-text editor, add tabs/subtabs in the sidebar, insert dates, dropdowns, or checklists.
- **Review suggestions**: Accept or reject proposed edits inline, or pin comments on words/suggestions and click **Send to agent**.
- **Import files**: Ask your agent to import an existing `.md`, `.docx`, or `.pdf` as a new tab.
- **Export**: Open **Share → Export** to download Markdown, Word (`.docx`), PDF, or HTML.

## How to use (for agents)

- **Type ID**: `docs` (`type_url: "open-artifact://type/docs"`)
- **Storage model**: Structured tabbed block/character-ID store under `<root>/doc/` (`doc/doc.json`). **Never edit files under `<root>/doc/` by hand**—always call the type's actions.

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/docs/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/docs", title, open: "after_first_write"}` then `call` `create` | `open-artifact create <root> <birth-json>` (or `--markdown <file>`) |
| Import file | `Artifact {action: "call", url, name: "import", args: {file: "<abs path>", name?}}` | `open-artifact import <root> <file> [--name n]` |
| Read outline / view / search / history / suggestions | `Artifact {action: "call", url, name: "read", args: {call: {ref, payload: {kind: "outline" \| "view" \| "search" \| "markdown" \| "history" \| "suggestions"}}}}` | `open-artifact read <root> [<tab> [--view \| --search ... \| --markdown \| --suggestions \| --history]]` |
| Edit / propose suggestions | `Artifact {action: "call", url, name: "update", args: {call: {ref, payload: {ops: [...], ifRev?, suggest?: true}}}}` | `open-artifact update <root> '{"tab":"<tab>","ops":[...],"suggest":true}'` |
| Batch tabs / enums | `Artifact {action: "call", url, name: "batch", args: {call: ...}}` | `open-artifact batch <root> <call>` |
| Upload picture | `Artifact {action: "call", url, name: "upload", args: {file: "<abs path>"}}` | `open-artifact upload <root> <file>...` |
| Export | `Artifact {action: "call", url, name: "export", args: {format: "md" \| "docx" \| "pdf" \| "html", tab?, paper?, out?}}` | `open-artifact export <root> --format docx\|pdf\|html [--tab t] [--paper a4\|letter] [--out file]` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |

### Key rules for agents
1. **Skeleton first**: Create the doc with a title, headings, and `pending` blocks, show the page right away, and replace pending blocks one section per `update` so the user watches it fill live.
2. **Never write `<root>/doc/` directly** (and never use `Artifact publish` with `files` for Docs): always go through `create`, `read`, `update`, `batch`, `delete`, `import`, `export`.
3. **Pass `ifRev`** on updates to avoid overwriting concurrent user edits, and use `"suggest": true` when revising a user's existing prose unless they asked for direct edits.
4. Put chips (`<?oa block KEY?>`) cleanly in markdown with definitions in `blocks` (`pending`, `date`, `mention`, `dropdown`, `paragraph`).

For complete ops syntax, chip rules, tabs, and suggestion workflows, read [artifact-types/docs/SKILL.md](../../artifact-types/docs/SKILL.md) and `artifact-types/docs/reference/`.
