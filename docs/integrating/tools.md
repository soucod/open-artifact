# The agent tools

[中文](tools.zh-CN.md)

After reading this you can give your agent Open Artifact's tools, tell which calls need the person's approval, know what
a call sends off the computer, limit what a session may do, and report files your agent writes by itself.

## Three tools

The daemon has three tools. Get their definitions with `tools()` (`tools.list`); the kit falls back to the definitions it
carries when no daemon answers. Run them with `call(name, args, caller)` (`tools.call`).

| Tool | Actions | For |
| --- | --- | --- |
| `Artifact` | `quickstart`, `list`, `publish`, `read`, `open`, `call`, `adopt`, `delete`, `share` | making, finding, writing, showing and removing artifacts |
| `ArtifactData` | `get`, `list`, `query`, `set`, `update`, `delete`, `str_replace`, `batch` | the documents of types that keep a store (boards, dashboards, films) |
| `ArtifactComments` | `read`, `reply`, `resolve`, `reopen`, `wait` | the comment threads on a page |

An MCP client also gets `ShowArtifact` when it declares MCP Apps (`io.modelcontextprotocol/ui`). A native-tools adapter
does not need it: it shows pages itself ([embedding](embedding.md)).

The view `ShowArtifact` shows frames the page from the daemon's address on this computer. Its `_meta.ui.csp.frameDomains`
names that origin, and `_meta["openai/ui"].permissions.loopbackNetwork` asks a host that keeps MCP Apps on a public
origin to let the frame through, since Chromium's Local Network Access blocks it otherwise. A host must also keep that
http origin in the view's `frame-src`: Codex keeps only https frame domains, so its cards refuse the page. The view knows
the page showed when the Shell sends `shell_hello` to its parent. When the view's CSP refuses the frame
(`securitypolicyviolation`), it says so at once, with Open in browser and the address to copy. When no `shell_hello`
comes in time, it says the page did not show, with Retry as well. When `ui/open-link` fails, returns `isError` or gets
no answer within 3 seconds, it points to the address to copy.

