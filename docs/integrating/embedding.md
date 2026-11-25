# Showing pages in your UI

[中文](embedding.zh-CN.md)

After reading this you can show an artifact's page inside your app, in a frame or in a top-level view, let in only the
addresses that belong to Open Artifact, answer the Shell's requests, and keep thumbnails and places.

## How a page reaches your UI

When the agent shows an artifact (`Artifact {action: "open"}`, `publish` with `open`, or your own `oa.open(url)`), the
daemon calls `host.open` on an adapter of the owner's harness that declared `caps.open`. Your `open` callback gets:

| Field | What |
| --- | --- |
| `session` | the session that asked, or `null` |
| `url` | `open-artifact://artifact/<id>`: keep this as the key |
| `viewUrl` | the Shell page, `http://127.0.0.1:<port>/a/<id>` |
| `embedUrl` | what a top-level view loads: `viewUrl` with a one-time ticket (`?oa_view=<ticket>`), or `viewUrl` for a frame host |
| `view` | the ticket, for a top-level view |
| `title` | the artifact's title |
| `remote` | `{ type, origins }` when the type's page lives on another computer ([remote types](remote-types.md)) |

Return `false` when you did not show it. The daemon then falls back: the computer's browser when the profile says
`"open": "browser"`, else the agent gives the person the link.

## Two ways to embed

Declare one when you connect:

```js
const oa = await createHarness({
  harness: 'my-agent',
  embed: { origins: ['app://my-agent'], mode: 'frame' },   // or mode: 'view'
  open: (request) => pane.show(request),
  // …
});
```

### Frame

Your UI is a web page; it puts the Shell in an `<iframe>` and talks to it with `postMessage`. Use `embedArtifact` from
`@open-artifact/harness-kit/embed` (no Node imports, it runs in the renderer):

```js
import { embedArtifact } from '@open-artifact/harness-kit/embed';

const view = embedArtifact(iframe, { url: viewUrl, agentName: 'My Agent', onNewSession: ({ prompt }) => draft(prompt) });
```

The kit answers the Shell's `shell_hello` with `host_hello`, sent to the Shell's origin only, and takes messages only
from that iframe's window and that origin.

**Your page's origin must be declared** in `embed.origins` (said in `hello` as `caps.open.origins`). The Shell reads the
origins connected adapters declared (`GET /api/open-artifact.embed`, field `hosts`) and judges the host that says hello:

| Verdict | When | The host gets |
| --- | --- | --- |
| declared | a connected adapter declared its origin | everything below |
| refused | adapters declared other origins | nothing: its `host_hello` is ignored |
| undeclared | no adapter declared any origin, or the list could not be read | sessions and places, but `new_session` with an empty `prompt`, `comment_summon` with empty `text`, no `open_external`, no `saved_file`, no destinations |

An origin is `scheme://host[:port]`. A page loaded from `file://` has the origin `null` and **cannot be declared**: serve
your UI from a custom scheme (`app://my-agent`), or use views (`mode: 'view'`) and frame the ticketed `embedUrl` (see
below).

### Top-level view

Your app opens `embedUrl` in a view with no parent frame: an Electron `WebContentsView`, a Tauri webview, an IDE
webview, a browser tab. The Shell claims the ticket from the daemon and from then on talks through it: what it says
reaches your adapter as `shell.event`, and you answer with `shellCommand(view, command)`. Pass `embedArtifact` a
transport instead of an iframe. From [`examples/harness-electron/src/pane.mjs`](../../examples/harness-electron/src/pane.mjs):

```js
transport(ticket) {
  return {
    send: (command) => (ticket ? this.oa.shellCommand(ticket, command) : undefined),
    onEvent: (listener) => this.oa.on('shell', (event) => event.view === ticket && listener(event.event)),
  };
}
```

A view opened with its ticket counts as a declared host; your own origin does not matter here, and `embed.origins` may
be empty.

