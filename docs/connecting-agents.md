# Connecting your computers and agents to a site

[中文](connecting-agents.zh-CN.md)

**At the end** your computer's Open Artifact is connected to a site, artifacts you publish have a web address that
works when your computer is off, and (if you want) every new artifact is published by itself. Agents that cannot run
Open Artifact locally can use the site over remote MCP.

**Before you start** you need a running site ([hosting.md](hosting.md)), an account on it (the owner key, or a sign-in
someone set up for you), and Open Artifact installed in your agent app (see the main [README](../README.md)).

> **If you are an agent doing this for someone**
>
> - Ask, never guess: which site and what to name it; whether new artifacts should be published by themselves; whether
>   a dashboard's data may go to the site (its query results become visible to everyone who can open it).
> - Only the person can: approve this computer on the site, turn on publishing by itself, choose the default site,
>   publish a dashboard's data, approve a remote MCP client. The tools refuse these to agents on purpose.
> - Never print a secret: Link tokens (`oa_rt_…`) and OAuth tokens. A token goes in `preset.json` with mode 600; say
>   the path.
> - Check each step before the next. After two failures of the same step, stop and report.

**The words.** "Connect a site" is `remote add` in the CLI: a **remote** is a site this computer is connected to, by a
short name you choose (`work`, `home`). The connection is called the **Link** in the code and logs. Your computer's
Open Artifact is the **daemon**.

**The command.** `open-artifact` below is the CLI that comes with every plugin and the skill. How to run it depends
on where you are:

| Where | Run | Checked |
| --- | --- | --- |
| A computer with an agent app that has the Open Artifact plugin or skill | `node <skill folder>/scripts/open-artifact.mjs`, where `<skill folder>` is the installed `open-artifact` skill (for example `codex/skills/open-artifact` in the plugin bundle) | Run (from a checkout, below) |
| A clone of this repository | `node skills/open-artifact/scripts/open-artifact.mjs`. It runs `skills/open-artifact/vendor/`; `npm run build` does **not** rebuild that folder, so run `node scripts/build-skill.mjs` after pulling (without `vendor/` it runs the daemon from source) | Run |
| Anywhere with Node 22.18 or later | `npm install -g @open-artifact/cli`, then `open-artifact` | Not run (the package is on npm: `npm view @open-artifact/cli bin` answers `{ 'open-artifact': 'scripts/open-artifact.mjs' }`) |

An alias saves typing: `alias open-artifact='node /path/to/skills/open-artifact/scripts/open-artifact.mjs'`.

**A computer's Open Artifact lives in one folder**, `OPEN_ARTIFACT_HOME` (default `~/.agents/open-artifact`): its
settings, sites, artifacts it knows and its log, `<OPEN_ARTIFACT_HOME>/logs/daemon.log`. Any `open-artifact` command
starts the daemon when none runs for that folder, on the port in its `settings.json` (`serverPort`, default 4800, the
next free one when taken). The log has `daemon <version> listening at …` when the daemon starts and
`daemon <version> stopped (<why>)` when it stops by itself: `SIGTERM` (which `open-artifact daemon stop` sends),
`SIGINT`, `SIGHUP`, `idle`, or `leaving for runtime <version>`. A log that ends without that line belongs to a daemon
that was killed. To try a site **without touching your own Open Artifact**, give the trial a folder and a
port of its own, before the first command:

```bash
export OPEN_ARTIFACT_HOME=/tmp/oa-try
mkdir -p $OPEN_ARTIFACT_HOME
echo '{"serverPort": 4978}' > $OPEN_ARTIFACT_HOME/settings.json
```

(`OPEN_ARTIFACT_PORT=4978` does the same for one shell.) Or start the daemon yourself and leave it running in its own
terminal:

```bash
open-artifact daemon run --port 4978
```

**Expect:** `open-artifact daemon at http://127.0.0.1:4978`

> **Warning.** With a new `OPEN_ARTIFACT_HOME` and no port of its own, the first command starts a second daemon on
> 4800, the port your own daemon uses: if yours is stopped at that moment, the trial takes the port and your agent
> apps' next daemon starts on 4801, so the page addresses they gave out before stop working.