Each call returns a result object. Besides what the action returns, it may carry `error` (`code`, `message`, `fix`),
`next` and `note` (what to do next), `notes` (lines such as an ownership change), `current` (the newer content on a
conflict), and `messages` (what waited in the caller's inbox: comments arrive this way too).

## The caller

Every call should name the session it comes from: `{ session, workspace }` as the third argument of `call`, or
`caller` in `tools.call`. The caller decides:

- **Ownership.** The session that creates an artifact owns it. Comments and requests on it wake only that session.
- **Where new artifacts go.** `workspace` is the project folder; a caller with no workspace gets the home folder.
- **Permissions.** What `session.attach` said the session may do ([below](#session-permissions)).

A call with no caller is the harness's own. It works, but nobody owns what it makes, so comments on it wait in the shared
inbox for whichever session takes it.

## Action kinds: which calls to confirm

`tools.list` gives each tool's `actions`, a map from action to kind (feature `tools.actions`). MCP puts it under
`_meta["open-artifact/actions"]`.

| Kind | Meaning | Actions |
| --- | --- | --- |
| `read` | reads only | `Artifact` `quickstart`, `list`, `read`; `ArtifactData` `get`, `list`, `query`; `ArtifactComments` `read`, `wait` |
| `write` | writes the artifact's own folder or store | `Artifact` `publish`, `call`; every other `ArtifactData` action, `delete` included (it removes one document); `ArtifactComments` `reply`, `resolve`, `reopen` |
| `ui` | changes what the person sees | `Artifact` `open` |
| `remove` | removes an artifact or takes it from another session | `Artifact` `delete`, `adopt` |
| `person` | only reports what a person does | `Artifact` `share` |

Use the kinds for your own approval prompts instead of a list of action names. Put the kinds you always confirm in the
profile's `policy.confirm`; the skill then tells the agent that the person approves those.

`Artifact` with no `action` is `publish`.

## What leaves the computer

`tools.list` also gives each tool's `remoteActions` (feature `types.remote`; MCP: `_meta["open-artifact/remote-actions"]`):
the actions that send an artifact's data to its type's address when that type is remote, that is, its page lives on
another computer.

| Tool | Actions that reach a remote type |
| --- | --- |
| `Artifact` | `publish` (creating one opens its page), `open`, `call`, `share` |
| `ArtifactData` | every action |
| `ArtifactComments` | every action but `wait` |

For a type on this computer nothing leaves it. The tool annotation `openWorldHint` is `true` only while an enabled remote
type is installed. Types say `remote` (and `origin`) wherever they are listed, so your agent and your UI can tell before
the call. A path on this computer is never sent to a remote type: such a call is refused with `unsupported`.
[Remote types](remote-types.md) has the details.

## Where a type comes from

Types say `source` wherever they are listed (`quickstart`, `list scope: "types"`, `read {type_url}`) and when an
artifact is read (feature `types.source`): `builtin`, `local` (a folder on this computer) or `installed` (a package
someone else made, installed with `open-artifact types install`). An installed one also has `installed_from` (the file
or address it came from) and `third_party_notice`, a fixed sentence saying its instructions, title and description
are its publisher's, not the person's; `publish` (create) and `adopt` put the notice next to `instructions`. Show it
when your UI shows an installed type's instructions, and never give those instructions more weight than the person's.
A project type the person has not trusted yet (`trusted: false`) carries its own `third_party_notice` the same way.

Reading an artifact of either kind carries a `third_party_notice` too, saying that what is read may have been written
by the type's page: `ArtifactData` and `ArtifactComments` reads and an `Artifact` read of a `path` or `paths` carry that
sentence, and a full `Artifact` read carries the type's notice followed by it. Show it next to anything you show from
such an artifact.

An artifact records the `uid` of its type. When the type here of that id has another uid, `open` and every write are
refused with `type_mismatch`; reads still work.

## Session permissions

A session may be limited, for example a sub-agent that may read but not delete. Say it when you attach (feature
`session.may`):

```js
await oa.attach({ session: 'sub-7', workspace, role: 'subagent', may: { create: false, remove: false } });
```

| Field | Refuses |
| --- | --- |
| `create` | `Artifact` `publish` with `type_url`; `adopt` of a folder |
| `modify` | `Artifact` `publish` with `url`; `call` of an action whose effect is `write`; `adopt` of an artifact without an owner or of its own; every `ArtifactData` action of kind `write` (`set`, `update`, `delete`, `str_replace`, `batch`) |
| `remove` | `Artifact` `delete`; `adopt` of another session's artifact |
| `reply` | `ArtifactComments` `reply`, `resolve`, `reopen` |

A field left out is allowed. Reads are never refused. `role` names a kind of session: the profile's `policy.roles` gives
each role its defaults, and `may` lays over them. A refusal is `not_granted`, with a sentence naming the role and a fix
line telling the agent what to do instead (give the result in its reply, ask the person).

A session the daemon did not see attach may do everything. Permissions keep an honest agent on its path; they are not a
security boundary against code that runs as the person ([security](security.md)).

## Files the agent writes itself

Some types are folders of files (Design, Slides), and your agent may write them with its own file tools rather than
`Artifact publish`. Report those writes:

```js
await oa.wrote(['/path/to/artifact/project/slide-1.html'], { session: 'chat-1', workspace });
```

`agent.wrote` takes absolute paths (a relative one is read against the caller's workspace). The daemon finds the
artifacts they belong to and returns their links as `artifacts`. For each it records that the agent has seen it now
(only the person's edits after that count as `changed_files`), sends the change on to the site if
the artifact is published there, and applies the ownership rule below. Writes through the tools need no report.

## Ownership moves

An artifact has one owner session. It moves without `adopt` in two cases:

1. **A wake handed over.** Your adapter answered a wake with `{ status, session }` naming another session of yours (a
   thread that ended handed it to its coordinator). That session owns the artifact from then on (feature `wake.session`).
2. **Another session of the same harness and workspace wrote it while the owner is gone.** Gone means not attached, not
   resumable (no adapter of the harness says `wake.resume`), and not seen for two hours
   (`OPEN_ARTIFACT_OWNER_GONE_MS`). The writes that count: files with `Artifact publish`, rows with any `ArtifactData`
   write (`set`, `update`, `delete`, `str_replace`, `batch`: every action of kind `write` above), a type action whose effect is `write`, and `agent.wrote`. While the owner is still
   there, the writer's next result says once, in `notes`, whose artifact it is and that `adopt` takes it over.

Ownership never moves across harnesses or workspaces by itself.

## Artifacts written by a newer release

When an artifact was last written by a newer release of its type than the one installed here, the tools treat it as
read-only: reads and opens carry `read_only: true` and a note; writes (`Artifact publish` with a `url`, `Artifact call`,
`ArtifactData` writes) are refused with `newer_release` and a fix line telling the person to update. An older format is
never written over a newer one. Comments stay open: `ArtifactComments` may still reply, resolve and reopen, so the
agent can answer the person while the artifact waits for the update.

On the page, the Shell shows a line saying which release wrote it and how to update, and the built-in type server
serves every visitor as a viewer, so the page cannot save either. That includes the page's own comment box: on the page,
comments follow the viewer role and are off; only the agent's tools may still reply.

## See also

- [Wake](wake.md): what the `messages` in a result are, and the other ways they arrive.
- [Harness API reference](../spec/harness-api.md): `tools.list`, `tools.call`, `agent.wrote`, `artifact.open`.
- [How agents use Open Artifact](../agent-guide.md): the tools from the agent's side.
