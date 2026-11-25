# Page

[中文](page.zh-CN.md) · [All artifact types](../artifact-types.md)

**Page** is a free HTML page: one complete document the agent writes itself, kept as `index.html` in the artifact's folder with any files it loads beside it. It opens as a live local page you use and comment on. Use it for small interactive things no other type fits: a widget or tool, a calculator, a mini game, an explainer page, a poll, checklist or sign-up sheet that remembers what people do on it.

> **When NOT to use Page:** Don't use it for a slide deck ([Slides](slides.md)), a UI design or landing page to iterate on ([Design](design.md)), a dashboard from data ([Data](data.md)), a document ([Docs](docs.md)), a spreadsheet ([Sheets](sheets.md)) or an animated film ([Motion](motion.md)).

## Key features

- **Your own page, whole**: no template, framework or build step. The page's `<title>` is the artifact's title.
- **Runtime capabilities you declare**: the page asks `window.openArtifact.use("db")` (`window.claude` is the same object, for pages written for claude.ai) for a small shared database, uploads, a file to save, who is viewing, live messages between open views, and comments. Only what the agent declares is granted.
- **Live**: every open view reloads when `index.html` or the declaration changes; database writes show in every view at once.
- **Comments**: with `comments` declared, threads are kept beside the page and answered by the agent.
- **On a site too**: a page published to a site (self-hosted Node, or Cloudflare) runs there for everyone it is shared with, each person on a page host of their own; the database, comments and uploads sync both ways with this computer.

## How to use (for users)

```text
/open-artifact page a unit converter for cooking measures
/open-artifact page a team lunch poll that remembers everyone's vote
/open-artifact page a small memory game with emoji cards
```

Ask in plain words too ("make me a widget", "做个小游戏"): with no type word, the agent's quickstart picks `page` when nothing else fits.

## How to use (for agents)

- **Type ID**: `page` (`type_url: "open-artifact://type/page"`)
- **Storage model**: the folder itself. `<root>/index.html` is the page; other files beside it are served by relative URL. `<root>/db/` holds the database (one JSON file per document), `<root>/_blobs/` uploads, `<root>/comments.json` comments. The declared capabilities are kept in the artifact's record and in `<root>/.artifact.json`.
- **Runtime**: served by `frame-host` in page mode, on the artifact's own origin (`<id>.frame.localhost`). The type folder has no `index.html`; its manifest says `openArtifact.style: "page"`.

### Workflow & commands

| Task | Under daemon (MCP tools) |
| --- | --- |
| Create, declaring capabilities | `Artifact {action: "publish", type_url: "open-artifact://type/page", title, capabilities: {"db": true}, open: "after_first_write"}` |
| Write the page | Your file tools into `root`, or `Artifact {action: "publish", url, files: {"index.html": "…"}}` |
| Change the declaration | `Artifact {action: "publish", url, capabilities: {…}}` (files may be left out) |
| Read or write its database | `ArtifactData {action: "list" \| "get" \| "set" \| "batch", url, …}` |
| Look at it | `Artifact {action: "call", url, name: "snapshot", args: {width?, height?, scheme?}}` |
| Answer comments | `ArtifactComments` |

There is no standalone type CLI: a page needs the daemon to be served.

### The `capabilities` argument

| Given | Means |
| --- | --- |
| left out | Keep the current declaration. |
| `{}` | Declare none: only `artifact` and `permissions`. |
| `{"db": true, "assets": {}}` | The whole set from now on (replaces the previous one). |

`capabilities` is only for page artifacts: any other type answers `invalid_argument`. Values are `true` or an object of options (`false` declares nothing). The result of `publish` repeats the declaration in `capabilities` and, in `notes`, names any capability that only answers with an error here (`mcp`, `sample`, `tts`, `paste`) or that does not exist.

Capabilities served on this computer: `db`, `artifact`, `assets`, `downloads`, `comments`, `user`, `room`, `permissions`, `network`. With `network` declared, `await network.origins()` lists the external origins granted by the host to the type. The built-in page type has an empty list. Database snapshots are immutable, and unchanged documents keep their identity across listener updates. What each one does is in `artifact-types/page/artifact-type/reference/capabilities.md`, with TypeScript declarations beside it.

### On a site