**What was run.** Every CLI step below was run while writing this guide against a site on the same computer
(`http://127.0.0.1:4977`, artifacts on `127-0-0-1.nip.io`), with a separate `OPEN_ARTIFACT_HOME` and port 4978 as
above; the **Expect:** lines are copied from that run, with the site's address written as
`https://artifacts.example.com`. Per-app notes come from `plugins/README.md`, which says for each app how it was
checked. Remote MCP was run with curl standing in for a client.

## Connect a computer to a site

### 1. Add the site

```bash
open-artifact remote add work https://artifacts.example.com
```

**Expect** (the browser opens on the approval page):

```
Opened https://artifacts.example.com/link/device?user_code=HRHX-MHGN in your browser: check that it shows the code HRHX-MHGN, then approve.
Waiting for the approval...
```

The command waits until the code is approved, denied or expires (a few minutes). On a computer without a browser (a
server, a session over SSH), or to approve on another device, add `--no-browser`:

```bash
open-artifact remote add work https://artifacts.example.com --no-browser
```

**Expect:**

```
Open https://artifacts.example.com/link/device?user_code=GXKR-DLVC in a browser where you are signed in to the site, check that it shows the code GXKR-DLVC, then approve.
Waiting for the approval...
```

The same line is printed when the browser could not be opened.

### 2. Approve it (the person)

The page says, with your own code:

> **Link a computer** — Open Artifact daemon asks to be linked to your account. It says it is open-artifact 0.14.6.
> Code: HRHX-MHGN. You are signed in as Owner. Once linked, it can publish artifacts to this site and read and change
> the artifacts you own here, and it hears comments and requests sent to your agent. Only approve a code you started
> yourself.

Check the code matches, then **Approve**. The terminal then prints:

```
Linked work (https://artifacts.example.com) as Owner.
```

