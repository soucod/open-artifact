# Documentation maintenance reference

Load this reference whenever adding, modifying, or removing features, artifact types, tools, CLI commands, plugins, or hosting capabilities.

## Core rule

**Documentation updates ship in the same change as code changes.** Never leave docs out of sync with the implementation, and never update only English or only Simplified Chinese when a bilingual pair exists.

## Documentation inventory

### Top-level & coding-agent docs

- `README.md` & `README.zh-CN.md` — Project landing page (overview, 8-type summary table, plugin install matrix, self-hosting links, dev/release basics, repo layout).
- `AGENTS.md` (included by `CLAUDE.md`) — Concise orientation, essential commands, mandatory doc sync rule, release rule, and progressive-loading index to `docs/references/`.
- `docs/references/*.md` — Deep contributor/coding-agent references (`architecture.md`, `artifact-types.md`, `build-test-release.md`, `docs-maintenance.md`).

### User & agent guides in `docs/` (all bilingual: `<name>.md` + `<name>.zh-CN.md`)

- **Core concepts & usage**
  - `docs/README.md` / `.zh-CN.md` — Documentation hub.
  - `docs/overview.md` / `.zh-CN.md` — What Open Artifact is, core advantages, workflow, quick start for users & agents.
  - `docs/artifact-types.md` / `.zh-CN.md` — Overview & comparison of all 9 artifact types, decision guide, storage models, cross-type workflows.
  - `docs/agent-guide.md` / `.zh-CN.md` — How AI agents use Open Artifact (decision rules, MCP tools, CLI fallback, lifecycle, comments & wake loop, safety rules).
- **Per-type guides (`docs/types/`)**
  - `slides`, `design`, `design-system`, `whiteboard`, `sheets`, `data`, `docs`, `motion`, `page` — Each has `<type>.md` and `<type>.zh-CN.md` covering purpose, key features, user workflow, and agent workflow.
- **Hosting & extensions**
  - `docs/hosting.md` / `.zh-CN.md`
  - `docs/hosting-lan.md` / `.zh-CN.md`
  - `docs/hosting-server.md` / `.zh-CN.md`
  - `docs/hosting-cloudflare.md` / `.zh-CN.md`
  - `docs/connecting-agents.md` / `.zh-CN.md`
  - `docs/plugins.md` / `.zh-CN.md`
- **Integrating Open Artifact into an agent product**
  - `docs/integrating.md` / `.zh-CN.md` — The integrator guide: levels 0–4, from the skill and the command line to the kit, embedded pages and the library.
  - `docs/integrating/{tools,wake,embedding,remote-types,runtime,non-node,security,testing,limits}.md` / `.zh-CN.md` — One topic each.
  - `docs/spec/{harness-api,embed,profile}.md` / `.zh-CN.md` — References: every Harness API method, feature, event and error; the Shell embed messages and `harness-kit/embed`; harness profile fields.

### Authoritative runtime skills & package docs

- `skills/open-artifact/SKILL.md` — Primary `/open-artifact` skill prompt loaded by agent apps (rendered from `packages/protocol/src/skill.ts`; never edit it by hand).
- `skills/open-artifact/reference/new-type.md` — The `/open-artifact new-type` guide to making an artifact type (English only, like the skill).
- `docs/custom-types.md` / `.zh-CN.md` — Making, checking, trying, turning off and trusting your own types.
- `artifact-types/<type>/SKILL.md`, `artifact-types/<type>/reference/*`, `artifact-types/<type>/artifact-type.json` — Authoritative type instructions and metadata.
- `plugins/README.md` and `plugins/<app>/README.md` — Per-agent-app plugin behavior, hooks, and install guides.
- `packages/host/README.md`, `packages/host-plugin/README.md`, `packages/editor-kit/README.md`, `packages/harness-kit/README.md`, `deploy/*/README.md`, `e2e/README.md`.
- `examples/README.md` and `examples/*/README.md` (English only).

