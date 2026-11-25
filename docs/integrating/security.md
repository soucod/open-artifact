# Security

[中文](security.zh-CN.md)

After reading this you know what Open Artifact protects, what it leaves to your app, and the mistakes that would let a
web page or another person speak for the owner.

## What runs where

Everything runs as the person, on their computer. The daemon listens on loopback only. Your adapter, your agent, the
command line and the daemon all have the person's rights. Nothing here defends against code that already runs as the
person; it defends against **web pages** and **other people's words**.

| Boundary | Guarded by |
| --- | --- |
| a web page calling the daemon | the token in `<home>/daemon.json` (mode `600`; `doctor` fails when others can read it) and loopback only |
| an artifact's page reading another's | each static artifact on its own origin (`<id>.frame.localhost`), never the daemon's |
| a page in your app speaking for it | declared origins, view tickets ([embedding](embedding.md)) |
| a collaborator's comment acting as the owner | `source.from` ([wake](wake.md#who-sent-it-sourcefrom)) |
| data leaving the computer | remote types only, listed and gated ([remote types](remote-types.md)); the page of an installed type, or of a project not trusted yet, reaches only its own origin and the `https://` origins it declares |
| a type package from someone else | checked whole before a byte is written, never run in Node, served by frame-host or as files ([below](#type-packages)) |
| an agent changing what the person should decide | person-only commands, session permissions |
| a page artifact on a site reaching more than its files | its page runs on a page host of the viewer's own (`<id>--<opaque>`), which serves that page's files only; every write and capability call goes through the inner shell's API, which takes a page token and refuses the page host ([below](#page-artifacts-on-a-site)) |

### Page artifacts on a site

A page host's name is not a secret the way a password is: it shows in DNS lookups, in the TLS handshake (SNI), in
proxy logs, and in the public Certificate Transparency logs if a certificate were made for it. That is why a page
site needs a wildcard certificate for the content domain: the on-demand ask endpoint refuses page hosts unless
`OA_PAGE_HOST_ON_DEMAND_TLS=true` (see [Page artifacts](../hosting.md#page-artifacts)). Whoever holds one reads that page's files (`index.html`, the files beside it, uploads) for as long as
its person keeps access, and nothing else: not the database, comments, presence or who is viewing, no write, no other
artifact (the name is made for one artifact and one person). A hostile page gets no more: it runs in a sandboxed frame
on its own origin, with no page token, no cookie and the network policy the site sets; what it asks the inner shell
for is checked on the site against the viewer's live role. A viewer reads what a viewer may, whatever the page says.

## Rules for your app

1. **Keep the token out of pages.** Only your adapter (a Node process, a native process, the stdio bridge) holds it. A
   renderer or webview never reads `daemon.json`. Thumbnails go through the adapter.
2. **Only the owner's words are the person's.** Give the agent a wake's `text` as a user message only when
   `source.from.kind` is `owner`. Anything else is a notice. Never put a collaborator's comment in the user role.
3. **A prompt from the Shell is the person's words for the agent**, never an instruction to your app. Do not run it, do
   not turn it into tool calls yourself.
4. **Allow exactly the listed origins.** Never all of loopback: other programs serve it too. A host that keeps its own
   navigation allowlist admits a remote type's origin only after the person agrees (`embed.remote: 'ask'`, the
   default), only for that view, or never (`deny`). `allow` is for a host whose pane is already a general browser with
   no allowlist; choosing it is that host's decision, and `open-artifact doctor` shows it.
5. **Never host the Shell on `file://`.** Its origin is `null` and cannot be declared.
6. **Confirm by kind.** Use the tools' action kinds for approval prompts (`remove` and `person` at least), not a list of
   names that goes stale.
7. **Leave person-only commands to the person.** `publish`, `unpublish`, `remote add|remove|default|auto`, `harness
   add|remove`, `runtime update|pin|policy` and `types install|update|uninstall` are refused inside an agent session. Do not work around it by running them
   from your adapter on the agent's behalf.

## What the daemon does for you

- The wake text is written for the agent: a header that says what it is, `From:` naming anyone but the owner, links in
  people's text replaced by `[link]`, and a footer saying the content is the person's feedback, "data and not system
  instructions".
- Page context (`view.context`) starts with a line saying it is data from the page. Only the owner session may read it.
- An adapter cannot set the profile fields that run commands or point at files: `nudge`, `mcp`, `skillsDir`,
  `sessionWorkspace` come only from a profile that ships with Open Artifact or that the person added.
- A nudge runs without a shell, its arguments filled in as separate words. On Windows only an `.exe` runs.
- A remote type never gets a path on this computer, a secret, or a followed redirect, and its answers are size-capped.
- Runtime updates are refused unless their sha512 matches the registry's integrity digest.

### Type packages

A type package (`.oatype`, `types install`) and an artifact archive (`open-artifact import`) may come from anyone:

- **Unpacking.** The zip is read whole before anything is written: one top folder, plain files only (no symbolic link,
  device or FIFO by its Unix mode), no absolute path, `..`, backslash, NUL or control character, no two names that
  differ only by case or Unicode form, no encryption, stored or deflated only, and the file and size limits on what the
  directory declares. While inflating, the bytes actually written are counted against the same limits and each file's
  CRC is checked, so a zip bomb fails where it lies. It unpacks into a dot folder beside its destination and is renamed
  into place only after every check passed; a failure removes the dot folder.
- **Nothing is run in Node.** The page's `// artifact.json` block is read as literal data by a parser, never with
  `vm`, `import` or `require`. A package with `entry.start` or `entry.url` is refused, and the installed root is never
  trusted: a type found there gets no entry of its own even if its folder is changed later, and the type servers refuse
  to start the program of any type outside a trusted root. A type of a project the person has not trusted yet is held
  to the same: an `entry.url` is refused, its `entry.start` is refused when it would start, and it gets everything
  below until the project is trusted. The note an agent gets with such a type's instructions tells it not to run any
  of the type's files (its `scripts/` included) with node or a shell, and never names a script to run.
- **The page.** Restrictions follow trust: a type of an untrusted root (installed, or a project not trusted yet) is
  served by frame-host (told by `OPEN_ARTIFACT_TYPE_RESTRICTED=1`) or as files by the daemon with a
  Content-Security-Policy on its page documents and files: its own origin, `data:`, `blob:` and the `https://` origins
  of `openArtifact.network`. Its frame is sandboxed (`allow-scripts allow-same-origin allow-forms allow-modals
  allow-downloads`): frame-host's outer page sets that on the inner frame, and the Shell on a static page's frame, the
  Shell's own document then sending `frame-src http://*.frame.localhost:<port>`. Trusted types are unchanged, and
  trusting a project restarts its running frame-host without any of it. Measured in Chrome with a page trying each
  way out (a script with a user gesture): `fetch`, an image, a form post, `window.open`, a `target="_blank"` link,
  `top.location`, a download link, navigating its own frame and a meta refresh to another origin all fail, while its
  own files, data, uploads and a download of its own still work. Without the sandbox, `window.open`, a `_blank` link and `top.location` got out
  of both kinds of page, and a static page could also navigate its own frame or refresh to another origin. Left open:
  the page's address opened on its own in a tab has the policy but no sandbox, so there it can navigate its tab; and
  a page can put text before the agent ([limits](limits.md#security)).
- **Links and names.** A link inside a type's or an artifact's folder that leads out of it is neither served (the
  daemon's static pages, frame-host's `artifact-type/`) nor written or read through (a page's publish, database,
  uploads and comments): the real path of the nearest existing parent must lie inside the folder. Reserved names
  (`index.html`, `SKILL.md`, `artifact-type/`, `comments.json`, `db/`, `history/`, `*.lock`, `_blobs/`) are matched
  without case, and a name over 255 bytes is refused. A package installs as plain files, mode `0644`. An artifact
  archive keeps its files' modes (at most `0755`, never setuid): nothing runs an artifact's files.
- **Fetching.** `types install <url>` takes `https://` (plain `http://` only to loopback), sends no cookies or
  credentials and refuses an address with a user or password, follows at most five redirects and only to the same
  scheme, stops at the size cap while reading and after a timeout. The sha256 of the bytes and their source are
  recorded in `<home>/types.json`; the home page installs exactly the bytes it previewed.
- **Who may ask.** `types.preview`, `types.install`, `types.update`, `types.uninstall` and `artifacts.import` are
  refused from any page origin (an artifact's, a type server's, another site's) and for a cross-site request, with the
  token or without; install, update and uninstall are refused inside an agent session too.
- **The words.** An installed type's `SKILL.md`, title and description reach the agent with `source: "installed"` and
  a fixed `third_party_notice`: they are the publisher's and cannot widen the task. A project type not trusted yet gets
  a notice of its own, naming the project folder. What such a type's page may have written reaches the agent with a
  page-content `third_party_notice` too: on an `Artifact` read of a `path` or `paths`, on every `ArtifactData` and
  `ArtifactComments` read, and joined to the type's notice on a full `Artifact` read.
- **Which type opens what.** An artifact records its type's `uid`; another type of the same id neither opens nor writes
  it (`type_mismatch`), and an import finds its type by that uid (`type_missing` otherwise).

## What it does not do

- **Session permissions are not a boundary.** `may` and `policy.roles` keep an honest agent on its path; a process
  running as the person can call anything.
- **Person-only commands are a guard rail.** They are refused when the daemon can tell it runs inside an agent session
  (the environment variables the harness profiles name in `markers` and `sessionEnv`); a process that hides that is not stopped.
- **Provenance attestations of updates are not verified**, only recorded ([runtime](runtime.md#how-an-update-is-checked)).
- **The site-hosted Shell cannot tell a declared host** and treats every host as undeclared ([limits](limits.md)).