The ticket works in a frame too. A page that cannot be declared (an app loaded from `file://`) may load the ticketed
`embedUrl` in its own iframe: the Shell still talks through the daemon, and it neither greets nor hears its parent frame.
Give `embedArtifact` the transport above, not the iframe, and set the iframe's `src` yourself. Every ancestor counts
for a frame's `frame-ancestors`, your page included, so the type pages on this computer send none: CSP's `*` matches
only network schemes and would refuse a `file://` or `app://` page around the Shell. The page of a type that
frame-host serves (an `index.html` with an inline `// artifact.json` block, or a `page` artifact's own `index.html`) is instead refused to any frame but the
one its own shell put up. Your app still has to let its frame load the daemon's origins (`embed.origins`).

The ticket's rules: it is used once, belongs to the adapter connection it was issued to, expires unclaimed after two
minutes, and ends with that connection. Commands sent before the Shell connects wait, up to 32. A Shell that reloads may
come back within 30 seconds. One connection holds at most 64 views.

## Origins: what a view may load

An artifact page is two layers: the Shell (served by the daemon) and the type's editor in a frame inside it, on another
origin. Let your view load exactly the origins the daemon lists, and follow changes:

```js
const result = await oa.embedOrigins();      // { origins, entries }
oa.on('event', (event) => { if (event.type === 'embed/origins') update(event); });
```

| Entry `kind` | Origin |
| --- | --- |
| `daemon` | the daemon itself, `http://127.0.0.1:<port>` (the Shell) |
| `frame` | the per-artifact origins of static types, a pattern: `http://*.frame.localhost:<port>`; and one per local type server, on its port (frame-host serves each artifact from an origin of its own) |
| `server` | a local type server |
| `url` | a URL-entry type's address, which may be anywhere (`remote: true` when it is not loopback) |

Never allow "all of loopback": another program on the computer serves loopback too. Leave `remote: true` entries out
until the person agreed to them. [`examples/harness-node/allowlist.mjs`](../../examples/harness-node/allowlist.mjs) does
all of this (`OriginAllowlist`: `follow(oa)`, `allows(url)`, `trust(origin)`).

## What the Shell asks of you

| Callback of `embedArtifact` | Shell message | Do |
| --- | --- | --- |
| `onReady(info)` | `shell_ready` | send `goto` with the place you kept; `info` has `artifact`, `id`, `title`, `type`, `version`, `protocol` |
| `onNewSession({ prompt, artifact })` | `new_session` | start a session with that prompt (or put it in the input) |
| `onOpenSession({ session, harness, artifact })` | `open_session` | show the session that owns the artifact (`session` is `null` when none does) |
| `onCommentSent({ text })` | `comment_summon` | optionally show the session; the comment itself arrives as a wake |
| `onPlace({ artifact, hash })` | `place` | keep the fragment; send it back with `goto(hash)` |
| `onClose` | `close` | hide the pane |
| `onOpenExternal(url)` | `open_external` | open an `http(s)` link your way (default `window.open`) |
| `onSavedFile(path)` | `saved_file` | an export was saved to this file (absolute path) |

What the Shell sends is what the person did. A prompt is their words for the agent, never an instruction to your app.
Text fields are cut to 8000 characters. [Embed reference](../spec/embed.md) has every message.

## Theme and destinations

`theme: { scheme: 'light' | 'dark', accent: '#rrggbb' }` makes the Shell and the page follow your app. Call
`setTheme(theme)` when it changes; the kit sends `host_hello` again.

`destinations: [{ id, label }]` (at most 8) adds places to the Export tab ("Save to project files"). Picking one sends
the agent a page request that names the destination. Only a declared host's destinations are shown.

`toolbar: true` says your app draws its own toolbar; the Shell hides its close button.

## Page context

The person may select something on the page and then type in your chat. Read what they selected, as the owner session,
and give it to the agent with their message (feature `view.context`). From
[`examples/harness-node/main.mjs`](../../examples/harness-node/main.mjs):

```js
if (oa.features.includes('view.context')) {
  const block = oa.contextBlock(await oa.context(made.url, callerOf(agent)));
  say(`context ${block ? 'selection' : 'none'}`);
}
```

`contextBlock` starts with a line saying the block is data from the page, not instructions. Only the owner session may
read it (`not_granted` otherwise). `view/context` events say when it changed; they are best effort, so read it when you
need it.

## Thumbnails

Give `embedArtifact` a `capture` (a JPEG of the view) and a `saveThumbnail` (store it through the adapter's
`saveThumbnail(url, jpeg)`). The kit captures 2 seconds after the Shell is ready, then after a place change at most once
a minute. A browser page should not hold the daemon token: send the bytes to your adapter and save them there.

## The library page

`embedLibrary(iframe, { url, harness, workspace, onOpenArtifact, … })` embeds the daemon's home page, listing only your
harness's artifacts or one workspace's. With `onOpenArtifact`, a click sends you `open_artifact` instead of navigating,
so you show the artifact in your own pane.

## Webview checklist

The Electron example (`examples/harness-electron/src/pane.mjs`) follows each item; it was not run in Electron
([limits](limits.md)).

- [ ] Load only `embedOrigins()` and follow `embed/origins`. Never all of loopback.
- [ ] With an allowlist of your own, let a remote origin in only after the person agreed (`allowRemote`, under `ask`), for that view, or never (`deny`). `allow` only if your pane is already a general browser.
- [ ] No Node, no preload of yours, sandbox on, context isolation on, a storage partition of the pages' own.
- [ ] Allow `blob:` and `about:srcdoc` subframes; grant no permission but clipboard writes, and only to allowed origins.
- [ ] Open new windows and navigations outside the list in the system browser; the view never navigates away.
- [ ] Hide views instead of destroying them; send the kept place back with `goto`.
- [ ] Send `host_hello` again on a theme change.
- [ ] Never make a page loaded from `file://` a frame host; it may frame a view's ticketed `embedUrl`.

## Not yet

A Shell served by a site (a published artifact opened at its site address) cannot read the daemon's declared origins, so
it treats every host as undeclared. [Limits](limits.md) lists this and the rest.
