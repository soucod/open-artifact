# Notes for coding agents

Open Artifact is an open, local-first platform that lets any coding agent produce live, editable, commentable artifacts
(slides, UI designs, design systems, whiteboards, spreadsheets, data dashboards, docs, and animated films) stored as
plain folders on disk.

> Keep this file concise. Load files in `docs/references/` only when your task touches that area.

## Workspace at a glance

| Path | Role |
| --- | --- |
| `artifact-types/<type>/` | Self-contained type skills (`SKILL.md`, `reference/`, `artifact-type.json`, built `scripts/`). |
| `skills/open-artifact/` | Unified `/open-artifact <type>` skill + vendored daemon. |
| `packages/` | Core platform (`daemon`, `shell`, `protocol`, `runtime`, `type-server`, `server-sdk`, `live-store`, `host*`, `harness-kit`), 8 type pairs (`<type>-core` + `<type>-editor`), shared UI/canvas/export kits, and `wasm-*` bindings. |
| `crates/` | Rust crates compiled to WebAssembly (`packages/wasm-*/generated/` is committed). |
| `plugins/` | Per-app agent plugins (`claude-code`, `codex`, `cursor`, `copilot`, `antigravity`, `zcode`, `dsh`, `chatgpt`). |
| `examples/` | Runnable agent-app integrations (`harness-node`, `harness-electron`, `harness-stdio`) and host plugins. |
| `docs/` | Bilingual user & agent guides (`*.md` and `*.zh-CN.md`), `docs/types/`, the integrator guide (`docs/integrating*`, `docs/spec/`), and contributor `docs/references/`. |
| `scripts/` | Build, plugin packaging, WASM, npm staging/publishing, and changelog scripts. |
| `e2e/` | End-to-end tests driving built artifact types via CLI and Chrome DevTools Protocol. |

## Essential commands

```bash
npm run build                  # Build CLI, support.js, all 8 editors, Shell, frame-host, DSH plugin
npm run build -- --only cli    # Partial build: cli|support|editors|types|shell|frame|dsh (sea: single executable, only when asked)
node scripts/build-plugins.mjs # Build unified skill + dist/plugins/<name>/
npm run typecheck              # TypeScript check across the workspace
npm test                       # Unit tests (node --test)
npm run check                  # typecheck + unit tests
npm run e2e                    # Full E2E suite (supports: --only <suite>, --no-browser)
npm run test:sea               # Build and test the single executable (official Node 25.5+; not in npm test)
open-artifact doctor --harness <name> [--session <id>]   # Check a setup; with --session, an app's conformance run
node scripts/build-wasm.mjs    # Only needed when modifying Rust crates in crates/
```

Node.js **22.18+** is required.

## Documentation sync rule (mandatory)

Whenever you **add, remove, or modify** a user-facing or agent-facing feature, you MUST update the corresponding
documentation in the same change—both English (`*.md`) and Simplified Chinese (`*.zh-CN.md`).

| If you change… | Update these docs |
| --- | --- |
| An artifact type's features, commands, format, imports, or exports | `artifact-types/<type>/SKILL.md` (+ `reference/`), `artifact-types/<type>/artifact-type.json`, `docs/types/<type>.md` & `.zh-CN.md`, and `docs/artifact-types.md` & `.zh-CN.md` (plus `README.md` & `README.zh-CN.md` if summary/exports change). |
| Add or remove an artifact type | All of the above, plus `skills/open-artifact/SKILL.md`, `docs/README.md` & `.zh-CN.md`, `README.md` & `README.zh-CN.md`, `plugins/README.md`, and `docs/references/artifact-types.md`. |
| MCP tools, CLI commands, hooks, or comment/wake behavior | `skills/open-artifact/SKILL.md`, `docs/agent-guide.md` & `.zh-CN.md`, `plugins/README.md`, and `docs/references/architecture.md`. |
| The Harness API, `harness-kit`, the Shell embed protocol, harness profiles, or `examples/harness-*` | `docs/integrating*.md` and `docs/integrating/` (EN & zh-CN), `docs/spec/` (EN & zh-CN), `packages/harness-kit/README.md`, the example's README. |
| Agent app plugins or install steps | `plugins/<app>/README.md`, `plugins/README.md`, `README.md` & `README.zh-CN.md`. |
| Self-hosting, remotes, or host plugins | `docs/hosting*.md`, `docs/connecting-agents*.md`, `docs/plugins*.md` (both EN & zh-CN), `packages/host/README.md`. |
| Build scripts, workspace packages, or release workflow | `AGENTS.md`, `docs/references/build-test-release.md`, `docs/references/architecture.md`. |

See [docs/references/docs-maintenance.md](docs/references/docs-maintenance.md) for the full checklist and writing conventions.

## Releasing

Every release gets a `CHANGELOG.md` entry written from commit history; the Publish to npm workflow refuses a tag
without one and uses the entry as the GitHub release notes.

1. Raise the version everywhere it is kept (`@open-artifact/*` packages, `plugins/dsh`, every plugin manifest, and
   the marketplaces share one version).
2. Run `node scripts/changelog.mjs` to list commits since the last `v*` tag (`node scripts/changelog.mjs <from> <to>`
   for another range).
3. Add a `## [x.y.z] - YYYY-MM-DD` section at the top of `CHANGELOG.md` (one-line summary, then `### Added`,
   `### Changed`, `### Fixed`, and `### Removed` when needed), plus the compare link at the bottom. From 0.14.0, a
   release that changes what integrators see (the Harness API, Shell and wake messages, `harness-kit`, shipped harness
   profiles, the stdio bridge) also needs `### Integrators`; `--check` names the files.
4. Check it with `node scripts/changelog.mjs --check x.y.z` (a shallow clone skips the Integrators rule with a
   warning; the publish workflow fetches full history, so it checks it), commit, tag `vx.y.z`, and push the tag.

## Progressive-loading references

Read these only when relevant to your task:

- [docs/references/architecture.md](docs/references/architecture.md) — Platform architecture, package responsibilities, MCP & wake flow, hosting, WASM crates.
- [docs/references/artifact-types.md](docs/references/artifact-types.md) — Storage models, `artifact-type.json`, editor/core split, adding or modifying a type.
- [docs/references/build-test-release.md](docs/references/build-test-release.md) — Build pipeline details, WASM & plugin builds, testing, npm publishing & release checks.
- [docs/references/docs-maintenance.md](docs/references/docs-maintenance.md) — Full documentation inventory, sync rules, bilingual parity, and style guide.
- [docs/README.md](docs/README.md) — User & agent documentation index (EN / zh-CN).
