# Putting artifacts on a site

[中文](hosting.zh-CN.md)

Open Artifact makes artifacts (slides, docs, sheets, dashboards, whiteboards, designs, motion) on your own computer.
A **site** is a server that gives those artifacts a **web address** that works when your computer is off. People
sign in there, open what is shared with them, edit and comment together. Your agent **publishes** an artifact to the
site, and keeps working on it from your computer.

This page explains how a site works and helps you pick where to run one. The step-by-step guides are linked at the end.

> **If you are an agent doing this for someone**
>
> - Ask, never guess: the domain names; which cloud account to use; who may sign up; whether artifacts may be made
>   public; whether a dashboard's data may be published.
> - **One domain for both** (`OA_CONTENT_SAME_SITE=true`) is the person's decision, never yours. Offer a second name
>   first (a second domain, `nip.io` on a LAN, `workers.dev` on Cloudflare). If there is none, show them
>   [what it weakens](#one-domain-for-both) and turn it on only after they say yes to that.
> - Only the person can: add DNS records, sign in with the owner key, approve a computer, pay or accept a plan.
> - Never print a secret (signing keys, the owner key, Link tokens, OAuth secrets). Say where it is stored instead.
> - Ask before you create or delete a cloud resource, or anything that costs money.
> - Check each step with its **Check:** command before the next one. After two failures of the same step, stop and
>   report what you ran and what you saw.

## The words

The product and the code use different words for the same things. The guides use the product's words.

| In these guides | In the code and the logs | What it is |
| --- | --- | --- |
| site | host | The server: Node (`packages/host`) or Cloudflare (`packages/host-cloudflare`). |
| web address | view URL, `/a/<id>` | Where an artifact opens on the site. |
| connect a site | `remote add` | Link your computer's Open Artifact to a site. |
| publish / unpublish | Link `import` / `unpublish` | Put an artifact on the site, or take it off. |
| your computer's Open Artifact | the daemon | The local program the agent apps start. It keeps a folder per artifact. |
| room | artifact object, room | The live copy of one artifact on the site (on Cloudflare, one Durable Object). |

## How the parts fit

```
 agent app (Claude Code, Codex, Cursor, ...)
        |  MCP tools
        v
 Open Artifact on your computer  ----- publish, then sync both ways ----->  site
 (the daemon, one folder per artifact)  <---- comments, requests, edits ---  (app origin + content origin)
                                                                              ^
                                                     people, in a browser ---+
                                                     remote MCP clients -----+
```

- The agent makes and edits the artifact on your computer, as without a site.
- **Publish** copies the artifact to the site. From then on, the folder on your computer is a **working copy**: your
  changes are pushed to the site, and changes people make on the site come back to the folder. If the two collide,
  the site's version wins and yours is kept under `_agent/conflicts/` in the folder.
- Comments and requests people send to "the agent" on the site reach your computer's Open Artifact, which hands them
  to your agent. If your computer is off, they wait on the site.
- **Unpublish** moves the site's copy to the site's trash. The folder stays on your computer with the latest changes.
  The trash keeps it for `OA_TRASH_DAYS` days (30 by default; `0` keeps it until its owner deletes it forever), and
  the home page's trash says how long. The home page's **Upload** takes a `.zip` up to the site's limit (100 MiB on
  Node, 32 MiB on Cloudflare) and refuses a larger one before sending it.
- An agent that cannot run Open Artifact locally can use the site directly over **remote MCP** (`/mcp` on the site).

## Two web origins

A site answers on two origins:

| | Example | Serves | Cookies |
| --- | --- | --- | --- |
| **App origin** (`OA_APP_ORIGIN`) | `https://artifacts.example.com` | sign-in, the home page, the Shell (the frame around each artifact), sharing, the APIs, `/mcp` | the session cookie |
| **Content origin** (`OA_CONTENT_ORIGIN`) | `https://{id}.oa-content.example.net` | each artifact's own pages, one host name per artifact | none; a short-lived page token is in the address |

