# Open Artifact host

The Open Artifact host is a single Node process that serves artifacts to people over the web. You run it on a server
you control: an EC2 or Lightsail instance, any VPS, or a machine at home. People sign in, open the artifacts shared
with them, edit and comment together, and share by email, group, domain or link. Agents work with the same artifacts
through the remote MCP endpoint, or through a computer's local daemon that is linked to the host.

**What the host is:**

- one process;
- one SQLite catalog of users, grants, links and sessions;
- one folder of artifacts, in the same layout the local daemon uses;
- the same type servers and editors as the local app.

**What it is not:**

- It is not a cluster. Each artifact's live room is in memory, so you run one process per host.
- It installs no type package from elsewhere, and runs no code from one. The built-in types are the ones in the
  checkout or the image; besides them it keeps the page-kind types people publish to it (`open-artifact types
  publish`, `OA_TYPES_PUBLISH`), as plain files under `<OA_DATA_DIR>/types/` whose pages run restricted on page hosts
  (see [Published types](../../docs/hosting.md#published-types)).
- It never runs a browser (see [Rendering happens on people's computers](#rendering-happens-on-peoples-computers)).

Every command in this guide was run while writing it, except the ones marked **not run here**. Docker, Caddy and AWS
were not available on the machine where it was written.

- [Quick start on your own computer](#quick-start-on-your-own-computer)
- [The two origins](#the-two-origins)
- [Deploy with Docker and Caddy](#deploy-with-docker-and-caddy)
- [Settings](#settings)
- [Sign-in](#sign-in)
- [Accounts and sharing](#accounts-and-sharing)
- [Getting artifacts onto the host](#getting-artifacts-onto-the-host)
- [Linking a computer's daemon](#linking-a-computers-daemon)
- [Remote MCP](#remote-mcp)
- [Rendering happens on people's computers](#rendering-happens-on-peoples-computers)
- [What else hosted mode leaves out](#what-else-hosted-mode-leaves-out)
- [Upgrades](#upgrades)
- [Backup and restore](#backup-and-restore)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)

## Quick start on your own computer

You need Node 22.18 or newer. The host runs its TypeScript source directly and uses the built-in `node:sqlite`. On
Node 22 this prints an `ExperimentalWarning`; `NODE_OPTIONS=--disable-warning=ExperimentalWarning` hides it.

```sh
git clone https://github.com/JimLiu/open-artifact.git
cd open-artifact
npm ci
npm run build                      # editors, Shell and home page into dist/

export OA_DATA_DIR="$HOME/.open-artifact-host"
node packages/host/src/node/main.ts import test-artifacts/whiteboard/elements
node packages/host/src/node/main.ts serve
```

On its first start the host prints the owner's sign-in address, once:

```
Open Artifact host 0.14.6 listening on http://127.0.0.1:4900
  app:     http://localhost:4900
  content: http://{id}.content.localhost:4900
  data:    /Users/you/.open-artifact-host

Sign in as the owner (shown this once; `open-artifact-host owner-key` makes a new one):
  http://localhost:4900/auth/sign-in#key=…
```

Open that address in Chrome or Firefox. Both send `*.localhost` names to your own computer, so the content origin works
without any DNS set-up.

On localhost, or a private network's name (see [On a home or office network](#on-a-home-or-office-network)), the
host makes a signing key itself and keeps it in `<OA_DATA_DIR>/keys.json`. A host on a public domain refuses to start
without `OA_SIGNING_KEYS`.

The other commands:

```sh
node packages/host/src/node/main.ts version
node packages/host/src/node/main.ts owner-key      # replaces the owner key and prints a new sign-in address
node packages/host/src/node/main.ts import <folder|zip> [--owner <email>]
node packages/host/src/node/main.ts link-token --user <email> [--label <text>]   # a token that links a computer
node packages/host/src/node/main.ts link-token --revoke <id>
```

- `owner-key` works while the host is running. The old key stops working at once.
- `import` takes an artifact folder or a `.zip` from the Shell's "Download .zip". It belongs to the owner-key user,
  or to `--owner <email>`; that user is created if it does not exist yet.
- `link-token` makes a Link token for a person (created if missing), for setting up a computer without a browser
  approval: see [Set a computer up in advance](#set-a-computer-up-in-advance).
- Stop the host with Ctrl-C or SIGTERM. It closes its connections and the database, then exits.

## The two origins

The host answers on two origins:

| | Example | What it serves | Cookies |
| --- | --- | --- | --- |
| App (`OA_APP_ORIGIN`) | `https://artifacts.example.com` | sign-in, the home page, the Shell, sharing, `/mcp`, the Link API | the session cookie, `__Host-oa_session` |
| Content (`OA_CONTENT_ORIGIN`) | `https://{id}.oa-content.example.net` | each artifact's own pages, one host name per artifact | none: a short-lived page token in the address |

An artifact's page is HTML that its author or an agent wrote, so it must never be able to reach the session cookie.
That is why the content origin has to be a different registrable domain: `example.net` against `example.com`, not
just another sub-domain. The host refuses to start otherwise, unless `OA_CONTENT_SAME_SITE=true`: then one domain
serves both (`app.example.com` and `{id}.example.com`), weaker in the ways `docs/hosting.md` lists under "One domain
for both". Even then the app's host is never a content host nor under one, and the host answers the app only on the
app's own host name (421 for any other).

In the content host name, `{id}` is the artifact id with `_` turned into `-`. For example `art_0mwr…` is served at
`art-0mwr….oa-content.example.net`.

DNS needs two records, both pointing at your server:

```
artifacts.example.com.          A     203.0.113.10
*.oa-content.example.net.       A     203.0.113.10
```

Add AAAA records as well if the server has IPv6.

A `page` artifact uses one more name per person under the same wildcard: the artifact's content host serves the inner
shell at `/page/<page token>/`, and the page itself runs on `art-<id>--<opaque>.oa-content.example.net`, read only. The
opaque part is an HMAC of the signing key over the artifact, the person and the site epoch; it lasts while the person
keeps access. `docs/hosting.md` ("Page artifacts") has the details; `OA_PAGE_NETWORK` sets what pages may fetch. With
`OA_CONTENT_SAME_SITE=true` the host runs no pages and refuses to take one.

## On a home or office network

A host on your LAN can run over plain http, without a certificate. Plain http is accepted for these names, judged by
the name as written (nothing is looked up in DNS):

- private addresses: `10.x`, `172.16-31.x`, `192.168.x`, link-local `169.254.x`, IPv6 `fc00::/7` and `fe80::/10`;
- names under `.local`, `.lan`, `.home.arpa` or `.internal`, and one-word names such as `nas`;
- `nip.io` and `sslip.io` names that spell a private address, such as `192-168-1-20.nip.io`.

For any other name, set `OA_ALLOW_HTTP=true` to allow http anyway. Over http the session cookie is `oa_session`
without `Secure`: browsers only keep the `__Host-` prefix and `Secure` over https. Traffic is not encrypted, so use
this only on a network you trust.

The content origin still needs one host name per artifact (`{id}` as the first label), and a bare address cannot do
that. There are two ways to get those names on a LAN.

**Wildcard DNS on the LAN.** If your router or DNS server (dnsmasq, Pi-hole, AdGuard Home, OpenWrt) can answer a
wildcard, point both names at the server, for example in dnsmasq:

```
address=/oa.lan/192.168.1.20
address=/oa-content.lan/192.168.1.20      # also answers *.oa-content.lan
```

```sh
OA_APP_ORIGIN=http://oa.lan:4900 \
OA_CONTENT_ORIGIN=http://{id}.oa-content.lan:4900 \
OA_BIND=0.0.0.0 node packages/host/src/node/main.ts
```

**nip.io, with no DNS set-up.** `nip.io` answers any name that spells an address with that address, so
`art-….192-168-1-20.nip.io` reaches `192.168.1.20`. Use the address itself for the app:

```sh
OA_APP_ORIGIN=http://192.168.1.20:4900 \
OA_CONTENT_ORIGIN=http://{id}.192-168-1-20.nip.io:4900 \
OA_BIND=0.0.0.0 node packages/host/src/node/main.ts
```

This needs the computers on the LAN to reach the public `nip.io` DNS, and some routers block answers that point at
private addresses (DNS rebinding protection): allow `nip.io` there, or use the wildcard set-up. `sslip.io` works the same
way.

Then link each computer to it: `open-artifact remote add home http://192.168.1.20:4900`. The daemon accepts http for the
same names. For a private-network host it prints a short reminder that the connection is not encrypted; for
`localhost` and other loopback addresses it prints nothing. Any other name over http is refused unless
`--insecure-http` (or `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1`) is given, and then the warning says the token and
everything published cross the internet in clear text.

## Deploy with Docker and Caddy

`deploy/docker` runs the host behind [Caddy](https://caddyserver.com), which gets the certificates and proxies to the
host. **Not run here:** Docker was not installed where this was written, so the image was never built and compose was
never started. The image's file set was checked another way:

1. `deploy/docker/stage.sh` was run.
2. Then `npm ci --omit=dev` ran in a read-only copy.
3. That copy was started with the image's settings, and sign-in and pages were checked through a content host.

```sh
cd deploy/docker
cp .env.example .env          # then fill in APP_HOST, CONTENT_DOMAIN, ACME_EMAIL and OA_SIGNING_KEYS
docker compose up -d --build
docker compose logs host      # the owner's sign-in address is printed here once
```

The image:

- is built from the root `Dockerfile`;
- uses Node 22 LTS and runs as the non-root `node` user;
- keeps everything in the `/data` volume;
- listens on 4900;
- has a health check on `GET /__open-artifact/health`.

Caddy needs a certificate for every content host. There are two ways to get them, and you pick one in `.env`:

- **On demand (the default, `Caddyfile.on-demand`).** Caddy gets a certificate the first time a content host is
  visited, over HTTP-01.
  - Before it asks Let's Encrypt, it checks with the host's internal `GET /tls-ask?domain=` endpoint. This runs on
    `OA_INTERNAL_PORT`, which compose sets to 4901 and does not publish.
  - The endpoint answers 200 only for the app host and for the content hosts of artifacts that exist and are not in
    the trash, so strangers cannot make Caddy request certificates for made-up names.
  - Let's Encrypt allows 50 new certificates per registered domain per week. Past that, use DNS-01.
- **One wildcard certificate by DNS-01 (`Caddyfile.dns` plus `compose.dns.yaml`).**
  - Set `COMPOSE_FILE=compose.yaml:compose.dns.yaml` and `CLOUDFLARE_API_TOKEN` in `.env`. Compose then builds a Caddy
    with the Cloudflare DNS plugin.
  - For another DNS provider, `Caddyfile.dns` says what to change.

The Caddy configuration does four things:

- forwards the Host header unchanged;
- sets `X-Forwarded-Proto`/`-Host`/`-For`, which the host trusts because compose sets `OA_TRUST_PROXY=1`;
- streams server-sent events without buffering;
- allows request bodies up to 101 MiB, just above the host's 100 MiB limit for uploads and Link pushes.

WebSockets need no extra settings.

`deploy/aws` has a CloudFormation template that makes an EC2 instance with all of this on it. Its README covers the
details.

### Without Docker

Run `node packages/host/src/node/main.ts serve` under systemd or a similar service manager. Give it:

- `OA_TRUST_PROXY=1`;
- a reverse proxy that terminates TLS;
- `OA_INTERNAL_PORT` if you want the on-demand ask endpoint.

Your proxy must:

- pass the original `Host`, or set `X-Forwarded-Host`;
- set `X-Forwarded-Proto: https`;
- allow WebSocket upgrades;
- not buffer `text/event-stream` responses;
- keep idle upstream connections for less than 130 seconds. That is how long the host keeps an idle connection open
  behind a proxy; if the proxy keeps them longer, it can reuse one the host has just closed and get a 502.

`packages/host/test/proxy.test.ts` checks all of this through a small proxy written for the test.

## Settings

Every setting is an environment variable. The host checks them all at start-up and refuses to start if one is wrong,
naming the variable and what is wrong with it.

### Addresses and secrets

| Variable | Default | Meaning |
| --- | --- | --- |
| `OA_APP_ORIGIN` | `http://localhost:4900` | The app origin. It must be https unless it is localhost or a private network's name ([On a home or office network](#on-a-home-or-office-network)). It decides the session cookie: `__Host-oa_session` with `Secure` on https. |
| `OA_CONTENT_ORIGIN` | `http://{id}.content.localhost:4900` | The content origin template. `{id}` must be the first label. It must be a different site from the app, unless `OA_CONTENT_SAME_SITE` is on. The same http rule applies. |
| `OA_CONTENT_SAME_SITE` | `false` | `true` lets the content origin be on the app's registrable domain (one domain for both). The person who runs the site decides, after reading "One domain for both" in `docs/hosting.md`. The app's host must still not be, or be under, a content host (no `art-` label). |
| `OA_ALLOW_HTTP` | `false` | `true` allows plain http for any name, not only localhost and a private network. |
| `OA_SIGNING_KEYS` | required, except on localhost or a private network, where `<OA_DATA_DIR>/keys.json` is made | Comma-separated secrets of at least 32 characters each. The first one signs and encrypts; all of them verify. |
| `OA_OWNER_KEY` | none: the host makes one and prints it once | The owner-key sign-in secret, at least 24 characters. When it is set, `owner-key` refuses to run; change the variable instead. |
| `OA_OWNER_NAME` | `Owner` | The name the owner-key user starts with. |

To make a signing key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

To rotate keys, put the new key first and keep the old ones after it. Page tokens last 12 hours, and API calls accept
them for another 24 hours after that, so keep an old key listed for at least a day and a half. Share-link addresses
are encrypted with whichever key comes first and can be read with any key on the list. Remove a key only once nothing
made with it is still needed.

### Sign-in, sign-up and sharing

| Variable | Default | Meaning |
| --- | --- | --- |
| `OA_AUTH` | `[{"kind":"owner-key"}]` | A JSON array of sign-in methods; see [Sign-in](#sign-in). |
| `OA_OWNERS` | none | Site admins, as comma-separated emails. They can open and manage every artifact. |
| `OA_SIGNUP` | `invite` | Who can create an account: `owners-only`, `invite`, `domain:<name>` or `open`. |
| `OA_LINK_MAX_ROLE` | `editor` | The highest role a share link can give: `editor`, `commenter` or `viewer`. |
| `OA_PUBLIC_ACCESS` | `true` | Whether an artifact can be made public, meaning anyone with the address can view it. |

### The Node process

| Variable | Default | Meaning |
| --- | --- | --- |
| `OA_DATA_DIR` | `~/.open-artifact-host` | The catalog (`host.db`), `artifacts/`, and `keys.json` on localhost. The Docker image sets `/data`. |
| `OA_PORT` | `4900` | The public port. |
| `OA_BIND` | `127.0.0.1` | The address to listen on. The Docker image sets `0.0.0.0`. |
| `OA_TRASH_DAYS` | `30` | Days an artifact stays in the trash before the hourly upkeep deletes it for good (its folder and catalog rows). `0` keeps it until its owner deletes it from the trash. |
| `OA_TRUST_PROXY` | off | Set it to `1` to honour `X-Forwarded-Host` and `X-Forwarded-Proto` and to keep idle connections for 130 seconds. Only set it when a proxy you run is the only way in. |
| `OA_INTERNAL_PORT` | off | Starts the internal listener with `GET /tls-ask?domain=`. Answers are cached for 30 seconds. |
| `OA_INTERNAL_BIND` | `127.0.0.1` | Where the internal listener listens. Compose sets `0.0.0.0` inside its private network. |
| `OA_ASSETS_DIR` | the checkout's `dist/server` | The built editors, Shell and `support.js`. |
| `OA_UI_DIR` | the checkout's `dist/daemon` | The built Shell and home pages. |
| `OA_TYPES_DIR` | the checkout's `artifact-types` | Each type's `artifact-type.json` and `SKILL.md`, which the MCP tools describe to agents; its `page` folder is the page type the host runs. |
| `OA_PAGE_NETWORK` | `self` | What a `page` artifact may fetch: `self` (its own origin only) or `https` (any https origin too). |
| `OA_TYPES_PUBLISH` | `admins` | Who may publish a type to the site: `admins`, `members` or `off`. Always `off` with `OA_CONTENT_SAME_SITE=true`. Published types live in `<OA_DATA_DIR>/types/<uid>/<version>/`; their pages fetch only what their manifest's `openArtifact.network` lists. |

### Remote MCP

| Variable | Default | Meaning |
| --- | --- | --- |
| `OA_MCP_ORIGINS` | none | Comma-separated browser origins, besides the app origin, that can call `/mcp`. |
| `OA_OAUTH_CLIENTS` | none | Pre-registered OAuth clients: `[{"client_id":"…","client_name":"…","redirect_uris":["https://…"]}]`. |

## Sign-in

`OA_AUTH` lists the sign-in methods offered on the sign-in page.

- **Owner key** (`{"kind":"owner-key"}`). This is a secret sign-in address for the person who runs the host. The key
  is in the address fragment, so it never reaches access logs. Repeated wrong keys are slowed down. If you remove
  `owner-key` from `OA_AUTH`, the owner signs in with another method.
- **OIDC.** Give it an `id` (lower-case letters, digits, `-` and `_`), a display `name`, the `issuer`, a `clientId`
  and usually a `clientSecret`.
  - The default scopes are `openid email profile`. You can change them with `"scopes": [...]`.
  - An email counts only when the provider says it is verified (`email_verified`).
  - Groups come from the `groups` claim.
  - The callback URL to register with the provider is `<OA_APP_ORIGIN>/auth/<id>/callback`.
- **GitHub** (`{"kind":"github","clientId":"…","clientSecret":"…"}`). Create an OAuth app (not a GitHub App) with the
  callback URL `<OA_APP_ORIGIN>/auth/github/callback`. The host asks for `read:user user:email`.

Google, with the callback `https://artifacts.example.com/auth/google/callback` registered in the Google Cloud console:

```sh
OA_AUTH='[{"kind":"owner-key"},
  {"kind":"oidc","id":"google","name":"Google","issuer":"https://accounts.google.com",
   "clientId":"1234-abc.apps.googleusercontent.com","clientSecret":"GOCSPX-…"}]'
```

Any other OIDC provider, such as Okta, Keycloak, Authentik or Microsoft Entra, works the same way with its issuer
URL. This example uses the callback `https://artifacts.example.com/auth/sso/callback`:

```sh
OA_AUTH='[{"kind":"oidc","id":"sso","name":"Company SSO","issuer":"https://login.example.com/realms/staff",
  "clientId":"open-artifact","clientSecret":"…","scopes":["openid","email","profile","groups"]}]'
```

GitHub and the owner key together:

```sh
OA_AUTH='[{"kind":"owner-key"},{"kind":"github","clientId":"Iv1.…","clientSecret":"…"}]'
```

## Accounts and sharing

`OA_SIGNUP` decides who gets an account the first time they sign in:

- `owners-only`: only the emails in `OA_OWNERS`.
- `invite`, the default: people who already have something shared with them, by email, domain or group.
- `domain:<name>`: anyone whose verified email is at that domain.
- `open`: anyone who can sign in.

The site admins are the `OA_OWNERS` emails, plus the owner-key user. If `OA_OWNERS` is empty, the first user ever
created is also an admin.

Sharing works like this:

1. Each artifact has one owner. The owner and site admins manage its sharing in the Shell's Share panel.
2. People get a role: `editor`, `commenter` or `viewer`. You can give it to an email, a whole email domain, or an OIDC
   group.
3. General access is `restricted`, `link` (a role link), or `public` (anyone can view, if `OA_PUBLIC_ACCESS` allows
   it).
4. A role link gives at most `OA_LINK_MAX_ROLE`. Signed-in people join through it as themselves; anyone else joins
   as a named guest.
5. Access is checked again on every request, so removing someone or changing their role applies at once.

## Getting artifacts onto the host

There are four ways to get an artifact onto the host:

- **Import on the server:** `node packages/host/src/node/main.ts import <folder|zip> [--owner <email>]`. In Docker
  (**not run here**), first copy the zip into the volume:
  `docker compose cp my.zip host:/data/my.zip && docker compose exec host node packages/host/src/node/main.ts import /data/my.zip`.
- **Upload:** `POST /api/open-artifact.artifacts.import` takes a `.zip` of up to 100 MiB from a signed-in person. The
  home page's Upload button (or dropping a `.zip` on the page) uses it.
- **Link a computer's daemon and publish** (next section).
- **Create one over remote MCP.**

## Linking a computer's daemon

The local `open-artifact` daemon can link to a host and publish artifacts there. Run against this host by hand
(a daemon with a preset token auto-publishing, local edits syncing, the local Share panel), by the end-to-end tests
(`npm run e2e -- --only host`, `host-auto`, `host-data`), and against a real Cloudflare deployment on 2026-11-22
(`remote add` by browser approval, `publish`, local edits on the open page about 4 s later, a guest by share link).

```sh
open-artifact remote add work https://artifacts.example.com   # opens the browser to approve this computer
open-artifact remote list
open-artifact publish <id|folder> --remote work
open-artifact unpublish <id>
```

After `publish`:

- The local folder becomes a working copy of the hosted artifact, and the host becomes the authority for it.
- Your local edits are pushed to the host, and changes made on the host come back down to the folder.
- If your change and the host's change collide, the host's version wins. Your version is kept under
  `_agent/conflicts/` in the folder.
- The `doc/` and `sheet/` folders become a read-only mirror of the host.
- `unpublish` takes the artifact off the host, and the folder is local only again.

An agent on that computer keeps using its local tools on the working copy.

`open-artifact remote default <name>` picks the remote `publish` uses when none is named (the first one added is the
default; with one remote, that one is always the default). `open-artifact remote auto on` publishes every artifact
created from then on to the default remote by itself, in the background.

Publishing, unpublishing, connecting or removing a site, the default site, automatic publishing and a dashboard's
data are the person's decisions:

- Run inside an agent's session (the command sees a variable the agent app sets, such as `CLAUDECODE`,
  `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID` or `ANTIGRAVITY_CONVERSATION_ID`), `publish`, `unpublish` and
  `remote add` / `remove` / `default` / `auto` are refused, with a sentence telling the agent to ask the person. A
  person's own terminal has none of these variables. The person can let agents publish and unpublish on one site with
  `"remotes": {"<name>": {"agentMayPublish": true}}` in `<OPEN_ARTIFACT_HOME>/settings.json`; the other decisions
  have no override.
- `publish` of a dashboard with live data asks at a terminal whether its rows go to the site too; with no terminal
  (or in an agent's session) the dashboard is published without its rows, and the command says how to add them.
- The daemon writes every publish, unpublish, data confirmation, site change and automatic-publishing change to
  `<OPEN_ARTIFACT_HOME>/logs/daemon.log` as an `audit:` line naming who asked (the Shell, the command line, or a
  process holding the daemon token, and the agent session when there was one).
- This is a guard rail, not a security boundary: an agent runs as the person's user and can unset the variables, call
  the daemon with the token in `daemon.json`, or edit `settings.json`. Agent apps whose sessions set no variable
  (Cursor, Copilot, ChatGPT, dsh) are not recognised.

### Set a computer up in advance

To link computers without each person approving in a browser, mint a token for each person on the host:

```sh
open-artifact-host link-token --user ada@example.com --label "Ada's laptop"
```

Run it with the same environment as the server (with Docker:
`docker compose exec host node packages/host/src/node/main.ts link-token --user …`): it reads the data folder from
`OA_DATA_DIR` and prints the site address from `OA_APP_ORIGIN`. When `OA_APP_ORIGIN` is not set where it runs, the
address it prints is the default (`http://localhost:4900`), and it says so; use the address people open the site at.

It prints the token once (it is stored only as a hash, and the audit log records who and which token, never the
token). Set it on the computer, in the environment the daemon starts with or in `<OPEN_ARTIFACT_HOME>/preset.json`:

```sh
OPEN_ARTIFACT_REMOTE=https://artifacts.example.com
OPEN_ARTIFACT_REMOTE_TOKEN=oa_rt_…
OPEN_ARTIFACT_PUBLISH=auto      # optional: publish new artifacts by themselves
```

At start the daemon adds the remote as the default and signs in with the token once. The token rotates on that first
use, so it cannot be used again. Without a token, the daemon still adds the remote and shows an approval link in
`open-artifact remote status`, in the Share panel and once to the agent. `link-token --revoke <id>` signs that
computer out.

## Remote MCP

Agents that only reach the host over the network use `https://artifacts.example.com/mcp`, which speaks MCP over
streamable HTTP.

- **Authorization** is OAuth 2.1 with PKCE. The endpoints are:
  - `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, for discovery;
  - `/oauth/authorize`, `/oauth/token`, `/oauth/register` and `/oauth/revoke`.
- **Scopes:** `artifacts.read`, `artifacts.write`, `comments` and `share.read`.
- **Who grants access:** the person who approves the agent, on the host's own consent page. The agent then acts as
  that person, with that person's roles.
- **Clients can be known in three ways:**
  - by a Client ID Metadata Document (a client id that is an https URL);
  - by being listed in `OA_OAUTH_CLIENTS`;
  - by dynamic registration.
- A browser-based client must call from the app origin or from one listed in `OA_MCP_ORIGINS`.

Without a token, `/mcp` answers 401 with a pointer to the resource metadata. The OAuth flow and the tools were
driven by a raw MCP client in the tests (`npm run e2e -- --only cloudflare-link`, `packages/host/test/mcp-oauth.test.ts`); a real agent app
connecting to a deployed host was not run.

## Rendering happens on people's computers

The host never runs a browser. This is a design choice. There is no Chromium in the image, so it stays small, and no
browser on the server ever loads the HTML that people and agents write. Every picture or file made from an artifact
is made on someone's own computer:

- **People export in their own browser.**
  - Slides, Design, Whiteboard and Motion export through the editor in the page.
  - A Docs PDF goes through the browser's print dialog, using the same print page the local app uses.
- **An agent with a linked daemon** uses the headless Chrome on its own computer, against the local working copy.
  This covers `snapshot`, every Docs `export` format (including PDF to a local path), and Motion `stills`, just as
  without a host. These are local, read-only actions and are never sent to the host.
- **An agent that only uses the remote MCP endpoint** gets no pictures made on the server. It can check an artifact
  with `check` and `summary`.

## What else hosted mode leaves out

Some local-app features have no meaning on a shared server, so the host leaves them out:

- connectors, the MCP servers an artifact calls from your computer;
- LAN sharing, which sharing and role links replace;
- idle exit;
- uploading a file by its absolute path on the server;
- copying from a design system by a recorded path on someone's disk.

## Upgrades

Data stays in `OA_DATA_DIR`, the `/data` volume in Docker, across upgrades. The catalog's schema migrates by itself
when the new version starts. Back up first.

Without Docker (each step was run here except the restart of a service):

```sh
deploy/backup.sh                     # with OA_DATA_DIR set
git pull && npm ci && npm run build
# restart the service
```

With Docker (**not run here**):

```sh
cd deploy/docker
../backup.sh
git pull
docker compose up -d --build
```

Compose gives the host 30 seconds to stop on SIGTERM. The host closes its connections and the catalog, then exits.
Expect a short outage while the new container starts.

## Backup and restore

`deploy/backup.sh` writes one `.tar.gz` with three things in it:

- a consistent copy of the catalog, made with SQLite's `VACUUM INTO` while the host keeps running;
- the `artifacts/` folder;
- `keys.json`, if there is one.

Settings for the script:

- `BACKUP_DIR`: where archives go. The default is `/var/backups/open-artifact`.
- `BACKUP_KEEP`: how many archives to keep. The default is 7.
- `BACKUP_S3`: an `s3://bucket/prefix` to upload each archive to, using the `aws` CLI.

```sh
OA_DATA_DIR=/srv/oa BACKUP_DIR=/srv/backups deploy/backup.sh   # a host run without Docker (run here)
deploy/backup.sh                                               # the compose set-up, through `docker compose exec` (not run here)
```

The catalog copy is exact. The artifact files are read while the host may be writing to them, so an artifact being
edited at that moment can be caught halfway through a change.

To restore, stop the host, unpack the archive into an empty data folder, rename the catalog copy, and start again:

```sh
mkdir /srv/oa-restored
tar -xzf /srv/backups/open-artifact-20261122T054431Z.tar.gz -C /srv/oa-restored
mv /srv/oa-restored/.backup-host.db /srv/oa-restored/host.db
OA_DATA_DIR=/srv/oa-restored node packages/host/src/node/main.ts serve
```

In Docker (**not run here**), stop compose, then unpack into the volume through a helper container:

```sh
docker compose down
docker run --rm -v open-artifact_oa-data:/data -v /srv/backups:/b alpine \
  sh -c 'rm -rf /data/* /data/.backup-host.db; tar -xzf /b/open-artifact-….tar.gz -C /data && mv /data/.backup-host.db /data/host.db && chown -R 1000:1000 /data'
docker compose up -d
```

Keep the same `OA_SIGNING_KEYS` when you restore. Without them, open pages and share-link addresses made before the
backup stop working.

## Security notes

- **Cookies.** Keep the content domain a different registrable domain from the app: that keeps artifact HTML away
  from the session cookie in every way a browser knows. With `OA_CONTENT_SAME_SITE=true` the host keeps it away
  itself (writes refused unless same-origin, CORP and `Origin-Agent-Cluster` on every answer, `__Host-` cookies on
  https, duplicate cookies refused and their sessions ended), and some risks remain, most of all on plain http:
  `docs/hosting.md`, "One domain for both", has the table.
- **Secrets.** Keep `OA_SIGNING_KEYS`, `OA_OWNER_KEY` and the OAuth client secrets out of version control. `.env` is
  in `.dockerignore`.
  - The data folder is created with mode 0700, and the catalog and `keys.json` with 0600.
- **Proxy trust.** Set `OA_TRUST_PROXY=1` only when the proxy is the only way to reach the host. Otherwise anyone can
  send `X-Forwarded-Host` and choose which origin the host thinks it is serving.
  - Without trust, those headers are ignored, and the cookie's `Secure` flag still follows `OA_APP_ORIGIN`.
- **Ports.** The host listens on 127.0.0.1 by default. In compose, only Caddy publishes ports (80 and 443). The
  internal ask listener is never published.
- **Writes.** Writes on the app origin must come from the same origin, and the host checks `Sec-Fetch-Site` and
  `Origin`. Content pages get a CSP that lets only the app origin frame them.
- **Audit log.** Sign-ins and sign-outs, share changes and joins, imports, trash and restore, owner-key changes, Link
  device approvals and tokens, and MCP consents and tokens are written to the catalog's `audit` table.

## Troubleshooting

- **Signing in on plain http loops back to the sign-in page.**
  - With an https `OA_APP_ORIGIN`, the cookie is `Secure` and the browser drops it over http. Use https through the
    proxy, or an `http://localhost` origin for local tests.
- **`curl` cannot resolve `art-….content.localhost`.**
  - Browsers send `*.localhost` to your own computer; some resolvers do not. Use
    `curl --resolve art-….content.localhost:4900:127.0.0.1 http://art-….content.localhost:4900/…`.
- **Artifact pages do not load on the real domain.**
  - Check the wildcard record: `dig +short anything.oa-content.example.net` should print your server's address.
  - With on-demand TLS, `docker compose logs caddy` shows whether the ask endpoint refused the name. It refuses names
    of artifacts that do not exist or are in the trash.
- **Live editing or presence does not work behind your own proxy.**
  - The proxy is not passing WebSocket upgrades (`Upgrade` and `Connection` headers).
- **The library or Link updates arrive late.**
  - The proxy is buffering `text/event-stream`. Turn buffering off for it; the host already sends
    `X-Accel-Buffering: no` for nginx.
- **Random 502 errors after idle periods.**
  - The proxy keeps idle upstream connections longer than the host does (130 seconds with `OA_TRUST_PROXY=1`, 5
    seconds without). Lower the proxy's keep-alive, or set `OA_TRUST_PROXY=1`.
- **The host refuses to start.**
  - The message names the variable and what is wrong with it, for example
    `OA_SIGNING_KEYS is required` or `OA_CONTENT_ORIGIN must be a different site from OA_APP_ORIGIN` (the message
    names `OA_CONTENT_SAME_SITE=true` for a site with only one domain).
- **Is it up?**
  - `curl https://artifacts.example.com/__open-artifact/health` answers `{"openArtifact":1,"version":"…"}`. It
    answers 503 if the catalog cannot be read.
