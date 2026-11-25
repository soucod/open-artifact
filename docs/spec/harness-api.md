# Harness API reference

[中文](harness-api.zh-CN.md)

This page lists every method, notification, event, feature and error of the Harness API, protocol 1. The TypeScript
types are in `packages/protocol/src/harness.ts` (`AdapterToDaemon`, `DaemonToAdapter`, `HarnessEvent`). For what to do
with them, start at [Integrating Open Artifact](../integrating.md).

## Transport

| | |
| --- | --- |
| WebSocket | `ws://127.0.0.1:<port>/__harness`, subprotocol `open-artifact-harness` |
| Messages | JSON-RPC 2.0; both sides send requests |
| Port and token | `<home>/daemon.json` (`port`, `token`, `pid`, `version`) |
| stdio | `open-artifact harness --stdio --harness <name>`: the same methods as JSON lines ([other languages](../integrating/non-node.md)) |
| HTTP polling | [below](#http-polling) |

The first request must be `hello`. Anything else before it is refused `unauthorized`.

## Versions and the compatibility promise

`PROTOCOL_MIN` and `PROTOCOL_MAX` are both `1`. The adapter says the versions it speaks in `hello` (`protocols: { min,
max }`; left out means 1); the daemon answers with the highest both speak. When none is shared, `hello` fails with
`unsupported_protocol` and a fix line saying which side to upgrade.

Within one protocol version, methods, optional fields, events and feature names are only ever **added**. Check a
feature by name before using it; never compare daemon versions. Ignore fields and events you do not know.

From 0.14.0, every release whose Harness API, Shell or wake messages, kit, shipped profiles or stdio framing changed has
an `### Integrators` section in [CHANGELOG.md](../../CHANGELOG.md) saying what changed for you.

## Features

`hello`'s answer lists `features`. A daemon lists only what it implements.

| Feature | The daemon |
| --- | --- |
| `hello.profile` | keeps the profile an adapter reports in `hello` |
| `skill.get` | answers `skill.get` |
| `commands.list` | answers `commands.list` |
| `embed.origins` | answers `embed.origins` and sends `embed/origins` events |
| `shell.command` | answers `shell.command` |
| `shell.event` | calls `shell.event` for top-level views |
| `view.context` | answers `view.context` and sends `view/context` events |
| `session.may` | enforces `session.attach`'s `may` and `role` |
| `wake.drafted` | takes the answer `drafted` |
| `wake.session` | takes `{ status, session }` and moves ownership to that session |
| `wake.from` | puts `reason` and `from` in a wake's `source` |
| `tools.actions` | gives each tool's `actions` (action → kind) in `tools.list` |
| `quickstart.steps` | `quickstart` answers `steps`, `existing`, `rules`, `replaces`, and takes `type` |
| `types.remote` | describes types with `remote` and `origin`, gives `remoteActions`, and puts `remote` in `host.open` |
| `hello.runtime` | records `hello`'s `runtime` and starts the newest compatible runtime |
| `runtime.update` | answers `runtime.status` and `runtime.update`, and sends `runtime/update` events |
| `types.source` | describes types with `source` (`builtin`, `local`, `installed`) and, for an installed one, `installed_from` and `third_party_notice`, wherever types are listed and when an artifact is read; puts `third_party_notice` next to `instructions` when one is created or adopted; a project type not trusted yet gets its own `third_party_notice`, and reads of an artifact of either (`Artifact`, `ArtifactData`, `ArtifactComments`) add a page-content one |

`session.*`, `tools.list`, `tools.call`, `agent.wrote`, `artifact.open`, `inbox.take`, `inbox.wait` and `subscribe` are
the base protocol and need no feature.

## `hello`

| Param | Type | |
| --- | --- | --- |
| `harness` | string | `^[a-z0-9][a-z0-9._-]{0,40}$` |
| `token` | string | from `daemon.json` (not over stdio) |
| `caps` | `AdapterCaps` | below |
| `protocols` | `{ min, max }` | |
| `kit` | `{ name, version }` | the SDK you build on |
| `profile` | part of a [profile](profile.md) | kept when the daemon lists `hello.profile`; never `nudge` |
| `runtime` | `{ dir, version, update? }` | the runtime you carry ([runtime](../integrating/runtime.md)) |

Result: `{ protocol, daemon, connection, features }`.

### `AdapterCaps`

| Field | Type | Means |
| --- | --- | --- |
| `wake` | `{ resume?, mode?: 'auto' \| 'draft' }` | you take `wake.deliver`; `resume`: you can bring back a closed session; `draft`: you put the text in the input |
| `open` | `true` or `{ embed: 'frame' \| 'view', origins, remote?: 'allow' \| 'ask' \| 'deny' }` | you take `host.open` |
| `agentName` | string | what your app calls its agent |
| `tools` | `'cli' \| 'mcp' \| 'native'` | how your agent reaches the tools |
| `commands` | `{ names, menu? }` | your command names; `menu`: you list one entry per type |
| `library` | `'home' \| 'cards' \| 'own'` | where the person finds artifacts; informational only (see below) |

`library` changes nothing the daemon or the Shell does: the daemon checks the value, records it, writes it in its log
and in `GET /api/open-artifact.harnesses`, and `doctor --session` prints it (`library (not said)` when it is left out).
Artifact events, the home page and `embedLibrary` work the same with any value or none. Leave it out when your app has
no place that lists artifacts; there is no separate value for that.

## Adapter → daemon

| Method | Params | Result |
| --- | --- | --- |
| `session.attach` | `session`, `workspace`, `title?`, `status?` (`idle` \| `running`), `pid?`, `may?`, `role?` | `{ key, inbox }` |
| `session.status` | `session`, `workspace`, `status` | `{ ok }` |
| `session.detach` | `session`, `workspace` | `{ ok }` |
| `session.rename` | `session`, `workspace`, `title` | `{ ok }` |
| `tools.list` | — | `{ tools }` (name, description, inputSchema, `actions`, `remoteActions`) |
| `tools.call` | `name`, `arguments`, `caller?` | the tool's result |
| `agent.wrote` | `paths`, `caller?` or `session`/`workspace` | `{ ok, artifacts? }` |
| `artifact.open` | `url`, `caller?` or `session`/`workspace` | `{ opened, view_url? }` |
| `inbox.take` | `session`/`workspace` or `caller` | `{ messages }` |
| `inbox.wait` | the same, `timeoutMs?` (default 10 minutes, at most an hour) | `{ messages }` |
| `subscribe` | `on` | `{ ok }`; `event` notifications follow while on |
| `skill.get` | `form?` (`entry` \| `full`), `command?`, `agentName?`, `tools?`, `toolNames?`, `opens?`, `locale?` | `{ name, description, argumentHint, body, version, etag, prompt? }` |
| `commands.list` | `command?`, `locale?` | `{ commands }`: `text`, `type`, `title`, `description`, `templates?`, `remote?`, `origin?` |
| `embed.origins` | — | `{ origins, entries }`; an entry has `origin` or `pattern`, `kind` (`daemon` \| `frame` \| `server` \| `url`), `type?`, `remote` |
| `shell.command` | `view`, `command` (a host message) | `{ ok }` |
| `view.context` | `url`, `session?`, `workspace?` | `{ at, context, changed }`; owner session only |
| `runtime.status` | — | `RuntimeStatus` |
| `runtime.update` | `version?` | `{ installed, pending, message }` |

`skill.get` `opens` picks the skill's "show it" step: `host` (your app shows the page by itself), `agent-browser` (the
agent opens `view_url` in its own browser panel), `system` (the computer's browser), `link` (the agent gives the person
`view_url`). Left out, the daemon uses `host` when your caps (from `hello` or the profile) have `open`, else a general
step that covers a built-in browser and the computer's browser.

