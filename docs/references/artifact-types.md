# Artifact types developer reference

Load this reference when modifying an existing artifact type, adding a new type, or working on `artifact-types/`, `type-server`, or `*-core` / `*-editor` packages.

## Built-in artifact types & storage styles

Open Artifact supports three storage architectures across its 8 editor-backed built-in types, plus the free page (`page`), the ninth:

| Style | Types | On-disk layout | How agents write |
| --- | --- | --- | --- |
| **Project files (`project`)** | `slides`, `design`, `design-system` | Index JSON + content files under `<root>/project/` (e.g., `project/deck.json`, `project/canvas.json`, `project/design-system.json`) | Direct file writes under `<root>/project/` (or `Artifact publish`), plus `check` / `upload` actions. |
| **Live document store (`db`)** | `whiteboard`, `data`, `motion` | Small JSON documents under `<root>/db/<collection>/<id>.json`, synced via `@open-artifact/live-store` | `ArtifactData` (`get`/`list`/`query`/`set`/`update`/`delete`/`str_replace`/`batch`) or standalone `open-artifact write-db`. |
| **Operational log / structured store (`sheet` / `doc`)** | `sheets`, `docs` | `sheet/sheet.json` + `sheet/edits.jsonl` (Sheets); `doc/doc.json` + character/block-ID tabs (Docs) | Structured `Artifact {action: "call", name: "read" \| "update" \| "batch" \| ...}` or standalone CLI commands; never hand-edit raw store files. |
| **Free page** | `page` | The folder itself: `<root>/index.html` written whole by the agent, files beside it; data through the runtime capabilities it declares (`db/`, `_blobs/`, `comments.json`) | File writes (or `Artifact publish`), capabilities through `publish`'s `capabilities` argument. |

Shared folder conventions across all types:
- `<root>/_blobs/` — Content-addressed uploads (`/_blob/<sha256-prefix>`). Managed via `upload` / `delete-asset`; agents never write here directly.
- `<root>/_agent/` — Local page-to-agent request channel.
- `<root>/comments.json` — Comment threads.
- `<root>/history/` — Version history snapshots.
- `<root>/.artifact.json` — Local server metadata.

## Anatomy of an `artifact-types/<type>/` folder

| File / Dir | Tracked in git? | Purpose |
| --- | --- | --- |
| `artifact-type.json` | Yes | Machine-readable manifest read by the daemon and hosts: `slug`, `name`, `title`, `description`, `intents`, `when`, `detect`, `titleFrom`, `entry`, `openArtifact` (`style`, `store`, `comments`, `exports`, `uses`, `openEarly`). |
| `SKILL.md` | Yes | Authoritative instructions returned to agents when creating/editing an artifact of this type. |
| `reference/` | Yes | Progressive-loading format/craft/workflow docs referenced by `SKILL.md`. |
| `scripts/` | No (gitignored) | Built output copied from `dist/server/` by `npm run build` (`cli.mjs`, `support.js`, `editors/`, `sheets.wasm`, etc.) so the type folder can run standalone. |

## Page types (`openArtifact.style: "page"`)

`artifact-types/page/` has no `index.html`, no `scripts/` and no `*-core` / `*-editor` pair. Its manifest sets
`openArtifact.style: "page"`, which `entryOf` (`packages/daemon/src/types.ts`) resolves to frame-host (runtime `frame`).
frame-host then runs in page mode (`ctx.page` in `packages/server-sdk/src/frame/local.ts`, `FrameEnv.page` in `core.ts`):

