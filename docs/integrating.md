# Integrating Open Artifact into an agent product

[中文](integrating.zh-CN.md)

This guide is for engineers who ship an agent product: a desktop app (Electron, Tauri), an IDE extension, a command-line
agent, or a web app with a local helper, in JavaScript or not. After reading it you can make three things work:

1. your agent makes artifacts (decks, designs, docs, sheets, dashboards, boards, films) with Open Artifact's tools;
2. the artifacts' pages show inside your UI;
3. what people write on those pages (comments, **Ask**, page requests) comes back into the right agent session.

You can stop at any level below and have something that works. Each level says what to write, what the person sees,
and how to check it.

## The parts

```text
 your app ─────────── your adapter ──────── harness kit ─── WebSocket /__harness ───▶ daemon (one per computer)
 (chat, sessions,     (the code you write:   (@open-artifact/       JSON-RPC 2.0          │  tools, library, wake,
  tool registry, UI)   sessions, tools,       harness-kit, or the                        │  type servers
                       wakes, pages)          stdio bridge)                              ▼
                                                                               Shell page  /a/<id>
 your UI ◀── iframe or top-level view ──────────────────────────────────────── (title bar, comments, share,
                                                                                export, "Ask") around the page
```

- **The daemon** (`open-artifact daemon`) runs once per computer and per Open Artifact home (`~/.agents/open-artifact`,
  or `$OPEN_ARTIFACT_HOME`). It owns the artifact library, the three agent tools, the type servers and the inbox of
  messages for agent sessions. Every agent app on the computer shares it.
- **The Shell** is the daemon's page at `http://127.0.0.1:<port>/a/<id>`. It frames the artifact's editor and draws
  the title bar, comments, share and export. It talks to whoever embeds it.
- **Your adapter** is the code you write. It connects to the daemon as your harness (a name such as `my-agent`), tells
  it which sessions exist, gives your agent the tools, takes wakes, and shows pages.
- **The kit** (`@open-artifact/harness-kit`, Node 22.18+ or Electron's Node) does the connection for a JavaScript
  adapter: it finds or starts the daemon, reconnects, attaches sessions again, and wraps every call. A program in another
  language runs `open-artifact harness --stdio` instead ([non-node](integrating/non-node.md)).

## Pick a level

| Level | You write | The person sees | Comments come back |
| --- | --- | --- | --- |
| 0. Skill + command line | Copy the skill; the agent runs `open-artifact …` in a shell | A link to the page in the chat | In the result of the agent's next call, or while it runs `open-artifact wait` |
| 1. MCP | An MCP server entry (and hooks, if your app has them) | A link, or your app's browser | In the next tool result; with hooks, at session start, with the next message, at the end of a turn |
| 2. The kit | An adapter: sessions, native tools, a `wake` callback | A link | Right away, into the session that owns the artifact |
| 3. Pages in your UI | An `open` callback and an embedding | The page beside the chat | As above, plus **Ask** starts or opens your sessions |
| 4. The library | Cards or a list from artifact events | Cards under messages, or your own artifact list | As above |

The shipped integrations sit at these levels: Claude Code, Codex, Cursor, Copilot, Antigravity and ZCode are level 1
with hooks; DeepSeek Harness (`plugins/dsh`) is a full adapter on the kit. [`plugins/README.md`](../plugins/README.md)
lists them.

## Level 0: the skill and the command line

Any agent that can read a skill file and run a command can use Open Artifact. Write the skill into your app's skill
folder, under the command you want the person to type:

```bash
open-artifact skill install --command open-artifact --dir ~/.my-agent/skills
```

This writes `~/.my-agent/skills/open-artifact/SKILL.md`, rendered for your harness when you add `--harness my-agent`
(its agent name, command, rules). It writes again only when the text changed (an `etag` in the file), and it leaves alone
a `SKILL.md` there that Open Artifact did not write, unless you pass `--force`. `open-artifact skill render` prints the
same text without writing it.

The agent then calls the tools from the command line, one JSON argument each:

```bash
open-artifact artifact '{"action":"quickstart"}'
open-artifact comments '{"action":"wait"}'
```

`open-artifact` is the `@open-artifact/cli` package, or `node <plugin>/skills/open-artifact/scripts/open-artifact.mjs`
inside a plugin. It starts the daemon when none runs.

- **What the person sees:** the agent replies with the artifact's `view_url`; they open it in a browser.
- **How comments come back:** in the `messages` of the agent's next tool result, or while it runs `open-artifact wait`.
- **Check:** `open-artifact doctor` says the home, the daemon, the runtime and the installed types are fine.

## Level 1: MCP

If your agent takes MCP servers, add one that runs the bridge over stdio:

```bash
node <plugin>/skills/open-artifact/scripts/open-artifact.mjs mcp --harness my-agent
```

`--harness` names your harness, so calls from it are tied to your profile (its agent name, its sessions). The agent gets
`Artifact`, `ArtifactData` and `ArtifactComments`, and `ShowArtifact` when the client shows MCP Apps.

Comments reach an MCP-only agent in the `messages` of its next tool result. If your app has hooks, run
`open-artifact hook <event> --harness my-agent` from them and comments arrive at session start, with the person's next
message, and at the end of a turn. The hook reads your app's hook input on stdin and answers in your app's format; the
profile's `hookDialect` says which (`claude-code`, `cursor`, `copilot`, `antigravity`, or a mapping of your own,
[profile reference](spec/profile.md)).