`session` and `workspace` name a session of the calling harness. A session with no id is keyed by its workspace.
`may` is `{ create?, modify?, remove?, reply? }` ([tools](../integrating/tools.md#session-permissions)).

## Daemon → adapter

| Method | Params | Result |
| --- | --- | --- |
| `wake.deliver` | `session`, `workspace`, `artifact`, `artifactId`, `text`, `source` | `{ status, session? }`; `status` is `delivered`, `resumed`, `queued`, `drafted` or `failed` |
| `host.open` | `session`, `url`, `view_url`, `title?`, `view?`, `embed_url?`, `remote?` (`{ type, origins }`) | `{ opened }` |
| `shell.event` | `view`, `session`, `event` (a Shell message) | `{ ok }` |

Over stdio the bridge forwards `wake.deliver` only when your caps have `wake`, and `host.open` and `shell.event` only
when they have `open`. Without them you get no such call;
the daemon does not send it, and one that came anyway is answered `method_not_found` by the bridge.

The daemon waits 30 seconds for an answer. No answer, an error or `failed` keeps a wake in the inbox
([wake](../integrating/wake.md)).

## Events

The notification `event` carries one of these, while you are subscribed:

| `type` | Fields | When |
| --- | --- | --- |
| `artifacts/changed` | `id`, `author?`, `paths?`, `removed?` | an artifact was created, written or removed |
| `types/changed` | — | types were installed, removed or changed |
| `harness/changed` | — | adapters or sessions changed |
| `wake/state` | `artifactId`, `via`, `status?` | how a wake went |
| `view/context` | `id`, `at` (`url` too, from the Harness API) | the owner's selection on a page changed (best effort) |
| `embed/origins` | `origins`, `entries` | the result of `embed.origins` changed |
| `runtime/update` | `current`, `available`, `installed` | an update exists, or was installed |

## Errors

A failure is a JSON-RPC error whose `data` is `{ code, message, fix? }`. `fix` is one line saying what to do.

| JSON-RPC code | When |
| --- | --- |
| `-32700` | the message is not JSON (`data.code` `parse_error`) |
| `-32601` | unknown method (`data.code` `method_not_found`) |
| `-32602` | bad params (`data.code` `invalid_argument`) |
| `-32000` | any other failure; read `data.code` |

Decide by `data.code`, not by the JSON-RPC code.

The WebSocket and the stdio bridge answer with the same numbers (`rpcErrorCode` in `@open-artifact/protocol`); HTTP
polling answers with an HTTP status and the same `{ code, message, fix? }` body.

| `data.code` | Meaning |
| --- | --- |
| `invalid_argument` | a param is missing or wrong |
| `parse_error` | the line or message is not JSON |
| `method_not_found` | no such method, or one the adapter did not declare in its caps (stdio) |
| `unauthorized` | no `hello` yet, or a bad token |
| `unsupported_protocol` | no protocol version both sides speak |
| `unknown_session` | polling before `session.attach` |
| `not_found` | the artifact, session, file or version does not exist |
| `not_granted` | session permissions, owner-only reads, person-only actions, updates turned off |
| `conflict` | the thing changed under you, or already exists |
| `duplicate` | a comment reply identical to the last one |
| `too_large` | the body or file is over the limit |
| `bad_path` | a path leaves the artifact folder or names its bookkeeping |
| `rate_limited` | too many calls; try later |
| `unsupported` | the daemon or type does not do this (for example a feature it does not list) |
| `unknown_action`, `unknown_tool` | the type has no such action; no such tool |
| `type_missing`, `type_not_runnable` | the type is not installed (an import names its id, uid and source); it is installed but cannot run |
| `type_mismatch` | the artifact was made with another type of the same id (its `typeUid` differs): not opened or written |
| `server_failed` | a type server or remote type failed |
| `unavailable` | the service needed is not there right now |
| `newer_release` | the artifact was written by a newer Open Artifact; update first |
| `redirected` | a link host answered with a redirect; nothing was sent on |
| `download_failed`, `integrity_failed`, `bad_archive` | a runtime update or type package could not be fetched, did not match its integrity, or did not unpack safely (also an archive to import that is not one) |
| `connect_failed`, `disconnected`, `timeout` | a connection could not be made, closed, or took too long |
| `no_daemon`, `daemon_failed` | the kit or CLI found no daemon, or could not start one |
| `error` | anything else |

Types may add codes of their own. A tool's own failure comes back as a normal result with `error`, not as a JSON-RPC
error.

## HTTP polling

For an adapter that cannot keep a WebSocket. Every route is `POST` with `Authorization: Bearer <token>` and
`X-Open-Artifact-Harness: <name>`; the body is JSON.

| Route | Body | Answer |
| --- | --- | --- |
| `/api/open-artifact.session.attach` | attach params, `agentName?` | `{ key, inbox }` |
| `/api/open-artifact.session.wait` | `session`, `workspace`, `timeoutMs?` (default 25 s, 1 s to 60 s) | `{ messages }`, `[]` after the timeout |
| `/api/open-artifact.session.status` | `session`, `workspace`, `status` | `{ ok }` |
| `/api/open-artifact.session.detach` | `session`, `workspace` | `{ ok }` |
| `/api/open-artifact.tools` | — | `{ tools }` |
| `/api/open-artifact.tools.call` | `name`, `arguments`, `caller?` | the tool's result |

One `session.wait` at a time per session; a new one ends the old with `[]`. A polling adapter not seen for 20 seconds
counts as disconnected, and its wakes go to the inbox. Polling adapters get no events and no `host.open`, `shell.event`
or `wake.deliver`: their wakes arrive as `session.wait` messages.

## Other HTTP routes an adapter uses

| Route | |
| --- | --- |
| `GET /__open-artifact/health` | the daemon is up |
| `GET /api/open-artifact.harnesses` | adapters, their caps, the sessions (token) |
| `GET /api/open-artifact.embed` | the declared host origins (`hosts`) and `embed.origins` |