A page goes to a site (`open-artifact publish <id>`, publishing by itself, or `Artifact share {cloud}` where the
person lets agents publish) when the site runs pages: its Link `hello` says `features.pages`. An older site, or one in
single-domain mode (`OA_CONTENT_SAME_SITE`), refuses it with `unsupported`, and the page stays on this computer. The
Cloudflare host runs pages as the Node site does ([Page artifacts](../hosting-cloudflare.md#page-artifacts)).

- **Where it runs**: the artifact's content host frames the inner shell (`art-<id>.<content domain>/page/<page token>/`),
  and the inner shell frames the page on a page host of the viewer's own, `art-<id>--<opaque>.<content domain>`. The
  page host serves the page's files, read only; every write and capability call goes through the inner shell.
- **Levels**: viewer reads, commenter also comments, editor also writes the database and the page's files (frame level
  `admin`), owner does everything. `db` rules apply as here. Guests are marked as guests; the page learns names and
  emails only as the `user` declaration allows.
- **What syncs**: `index.html` and the files beside it, `db/`, `comments.json` and `_blobs/`, both ways. The
  declaration travels on its own: a change made here goes to the site, and one the owner makes there (the site's MCP,
  owner only) comes back; open pages reload with it.
- **Network**: the site's `OA_PAGE_NETWORK` decides it for every page: `self` (default), the page's own origin only;
  `https`, any https origin too, and `network.origins()` then answers `["https:"]`.
- **Not on a site**: snapshots (pictures) are made on this computer from the working copy, as for other types.

### Key rules for agents

1. Write one self-contained document: inline CSS and scripts or put them in files beside it; a CDN may not load.
2. Give it a `<title>`.
3. Ask for each capability with `await window.openArtifact.use(name)` and handle `null`.
4. Keep state that must last or be shared in `db`, not `localStorage`.
5. Never write `.artifact.json`, `db/`, `history/`, `comments.json` or names starting with `.` or `_` yourself.
6. `artifact.publish(html)` from the page replaces `index.html` only if nobody changed it since that view loaded (else `conflict`); every view reloads.
7. Design it: nothing styles a page for you. Read the type's `artifact-type/reference/design.md` before writing the page (start from the subject and its real content, colour and type as tokens with a dark set, system fonts or font files beside the page, works from 360px wide, complete when loaded, designed loading and empty states), `diagrams.md` before a drawn figure and `charts.md` before a chart.
8. Look at it once before handing over: `Artifact {action: "call", url, name: "snapshot", args: {width: 400, height: 900, scheme: "dark"}}` returns the path of a PNG of the page (see below); also one read of what the page stored, and `name: "info"` for its files and declaration.

### A picture of the page (`snapshot`)

`Artifact {action: "call", url, name: "snapshot", args?}` draws the page in headless Chrome on this computer and answers `{image, width, height, scheme, bytes, note}`; `image` is the path of a PNG under `<root>/_agent/snapshots/` (the last 20 are kept). Every artifact of a page-kind type has it, your own types included.

| Argument | Values | Default |
| --- | --- | --- |
| `width` | 320 to 3840 | 1440 |
| `height` | 240 to 2160 | 900 |
| `scheme` | `light` or `dark` (the page's `prefers-color-scheme`) | `light` |

- **It only reads.** The snapshot is a visitor of its own with your view of the page: it can read the database, files and comments, and every write is refused. A page that writes as it loads (a visit counter, a seed) shows that write refused in the picture, where you would see it succeed.
- **Nobody sees it.** It is no participant for other open views, reloads none of them, wakes no agent, and its pictures are not served, archived, duplicated or synced to a site.
- **It does not wait forever.** The picture is taken once the page has drawn; an artifact with no `index.html` is pictured with its empty state, and a page that has not started within 8 seconds with its "did not start" card.
- **This computer only.** It needs Chrome, Chromium or Edge (`OPEN_ARTIFACT_CHROME` names another); without one the answer is `unsupported`. A page published to a site is drawn from its working copy here; a site makes no pictures.

### Design guidance

The type ships three short guides in `artifact-type/reference/`, beside `capabilities.md`, that the agent reads when the page calls for them:

| File | Covers |
| --- | --- |
| `design.md` | How much design a request wants, starting from the subject, tokens and both themes, type without remote fonts, layout down to phone width, the first frame and its loading, empty and cannot-save states, pages people operate, motion, wording, the looks a generated page falls into, changing an existing page. |
| `diagrams.md` | When a figure is worth drawing, what to draw (the mechanism, the difference between options, labelled arrows), and how to hand-write it as inline SVG that follows the theme. |
| `charts.md` | Whether it is a chart at all, the form for each job, one honest scale, marks, colour by job with a second signal beside colour, hover and accessibility, drawing without a remote library. |

You can ask for any of it by name ("make it less generic", "add a diagram of the flow", "chart the votes by day").

### Comments sent to the agent

A page can register a listener with `comments.onSendToAgent(fn)`. Listeners run in registration order. Return `{ handled: true, reply }` to finish a send on the page, or `{ reply, handoffNote }` to let the normal comment reach the agent with page context. The first nonblank reply (up to 500 UTF-8 bytes) and note (up to 2,000 bytes) are kept when no listener handles the send. The agent receives the note as quoted page data. The saved thread contains the person's own comment.

### Importing capabilities from an ES module

A page module can import a capability by name. A declared database supplies its synchronous document and collection builders immediately.

```js
import db from '/_/openartifact:db';
import use, { at } from '/_/openartifact:use';

if (db.available) {
  const doc = db.collection('votes').doc('first');
  const stop = doc.onSnapshot(snapshot => render(snapshot.data()));
  window.addEventListener('pagehide', stop, { once: true });
}
const room = await use('room');
if (room.available) room.on('vote', renderVote);
```

`at(name)` returns a stable reference synchronously. The default `use(name)` waits for the frame handshake and resolves to that same reference. Use `available` to check this viewer's declaration and grant. Calls on an unavailable reference reject with `not_granted`. An explicit contract can be requested with `/_/openartifact:db@0.2.92` or `at('db', {contract: '0.2.92'})`. The host accepts its current contract exactly. The page's existing `window.openArtifact.use(name)` still resolves to its namespace or `null`.

TypeScript pages can import `at` and the default `use` from `@open-artifact/server-sdk/frame/imports`. To use that specifier directly in a browser, place this import map before the page's module scripts. Both names then resolve to the host's accessor.

```html
<script type="importmap">
{"imports":{"@open-artifact/server-sdk/frame/imports":"/_/openartifact:use"}}
</script>
```

Check `ref.available` before using synchronous members such as `db.collection()`. The SDK types describe this host's page capabilities, including immutable database snapshots and the nullable sender identity in room events. Import `FramePageRuntime` from `@open-artifact/server-sdk/frame/page-api` as a type when passing the injected runtime to a page component.
