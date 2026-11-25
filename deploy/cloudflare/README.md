# Open Artifact on Cloudflare

This folder bundles [packages/host-cloudflare](../../packages/host-cloudflare) into the Open Artifact cloud host as a
Worker. It is the same app as the Node host (`packages/host`): sign-in, the home page, the Shell, sharing, link guests,
roles, the Link (a computer's daemon publishing and syncing), remote MCP with OAuth, and `page` artifacts (each
person's page on a page host of their own). The catalog (users, sessions,
artifacts, grants, links, agent tokens, the outbox) is in D1. Each artifact lives in its own Durable Object: its SQLite
storage is the artifact's folder, and the unmodified type server runs on top of it. One more Durable Object, the site
hub, carries events, the Library's and the Link's event streams, and who is online.

**What was run where.** The tests run under `wrangler dev` (workerd on this computer, local D1 and Durable Objects).
The [Deploy](#deploy-from-nothing-to-a-running-site) path was followed once against a real Cloudflare account on
2026-11-22, with one zone and the app on `workers.dev`: D1 created, two deploys, the secrets, the wildcard record, a
computer linked, publishing, sharing and a guest. The step-by-step guide with what was seen is
[docs/hosting-cloudflare.md](../../docs/hosting-cloudflare.md). Still **not run** on Cloudflare: Cloudflare Access
against a real team, costs over time, an upgrade over the deployed site, `wrangler rollback`, `d1 export`, removing
everything, the two-zone layout (Custom Domain app), and one zone for both with `OA_CONTENT_SAME_SITE` (run only under
`wrangler dev`). The D1 id in the committed `wrangler.jsonc` is a placeholder; your own ids go in a config file
kept out of git (step 3). Cloudflare facts below were checked in Cloudflare's documentation on 2026-11-22 and cite the
page and its "last updated" date where it showed one.

## Run it locally

Build the editors, the Shell and the home page once, at the repository root:

```bash
npm run build
```

Then, in this folder:

```bash
npm install                    # wrangler 4.166.0 and esbuild 0.25.12, in this folder's own node_modules
cp .dev.vars.example .dev.vars # then set OA_SIGNING_KEYS and OA_OWNER_KEY in it
npm run dev                    # builds, then wrangler dev on :8787 with the state (D1, objects) in ./.state
```

- The app is at `http://localhost:8787`. Sign in at `http://localhost:8787/auth/sign-in` with the owner key from
  `.dev.vars`.
- Each artifact is at `http://{id}.content.localhost:8787` (with `_` in the id as `-`). Chrome and Node resolve
  `*.localhost` to this computer.
- `PORT=8790 PERSIST_TO=/tmp/oa-state npm run dev` picks another port or state folder. `dev.sh` sets `OA_APP_ORIGIN`
  and `OA_CONTENT_ORIGIN` for the port. Any other arguments go to `wrangler dev`.
- Link a computer to it: `open-artifact remote add local http://localhost:8787` (the daemon accepts http only for this
  computer or a private network: a private address, `.local`, `.lan`, `.home.arpa`, `.internal`, a one-word name or a
  nip.io / sslip.io name spelling a private address) and approve the computer in the browser that opens.
- Read or change the local catalog with wrangler. For example:
  `./node_modules/.bin/wrangler d1 execute open-artifact --local --persist-to ./.state --command "SELECT id, title FROM artifacts"`.

## Tests

Run these from the repository root:

```bash
node --test "packages/host-cloudflare/test/*.test.ts"   # unit tests; the catalog also runs against real local D1
npm run e2e -- --only cloudflare-host                   # the product Worker under wrangler dev, in Chrome
npm run e2e -- --only cloudflare-link                   # a real daemon linked to it, and remote MCP, in Chrome
npm run e2e -- --only cloudflare-page                   # a page artifact published from a daemon, owner and guest, in Chrome
npm run e2e -- --only cloudflare                        # the rooms test Worker (below)
```

The end-to-end tests build this folder and start `wrangler dev` with a temporary `--persist-to`. `cloudflare-link` and
`cloudflare-page` also start real daemons, each with a temporary `OPEN_ARTIFACT_HOME` and a free port (never your own
home or port 4800). They skip when this folder has no `node_modules`, when `E2E_BROWSER=0`, when there is no Chrome, or before
`npm run build`.

## Deploy: from nothing to a running site

These steps were followed once against a real account on 2026-11-22 with the one-zone layout below
([docs/hosting-cloudflare.md](../../docs/hosting-cloudflare.md) has each step with what to expect). They create
resources on your Cloudflare account and may cost money ([Costs](#costs)). You need a Cloudflare account, a domain on
it (a zone), and Node 22 or later.

### 1. Plan the two origins

The app and the artifacts are served on different origins, as on the Node host (`packages/host/README.md`, "The two
origins"). Two layouts:

| Layout | `OA_APP_ORIGIN` (sign-in, home page, Shell, APIs, Link, `/mcp`) | `OA_CONTENT_ORIGIN` (each artifact on its own host) |
| --- | --- | --- |
| **One zone** (run on 2026-11-22) | `https://open-artifact.<your-subdomain>.workers.dev`, the Worker's own address | `https://{id}.example.com`, a wildcard route on a zone nothing else uses |
| **Two zones** (not run) | `https://artifacts.example.com`, a Custom Domain, with `workers_dev: false` | `https://{id}.example-content.com` |
| **One zone for both** (`wrangler dev` only) | `https://app.example.com`, a Custom Domain on the same zone, with `workers_dev: false` and `OA_CONTENT_SAME_SITE=true` | `https://{id}.example.com` |

`workers.dev` is a different site from your zone, so one zone is enough for the two origins to be different
registrable sites. The examples below use the two-zone names; the one-zone settings are in step 4. Putting the app on
the zone itself makes the two one site, which the Worker refuses unless `OA_CONTENT_SAME_SITE=true`; what that
weakens is in `docs/hosting.md`, "One domain for both", and the setup in `docs/hosting-cloudflare.md`.

- The content origin needs a wildcard: one host per artifact. A content host must never be a host that can set
  cookies for the app's host, so do not put it under the app's host.
- **Use a separate zone for the content origin when you can** (`{id}.example-content.com`). Universal SSL covers a
  domain and its first-level subdomains, so `art-….example-content.com` is covered at no cost. A deeper name such as
  `{id}.content.example.com` is not: it needs Total TLS or an advanced certificate (Advanced Certificate Manager), or
  browsers show a certificate error. Source: Cloudflare, "Serve previews on their own hostnames", section "Certificates
  for deeper hostnames" (Sandbox docs, read 2026-11-22); "Configure preview URLs on a custom domain", Troubleshooting
  (read 2026-11-22).
- The content hosts sit under a domain that the app's cookies are never scoped to. `Domain=example.com` cookies reach
  every subdomain of `example.com` (same page), which is one more reason for a separate zone.

### 2. Create the D1 database

```bash
cd deploy/cloudflare
npm install
./node_modules/.bin/wrangler login
./node_modules/.bin/wrangler d1 create open-artifact     # prints the database id
```

- If the login reaches more than one account, wrangler cannot choose one in a script: set
  `CLOUDFLARE_ACCOUNT_ID=<account-id>` (or `"account_id"` in your config, step 3) first. Seen on 2026-11-22.
- `d1 create` prints a config snippet that names the binding after the database (`open_artifact`). **The Worker wants
  the binding `DB`**: copy only the `database_id`, not the snippet.

The Durable Object classes need nothing created by hand: the `migrations` entry in `wrangler.jsonc`
(`new_sqlite_classes`) creates them on the first deploy. There are no KV namespaces and no R2 buckets.

### 3. Your own config file, the variables and secrets

Your account id, database id and domain do not belong in the committed `wrangler.jsonc`. Copy it to
`wrangler.local.jsonc` (git-ignored here) and pass `-c wrangler.local.jsonc` to every wrangler command that touches
the account. In it, set `account_id`, the `database_id` (binding `DB`), and the `vars`, which hold what is not secret.
Replace the localhost values:

```jsonc
"vars": {
  "OA_APP_ORIGIN": "https://artifacts.example.com",
  "OA_CONTENT_ORIGIN": "https://{id}.example-content.com"
}
```

The secrets can only be put once the Worker exists, so they come after the first deploy (step 5; seen on
2026-11-22):

```bash
openssl rand -base64 48 | ./node_modules/.bin/wrangler secret put OA_SIGNING_KEYS -c wrangler.local.jsonc
openssl rand -base64 32 | ./node_modules/.bin/wrangler secret put OA_OWNER_KEY -c wrangler.local.jsonc   # keep a copy: you sign in with it
```

The bindings `wrangler.jsonc` already declares:

| Binding | Kind | What for |
| --- | --- | --- |
| `DB` | D1 | The catalog. |
| `ROOMS` | Durable Object `ArtifactObject` (SQLite) | One per artifact: its files, its comments, its data. |
| `HUB` | Durable Object `SiteHubObject` (SQLite) | One for the site: events, the event streams, who is online. |
| `ASSETS` | Static assets (`dist/assets`) | The editors, the Shell's and home page's files, `support.js`. |
| cron `17 * * * *` | Trigger | Hourly upkeep: expired sessions and device codes; the trash's timer ([Deleting](#deleting-the-trash-and-purge)). |

The other settings have the names and meanings of the Node host's (`packages/host/README.md`, "Settings"), set as
`vars` or, when secret, with `wrangler secret put`:

| Setting | Notes on Cloudflare |
| --- | --- |
| `OA_AUTH` | Sign-in providers, a JSON array. Holds client secrets: set it as a secret. Adds `cloudflare-access` ([Cloudflare Access](#cloudflare-access)). |
| `OA_OWNERS`, `OA_OWNER_NAME`, `OA_SIGNUP`, `OA_PUBLIC_ACCESS`, `OA_LINK_MAX_ROLE` | As on Node. |
| `OA_OAUTH_CLIENTS`, `OA_MCP_ORIGINS` | Remote MCP's pre-registered clients and browser origins, as on Node. |
| `OA_TRASH_DAYS` | Days an artifact stays in the trash before the hourly upkeep deletes it for good (default 30, `0` never). |
| `OA_ROOM_IDLE_CLOSE_MS` | How long an artifact's object keeps the artifact open with no page and no request, in ms (default 60000, `0` never). After that the stores are flushed and every timer stops; the next request opens it again. |
| `OA_SSE_HEARTBEAT_MS` | How often an idle event stream of a page gets an SSE comment, in ms (default 1000, `0` never). The write is how the object notices a page that left. See [Going quiet](#going-quiet) before you change it. |
| `OA_APP_ORIGIN`, `OA_CONTENT_ORIGIN` | Must be `https`, except a `localhost` origin. `OA_ALLOW_HTTP` is refused. |
| `OA_CONTENT_SAME_SITE` | `true` for one zone serving both origins (step 4). Off by default; the person's decision. With it, the site runs no `page` artifacts. |
| `OA_PAGE_NETWORK` | What a `page` artifact may fetch: `self` (default) its own origin only, `https` any https origin too. Another value is a configuration error naming it. |
| `OA_OWNER_KEY` | Required while the owner-key sign-in is on (the default). A Worker cannot print a key it made up. |
| `OA_DEBUG_STATS` | Local only: `1` adds `x-open-artifact-d1: queries=…;read=…;written=…` to every answer and answers `/__open-artifact/stats`. Honoured only while `OA_APP_ORIGIN` is a localhost origin. |

### 4. Domains and routes

**One zone** (run on 2026-11-22). The app stays on the Worker's `workers.dev` address; every host of the zone goes to
the Worker:

```jsonc
"workers_dev": true,
"routes": [{ "pattern": "*.example.com/*", "zone_name": "example.com" }]
```

and on `example.com` a DNS record `AAAA *  100::`, proxied. Page hosts (`art-<id>--<opaque>.example.com`, one per
person who opens a `page` artifact) are names under the same wildcard: the route, the record and Universal SSL cover
them, nothing more to add. A wrangler login or API token that can only read the zone
(seen on 2026-11-22: `zone (read)`, no DNS write) cannot add it: the person adds it in the dashboard (DNS > Records).
The route takes every host of the zone, so use a zone nothing else runs on. The `workers.dev` address is known only
after the first deploy; put it in `OA_APP_ORIGIN` then.

**Two zones** (not run):

- The app's host is a **Custom Domain** on the Worker (`artifacts.example.com`): Cloudflare creates its DNS record and
  certificate. Custom Domains do not support wildcards ("Custom Domains", Request matching behaviour, read 2026-11-22).
- The content origin is a **route** with a wildcard, plus a proxied wildcard DNS record so the names resolve. With a
  route, the record's address is never contacted; `AAAA 100::` is the usual placeholder. Source: "Serve previews on
  their own hostnames", "Route preview hostnames to your Worker" (read 2026-11-22); "Routes", "Domains and subdomains
  must have a DNS Record" (read 2026-11-22).

In `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "artifacts.example.com", "custom_domain": true },
  { "pattern": "*.example-content.com/*", "zone_name": "example-content.com" }
],
"workers_dev": false
```

And on `example-content.com`, a DNS record `AAAA *  100::`, proxied. `workers_dev: false` turns off the
`*.workers.dev` address, so the site answers only on your origins.

**One zone for both** (run only under `wrangler dev`): the same two routes on one zone, `app.example.com` as the
Custom Domain and `*.example.com/*` as the route, with `"OA_CONTENT_SAME_SITE": "true"` in `vars`. The route also
matches `app.example.com`, and a route takes precedence over a Custom Domain on the same host name ("Routes", read
2026-11-22); it is the same Worker, so the answer is the same, and the Custom Domain still makes the DNS record and the
certificate. Every other host of the zone reaches the Worker too, which in this mode answers 421 for any host that is
neither the app's nor an artifact's (the health check and the static `/_open-artifact/` files answer on any host).
Under `wrangler dev` with `app.oa.localhost` and `{id}.oa.localhost`: the app on its host, an artifact host, 421 for
`www.oa.localhost`, and a duplicated `oa_session` refused with its copies deleted.

### 5. Build and deploy

```bash
cd ../.. && npm run build && cd deploy/cloudflare   # the editors, the Shell, the home page
npm run build                                      # dist/: the Worker, the assets, the Sheets engine
./node_modules/.bin/wrangler deploy --dry-run -c wrangler.local.jsonc --outdir "$(mktemp -d)"   # check first: nothing is uploaded
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc   # first deploy: creates the Worker
# then: the secrets (step 3), OA_APP_ORIGIN set to the workers.dev address it printed, the DNS record (step 4)
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc   # second deploy
```

It takes two deploys (seen on 2026-11-22): the `workers.dev` address is known only after the first, and the secrets
can only be put once the Worker exists. Until they are, the Worker answers every request with a 500 naming the
missing setting. The dry run must show a binding `env.DB`.

Run the dry run first. It must list exactly one additional module, `sheets.wasm` (compiled-wasm, 7995 KiB), and end
`Total Upload: about 12300 KiB / gzip: about 3881 KiB` (version 0.12.3; 12299.98 KiB / 3880.61 KiB on 2026-11-22). The static assets are read separately
("Read 291 files from the assets directory"). If it lists editor `.html` or `.txt` files, a second `sheets.wasm`, or
anything under `assets/`, the Worker's folder is no longer `dist/site/` alone (see [What the build does](#what-the-build-does)).

The Worker counts against Cloudflare's 64 MiB size limit, which applies to the uncompressed `Total Upload` on both
Workers Free and Paid. The compressed 3 MB (Free) and 10 MB (Paid) limits were removed on 2026-09-04 ("Workers
limits", Worker size, read 2026-11-22), so about 12 MiB fits either plan. Before `dist/site/` existed, the upload
was 23 modules and 29417 KiB / gzip 9414 KiB. That also fits 64 MiB, but it would have failed the old 3 MB Free limit
and carried two unused copies of the engine. Startup time was not measured on the platform: a Worker must run its
global scope within 1 second, and this bundle is 4.2 MB of JavaScript plus the engine.

If your Cloudflare login can reach more than one account, wrangler cannot choose one in a script and will stop to ask
(or fail in CI). Set `"account_id": "<id>"` in `wrangler.jsonc`, or `CLOUDFLARE_ACCOUNT_ID=<id>` in the environment,
before the dry run and the deploy.

The catalog's schema is created and migrated by the Worker on the first request; there is no separate migration step.
Then open `https://artifacts.example.com/auth/sign-in`, sign in with the owner key, and check
`https://artifacts.example.com/__open-artifact/health` answers `{"openArtifact":1,"version":"0.14.6"}`.

### 6. Link computers

On each computer: `open-artifact remote add work https://artifacts.example.com`, then approve the computer in the
browser page that opens (`/link/device` on the app's host). The daemon keeps one event stream open to the site hub; a
comment sent to an agent while the computer is off is kept in the D1 outbox and delivered when it is back.

To set a computer up without a browser (a CI runner, a managed laptop), mint a Link token for a person **from the
admin API**, signed in as a site administrator (whoever signed in with the owner key is one). On Node this is the
`open-artifact-host link-token` command; a Worker has no shell next to its catalog:

```js
// In the browser console on https://artifacts.example.com, signed in as an administrator:
await (await fetch('/api/open-artifact.admin.link-tokens', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ user: 'ada@example.com', label: 'Ada laptop' }),
})).json();
// → { id, user, remote, token }: the token is shown once.
```

Give the computer `OPEN_ARTIFACT_REMOTE=<remote>` and `OPEN_ARTIFACT_REMOTE_TOKEN=<token>` (and
`OPEN_ARTIFACT_PUBLISH=auto` to publish new artifacts by themselves), as on Node. The person is made when missing,
with that email counted as verified. The token is a refresh token: it is used once and rotates. Revoke one with
`POST /api/open-artifact.admin.link-tokens.revoke` `{ "id": "<id>" }`. Both calls refuse a Bearer token, another
site's page, and anyone but an administrator, and are written to the audit log without the token.

### 7. Remote MCP

`/mcp` on the app's host, with OAuth (`/.well-known/oauth-protected-resource`, `/oauth/authorize`, `/oauth/token`),
as on Node (`packages/host/README.md`, "Remote MCP"). The installed types come from the build (`artifact-types/` at
build time); a type added later needs a new build and deploy. `ArtifactComments wait` waits at most 25 seconds.

## Cloudflare Access

The site can sign people in through [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) instead of,
or next to, the owner key and the OIDC providers:

```json
OA_AUTH=[{"kind":"cloudflare-access","teamDomain":"https://<team>.cloudflareaccess.com","aud":"<application AUD tag>"},{"kind":"owner-key"}]
```

- Access signs the person in before the request reaches the Worker and sends a JWT in `Cf-Access-Jwt-Assertion`. The
  host checks it on every request that carries it: the signature against the team's keys
  (`<teamDomain>/cdn-cgi/access/certs`, cached an hour, refetched once for an unknown key id), `iss`, `aud` (this
  application's AUD tag only), `exp` and `nbf`. A service token's assertion names no person and signs nobody in.
  The header is never trusted unchecked, because a request can reach the Worker without passing Access (a
  `workers.dev` address, another route).
- A valid assertion gets a session at once; the email counts as verified (Access checked it with its identity
  provider), and `groups` are kept when the token has them. A session cookie of someone else is ended first.
  `OA_SIGNUP` and `OA_OWNERS` apply as for any provider.
- Signing out ends the host's session and says that Access keeps its own: the page links to
  `<teamDomain>/cdn-cgi/access/logout`, and the API answer carries it as `accessLogoutUrl`.

### Which paths Access may guard

An Access application covers a hostname and paths; a more specific path's policy wins over its parent's
(Cloudflare One, "Application paths", Policy inheritance, last updated Apr 17, 2026). A Bypass policy lets requests
through without sign-in (Cloudflare One, "Require Access protection", read 2026-11-22). Some of the site's paths carry
their own credentials and are called by programs that cannot pass an Access login page; those need Bypass:

| Path on the app's host | Access | Why |
| --- | --- | --- |
| `/api/open-artifact.link.*` | **Bypass** | The daemon's Link API: it signs in with its own Bearer tokens. |
| `/mcp`, `/.well-known/oauth-*`, `/.well-known/openid-configuration`, `/oauth/token`, `/oauth/register`, `/oauth/revoke` | **Bypass** | MCP clients: discovery and tokens are fetched by programs. |
| `/oauth/authorize`, `/link/device` | Allow (sign-in) | A person approves a client or a computer here: Access signs them in first. |
| `/__open-artifact/health` | Bypass (optional) | For uptime checks. |
| Everything else (`/`, `/a/*`, `/api/*`, `/_open-artifact/*`, `/auth/*`) | Allow, or see below | The app. |
| Every host of the content origin | **No Access application** (or Bypass) | Pages carry their own signed page token; the frame's requests are cross-site and never carry Access's cookie. If "Block traffic to all domains in this account" is on, add a Bypass application for `*.example-content.com`. |

Two layouts:

1. **Members only.** One Access application for `artifacts.example.com` (Allow: your people), plus the Bypass paths
   above. Link guests and public artifacts from outside the Access policy cannot open anything: `/s/<link>`, `/a/<id>`
   and the Shell's files are behind Access.
2. **Members sign in through Access, guests still welcome.** Access guards only `/auth/*` (Allow: your people). The
   rest of the host is public, as without Access: a member who opens `/auth/sign-in` passes Access there, the host
   turns the assertion into its own session cookie, and the session works on every path. Link guests (`/s/<link>`)
   and public artifacts work as on Node.

Neither layout was run against a real Access application; the JWT check is covered by unit tests
(`packages/host/test/auth-cloudflare-access.test.ts`) with locally made keys.

## Upgrades and migrations

- Pull the new version, `npm run build` at the root and here, then `wrangler deploy` **(not run)**. The catalog's
  schema migrates on the first request after the deploy; each artifact object creates the tables it lacks when it is
  next used.
- The Durable Object classes are declared with the `migrations` array in `wrangler.jsonc`. A class that is renamed
  or deleted needs a new migration entry with a new tag (`renamed_classes`, `deleted_classes`); a `deleted_classes`
  migration deletes every object of that class with its storage. Migrations are atomic and cannot be gradually
  deployed. Cloudflare now also offers a declarative `exports` field for this; `migrations` and Durable Object
  `exports` cannot be mixed in one Worker. Source: "Durable Object class migrations (legacy)", last updated Sep 28,
  2026; changelog "Declare Durable Object class lifecycle with exports", Jul 4, 2026. Open Artifact 0.12.3 keeps the
  `v1` migration and needs no other.
- A Durable Object lifecycle change cannot be rolled back to a version from before it (same pages). A code-only
  upgrade can be rolled back with `wrangler rollback` **(not run)**.

## Backup and export

- **D1** (the catalog): Time Travel restores the database to any minute in the last 30 days (Workers Paid) or 7 days
  (Free), always on, at no extra cost ("Time Travel and backups", last updated Nov 6, 2026). For a copy you keep:
  `wrangler d1 export open-artifact --remote --output=catalog.sql` **(not run)** ("Import and export data").
- **Artifacts** (the Durable Objects): there is no account-level export of Durable Object storage. Each artifact's
  owner can download it from the Shell ("Whole folder (.zip)" in its Export tab) or through a linked computer (the working copy is a full
  copy, kept in sync). Restoring is importing that zip again (`artifacts.import`, or the Link). SQLite-backed
  objects also have a point-in-time recovery API, reachable only from code, which this host does not use.
- An artifact deleted for good ([below](#deleting-the-trash-and-purge)) cannot be brought back by a D1 restore: the
  object's storage is gone.

## Deleting: the trash and purge

- Deleting an artifact moves it to the trash (as on Node). Its owner can restore it from there.
- `POST /api/open-artifact.artifacts.purge` `{ "id": "art_…" }` deletes one from the trash for good: only its owner,
  only from the trash. The artifact's object storage is deleted first, then its catalog rows (the artifact, its grants
  and links); if the storage cannot be deleted, the catalog keeps the record so it can be tried again.
  It is written to the audit log.
- The hourly upkeep deletes for good what has been in the trash `OA_TRASH_DAYS` days (default 30; `0` keeps the
  trash until owners purge it).
- The home page's trash has a "Delete forever" button, which calls the route above after asking.

## What answers which path

| Path | Served by |
| --- | --- |
| `/_open-artifact/**` (the editors, the Shell's and home page's files, `support.js`) | The platform, from static assets, before the Worker runs. `dist/assets/_headers` adds `nosniff`, and a year's cache for the hashed Shell and home files. |
| `/_open-artifact/shell/index.html` | The Worker (`run_worker_first`), which answers 404. It is a template: the Shell is served with its boot at `/a/<id>`. |
| `/_open-artifact/**` files that do not exist | The Worker, which answers 404. |
| `/api/open-artifact.link.*`, `/link/device` | The Worker: the Link API (the core's routes over the artifact objects) and the computer-approval page. The Link's event stream is forwarded to the site hub. |
| `/mcp`, `/oauth/*`, `/.well-known/oauth-*` | The Worker: remote MCP and its OAuth server. |
| `/api/open-artifact.admin.link-tokens[.revoke]` | The Worker: the Cloudflare stand-in for `link-token` (above). |
| Everything else on the app's host (`/`, `/a/<id>`, `/s/<link>`, `/auth/**`, `/api/**`, `/__open-artifact/health`) | The Worker: the host core's app routes, with the catalog in D1. |
| Every path on a content host | The Worker forwards it to that artifact's Durable Object, which checks the page token and runs the type server. For a `page` artifact, `/page/<page token>/…` there is the inner shell (the frame core in the object). |
| Every path on a page host (`art-<id>--<opaque>.…`) | The Worker forwards it with no cookie to that artifact's Durable Object, which checks the opaque part against the person's access now and serves the page's files, read only. Where pages do not run (one zone for both), 421. |
| `/_open-artifact/frame/<hash>/*` | The frame's client files as static assets (a new `<hash>` each build, a year's cache if fetched there). Pages do not load them from here: the object reads them through `ASSETS` once per isolate and serves them itself, `no-store`, as the Node site does. |

## Limits

Open Artifact's own limits on this host:

| What | Here | Node host |
| --- | --- | --- |
| An uploaded archive (`artifacts.import`) | 32 MiB | 100 MiB |
| A Link request body (`import`, `files`, `call`), told to the daemon in `link.hello` | 32 MiB | 100 MiB |
| One file in a Link push | 16 MiB | 64 MiB |
| A `/mcp` request body | 32 MiB | 32 MiB |
| `ArtifactComments wait` | 25 s | 25 s |
| An archive unpacked inside an artifact's object | 256 MiB, 20000 files | (the type server's caps) |

- Why lower: the Worker holds a body whole in a 128 MB isolate, and the artifact's object parses it again in its own;
  a 16 MiB file is 21.4 MiB as base64 in a push. Measured under `wrangler dev`: pushes of 1, 8 and 16 MiB files
  answered 200 and read back whole (23, 128 and 232 ms locally); a push declaring about 33 MiB answered 413. A body
  with no declared length is counted as it streams and refused when it passes the cap.
- Cloudflare's own limits that bear on this (all read 2026-11-22): request bodies up to 100 MB on the Free and Pro
  zone plans, 200 MB on Business ("Workers limits", Request and response limits); 128 MB memory per isolate; CPU time
  10 ms per request on Workers Free, up to 5 minutes on Workers Paid (same page); 10 GB of SQLite storage per Durable
  Object on Workers Paid, 1 GB on Free, and at most 8 MB in one SQLite value or row ("Durable Objects limits"); a D1
  database up to 10 GB (Paid) or 500 MB (Free) ("D1 limits").
- The device sign-in's rate limit is kept per Worker isolate, not across the deployment (the Node host keeps one per
  process). A Durable Object for it would make it exact; it was not needed for the tests.

## Costs

From Cloudflare's pricing pages (Workers pricing; Durable Objects pricing, last updated Nov 13, 2026; D1 pricing,
last updated Oct 30, 2026; read 2026-11-22). Prices are USD and change; check the pages.

- **Workers Paid is the realistic plan:** $5 a month minimum, with 10 million requests and 30 million CPU-ms
  included. Workers Free allows 10 ms of CPU per request, which the type server's page and archive work will often
  exceed (not measured on Cloudflare).
- **Durable Objects:** 1 million requests a month included, then $0.15 a million; 400,000 GB-s of duration included,
  then $12.50 a million GB-s. An object costs duration only while it is in memory and cannot hibernate; an open event
  stream (a Shell tab, a linked daemon) keeps the site hub in memory. SQLite storage: 5 GB-month included, then
  $0.20 per GB-month; rows read and written priced as D1.
- **D1:** 25 billion rows read and 50 million rows written a month included, then $0.001 a million read and $1.00 a
  million written; 5 GB stored included, then $0.75 per GB-month.

What the site does per request, measured under `wrangler dev` with `OA_DEBUG_STATS=1` (`npm run e2e -- --only
cloudflare-link`; D1 statements and rows):

| Request | D1 queries | Rows read |
| --- | --- | --- |
| The home page (`/`), signed in, 25 artifacts | 3 | 4 |
| The artifact list (`artifacts`), 1 artifact | 10 | 17 |
| The artifact list, 25 artifacts | 10 | 64 |

Before this version the list cost 7 queries for 1 artifact and 92 for 11 (a role lookup per artifact). It now costs
the same number of queries however long it is; the rows read grow with the list, and those are what D1 bills.

In one artifact's object, importing the sample whiteboard and then pushing files of 1, 8 and 16 MiB through the Link
took 2443 SQLite statements, 2305 rows read and 528 rows written (107 of them file chunks), and no D1 query.

These are local counts, not a bill. They suggest a small site stays inside the Workers Paid inclusions (the $5
minimum); this was not checked on Cloudflare.

## Going quiet

An artifact's object should cost nothing while nobody changes it. What it does now:

- **No polling.** The type server watches the artifact's files by the writes it makes itself (`watch: 'events'`), so
  there is no folder or catalog poll; agent status comes from the site hub when the owner's Link connects or leaves,
  instead of a 3-second check. While pages are open, only two timers run: the type server's 25-second keep-alive and
  the event stream's heartbeat (`OA_SSE_HEARTBEAT_MS`).
- **Closing when idle.** When the last page and socket have left, the type server closes the artifact after
  `OA_ROOM_IDLE_CLOSE_MS` (default 60000): no timers stay, and the object can be evicted. The next request opens the
  artifact again from its SQLite storage, with nothing lost.
- **A `page` artifact** runs its frame core in the same object, opened on its first request and closed by the same
  rule (no page, no socket, no request for `OA_ROOM_IDLE_CLOSE_MS`). Its WebSockets are taken with `accept()`, not
  the hibernation API, so an object with an open page stays in memory, as it does for any open tab. Its index of page
  hosts (which person each opaque part was made for, guests too) is a table in the object's SQLite storage, kept across
  evictions and dropped with the artifact.
- **Agent presence.** When an artifact's object asks the hub whether its owner's agent is connected, the hub remembers
  that it asked. When that answer changes, the hub tells the object, and the object tells its open pages at once. An
  object that has closed its artifact forgets its interest. The hub keeps this in memory only: a hub that was evicted
  has forgotten which objects asked, so they see the change when their 3-second presence cache runs out and they ask
  again. A closed object is never woken just to hear this.

Measured under `wrangler dev` with `OA_DEBUG_STATS=1` (`npm run e2e -- --only cloudflare-idle`; the counters are the
object's own SQLite statements and its live timers):

| One artifact, one page open, 60 s idle | Before | Now |
| --- | --- | --- |
| SQLite statements / rows read | 1671 / 2277 | 0 / 0 |
| Live timers | a 10 s storage check, the 25 s keep-alive, a 3 s status poll, the 1 s heartbeat | the 25 s keep-alive, the 1 s heartbeat |

Over a WebSocket, the same 60 s of idle cost no statements and left no timers. With `OA_ROOM_IDLE_CLOSE_MS=3000`, the
artifact closed about 3.1 s after the last page left. Nothing was open, no timers were left, and no statements ran in
the next 5 s. A later request opened it again with its files intact.

**The heartbeat.** An object learns that a page went away only when it writes to that page's event stream. With
`OA_SSE_HEARTBEAT_MS=0`, the request's abort signal did not report a page that left under `wrangler dev`. The object
noticed only about 25 s later, at the type server's keep-alive write. That is why the heartbeat stays (1 s by
default). Before you raise it or set it to `0`, check on your deployment whether a closed tab aborts the request
(`enable_request_signal`). If it does not, every page that leaves keeps the artifact open until the next write.

**Hibernation is not used.** Durable Objects can sleep with WebSockets open (the WebSocket Hibernation API:
`state.acceptWebSocket` and the `webSocketMessage`/`webSocketClose` handlers). This host does not use it, because:

- The type server keeps each page's state in memory: its role, its subscriptions, the open artifact. Hibernation would
  drop that state, and it has no way to restore it.
- The type server's sockets take listeners in memory (`HostedSocket.onMessage`/`onClose`). Hibernation delivers
  messages to class handlers instead.
- Event streams (SSE), which pages use when they have no WebSocket, cannot hibernate at all. The site hub's streams
  to Shell tabs and linked computers cannot either.

So an object with an open page stays in memory and bills duration, even with no timers and no statements. It leaves
memory only after its pages have gone and the artifact has closed. Making it hibernate would mean keeping each
connection's state in the socket's attachment, and rebuilding the type server's view from that after a wake. That
work was not done.

## What is not supported here

- Rendering (PNG, PDF, video exports) runs on people's computers, as on the Node host in hosted mode.
- A type added after the build: types come from `artifact-types/` at build time.
- `open-artifact-host` commands (`link-token`, backup, restore): the admin API above stands in for `link-token`;
  backup is D1's and each artifact's export.
- The device sign-in's rate limit across isolates (above).
- The rooms test Worker must never be deployed (below).
- A snapshot address of a `page` artifact (refused with a 403, as on Node), and `page` artifacts at all with one zone for
  both (`OA_CONTENT_SAME_SITE`).

## Deploy to Cloudflare button

Not added. The button deploys a repository's Worker project with its own build command, but this one needs the
repository's root build first (the editors, the Shell, the home page, the installed types), a wildcard route and DNS
record on a zone, and two secrets that must be chosen by the person deploying. The layout does not qualify.

## What the build does

`npm run build` (`build.mjs`) writes `dist/`:

- `dist/site/worker.js` is the product Worker (`src/worker.ts`), and `dist/rooms/worker.js` is the rooms test Worker
  (`src/dev-worker.ts`). Both are bundled with esbuild, using platform `node`, format ESM and the `workerd` condition.
  Each folder holds its bundle and its `sheets.wasm` and nothing else. With `no_bundle`, wrangler uploads as a module
  every file under `base_dir` (by default the folder of `main`) that a module rule matches. This is
  `find_additional_modules`, which is on by default with `no_bundle`, and the rules include `.html`, `.txt` and `.wasm`.
  So the static assets, `dist/assets/`, and the other Worker are sibling folders outside it. Both configs set
  `base_dir` explicitly.
- `node:fs` and `node:fs/promises` are replaced with the SQLite file system in `packages/host-cloudflare/src/fs`.
- `node:zlib` is replaced with `packages/host-cloudflare/src/zlib.ts`. workerd's `inflateRaw` checks `maxOutputLength`
  against the buffer it grows rather than the bytes unpacked, so it refused a 52 KB file at its exact size.
- `@open-artifact/wasm-sheets/node` is replaced with `packages/host-cloudflare/src/wasm/sheets.ts`. workerd does not
  compile WebAssembly from bytes at run time. So the engine's `.wasm` is left as an import (`dist/site/sheets.wasm`), and
  workerd compiles it when the Worker is loaded.
- `import.meta.url` is defined as a fixed `file:` URL, because workerd's value is no usable base.
- `open-artifact:build` is a module made at build time. It holds the version, the installed types (from
  `artifact-types/`, with each manifest and skill, which remote MCP lists) and the Shell and home page templates.
- `dist/server/{editors,shell,support.js}` and the home page's files are copied into `dist/assets/_open-artifact/`.
- Frame types (the built-in `page`, a type whose `artifact-type.json` says `openArtifact.style: "page"`) go into
  `open-artifact:build` with their manifest, skill and a fingerprint of their files. The frame's client
  (`dist/daemon/frame-host/client/`) is copied to `dist/assets/_open-artifact/frame/<hash>/`, `<hash>` the first 16
  hex characters of a SHA-256 over its files, and `_headers` gives that path `Cache-Control: public, max-age=31536000,
  immutable`.

`wrangler.jsonc` sets compatibility date 2026-11-01; `nodejs_compat`; `enable_request_signal` and
`request_signal_passthrough` (so `request.signal` aborts when the client goes); the two SQLite-backed Durable Object
classes; the D1 database; the assets binding; and the hourly cron.

## The rooms test Worker

`wrangler.rooms.jsonc` runs `src/dev-worker.ts`, a test Worker for the artifact objects alone. **Do not deploy it.** It
lets anyone in with any token: `owner` is the owner, and any other token is an editor of that name.

Start it with `npm run dev -- -c wrangler.rooms.jsonc`. Its addresses (on `:8787`):

| Address | What it is |
| --- | --- |
| `http://<id>.localhost:8787/<type>/<token>/…` | An artifact's pages, on its own origin. A client that cannot resolve `*.localhost` sends the request to `localhost` with an `x-open-artifact-artifact: <id>` header. |
| `http://localhost:8787/_dev/shell/<id>/<type>/<token>` | A bare frame around the page. It stands in for the Shell and brokers no capabilities. |
| `http://localhost:8787/_dev/<id>/<call>` | The room's calls: `POST seed` (JSON `{path: base64}`), `POST import` (zip bytes), `GET archive`, `GET manifest`, `GET file?path=`, `POST files` (`{writes, author}`), `POST action/<name>` (JSON args), `GET connected`, `POST disconnect` (`{keep}`), `GET stats`, `POST destroy`, `GET wakes`. |

Under `wrangler dev`, the abort signal does not reach a request that was forwarded to a Durable Object. Instead, the
HTTP bridge writes an SSE comment to an idle event stream about once a second. That write is how a page that left is
noticed, within about a second.