Tell the daemon about your harness with a profile. Ship it inside your plugin and have the person (or your installer,
from the person's own terminal) add it:

```bash
open-artifact harness add my-agent.json
open-artifact harness list
```

- **What the person sees:** a link, or your app's built-in browser if the agent opens the `view_url` there. A profile with
  `"open": "browser"` has the daemon open the computer's browser when the agent asks it to show a page.
- **Check:** `open-artifact doctor --harness my-agent` reports the profile, and once your app runs, its connection.

## Level 2: the kit — native tools, sessions, wake

At this level your app holds a live connection. Pages still open by link, but comments reach the session that owns the
artifact the moment they are sent. The code below is from [`examples/harness-node`](../examples/harness-node), which the
repository's test suite runs against a real daemon.

### Connect

From [`examples/harness-node/harness.mjs`](../examples/harness-node/harness.mjs):

```js
export function connectHarness({ name = 'example-node', agentName = 'Example', wake, runtime = hostRuntime(), ...options } = {}) {
  return createHarness({
    harness: name,
    agentName,
    ...(runtime ? { runtime } : {}),
    commands: ['open-artifact'],
    caps: { wake: { resume: true }, tools: 'native', library: 'own' },
    wake,
    ...options,
  });
}
export function callerOf(session) {
  return { session: session.id, workspace: session.workspace };
}
```

`createHarness` finds the running daemon through `daemon.json` in the Open Artifact home, or starts one. To start one it
needs a runtime: pass `runtime: { dir, version }` (the `@open-artifact/cli` folder your app carries), or set
`OPEN_ARTIFACT_DAEMON_BIN`. Without either, and with no runtime registered on the computer, it fails with `no_daemon`
([runtime](integrating/runtime.md)).

The example tells the kit which runtime it ships with `hostRuntime()`, from the same file:

```js
export function hostRuntime(folders = runtimeFolders()) {
  for (const dir of folders) {
    const version = runtimeInfo(dir)?.version;
    if (version) return { dir, version };
  }
  if (process.env.OPEN_ARTIFACT_DAEMON_BIN) return undefined;
  throw new Error('No Open Artifact runtime: install @open-artifact/cli (npm install @open-artifact/cli), or in this repository build it (npm run build, then node scripts/build-plugins.mjs).');
}
```

`runtimeFolders()` lists the installed `@open-artifact/cli` package and, in this repository, the built
`skills/open-artifact`; `runtimeInfo` (from the kit) reads a folder's version. Your app returns the folder inside its
own bundle.

`caps` tells the daemon what your adapter does. The kit adds `wake` only when you pass a `wake` callback and `open` only
when you pass an `open` callback, so you cannot claim what you do not handle.

### Attach sessions

A session is one conversation of your agent. Attach it when it starts, set its status when a turn starts and ends, and
detach it when it closes. From [`examples/harness-node/main.mjs`](../examples/harness-node/main.mjs):

```js
await oa.attach({ ...callerOf(agent), title: agent.title, status: 'running' });
// …
await oa.status(callerOf(agent), 'idle');
```

`session` is your id for it and `workspace` the project folder it works in. The kit attaches every session again after a
reconnect. What waited in a session's inbox while it was away goes to your `wake` callback on attach.

### Register the tools

Register the daemon's tools in your agent's own tool registry, each call going back with the session as caller. From
[`examples/harness-node/tools.mjs`](../examples/harness-node/tools.mjs):

```js
export async function registerTools(oa, agent) {
  const definitions = await oa.tools();
  for (const tool of definitions) {
    agent.register(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      run: (args) => oa.call(tool.name, args, callerOf(agent)),
    });
  }
  return definitions.map((tool) => tool.name);
}
export function reportWrites(oa, agent, paths) {
  return oa.wrote(paths, callerOf(agent));
}
```

The caller is what makes the session the artifact's owner, so comments come back to it. When your agent writes files
into an artifact's folder with its own file tools, report them with `wrote` (`agent.wrote`): the daemon records that
the agent wrote them, so they are not reported back as the person's changes. [Tools](integrating/tools.md) covers action kinds, what leaves the computer, and session
permissions.

### Take wakes

When the person sends comments or uses **Ask** on a page, the daemon calls `wake.deliver` on the adapter of the session
that owns the artifact. From [`examples/harness-node/wakes.mjs`](../examples/harness-node/wakes.mjs):

```js
export function routeOf(params) {
  return params.source?.from?.kind === 'owner' ? 'turn' : 'notice';
}
export function wakeHandler(sessions, { onWake = () => undefined } = {}) {
  return (params) => {
    const agent = params.session ? sessions.get(params.session) : null;
    if (!agent) return 'failed';
    const route = routeOf(params);
    agent.add(route === 'turn' ? 'user' : 'notice', params.text);
    onWake(params, route, agent);
    return 'delivered';
  };
}
```

Only the owner's words become a user turn. A comment from someone the artifact was shared with, or a finished background
task, is a notice the agent sees with the next turn. Answer `failed` when you could not take it: the daemon keeps the
message in the inbox. [Wake](integrating/wake.md) explains every answer and why the routing matters.

### Check it

```bash
node examples/harness-node/main.mjs --workspace /tmp/demo --once
```

It prints `connected`, `tools`, `skill`, `published`, `opened` and `ready <url>`. Open the page (`open-artifact open
<url>` prints its address), comment and press **Send to agent**: the line `wake turn comment from owner on "…"` appears.
In a second terminal, `open-artifact doctor --harness example-node` shows the adapter connected (run it while
`main.mjs` runs without `--once`).

## Level 3: show pages in your UI

Pass an `open` callback and say how you embed. The daemon then calls `host.open` instead of handing the agent a link,
and your app shows the Shell page.

| Way | What you load | How messages travel | Use it when |
| --- | --- | --- | --- |
| Frame | `viewUrl` in an `<iframe>` of your page | `postMessage` between your page and the Shell | your UI is a web page served from an origin of your own |
| Top-level view | `embedUrl` (with a one-time view ticket) in a webview, tab or window | through the daemon: `shell.event` to your adapter, `shellCommand` back | Electron, Tauri, an IDE webview, or any view without a parent frame |

The view way, from [`examples/harness-electron/src/pane.mjs`](../examples/harness-electron/src/pane.mjs) (this example
was not run in Electron, see [limits](integrating/limits.md)):

```js
const embed = embedArtifact(this.transport(request.view), {
  url: request.embedUrl,
  harness: 'electron-example',
  agentName: this.agentName,
  toolbar: false,
  theme: themeOf(),
  // …
  capture: async () => (await view.webContents.capturePage()).toJPEG(70),
  saveThumbnail: (jpeg, artifact) => this.oa.saveThumbnail(artifact, jpeg),
});
```

Three rules decide whether this works safely:

- **Load only the daemon's origins.** `embedOrigins()` lists them, and `embed/origins` events change them. Never let in
  "all of loopback". [`examples/harness-node/allowlist.mjs`](../examples/harness-node/allowlist.mjs) does this.
- **Declare your own origin for a frame.** `embed: { origins: ['https://app.example.com'], mode: 'frame' }`. The Shell
  gives an undeclared host no prompt text, no comment text, no links out, no saved files and no destinations. A page
  loaded from `file://` has origin `null` and can never be declared: serve your UI from a custom scheme or use a
  top-level view.
- **A remote type's page asks first.** A type whose page lives on another computer arrives with `remote`; the kit asks
  your `allowRemote` before showing it (`embed.remote: 'ask'`, the default), or never shows it (`deny`). `allow` is
  only for a host whose pane is already a general browser ([remote types](integrating/remote-types.md)).

The page tells you where the person is (`onPlace`), what they selected (`context()`, feature `view.context`), and asks
you to start or open sessions (`onNewSession`, `onOpenSession`). [Embedding](integrating/embedding.md) has the whole
list and a webview checklist; [embed reference](spec/embed.md) has every message.

- **What the person sees:** the page opens beside the chat; **Ask** goes to your session; thumbnails appear in the
  library.
- **Check:** `main.mjs` prints `opened in-host` when your `open` callback took the page; your view loads only origins in
  the allowlist.

## Level 4: the library

Your app can show the person's artifacts its own way. Three choices, said as `caps.library`:

- `home`: embed the daemon's home page with `embedLibrary`, filtered to your harness or workspace.
- `cards`: a card under the message that made or changed an artifact.
- `own`: your own list, kept from artifact events.

The value is a declaration: the daemon records it and shows it (its log, `GET /api/open-artifact.harnesses`, `doctor
--session`), and nothing it or the Shell does depends on it. Leave `library` out when your app has no place that lists
artifacts; there is no value for that, and artifact events and the home page work the same either way.

From [`examples/harness-node/artifacts.mjs`](../examples/harness-node/artifacts.mjs), a card per artifact and session,
keyed by the `open-artifact://` link:

```js
export function cardOf(report) {
  if (report.change === 'removed') return null;
  const { artifact } = report;
  return { url: artifact.url, title: artifact.title, type: artifact.type, thumbnail: artifact.thumbnail, updatedAt: artifact.updatedAt };
}
```

`on('artifact')` reports each artifact that is `created`, `updated` or `removed` in the library, with who changed it and
which files. `session` and `workspace` are set when one of your harness's sessions owns it; a `removed` report carries
no session, so find the card by its link: `followArtifacts` in the same file drops it from every session. Keep the `open-artifact://artifact/<id>` link as the key: the page address can
change when the daemon restarts on another port, and `viewUrl(url)` gives the current one.

## Commands and the skill

The person types a command to ask for an artifact. The default is `/open-artifact <type> <what to make>`; your app may use
its own name, given in `commands` (`createHarness({ commands: ['artifact'] })`) or the profile.

- `installSkill({ dir, agentName, tools, opens })` writes the skill rendered for your harness, as `skill install` does,
  and writes it again after a runtime update changes it. See
  [`examples/harness-node/skill.mjs`](../examples/harness-node/skill.mjs).
- `opens` says how the page reaches the person, and so how the skill's "show it" step reads. Pass it to
  `installSkill`, `renderSkill`, `localSkill` and `keepSkillInstalled`:

  | `opens` | The skill tells the agent | Use it when |
  | --- | --- | --- |
  | `host` | your app shows the page by itself after the first write; with `open: "never"`, call `Artifact open` and the app shows it | you pass an `open` callback (`caps.open`) |
  | `agent-browser` | open `view_url` in its own browser panel or tab | your agent has a browser tool and you show no pages yourself |
  | `system` | the page opens in the computer's browser after the first write; otherwise `Artifact open` opens it there | the computer's browser is where the person looks |
  | `link` | nothing opens by itself; give the person `view_url` as a link | neither of the above |

  Left out, the daemon's rendering (`skill.get`) uses `host` when your caps have `open` (from `hello` or your profile),
  else a general step: the agent's built-in browser if it has one, otherwise `Artifact open` in the computer's browser.
  `Harness.installSkill` does the same for the kit's own rendering (used when the daemon is not connected or lacks
  `skill.get`): it passes `opens: 'host'` when you gave `createHarness` an `open` callback. An `opens` you pass always
  wins. The standalone helpers (`installSkill(client, …)`, `renderSkill`, `localSkill`) know nothing of your callbacks:
  pass `opens` to them yourself.
