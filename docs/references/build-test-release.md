# Build, test, and release reference

Load this reference when building packages/plugins/WASM, running tests, or preparing an npm / GitHub release.

## Prerequisites

- **Node.js 22.18+** (workspace uses native TypeScript stripping for tests/scripts and Node's built-in `node:test`).
- **Rust toolchain** (only when editing `crates/`): `cargo`, `wasm32-unknown-unknown` target, `wasm-bindgen`, `wasm-opt`.
- **Chrome / Chromium** (for browser checks in `npm run e2e` and Motion `stills`).

## Build pipeline

```bash
npm ci                         # Install workspace dependencies
npm run build                  # Full build: cli, support, editors, types, shell, frame, dsh
node scripts/build-plugins.mjs # Build unified skill + dist/plugins/<name>/ + marketplace manifests
```

### Partial builds

- `node scripts/build.mjs --only <part>` where `<part>` is one of:
  - `cli` — bundles `dist/server/cli.mjs` (type server + standalone CLI)
  - `support` — bundles `dist/server/support.js` (`.dc.html` runtime)
  - `editors` — runs Vite builds for all 8 editors in `packages/*-editor` (each in its own process)
  - `types` — copies `dist/server/` into every `artifact-types/<type>/scripts/`
  - `shell` — builds `dist/daemon/shell/` and `dist/daemon/home/`
  - `frame` — builds `dist/daemon/frame-host/`
  - `dsh` — builds `plugins/dsh/` (`lib/`, the vendored daemon in `vendor/`, and the launcher `scripts/open-artifact.mjs` that makes the folder a runtime folder)
  - `sea` — the single executable `dist/sea/open-artifact-<platform>-<arch>` for this platform (`scripts/build-sea.mjs`; `--node <file>` or `OPEN_ARTIFACT_SEA_NODE` picks the Node to embed, an official build of Node 25.5+). Never part of the full build; needs `npm run build` and `node scripts/build-skill.mjs` first.
- `node scripts/build-plugins.mjs --only <app>` — builds one plugin (`claude-code`, `codex`, `cursor`, `copilot`, `antigravity`, `zcode`, `chatgpt`). Pass `--no-skill` to reuse an already-built skill.
- `node scripts/build-wasm.mjs` — compiles Rust crates under `crates/` and updates committed output under `packages/wasm-*/generated/`.

## Testing & verification

```bash
npm run typecheck                     # tsc -p tsconfig.json
npm test                              # node --test across packages/*, plugins/dsh, plugins/zcode, examples/host-plugins, examples/harness-node, examples/harness-stdio, scripts
npm run check                         # typecheck + unit tests
npm run e2e                           # Full E2E suite (requires npm run build first)
npm run e2e -- --only slides,docs     # Run selected E2E suites
npm run e2e -- --no-browser           # Skip Chrome DevTools checks (E2E_BROWSER=0)
npm run e2e -- --keep                 # Keep temp artifact directories and print their paths
npm run e2e -- --only harness-compat  # Agent-app hosts built from examples/harness-node against a real daemon
npm run e2e -- --only type-packages   # Two daemons in two temporary homes: pack on one, install and open on the other, import back
npm run test:sea                      # Build and run the single executable with no node on PATH (not in npm test or e2e)
```

`examples/harness-node` and `examples/harness-stdio` (Python; skipped without `python3`) run against a real daemon in a
temporary home as part of `npm test`. `open-artifact doctor --harness <name> --session <id> --json` is the conformance
run an agent app can put in its own CI (`docs/integrating/testing.md`).

E2E tests copy built `artifact-types/` folders into isolated temporary directories outside the repo and drive them with Node's WebSocket client over Chrome DevTools Protocol (see `e2e/README.md`).

## Releasing

`node scripts/build-npm.mjs` stages publishable packages into `dist/npm/`: the `@open-artifact/*` libraries, `@open-artifact/cli`, and `dsh-open-artifact`.
`@open-artifact/cli` is the skill folder: its `files` are `scripts/`, `vendor/`, `reference/` (the skill's guides, such as `new-type.md`) and `SKILL.md`.
The libraries are compiled with `tsc` (`rewriteRelativeImportExtensions`, which fixes `./x.ts` imports in the emitted JavaScript only); the script then rewrites relative `.ts`/`.tsx`/`.mts`/`.cts` specifiers in every staged `.d.ts` (compiled or authored) to `.js`/`.js`/`.mjs`/`.cjs` (`scripts/declaration-specifiers.mjs`, tested by `scripts/declaration-specifiers.test.mjs`) and fails the build if one is left.

1. **Bump versions in lockstep**: every `@open-artifact/*` package, `plugins/dsh`, every plugin manifest, and marketplace manifests share one version.
2. **Gather commits**: run `node scripts/changelog.mjs` (lists commits since last `v*` tag; pass `<from> <to>` for a custom range).
3. **Update `CHANGELOG.md`**: add `## [x.y.z] - YYYY-MM-DD` at the top with a one-line summary and user-facing `### Added`, `### Changed`, `### Fixed` (and `### Removed` when applicable) sections. Merge related commits; omit release bookkeeping and purely internal refactors. Add the compare link at the bottom:
   `[x.y.z]: https://github.com/JimLiu/open-artifact/compare/v<prev>...vx.y.z`
   From 0.14.0, when a file in `INTEGRATOR_PATHS` (`scripts/changelog.mjs`: `packages/protocol/src/{harness,wake,shell}.ts`, `packages/harness-kit/src/`, `packages/daemon/harnesses/`, `packages/daemon/src/stdio-bridge.ts`) changed since the previous tag, the entry also needs `### Integrators` saying what changed for apps built on the Harness API or the kit (or that nothing they use did).
4. **Verify changelog**: `node scripts/changelog.mjs --check x.y.z` (it fails a release that needs `### Integrators` and lacks it, naming the files; in a shallow clone it skips that rule with a warning). The Publish to npm workflow checks out with `fetch-depth: 0`, so there the rule is always checked.
5. **Commit, tag, and push**: tag `vx.y.z` and push the tag. `.github/workflows/publish-npm.yml` validates the changelog entry, publishes new versions to npm via trusted publishing, attaches `open-artifact-plugins.zip` to the GitHub Release, and uses the changelog entry as release notes.

Local/first-time npm helpers:
- `node scripts/publish-npm.mjs --dry-run` — preview local npm publishing.
- `node scripts/publish-npm.mjs --claim` — claim a brand-new npm package and register the GitHub Actions workflow as its trusted publisher.