Why: an artifact's page is HTML that a person or an agent wrote. It must never be able to read the session cookie, or
it could act as whoever opens it. So:

- The content origin must be a **different registrable domain** from the app (`example.net` against `example.com`, not
  just another sub-domain). Both hosts refuse to start otherwise.
- `{id}` must be the whole first label of the content host. It is the artifact id with `_` turned into `-`, so
  `art_0mwr…` is served at `art-0mwr….oa-content.example.net`. The content origin therefore needs a **wildcard** DNS
  name.

**Which name answers what.** In every layout (two domains, one domain, a LAN, Node or Cloudflare) the site looks at
the name a request was sent to (its `Host`, upper or lower case, with the default port or without) and answers:

- the app, with every app route (sign-in, pages, APIs, `/mcp`, `/link/…`, `/plugins/…`), only on the app origin's own
  host and port, exactly as `OA_APP_ORIGIN` has it;
- an artifact's pages only on that artifact's content host;
- any other name that reaches it (another name of the domain such as `www.example.com`, the bare content domain, the
  server's IP address when the app is a name, `localhost` when the app is `127.0.0.1`, a name with a trailing dot)
  with **421** and one line of text, `<name> is not this site's app host nor an artifact's: Open Artifact does not
  answer it.`: no page, no cookie, no redirect, no form, on GET and on writes alike;
- a request without a usable `Host` (missing, or not a host name) with **400** `The request has no valid Host header.`

The health check (`/__open-artifact/health`) is the one exception: it answers on any name, so a load balancer or a
container check can probe the server by address. Behind a proxy, the host the site judges is `X-Forwarded-Host` only
with `OA_TRUST_PROXY=1` on Node; otherwise it is the `Host` the proxy sent, so the proxy must pass the original name
on.

How "registrable domain" is judged: the last two labels of the name (`example.com`), except that `nip.io`, `sslip.io`
and `home.arpa` names use three (`192-168-1-20.nip.io`), and an IP address is its own site. So on a LAN,
`oa.lan` and `oa-content.lan` are two sites, but `nas.lan` and `{id}.nas.lan` are one, and are refused.

A person with one domain should first use a second name that is a different site: a second domain, a `nip.io` name on
a LAN, or Cloudflare's `workers.dev` address for the app. When there is truly only one, the site can run with both on
it, weaker in the ways the next section lists: [One domain for both](#one-domain-for-both).

## One domain for both

`OA_CONTENT_SAME_SITE=true` lets the content origin sit on the app's own registrable domain:

| | App origin | Content origin |
| --- | --- | --- |
| Server | `https://app.example.com` | `https://{id}.example.com` |
| LAN | `http://nas.lan:4900` | `http://{id}.nas.lan:4900` |
| Cloudflare, one zone | `https://app.example.com` (Custom Domain) | `https://{id}.example.com` (route) |

Without the setting such a pair is refused, with a message that names it:

```
open-artifact-host: OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN (http://nas.lan:4977), so that artifact pages cannot reach the session cookie: use another registrable domain. With only one domain, OA_CONTENT_SAME_SITE=true allows it, at a cost: read "One domain for both" in docs/hosting.md first.
```

Even with it, the hosts stay apart. The app's host is never a content host nor a name under one: an app at
`art-app.nas.lan` is refused, because every `art-…` label is an artifact's. (A content host under the app's host, as
`art-….nas.lan` beside `nas.lan`, is allowed.) Every other name of the domain, such as `www.example.com`, gets the
421 described in [Two web origins](#two-web-origins), as in every layout.

The guides show how to set it up: [LAN](hosting-lan.md#one-domain-for-both),
[server](hosting-server.md#one-domain-for-both), [Cloudflare](hosting-cloudflare.md#one-domain-for-both).

### What it weakens, and what the site does about it

Two origins on two sites keep an artifact's page (HTML a person or an agent wrote) away from the app in every way a
browser knows. On one site, the browser treats the two as neighbours. Each way that matters:

- **The app's cookies go along with an artifact page's requests.** The session cookie is `SameSite=Lax`, and "same
  site" is exactly this case, so a page on `art-….example.com` that sends a request to `app.example.com` sends the
  person's session with it. What the site does: every write on the app origin (each route that is not GET, HEAD or
  OPTIONS, and the MCP sign-in approval) from a browser is refused unless it comes from the app's own pages:
  `Sec-Fetch-Site` must be `same-origin`, and a `same-site` request is refused like a `cross-site` one (403
  `not_granted`); `none` (typed in the address bar) passes only without cookies, so it cannot use a session. A client
  that sends no `Sec-Fetch-Site` (the Link daemon, curl, an old browser) is judged by `Origin`: absent or the app
  origin passes, any other value (`null` included) is refused; such a client acts through its own credential (a Bearer
  token, or a session cookie it holds), never through a browser's. The GETs that
  used to change something now do so only on a visit to the page: opening a share link joins only on a top-level
  visit that did not come from a neighbour host, otherwise it shows a page with an **Open it** button; sign-in's
  start and callback refuse an image, a fetch or a frame. Other GETs change nothing a person would notice (opening an
  artifact starts its room; it does not grant anything). The site's tests walk every write route of the router to
  check this. A site plugin's own GET routes are the plugin's responsibility.
- **An artifact page tries to read the app's answers.** Same-site does not mean same-origin, so the browser still
  withholds them unless the app allows it, and it does not: no CORS for content hosts, and every app answer carries
  `Cross-Origin-Resource-Policy: same-origin`, so an `<img>`, `<script>` or no-cors `fetch` to the app gets nothing
  (the request is still sent, which is why writes must be refused as above). App pages cannot be framed
  (`frame-ancestors 'none'`, `X-Frame-Options: DENY`). The Shell and the home page carry
  `Cross-Origin-Opener-Policy: same-origin-allow-popups`, so a window an artifact page opened them from, or that
  opened them, has no handle on them. The sign-in and MCP approval pages do not: a web MCP client opens them in a
  popup and waits on it. Both origins send `Origin-Agent-Cluster: ?1`, so neither can relax itself into the other with
  `document.domain`. **These two headers work only on https** (and on `localhost` names): browsers ignore both on any
  other plain-http origin, Chrome with a console message, so a plain-http LAN site does not send them. There a window
  an artifact page opened the Shell from, or that the Shell opened, keeps a handle on it: it cannot read the Shell,
  but it can send it to another address (a look-alike sign-in page) or count its frames. And an artifact page can set
  `document.domain` to the shared domain; the app's pages never do, so that gives it no access to them.
- **Cookie tossing: an artifact page sets a cookie for the whole domain.** Any host may set a cookie with
  `Domain=example.com`, and the browser then sends it to the app too. On https the app's cookies are
  `__Host-oa_session`, `__Host-oa_flow` and `__Host-oa_guest_…`: the browser lets no other host set or replace a
  `__Host-` cookie, and the app reads no other name, so a tossed `oa_session` is ignored. On http (a LAN) the names
  have no prefix, so the site defends itself: when a request carries one of its cookie names twice, it ignores every
  copy, ends the sessions they name, answers as if signed out, deletes the copies (on the host, on each parent domain
  and on each path of the request), writes `auth.duplicate_cookie` to the audit log and a line to the log:
  `refused duplicate cookies (oa_session) on /…: another host of this domain set them`. Both orders are covered (the
  tossed copy first or last).
- **Other apps' cookies on the domain.** The content path drops the `Cookie` header before the artifact's server code
  sees it, and drops any `Set-Cookie` the artifact's server answers with, on Node and on Cloudflare. The browser still shows script on
  an artifact page every cookie of `example.com` that is not `HttpOnly`, and lets it set new ones there: that comes
  with putting artifacts on a domain that has other apps.
- **One browser process for both.** Browsers isolate pages by site; on one site an artifact page and the Shell may share
  a process, so a speculative-execution attack in the page could read the Shell's memory. `Origin-Agent-Cluster: ?1`
  asks the browser to keep each origin apart; whether that means a separate process is the browser's choice. On plain
  http (other than `localhost`) the browser ignores it, so the page and the Shell share one agent cluster, and with it
  one process. What the
  Shell holds in script-readable memory: the person's name and email, the artifact's page address with its short-lived
  page token, and while the Share panel is open the share-link addresses. The session cookie is `HttpOnly` and never
  in script.
- **Look-alike pages and password managers.** An artifact page at `art-….example.com` can draw a copy of the sign-in
  page, under the same domain as the real one. Password managers that fill by domain may offer the owner key or a
  password there. The site cannot stop either: tell people to sign in only at the app's host, and set the password
  manager's entry to that exact host (1Password: "Only fill on this exact host"; Bitwarden: URI match "Host").

| Threat | What the site does | What remains on https | What remains on http (LAN) |
| --- | --- | --- | --- |
| An artifact page sends writes with the person's session | Refuses every write that is not `same-origin`; join and sign-in GETs act only on a top-level visit | Nothing known | Nothing known |
| An artifact page reads app answers | No CORS; CORP `same-origin`; no framing; COOP on the Shell and home and OAC `?1`, on https only | Nothing known | No COOP or OAC (browsers ignore them on http): a page that opened the Shell, or was opened by it, can send that window to another address; it still reads nothing |
| Cookie tossing into the app | `__Host-` cookies; the duplicate-cookie guard as a backstop | A page can fill the domain's cookie jar so the browser drops the app's cookie: the person is signed out (annoying, not a takeover) | A **signed-out** browser takes a tossed `oa_session` as its own: it is then signed in as whoever's session the page planted (the attacker's), and what the person writes there goes to the attacker. A two-step toss (fill the jar to drop the real cookie, then plant one) does the same to a signed-in browser. The guard only sees duplicates. |
| Other apps' cookies on the domain | Drops `Cookie` and `Set-Cookie` on the content path | Script on artifact pages reads and sets the domain's non-`HttpOnly` cookies | The same |
| Shared browser process | OAC `?1` (on https only); HttpOnly session | A speculative-execution attack may read the Shell's memory where the browser keeps one process per site | The page and the Shell always share one process (no OAC on http), so the same attack applies in every browser |
| Look-alike sign-in page, autofill | Nothing it can do | People can be fooled; domain-wide password-manager matches | The same |

So: on https, one domain costs little beyond the look-alike risk and the other apps on the domain. On http it costs
more: a person who opens a hostile artifact while signed out can be signed into someone else's account without
noticing. On a LAN, prefer two names: `nip.io` for the artifacts needs nothing but working DNS
([hosting-lan.md](hosting-lan.md#choose-the-names)).

**Signing keys.** A Node site whose app origin is on this computer or a private network makes its own signing key
(`keys.json`), in either mode. Same-site mode changes nothing there: the key signs page addresses and share links,
which no neighbour host can read.

## Page artifacts

A `page` artifact (a free HTML page an agent wrote, with the capabilities it declares) runs on a site (Node or
Cloudflare) on one more host name per person, under the same wildcard as the content origin:

| | Example | Serves |
| --- | --- | --- |
| The artifact's content host | `art-0mwr….oa-content.example.net/page/<page token>/` | the inner shell, the frame around the page, and the API every write goes through |
| A page host | `art-0mwr…--k3vq…7x.oa-content.example.net` | that person's view of the page and its files, read only |

- The part after `--` is 24 characters made with the site's signing key from the artifact, the person and the site
  epoch. It is never a page token and is never taken as one. It stays the same while the person keeps access, so the
  page keeps its origin (and what the browser stores for it) across reloads and restarts. It stops working when they
  lose access, and when everyone is signed out (a new epoch).
- **DNS** needs nothing new: the content origin's wildcard covers page hosts.
- **Certificates: page artifacts need a wildcard certificate for the content domain** (`*.oa-content.example.net`).
  Every certificate a public authority issues is written to the Certificate Transparency logs, which anyone can
  search. A certificate made for one page host would publish that host's name, and with it that someone opened that
  page and when. So the on-demand ask endpoint (`/tls-ask`) refuses page hosts by default and only answers for the
  app host and content hosts. **`OA_PAGE_HOST_ON_DEMAND_TLS=true`** makes it also say yes to a page host while it
  names someone with access; use it only where those logs are not a concern (a private authority, a test site). The
  start-up line `tls-ask:` says which mode is on.
- **`OA_PAGE_NETWORK`**: `self` (default), a page reaches only its own origin; `https`, it may also fetch any https
  origin, and `network.origins()` then answers `["https:"]`.
- **One domain for both** (`OA_CONTENT_SAME_SITE=true`): the site runs no pages. Publishing one is refused, and the
  start-up lines say `pages: off`. The Cloudflare host runs pages too ([Page artifacts](hosting-cloudflare.md#page-artifacts)).

What each role may do on a page, and what syncs with the computer it was published from:
[Page on a site](types/page.md#on-a-site).

## Published types

A **Node** site that runs pages also keeps the types people publish to it (`open-artifact types publish`, see
[Publish to a site](custom-types.md#publish-to-a-site)), and runs the artifacts made with them.

- **`OA_TYPES_PUBLISH`**: who may publish a type. `admins` (default: the site admins), `members` (anyone with an
  account) or `off` (nobody; what is published keeps running). With one domain for both (`OA_CONTENT_SAME_SITE=true`)
  it is always `off`, since such a site runs no pages. The start-up line `types:` says which is in effect and where
  they are kept.
- **Where they are kept**: `<OA_DATA_DIR>/types/<uid>/<version>/`, holding the package as published
  (`package.oatype`) and its files unpacked (`files/`, plain `0644` files), one version per type: a new version
  replaces the old one's folder. The catalog (id, uid, version, publisher, visibility, sha256) is the `types` table of
  the site's database. Back them up together with the rest of the data folder.
- **What a type can do there**: nothing runs on the server. A package is checked as `types install` checks one before
  anything is kept (one folder, plain files, no `..` or links, the size limits, a literal declaration), and only a type
  whose page is served as it is goes in: no `entry`, not a page type. Its page runs on the artifact's page host in a
  sandboxed frame, under a Content-Security-Policy made from its manifest's `openArtifact.network` list
  (`OA_PAGE_NETWORK` does not widen it). An agent on the site is told that the type's text is its publisher's.
- **What admins should know**: an admin may publish a new version of anyone's type and unpublish it. Unpublishing a
  type that artifacts use only delists it (they keep opening); with none left it is deleted. A published id belongs to
  the first `uid` that took it; a built-in id is never taken. Every publish and unpublish is in the audit log
  (`type.publish`, `type.unpublish`), and a plugin can refuse a publish with the `type.publish` guard
  ([Plugins](plugins.md)).
- The Cloudflare host keeps no published types yet.

## Roles and sharing

- Each artifact has one **owner**. The owner and the site's admins decide who can open it, in the Share panel on the
  site.
- People get a role: **editor**, **commenter** or **viewer**. A role can go to an email, a whole email domain, or a
  sign-in group.
- General access is **restricted**, **anyone with the link** (a link that gives a role; people without an account
  join as a named guest) or **public** (anyone with the address can view, if the site allows it).
- **Site admins** are the emails in `OA_OWNERS`, plus whoever signs in with the **owner key**, a secret sign-in address
  for the person who runs the site. With `OA_OWNERS` empty, the first account ever made is an admin too.
- **Who may sign up** (`OA_SIGNUP`): `invite` (default: people something was shared with), `owners-only`,
  `domain:<name>` or `open`.

## What the site does not do

- **It never runs a browser.** Pictures, PDFs and videos of an artifact are made on someone's own computer: people
  export in their own browser (a Docs PDF through the browser's print dialog), and an agent with a connected computer
  makes snapshots and exports there, from the working copy. An agent that only uses remote MCP gets a short-lived
  read-only page address instead of a picture.
- **It never runs connectors.** A Data dashboard's live queries run on the owner's computer. When the owner publishes
  the dashboard and confirms that its data goes with it, the owner's computer runs the queries and puts the answers on
  the site, and the page there says "Data as of <time>, from <owner>'s computer". See
  [Connecting agents](connecting-agents.md#dashboards-and-their-data).
- No LAN sharing (sharing and links replace it), no idle exit, no upload by a path on the server's disk.

## Which kind of site

| | On your LAN | Your own server with a domain | Cloudflare |
| --- | --- | --- | --- |
| Guide | [hosting-lan.md](hosting-lan.md) | [hosting-server.md](hosting-server.md) | [hosting-cloudflare.md](hosting-cloudflare.md) |
| Who can reach it | Computers on that network | Anyone on the internet | Anyone on the internet |
| You need | An always-on computer (a NAS, a mini PC, a spare Mac); Node 22.18 or later, or Docker | A server with a public address (VPS, EC2), Docker; two domain names you control (or one, [weaker](#one-domain-for-both)); ports 80 and 443 | A Cloudflare account; one zone (domain) on it for the artifacts; Node 22.18 or later on your computer to deploy |
| Names | None: `http://192.168.1.20:4900` with `nip.io`, or LAN wildcard DNS (one name, `nas.lan` and `{id}.nas.lan`, only [weaker](#one-domain-for-both)) | An app host and a wildcard on a second registrable domain; or both on one domain, [weaker](#one-domain-for-both) | The `workers.dev` address for the app, a wildcard route on your zone for artifacts; or the app on a Custom Domain of the same zone, [weaker](#one-domain-for-both) |
| HTTPS | No, plain http (private network only) | Yes, Caddy gets certificates | Yes, Cloudflare's |
| Costs | Your electricity | The server, the domains | Workers Paid ($5 a month minimum) is the realistic plan; usage above it is billed |
| Backups | `deploy/backup.sh` | `deploy/backup.sh`, daily on AWS | D1 Time Travel for the catalog; each artifact's zip |
| Cannot do | Reach anyone outside the network; encrypt traffic | Keep two origins apart on one domain as well as on two | `open-artifact-host` commands (an admin API stands in for `link-token`); uploads over 32 MiB; types added after the build |
| Run for these guides | Yes, on one computer with `127-0-0-1.nip.io` (not a real LAN) | The host without Docker, yes; Docker, Caddy and AWS, no | Locally under `wrangler dev`; a real deployment on 2026-11-22 |

Then connect your computers and agents: [connecting-agents.md](connecting-agents.md).

## Rough edges you may meet

- A published artifact's local address (`/a/<id>` on your computer) sends you to the site while the site can be
  reached. When it cannot, the local page opens the working copy instead, and your changes wait on your computer until
  the site is back. So the same address can show two different pages depending on the network.
- On Cloudflare, one zone for artifacts and the `workers.dev` address for the app is the tested layout. An app host on
  the same zone as the artifacts is refused unless `OA_CONTENT_SAME_SITE=true`; that layout was run only under
  `wrangler dev`, not on a real zone.
- A dashboard's figures on a site are as old as the last refresh from the owner's computer (every 6 hours by default,
  or when someone presses Refresh).