(`Owner` is the owner-key account's name; other accounts show their name or email.)

**Without a browser at all (tests only).** The approval is an ordinary form post, so a script that holds a session
cookie of the person can approve the code. This is how the run for this guide approved it, with the owner key the
site printed at start-up; it is for testing a site you run yourself, never for approving on someone's behalf:

```bash
# Test only: sign in with the owner key (kept in a cookie file), then approve the code.
curl -s -o /dev/null -c jar -H 'Origin: https://artifacts.example.com' \
  --data-urlencode "key=$OWNER_KEY" https://artifacts.example.com/auth/owner-key
curl -s -b jar -H 'Origin: https://artifacts.example.com' \
  --data 'user_code=GXKR-DLVC&decision=approve' https://artifacts.example.com/link/device
```

The second answers 200 with a page saying "Open Artifact daemon is linked."; the waiting `remote add` then prints
`Linked work (…) as Owner.` (`decision=deny` refuses the code.) The `Origin` header may be left out (a client without a
browser's `Sec-Fetch-Site` is judged by it); one naming another origin is refused with 403 `Cross-site requests may
not change anything here.`

**Check:**

```bash
open-artifact remote status
```

**Expect:**

```
work (https://artifacts.example.com): signed in as Owner, connected
  nothing published
```

**If it fails:**

- `a host must use https (http only on this computer or a private network: …)`: the address is `http://` on a public
  name. Use https. On a network you trust, `--insecure-http` allows it.
- For a `nip.io` address it prints `Warning: … uses plain http …` and continues; that is expected on a LAN.
- The code expired: run `remote add` again and approve within a few minutes.

The same can be done in the Share panel of any artifact: **Publish to the web > Connect a site…**.

The sign-in is kept in `<OPEN_ARTIFACT_HOME>/remotes.json` (mode 600). The daemon writes what it does with sites to
`<OPEN_ARTIFACT_HOME>/logs/daemon.log`; after the steps above it has:

```
audit: connecting the site work (https://artifacts.example.com), asked by the open-artifact command line, route remotes.add
link: signed in to work (https://artifacts.example.com) as Owner
```

**Remove a site:**

```bash
open-artifact remote remove work
```

**Expect:** `Removed the site work: this computer no longer publishes or syncs there.` (`--json` prints the same as
JSON.) If that site was where new artifacts were published by themselves, the next line says publishing by itself is
now off:

```
Automatic publishing went to that site, so it is now off: new artifacts stay on this computer until you publish them. After connecting a site, turn it back on with open-artifact remote auto on.
```

A site that still has published artifacts is refused, with status 1:

```
open-artifact: 1 artifact is published to work: art_0mwrwt1jtf8c269e185698c2e.
  Unpublish it first (open-artifact unpublish <id>), or pass --force to keep it local only.
```

## Publish an artifact

### Your first artifact: a folder

`publish` takes a folder that holds an artifact of a known type (its `.artifact.json`, or a type's own files such as a
whiteboard's `db/board/meta.json`), whether this computer knows it yet or not. A new one is added first, then
published, and the CLI says so on an extra line:

```bash
open-artifact publish ./team-board
```

**Expect:**

```
Added /path/to/team-board as open-artifact://artifact/art_0mwrwt1jtf8c269e185698c2e (whiteboard, "Whiteboard element test").
Published to work: https://artifacts.example.com/a/art_0mwrwt1jtf8c269e185698c2e
```

The title is the one the content declares (a document's or board's name), else the folder's name, and the site keeps
it in step with the content. A folder whose type cannot be told is refused with `No artifact in <folder>.` and a fix
that names the `adopt` call with a `type_url`.

An artifact this computer already has is published by its id: `open-artifact publish art_0mwrnigw79b6e26beae1fac85`
answers `Published to work: https://artifacts.example.com/a/art_0mwrnigw79b6e26beae1fac85`. `--remote <name>` picks a
site other than the default. In the Share panel: **Publish to the web > Publish**. An agent cannot publish by itself
unless the person allowed it for that site (below).

**Check:** `open-artifact remote status` lists it:

```
work (https://artifacts.example.com): signed in as Owner, connected
  art_0mwrwt1jtf8c269e185698c2e  "Whiteboard element test"  https://artifacts.example.com/a/art_0mwrwt1jtf8c269e185698c2e
    in sync (2026-11-22T14:05:36.037Z)
```

and `daemon.log` has `link: published art_0mwrwt1jtf8c269e185698c2e to work (https://artifacts.example.com/a/…)`.

### Check that a change on your computer reached the site

Change a file in the folder (here the board's title in `db/board/meta.json`, from "Whiteboard element test" to "Team
board"), wait a few seconds, then:

```bash
open-artifact remote status
```

**Expect:** the new title and a later sync time:

```
work (https://artifacts.example.com): signed in as Owner, connected
  art_0mwrwt1jtf8c269e185698c2e  "Team board"  https://artifacts.example.com/a/art_0mwrwt1jtf8c269e185698c2e
    in sync (2026-11-22T14:05:39.776Z)
```

The title in `remote status` is the site's; the time is when the site last took a change. In the run for this guide
the site had the new title within 4 seconds (its Library API, `GET /api/open-artifact.artifact?id=…` with the person's
session, answered `"title": "Team board"`). Opening the web address shows the change too. A line `1 change waiting` or
`sync failed (…): …` instead of `in sync` says what is stuck; `daemon.log` has the details.

### What happens to the folder on your computer

- It becomes a **working copy**. The site holds the artifact now. Files the agent writes in the folder are sent to the
  site within seconds (seen: a new whiteboard element appeared on the site within 5 s), and changes people make on the
  site come back to the folder.
- If both change the same thing, the site's version wins and yours is kept in `_agent/conflicts/` in the folder.
- Opening the artifact on your computer (`/a/<id>` on the local port) sends you to the web address while the site can
  be reached; when it cannot, the local page shows the working copy and changes wait.
- Snapshots and exports by the agent still run on your computer, from the working copy.
- Sharing is decided on the site: open the web address, then **Share** there.

### Unpublish

```bash
open-artifact unpublish art_0mwrwt1jtf8c269e185698c2e
```

**Expect:** `Unpublished open-artifact://artifact/art_0mwrwt1jtf8c269e185698c2e; it opens at http://127.0.0.1:4978/a/art_0mwrwt1jtf8c269e185698c2e again.`
The site's copy goes to the site's trash and its web address stops working. The folder stays, with the latest changes
from the site. Publishing again works.

### From an agent's session these commands are refused

An agent with a shell could run this command line too, so the CLI looks for the variables agent apps set in their
agents' commands and refuses `publish`, `unpublish`, `remote add`, `remote remove`, `remote default` and `remote auto`
when one is set. The full list (`packages/daemon/src/agent-session.ts`):

| Variable | Set by |
| --- | --- |
| `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` | Claude Code |
| `CODEX_THREAD_ID` | Codex |
| `ANTIGRAVITY_AGENT`, `ANTIGRAVITY_CONVERSATION_ID` | Antigravity |
| the `sessionEnv` of each agent app profile | the profiles in `<OPEN_ARTIFACT_HOME>/harnesses/*.json` and the ones shipped with Open Artifact (the shipped ones add none beyond the above) |

`remote status`, `remote list`, `daemon …` and the agent's own tools are not refused. Run here with only
`CLAUDE_CODE_SESSION_ID` set:

```
open-artifact: Turning automatic publishing on or off is the person's decision, and this command runs inside an agent session (claude-code: CLAUDE_CODE_SESSION_ID is set), so it was not done.
Ask the person to switch it in an artifact’s Share panel, or to run `open-artifact remote auto on` in their own terminal.
```

and with `CODEX_THREAD_ID`:

```
open-artifact: Taking an artifact off its site is the person's decision, and this command runs inside an agent session (codex: CODEX_THREAD_ID is set), so it was not done.
Ask the person to unpublish it from the artifact’s Share panel, or to run `open-artifact unpublish art_0mwrwt1jtf8c269e185698c2e` in their own terminal.
```

The command ends with status 1. **What the agent does then:** pass the second line on to the person as it is (the
Share panel, or the exact command for their own terminal), and wait. Do not unset the variable, edit `settings.json`
or call the daemon's routes to get round it. Once the person says it is done, check with `open-artifact remote status`
(allowed in an agent session).

`agentMayPublish` (below) lets `publish` and `unpublish` through for that one site; nothing lets the others through.
This is a guard rail, not a lock: the agent runs as the person's own user. The daemon logs every publish, unpublish,
data confirmation and site change with who asked (`asked by the open-artifact command line, route …`).

**Without a terminal, a dashboard goes up without its rows.** For a dashboard with live queries, `publish` asks at
the terminal "This publishes the rows from your connectors to everyone the dashboard is shared with. Publish the data
too? [y/N]". With no terminal to ask at (a script, CI, output piped), and always inside an agent session, it publishes
the page and leaves the rows out, saying:

```
Its live data was not published: the page there shows no figures until the person publishes the data, from the dashboard's Share panel ("Publish its data") or with `open-artifact publish art_…` in their own terminal, which asks.
```

Inside an agent session (when `agentMayPublish` let the publish through) the line ends "An agent session never
publishes a dashboard's data." The dashboard lines are read from `packages/daemon/src/agent-session.ts`, not run (no
dashboard with a live connector was published while writing this guide).

## The default site and publishing by itself

- The **default site** is the one `publish` and the Share panel use when none is named. The first site you add is the
  default; with one site, it is always that one.

  ```bash
  open-artifact remote default work
  ```

  **Expect:** `The default remote is work.` (`remote default --clear` forgets the choice; with a single site that site
  is still the default.)

- **Publishing by itself** sends every artifact **created after** you turn it on to the default site, in the
  background. The agent's tool answers at once; its `view_url` is the local address until the publish finishes.
  Failures are retried and shown in `remote status` and the Share panel. Artifacts made earlier, and any you
  unpublished, are left alone.

  ```bash
  open-artifact remote auto on
  ```

  **Expect:** `New artifacts are now published to work by themselves (artifacts made before are left as they are).`
  `remote auto off` answers `New artifacts are published only when you publish them.`

  The Share panel has the same switch, **Publish new artifacts automatically**, and with more than one site a
  **Default site** picker. No agent tool can change either.

- **Letting an agent publish.** By default `Artifact {action: "share", url, cloud: "<site>"}` is refused with
  "Only the person publishes an artifact to the cloud". The person can allow it for one site in
  `<OPEN_ARTIFACT_HOME>/settings.json`: `{"remotes": {"work": {"agentMayPublish": true}}}`. Not run here.

## Set computers up in advance

For a team, a managed laptop or a CI runner, the site can be given to the daemon at install time. It reads these once,
when it starts:

| Variable (also a `preset.json` key) | Meaning |
| --- | --- |
| `OPEN_ARTIFACT_REMOTE` | The site's address. Added once, as the default. |
| `OPEN_ARTIFACT_REMOTE_NAME` | Its short name. Default: the first word of the host name (`oa.example.com` gives `oa`). |
| `OPEN_ARTIFACT_REMOTE_TOKEN` | A Link token: signs in once with no browser approval. Without it, the daemon starts an approval and shows its link in `remote status`, the Share panel and the agent's next tool result. |
| `OPEN_ARTIFACT_PUBLISH` | `auto` (publish new artifacts by themselves) or `manual`. |
| `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP` | `1`: allow plain http for this address even if it is not private. |
| `OPEN_ARTIFACT_PLUGIN_REMOTE` | Set by a plugin's own setting (Claude Code, Cursor); used only when `OPEN_ARTIFACT_REMOTE` is unset. |

`<OPEN_ARTIFACT_HOME>/preset.json` takes the same keys, for apps that do not pass the environment on:

```json
{
  "OPEN_ARTIFACT_REMOTE": "https://artifacts.example.com",
  "OPEN_ARTIFACT_REMOTE_NAME": "work",
  "OPEN_ARTIFACT_REMOTE_TOKEN": "oa_rt_…",
  "OPEN_ARTIFACT_PUBLISH": "auto"
}
```

Where: `~/.agents/open-artifact/preset.json` on macOS and Linux, `%USERPROFILE%\.agents\open-artifact\preset.json` on
Windows. With a token in it, make it readable only by you:

```bash
chmod 600 ~/.agents/open-artifact/preset.json
```

(A `preset.json` holding a token that others can read is still used, with a warning in `daemon.log`.)

**Which wins**, highest first: what the person set (`settings.json`, `remotes.json`, the CLI, the Share panel), then
the environment, then `preset.json`, then the defaults. A preset adds its site once: a site the person removed is not
added back, and a used token is never sent again. An address, its name and its token travel together: a token in
`preset.json` is not paired with an address from the environment. A value still written as `${…}` (an app that did not
fill it in) counts as unset. A daemon that is already running keeps what it started with:
`open-artifact daemon stop`, and the next tool call starts it again.

### Make a Link token

On a **Node site**, on the server, with the same environment as the site (so the address it prints is right):

```bash
node packages/host/src/node/main.ts link-token --user ada@example.com --label "Ada laptop"
```

**Expect:**

```
A Link token for ada@example.com (agt_WYqw6wWyaEWampMsO1X_xg) on the site at https://artifacts.example.com. It is shown this once; set it on the computer as
  OPEN_ARTIFACT_REMOTE=https://artifacts.example.com
  OPEN_ARTIFACT_REMOTE_TOKEN=oa_rt_…
It is good for one sign-in within 90 days. Revoke it: open-artifact-host link-token --revoke agt_WYqw6wWyaEWampMsO1X_xg
```

With Docker: `docker compose exec host node packages/host/src/node/main.ts link-token --user …` (not run here). Run
without the site's `OA_APP_ORIGIN`, it prints `http://localhost:4900` and warns that this is only the default address:
use the address people open. The person is made if missing, with that email counted as verified.

Revoke: `link-token --revoke agt_…` answers `Revoked agt_…: the computer that used it is signed out.`

On a **Cloudflare site**, use the admin API ([hosting-cloudflare.md](hosting-cloudflare.md#link-tokens-on-cloudflare)).

### Check a preset

Run here with the environment form, in a fresh `OPEN_ARTIFACT_HOME` whose `settings.json` gives it its own port, with
the token `link-token` printed (above). The first command starts the daemon with these variables:

```bash
OPEN_ARTIFACT_REMOTE=https://artifacts.example.com \
OPEN_ARTIFACT_REMOTE_NAME=work \
OPEN_ARTIFACT_REMOTE_TOKEN=oa_rt_… \
OPEN_ARTIFACT_PUBLISH=auto \
open-artifact remote status
```

**Expect:**

```
work (https://artifacts.example.com): signed in as ada@example.com, connected
  nothing published

New artifacts are published automatically to work.
```

`<OPEN_ARTIFACT_HOME>/logs/daemon.log` shows:

```
link: added the preset remote work (https://artifacts.example.com)
link: signed in to work (https://artifacts.example.com) with the preset token as ada@example.com
```

and after the agent made an artifact (here `Artifact {action: "adopt"}` on a whiteboard folder), within a second:

```
link: published art_0mwrwucojb833c54804e959cb to work (https://artifacts.example.com/a/art_0mwrwucojb833c54804e959cb)
link: published art_0mwrwucojb833c54804e959cb to work by itself
```

If the daemon was already running when you set the variables, it did not read them: `open-artifact daemon stop`,
then run the command again. `preset.json` with the same keys is read the same way (`packages/daemon/src/preset.ts`);
that form was not run for this version of the guide.

## Each agent app

One daemon serves every app on the computer, so **the app that starts it first decides its environment**. The apps
differ in what they pass on (from `plugins/README.md`, which records how each was checked):

| App | Point it at a site | Publish by itself | Checked |
| --- | --- | --- | --- |
| Claude Code | The plugin's **Open Artifact server** setting (asked when the plugin is enabled); or `OPEN_ARTIFACT_REMOTE` in the environment `claude` starts in; or `preset.json` | `OPEN_ARTIFACT_PUBLISH=auto` there or in `preset.json`; or `remote auto on`, or the Share panel | Run with a probe server |
| Codex | **`preset.json` only.** Codex starts MCP servers with a fixed short list of variables, so your shell's variables never arrive | `"OPEN_ARTIFACT_PUBLISH": "auto"` in `preset.json`; or the CLI or Share panel | Read from Codex's source; not run |
| Cursor | A team admin sets **Open Artifact server** (`OPEN_ARTIFACT_SERVER`) in the Cursor dashboard; or `OPEN_ARTIFACT_REMOTE` in the environment Cursor starts in; or `preset.json` | As Claude Code | cursor-agent with a probe; the dashboard setting and the Cursor app not tried |
| GitHub Copilot CLI | `OPEN_ARTIFACT_REMOTE` in the environment `copilot` starts in, or `preset.json` | As Claude Code | Run with a probe; VS Code agent mode not tried |
| Antigravity | `preset.json` | `preset.json`, the CLI or the Share panel | Docs read; not run |
| DeepSeek Harness | The environment it runs in, or `preset.json` | As Claude Code | Read from the plugin's code; not run |
| ChatGPT on the web | The environment of `open-artifact chatgpt`, or `preset.json` | As Claude Code | Read from the code; not run |
| Any agent with the skill | The environment the agent runs `open-artifact` in, or `preset.json` | As Claude Code | Read from the code; not run |

An app opened from the Dock or the Start menu does not see variables from your shell profile: use `preset.json`.
When in doubt, `preset.json` works for every app.

## Remote MCP

An agent that cannot run Open Artifact on its computer (a hosted agent, a phone app) can use the site directly at
`<app origin>/mcp` (MCP over streamable HTTP). It acts as the person who approves it, with that person's roles.

1. Add the server to the MCP client with the address `https://artifacts.example.com/mcp`. The client finds the rest
   itself: an unauthenticated call answers 401 with

   ```
   www-authenticate: Bearer resource_metadata="https://artifacts.example.com/.well-known/oauth-protected-resource/mcp", scope="artifacts.read artifacts.write comments share.read"
   ```

   and the metadata names the authorization server (`/oauth/authorize`, `/oauth/token`, `/oauth/register`,
   `/oauth/revoke`; OAuth 2.1 with PKCE). Clients register themselves, use a Client ID Metadata Document (an https
   client id), or are listed by the site's admin in `OA_OAUTH_CLIENTS`.
2. The person signs in to the site if needed and sees the consent page:

   > **Connect an app** — Test MCP client asks to use Open Artifact on this site as you. It runs at 127.0.0.1:9, and
   > you will be sent back there. This app registered itself: its name is not verified. It will be able to: see the
   > artifacts you can open here and read their files; make new artifacts and change the ones you may edit; read and
   > answer comments, and get the comments and requests sent to your agent; see how your artifacts are shared.

   **Allow** sends the client back with a code it exchanges for a token (valid 3600 s, refreshed by the client).
3. The tools are `Artifact`, `ArtifactComments`, `ArtifactData` and `ShowArtifact`.

**Check:** ask the agent to list your artifacts (`Artifact {action: "list"}`); it shows them with your role.

Run here with curl as the client: registration, consent, token, `initialize` (server `open-artifact 0.14.6`), the tool
list, `list` and `snapshot`. Not run with a real agent app; how to add an MCP server with OAuth differs per app (for
example a "custom connector" or `mcp add --transport http`), see the app's documentation.

What it can and cannot do: there is no picture made on the site. `Artifact {action: "call", name: "snapshot"}` answers
with a read-only page address valid for 5 minutes (`page_url`, 1440×900) for a client that can open pages itself.
Exports and PDFs need a person's browser or a connected computer. A browser-based client must call from the app origin
or an origin listed in `OA_MCP_ORIGINS`.

## Dashboards and their data

A Data dashboard's live queries run through **connectors**, which exist only on the owner's computer. The site never
runs them. So, for a published dashboard, the owner's computer runs the queries and puts the answers on the site, and
the page there shows them with **Data as of <time>, from <owner>'s computer**.

- **Who decides.** Publishing a dashboard yourself in the Share panel publishes its data too; `open-artifact publish`
  in your own terminal asks first ([above](#publish-an-artifact)), and without a terminal leaves the rows out. The
  Share panel says so before you press Publish: "Publishing this dashboard publishes its data too: this computer runs
  its live queries and puts the rows on the site, where everyone who can open it sees them." A dashboard published by
  itself (auto-publish) or by an agent goes up **without** rows; the Share panel then shows "Its live data isn't on the
  site yet" and a **Publish its data** button. Only the person presses it.
- **When it refreshes.** When it is published; when someone presses **Refresh** on the site's page (the owner, or an
  editor while the owner lets editors ask the agent); and on a timer while the computer is connected, every 6 hours by
  default. A refresh asked for while your computer is off waits until it is back.
- **Why only every 6 hours.** Each refresh runs every live query of every published dashboard against your data
  source, and most warehouses bill per query; your computer may also be asleep. Press Refresh when you need newer
  figures. To change the timer, set minutes in `<OPEN_ARTIFACT_HOME>/settings.json`, for example
  `{"cloud": {"dataRefresh": 60}}`; `0` turns the timer off (publish and Refresh still work).
- **Keeping a query private.** A dataset with `"snapshot": false` next to its `source` never leaves your computer;
  readers of the site see "Live data isn't available in this view." for it.
- **Size.** One query's answer over 256 KB fails by name and is never cut; aggregate in the query.
- **What is not replayed.** The site replays exactly the answers taken at the dashboard's stored filters. A reader's
  own filter changes are not re-run; a loader's own `call(...)` is not replayed (give it a dataset of its own).
- **Failures.** A failed refresh keeps the last answers; the owner sees why ("The last refresh failed: …").
- **Taking it back.** Unpublishing removes the answers from the site. (The daemon can also take back the confirmation
  alone, through its `artifacts.data` API with `publish: false`; the Share panel has no button for that yet.)

Not run here: no dashboard with a live connector was published while writing this guide. The behaviour above is read
from `packages/daemon/src/data-refresh.ts`, the Share panel and the Data editor; the repository's
`e2e/host-data.test.mjs` and `e2e/cloudflare-data.test.mjs` cover it.

## Limits

- Snapshots, PDFs and videos are made on a computer: yours (the agent's, from the working copy) or a person's
  browser. Never on the site.
- A dashboard's figures on the site are only as new as the last refresh from the owner's computer.
- An artifact belongs to one site at a time: publish it elsewhere only after unpublishing it.
- A site takes up to 100 MiB per push on Node, 32 MiB on Cloudflare.
- Publishing an artifact that someone else already published under the same id is refused; duplicate it and publish
  the copy.
