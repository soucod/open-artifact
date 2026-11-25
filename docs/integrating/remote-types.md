# Remote types

[中文](remote-types.zh-CN.md)

After reading this you can tell when an artifact's data leaves the computer, decide whether your app shows pages that
come from another computer, and explain to the person what is sent.

## What a remote type is

Most types run on this computer: their page is a file the daemon serves, or a type server it starts on loopback. A type
whose `artifact-type.json` `entry` is a URL on another host is **remote**: its page and its actions live on that
computer.

```json
{ "name": "Board", "entry": { "url": "https://types.example.com/board/", "open": true, "actions": true } }
```

Loopback means `localhost`, a name ending in `.localhost`, `127.x.x.x` written as four numbers, or `[::1]`. Any other
host, including unusual spellings of a loopback address, counts as remote.

## What leaves the computer

| When | What is sent |
| --- | --- |
| the page opens | the person's browser loads the type's page from its address |
| `Artifact` `publish` (creating one), `open`, `call`, `share` | the request body for that route, without `root` |
| `ArtifactData`, every action | the documents and the change |
| `ArtifactComments`, every action but `wait` | the threads and the reply |

`tools.list` gives these per tool as `remoteActions` ([tools](tools.md#what-leaves-the-computer)). For a type on this
computer nothing leaves it.

What the daemon never sends to a remote type:

- **A path on this computer.** `root` is taken out of every request body, the `{root}` placeholder is refused in a
  remote `entry.url`, and an action whose arguments name a local path is refused with `unsupported`.
- **A secret.** A type server on loopback gets a bearer secret; a remote URL entry gets none.

## What the daemon refuses from it

| Rule | Error |
| --- | --- |
| a redirect is never followed (the request would go, body and all, somewhere else) | `server_failed`, naming the address |
| a JSON answer is read up to 32 MiB | `server_failed` |
| an archive (`/__open-artifact/archive`, what publishing to a site takes) is read up to 128 MiB; an error body up to 64 KiB | `server_failed` |
| before creating an artifact, the address must answer at all (any HTTP status) | an error whose fix suggests a local type |

## Before the call: telling the person

Types say `remote` (and `origin`) wherever they are listed: in `Artifact {action: "list", scope: "types"}`, in the
commands from `commands.list`, in the steps `quickstart` gives for one, and as `type_remote` / `type_origin` in `read`. MCP tools carry `openWorldHint: true` only while an enabled remote
type is installed. Use these to say "this sends data to types.example.com" before the agent makes one.

## Showing a remote page

When the daemon asks you to show a remote type's artifact, `host.open` carries `remote: { type, origins }`. The kit
applies your policy before your `open` callback sees it:

| `embed.remote` | The kit |
| --- | --- |
| `allow` | shows it like any page |
| `ask` (default) | calls `allowRemote({ origin, type, title })`; a yes is kept per origin while the process runs; a no, or a question that throws, is not kept, so the next open asks again; with no `allowRemote` the answer is no |
| `deny` | answers not opened without calling `open` |

```js
const oa = await createHarness({
  harness: 'my-agent',
  embed: { origins: ['app://my-agent'], mode: 'frame', remote: 'ask' },
  allowRemote: ({ origin, type }) => confirmDialog(`Show a ${type} page from ${origin}?`),
  open: (request) => pane.show(request),
});
```

When it was not shown, the daemon falls back as for any page: the browser when the profile says `"open": "browser"`,
else the agent gives the person the link.

Which policy is yours to choose. A host that keeps its own navigation allowlist uses `ask` (the default) or `deny`,
and lets the remote origins in only for that view, after the yes. `allow` is for a host whose pane is already a
general-purpose browser with no allowlist, as DeepSeek Harness's Browser tab is
([plugins/dsh](../../plugins/dsh/README.md#remote-type-pages)); `open-artifact doctor --harness <name>` shows each host's
policy for each remote type. `embedOrigins()` lists them with
`kind: "url"` and `remote: true`; [`examples/harness-node/allowlist.mjs`](../../examples/harness-node/allowlist.mjs)
leaves them out until `trust(origin)`.

## Checking it

`open-artifact doctor` probes each enabled remote type with a plain GET (no body, no token, no secret, no path, no
redirect followed): `/__open-artifact/health` when it declares `open`, `actions` or `share`, else its base address, and
`/__open-artifact/actions` when it declares actions. With `--harness <name>`, it warns when that harness's
`embed.remote` is `deny`.

## See also

- [Security](security.md): who can see what.
- [Embedding](embedding.md): origins and webviews.
- [Artifact types reference](../references/artifact-types.md): `artifact-type.json` and `entry`.
