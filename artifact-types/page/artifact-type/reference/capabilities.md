# Runtime capabilities of a page

A page reaches Open Artifact through `window.openArtifact`: one frozen, read-only object the runtime defines before
the page's own scripts run. `window.openArtifact.use(name)` resolves to the capability's namespace,
or to `null` when it is not declared or not available here. A declared capability is also a property from the start
(`window.openArtifact.db`), but `use()` is the call that works everywhere.

`window.claude` is the same object, so a page written for claude.ai runs as it is. Write `window.openArtifact` in a
new page.

Declare capabilities with `Artifact` `publish`'s `capabilities` argument (see `SKILL.md`). `artifact` and
`permissions` are always there; every other one needs declaring.

Every call returns a promise. A failed call rejects with an `Error` whose `code` says why (`not_granted`,
`invalid_argument`, `conflict`, `too_large`, `unavailable`, …) and whose `message` is for people.

`openArtifact` is a taken global name: a top-level `const`, `let`, `class` or `function openArtifact` in a classic script
is a SyntaxError: call `window.openArtifact.use(…)`, or keep it under another name (`const oa = window.openArtifact`).
`claude` is not taken: `const claude = window.claude` at the top of a classic script works.

The TypeScript declarations are in `capabilities.d.ts` beside this file.

## Backed on this computer

### `db`: a small document database

Documents are JSON objects, at most 256 KB each, in collections: `collection/doc/collection/doc…` (an even number of
segments names a document). They are stored as files under `<root>/db/`, shared by every open view, and the agent
reads and writes the same documents with `ArtifactData`.

```js
const db = await window.openArtifact.use('db');
const doc = db.doc('settings/main');
await doc.set({ theme: 'dark' });            // replace
await doc.update({ counts: { visits: 1 } }); // merge into an existing document; {"__delete__": true} removes a field
const snap = await doc.get();                // snap.exists, snap.data(), snap.get('theme')
await doc.delete();

const notes = db.collection('notes');
const ref = await notes.add({ text: 'Hi', at: Date.now() });   // a new id
const list = await notes.where('done', '==', false).orderBy('at', 'desc').limit(50).get();
list.forEach((d) => console.log(d.id, d.data()));

const stop = notes.onSnapshot((s) => render(s.docs), (err) => console.warn(err.code));
// later: stop()
```

- `where` operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not-in`, `array-contains`. One `orderBy` per query;
  `limit` 1 to 1000.
- `onSnapshot` on a document or a query calls back at once and on every change, from this view, other views or the
  agent. `docChanges()` on a query snapshot lists what was added, modified or removed. At most 64 live at once.
- Snapshots and their document bodies are read-only. Clone a body before editing it. Unchanged documents keep the same identity between listener updates. Apply `docChanges()` in order; each index reflects any preceding changes.
- `doc.acquire({ ttlMs })` / `doc.release()`: a short lease, so only one view does something at a time.

### `network`

After declaring `network`, `await (await window.openArtifact.use('network')).origins()` returns a fresh array of external HTTPS origins granted to the type by its host. The built-in page type returns an empty array. The page's capability declaration cannot grant network access.

### `artifact`: the page itself

Always granted (also as `use('self')`).

- `id`: the artifact's id.
- `publish(html)`: replaces `index.html` with a whole new document. It is refused with `conflict` when the page
  changed since this view loaded it. Afterwards every open view reloads, this one too.
- `publish({ 'path': content, … }, { ifMatch })`: writes other files beside the page (text, a `Blob` or bytes;
  `null` deletes). `ifMatch` maps a path to the sha256 it must still have (or `null`: must not exist). The view keeps
  running; other views reload.
- `sync()`: `{ version, files }`, the current file list with each file's sha256.
- `metadata(['self'])`: this artifact's id, title and type.

### `assets`: files people add

- `upload(blob)`: stores a file the person picked or dropped (images, PDFs, audio, video, text; at most 20 MB) and
  resolves to `{ id, url, sizeBytes, contentType, createdAt }`. Use `url` in the page (`<img src>`).
- `list()`, `delete(idOrUrl)`.

### `downloads`: a file for the viewer to save

- `save({ filename, data })`: `data` is a string, a `Blob`, bytes, or anything JSON. The browser saves it.

### `user`: who is viewing

On this computer the viewer is always the owner.

- `me()`: `{ id, name, avatarUrl, color, email, isOwner, canEdit }` (here `email` is `null`).
- `id()`, `name()`, `isOwner()`, `canEdit()`, `can(permission)`, `profiles(ids)`, `access(ids)`.

### `room`: live messages between open views

Messages are not stored; use `db` for anything that must last.

- `emit(topic, data)` (at most 4 KB) and `on(topic, (data, from) => …)`.
- `presence(patch)`, `peers()`, `onPeers(fn)`: who has the page open, and what they share about themselves.
- `connected()`, `onConnection(fn)`, `join(name)`: a sub-room.
- `sendToAgentSession(data)`, `canSendToAgentSession()`: hand something to the agent's session.

### `comments`: threads on the page

Comment threads are kept in `<root>/comments.json`; the person writes them in the page, the agent answers with
`ArtifactComments`.

- `list()`, `create({ anchor, label, text })`, `reply(threadId, text)`, `resolve(threadId, resolved?)`,
  `delete(threadId, commentId?)`.
- `sendToAgent(…)`, `canSendToAgent()`: send a thread to the agent.
- `onSendToAgent(listener)` returns an unsubscribe function. Return `{ handled: true, reply }` to finish the send locally, or `{ reply, handoffNote }` to continue. The first valid reply (500 UTF-8 bytes) and page note (2,000 UTF-8 bytes) are kept on an unhandled send. The note is quoted as page data in the agent's message.
- `openComposer(…)`, `anchorFor(element, event)`, `customAnchors(…)`: let the page place comments itself.

### `permissions`

Always granted.

- `state(name?)`, `request(names?)`: here every declared capability is `granted`; for browser permissions (camera,
  microphone, …) the browser's own state.

## Declared, but not served on this computer

These names are accepted in `capabilities`, and `use()` gives a namespace, but every call rejects with this code.
Write the page so it still works.

| Capability | Error code |
| --- | --- |
| `mcp` | `server_not_connected` |
| `sample` | `tools_unavailable` |
| `tts` | `capability_disabled` |
| `paste` | `capability_disabled` |

Any other name is unknown here: `use()` resolves to `null`, and `publish` says so in its `notes`.