- `commands()` (`commands.list`) gives one entry per installed type for your command menu: the text to insert
  (`/artifact slides `), a title, a description and starting prompts.
- The skill and `quickstart` read the same options: your command, agent name, how the agent calls tools, how pages open,
  your rules, and the action kinds you confirm with the person.

Your harness's rules come in two kinds. `rules` is text (at most 4000 characters) that the daemon puts first in the
skill, saying it wins over the instructions after it; it changes no permission. `policy` is data the daemon acts on:
`offer` (make artifacts only when asked, or offer them), `reuse` (where `quickstart` looks for one to reuse), `roles`
(what each kind of session may do) and `confirm` (action kinds the person approves each time). Per-session permissions
go in `attach({ may, role })` and are enforced when the daemon lists `session.may` ([tools](integrating/tools.md)).

## The profile

The daemon knows each harness by a profile: its title, agent name, level, how it reaches the daemon, its markers and
session variable, its hook format, and more. Profiles come from three places:

| Source | Where | Who writes it | Wins over |
| --- | --- | --- | --- |
| `user` | `<home>/harnesses/<name>.json` | the person, with `open-artifact harness add` | everything |
| `adapter` | the same file, `"source": "adapter"` | your adapter, in `hello` (`profile`) | the shipped one, field by field |
| `shipped` | `packages/daemon/harnesses/<name>.json` in the runtime | Open Artifact's release | the defaults |