- The page is the artifact's own root `index.html` (an empty state while it is missing), and `index.html` is the
  artifact's file, so the page's `artifact.publish(html)` may replace it (compare-and-set on the view's `ver`).
- The declaration is `{key: "page", capabilities}`, the capabilities read only from `<root>/.artifact.json`
  (`pageDeclaration`); a change of the marker rewires the site. A `// artifact.json` block in the page is ignored.
- The page's `<title>` becomes the artifact's title (frame `touch`, and `titleFrom: "index.html"` in the daemon).
- The daemon keeps the declaration in the record and the marker (`ArtifactStore.setCapabilities`); only page types take
  the `capabilities` argument. `LinkHub` publishes a page only to a site whose `hello` says `features.pages` (`PAGE_NO_SITE` otherwise), and keeps its declaration in step by `link.capabilities` and the `artifact` event; a Node site runs it in `packages/host/src/node/frames.ts`.
- `page` is in `BUILTIN_TYPE_IDS`, but not in type-server `TYPES` nor `EDITORS` in `scripts/build.mjs`;
  `scripts/vendor-types.mjs` skips the `scripts/cli.mjs` shim for it.

## Custom types (frame types people make)

A folder in a user, extra or trusted project root with an `index.html` whose first 64 KB hold a `// artifact.json`
block (`hasInlineDeclaration`) runs on frame-host in type mode: the page and `artifact-type/` are the type's
(read-only to the page, `typePath` in `packages/server-sdk/src/frame/files.ts`), every other relative URL is the
artifact's folder, and `artifact.publish(html)` is refused.

- **Authoring** (`packages/daemon/src/type-authoring.ts`, shapes in `packages/protocol/src/type-authoring.ts`):
  `newType` (the `page` and `data` starters, `starterFiles`), `typeFromPage` (a `page` artifact's `index.html` and
  `artifact-type/`, its record's capabilities as the inline declaration), `checkType` (errors and warnings by stable
  `code`, plus `--for-share` limits `TYPE_SHARE_LIMITS`), `setTypeEnabled` (`disabledTypes`) and `setProjectTrusted`
  (`trustedProjects`). The CLI is `open-artifact types new | check | from | enable | disable | trust | untrust | list`;
  the Library routes are `types.new`, `types.check`, `types.from`, `types.enable`, `types.disable`, `types.trust`.
- **The declaration, statically** (`packages/protocol/src/declaration.ts`): `declarationSource` finds the block (to
  the next full-line `//` comment, or 64 KB) and `readStaticDeclaration` parses it as literal data without running it.
  frame-host still evaluates the block in a V8 context (`packages/server-sdk/src/frame/declaration.ts`), which sees
  only `var`; `types check` reports `let`/`const` (`declaration_lexical`). `packages/server-sdk/test/declaration-parity.test.ts`
  keeps the two in step.
- `manifest.uid` names a type apart from others of the same id (`types new` and `types from` write one).
- The guide for agents is `skills/open-artifact/reference/new-type.md` (`/open-artifact new-type`, the `NEW_TYPE_TEXT`
  section of `packages/protocol/src/skill.ts`). People's guide: `docs/custom-types.md`.

## Cross-type composition (`uses`)

Types declaring `"uses": ["design-system"]` in `artifact-type.json` (`slides`, `design`, `data`, `motion`) can install a `design-system` artifact so their editors expose brand tokens, colors, fonts, and (for `design`) mounted component bundles.

## `version` and `entry`: what integrators see

- **`version`** in `artifact-type.json` is recorded as the release that last wrote each artifact (`typeRelease`, and `release` in `.artifact.json`). On a computer whose installed type is older, that artifact is read-only: the agent's writes are refused with `newer_release`, the Shell says how to update, and the type server serves every visitor as a viewer (`packages/daemon/src/release-guard.ts`). Raise `version` when a change of format must not be written over by an older release.
- **`entry`** as a URL on a host other than loopback makes the type **remote**: its page and actions run on another computer, every place that lists the type says so (`remote`, `origin`), and agent apps gate its pages (`docs/integrating/remote-types.md`). No secret and no local path (`root`, `{root}`) is sent to a remote type.

## Checklist for adding a new artifact type

1. **Core & Editor packages**:
   - Create `packages/<type>-core` (schema, validation, checks, pure logic testable in `node --test`) and `packages/<type>-editor` (Vite + React editor adopting `@open-artifact/ui` and `@open-artifact/editor-kit`).
2. **Server & Build integration**:
   - Register the type in `packages/type-server` (server routes, actions, scaffold, check/export handlers).
   - Add `<type>: 'packages/<type>-editor'` to `EDITORS` in `scripts/build.mjs`.
   - Ensure `packages/daemon` type discovery and `packages/host` / `packages/host-cloudflare` support the type's storage style if new.
3. **Type skill & manifest**:
   - Create `artifact-types/<type>/artifact-type.json`, `artifact-types/<type>/SKILL.md`, and `artifact-types/<type>/reference/*.md`.
4. **Tests**:
   - Add unit tests in `packages/<type>-core/test/` and `packages/<type>-editor/test/`.
   - Add an E2E suite `e2e/<type>.test.mjs` and test fixture in `test-artifacts/<type>/`.
5. **Documentation sync (mandatory)**:
   - Update `skills/open-artifact/SKILL.md`.
   - Add `docs/types/<type>.md` and `docs/types/<type>.zh-CN.md`.
   - Update `docs/artifact-types.md` & `.zh-CN.md`, `docs/README.md` & `.zh-CN.md`, `README.md` & `README.zh-CN.md`, `plugins/README.md`, and this file.