## Detailed sync checklist by change type

1. **Feature added, changed, or removed in an existing artifact type** (e.g., new export/import format, new editor feature, new interactive capability, new storage field, new CLI/MCP action):
   - Update `artifact-types/<type>/artifact-type.json` (if `exports`, `description`, `uses`, `openEarly`, or `detect` changed).
   - Update `artifact-types/<type>/SKILL.md` and relevant `artifact-types/<type>/reference/*.md`.
   - Update `docs/types/<type>.md` AND `docs/types/<type>.zh-CN.md`.
   - If the change affects summary rows, imports/exports, or Design System support, also update `docs/artifact-types.md` & `.zh-CN.md`, `skills/open-artifact/SKILL.md`, and `README.md` & `README.zh-CN.md`.

2. **New artifact type added or an existing type removed**:
   - All items in (1), plus:
   - Create or remove `docs/types/<type>.md` and `docs/types/<type>.zh-CN.md`.
   - Update `docs/README.md` & `.zh-CN.md`, `docs/overview.md` & `.zh-CN.md`, `docs/artifact-types.md` & `.zh-CN.md`, `docs/agent-guide.md` & `.zh-CN.md`.
   - Update `README.md` & `README.zh-CN.md`, `skills/open-artifact/SKILL.md`, `plugins/README.md`, `docs/references/architecture.md`, and `docs/references/artifact-types.md`.

3. **MCP tools, `ShowArtifact`, CLI (`open-artifact.mjs`), or comment/wake behavior changed**:
   - Update `skills/open-artifact/SKILL.md`.
   - Update `docs/agent-guide.md` & `.zh-CN.md` and `docs/overview.md` & `.zh-CN.md` (if high-level flow changed).
   - Update `plugins/README.md` and `docs/references/architecture.md`.

4. **Agent plugin added, removed, or install/config steps changed**:
   - Update `plugins/<app>/README.md` and `plugins/README.md`.
   - Update `README.md` & `README.zh-CN.md` (install table) and `docs/overview.md` & `.zh-CN.md` if supported apps list changed.

5. **Self-hosting, remote linking, or host plugin API changed**:
   - Update the matching `docs/hosting*.md`, `docs/connecting-agents*.md`, or `docs/plugins*.md` (both EN and zh-CN).
   - Update `packages/host/README.md`, `packages/host-plugin/README.md`, or `deploy/*/README.md`.

6. **Harness API, `harness-kit`, Shell embed protocol, harness profiles, the stdio bridge, `doctor`, or the runtime and its updates changed**:
   - Update the matching page under `docs/integrating/` and `docs/integrating.md` (both EN and zh-CN).
   - Update `docs/spec/harness-api.md`, `docs/spec/embed.md` or `docs/spec/profile.md` (both EN and zh-CN). A new feature name goes in the features table of `harness-api.md`.
   - Update `packages/harness-kit/README.md` and the README of any `examples/harness-*` that shows it.
   - Move an item out of `docs/integrating/limits.md` & `.zh-CN.md` when it ships; add one when something is known not to work.

## Writing conventions

- **Dual audience**: Write `docs/` clearly for both humans (scannable tables, concrete examples, plain language) and AI agents (exact tool names, CLI commands, decision rules, constraints).
- **Bilingual parity**: Every `docs/<name>.md` pairs with `docs/<name>.zh-CN.md` and links to its sibling directly below the H1 heading (`[中文](...)` / `[English](...)`). Keep structure, facts, tables, and commands aligned.
- **Progressive disclosure**: Keep top-level pages (`README.md`, `AGENTS.md`, `docs/overview.md`, `docs/artifact-types.md`) concise and link out to `docs/types/*.md`, `docs/references/*.md`, and `artifact-types/*/SKILL.md` for deep details.
- **Grounded facts only**: Only document commands, tool actions, exports, imports, and features that actually exist in the codebase.