Your adapter may report almost everything about itself. It may never set `nudge`, `mcp`, `skillsDir`,
`sessionWorkspace`, `source` or `name`: `nudge` and `sessionWorkspace` make the daemon run a program or read files, so
only a file on disk that ships with Open Artifact or that the person added may say them. A reported profile never
overwrites the person's own file. [Profile reference](spec/profile.md) lists every field.

Give your app's display name as the profile `title`; with the kit, `createHarness({ profile: { title: 'My App' } })`
reports it in `hello`. The Shell uses it wherever it names the harness to a person: the Ask pane ("Messages go to the
My App session…"), the open-session button and menu item, and the owner badge on the home page. Without a title the
Shell shows your harness name as it is.

## Before you ship

- [ ] Your harness name matches `^[a-z0-9][a-z0-9._-]{0,40}$` and is the same in `hello`, the profile and `--harness`.
- [ ] Every tool call carries the session as caller; files your agent writes itself are reported with `wrote`.
- [ ] The `wake` callback routes by `source.from.kind`: only `owner` becomes a user turn.
- [ ] `wake` answers `failed` when it could not take a message, so the daemon keeps it.
- [ ] Sessions are attached with their `workspace`, set `running`/`idle`, and detached when they close.
- [ ] Your views load only `embedOrigins()`, follow `embed/origins`, and keep pages away from your app's privileges.
- [ ] A frame host's origin is declared in `embed.origins`; nothing is loaded from `file://`.
- [ ] Remote type pages go through `allowRemote`, or `embed.remote` is `deny`.
- [ ] You test for features by name (`harness.features.includes('view.context')`), not by version.
- [ ] Publishing to a site, changing remotes, adding profiles and updating the runtime are left to the person.
- [ ] Your tests run the adapter against the fake daemon, and `open-artifact doctor --harness <name> --session <id>`
      passes against your running app ([testing](integrating/testing.md#a-conformance-run)).
- [ ] You read [security](integrating/security.md) and [limits](integrating/limits.md).

## Further reading

| Topic | Page |
| --- | --- |
| The three tools, action kinds, session permissions, ownership | [integrating/tools.md](integrating/tools.md) |
| Wake routing, answers, resume, nudges | [integrating/wake.md](integrating/wake.md) |
| Frames, top-level views, origins, thumbnails, theming | [integrating/embedding.md](integrating/embedding.md) |
| Types whose pages live on another computer | [integrating/remote-types.md](integrating/remote-types.md) |
| Which runtime runs, updates, pins | [integrating/runtime.md](integrating/runtime.md) |
| Adapters not written in JavaScript | [integrating/non-node.md](integrating/non-node.md) |
| Trust boundaries in one place | [integrating/security.md](integrating/security.md) |
| The fake daemon, `doctor`, CI | [integrating/testing.md](integrating/testing.md) |
| What does not work yet | [integrating/limits.md](integrating/limits.md) |
| Every Harness API method, event and error | [spec/harness-api.md](spec/harness-api.md) |
| Every host ↔ Shell message | [spec/embed.md](spec/embed.md) |
| Every profile field | [spec/profile.md](spec/profile.md) |
| Runnable examples | [examples/README.md](../examples/README.md) |
