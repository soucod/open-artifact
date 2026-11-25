# A site on your own server, with a domain

[中文](hosting-server.zh-CN.md)

**At the end** you will have an Open Artifact site on the internet, at an address like
`https://artifacts.example.com`, with certificates that renew themselves, a sign-in page, and daily backups if you
want them. Anyone you share with can open it; your agents publish to it.

**Before you start** you need:

- a server with a public IPv4 (and optionally IPv6) address: a VPS, an EC2 instance, a home server with port
  forwarding; 2 GB of memory is comfortable;
- Docker with the Compose plugin on it (or Node 22.18 or later, and a reverse proxy you already run);
- **two names on two different registrable domains** that you control in DNS, for example `artifacts.example.com` for
  the app and `oa-content.example.net` for the artifacts (see [hosting.md](hosting.md#two-web-origins) for why). With
  only one domain, see [One domain for both](#one-domain-for-both): it works, and is weaker;
- ports 80 and 443 reachable from the internet;
- an email address for Let's Encrypt's expiry notices.

> **If you are an agent doing this for someone**
>
> - Ask, never guess: the app host name and the content domain; whether the person accepts
>   [one domain for both](#one-domain-for-both) when they have only one (their decision, after reading what it weakens); the cloud account and region (AWS); who may sign up
>   (`OA_SIGNUP`) and who is an admin (`OA_OWNERS`); which sign-in providers; whether artifacts may be public
>   (`OA_PUBLIC_ACCESS`); whether a dashboard's data may be published.
> - Only the person can: add DNS records, create OAuth apps at Google, GitHub or their identity provider, open the
>   owner sign-in address, approve a computer, accept costs.
> - Never print a secret: `OA_SIGNING_KEYS`, `OA_OWNER_KEY`, OAuth client secrets and DNS API tokens live in
>   `deploy/docker/.env` (mode 600). Say that path; do not show its content.
> - Ask before creating a server, a stack, a bucket or anything billed, and before deleting anything.
> - Check each step before the next. After two failures of the same step, stop and report.

**What was run for this guide.** Docker was not installed where this guide was written, so **the image was never built
and Compose and Caddy were never started here**; AWS was not touched. What was run: the host itself without Docker (the
same program the image runs), `deploy/docker/stage.sh` (the image's file set, `staged the host into …`), the backup and
restore script, and every host command and message quoted. Steps that use Docker, Caddy, DNS or AWS are marked
**Not run here**.

## Decide

| Question | Setting | Default |
| --- | --- | --- |
| The app's host name | `APP_HOST` | none |
| The content domain (another registrable domain) | `CONTENT_DOMAIN` | none |
| The content domain is the app's own domain ([One domain for both](#one-domain-for-both)) | `OA_CONTENT_SAME_SITE` | `false` |
| One certificate per artifact on demand, or one wildcard by DNS | `COMPOSE_FILE` | on demand |
| Sign-in methods | `OA_AUTH` | the owner key only |
| Who gets an account by signing in | `OA_SIGNUP` | `invite` |
| Site admins | `OA_OWNERS` | none (the owner-key user; and the first account, while this is empty) |
| The highest role a share link gives | `OA_LINK_MAX_ROLE` | `editor` |
| May an artifact be public | `OA_PUBLIC_ACCESS` | `true` |

## Steps (Docker Compose and Caddy)

### 1. Add the DNS records

The person adds, at their DNS provider, pointing at the server's address:

```
artifacts.example.com.          A     203.0.113.10
*.oa-content.example.net.       A     203.0.113.10
```

Add `AAAA` records too if the server has IPv6. If the DNS is on Cloudflare, leave the records **DNS only** (grey
cloud) unless you know you want Cloudflare's proxy in front.

**Check:**

```bash
dig +short artifacts.example.com
```

```bash
dig +short anything.oa-content.example.net
```

**Expect:** the server's address, twice.

**If it fails:** wait for the records to spread (minutes to an hour); check the wildcard is `*.oa-content.example.net`,
not `*.example.net`.

Not run here (no domain).

### 2. Put the code on the server and fill in `.env`

```bash
git clone https://github.com/JimLiu/open-artifact.git && cd open-artifact/deploy/docker
```

```bash
cp .env.example .env && chmod 600 .env
```

Make a signing key (it signs page addresses and share links; keep it, a restore needs the same one):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

(or `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` on a server without Node). Put it in `.env` as
`OA_SIGNING_KEYS=`, and set at least:

```
APP_HOST=artifacts.example.com
CONTENT_DOMAIN=oa-content.example.net
ACME_EMAIL=you@example.com
OA_SIGNING_KEYS=<the key>
OA_SIGNUP=invite
```

The other settings in `.env.example` have comments; leave them empty for the defaults.

**Check:** `grep -c '^OA_SIGNING_KEYS=.\{32,\}' .env` prints `1` (without showing the key).

**If it fails:** the key must be at least 32 characters; several keys are comma-separated, the first one signs.

The signing-key command was run here. The rest is not run here.

### 3. Choose how certificates are made

- **On demand (default, `Caddyfile.on-demand`).** Caddy gets a certificate for each artifact's host name the first time
  it is visited (HTTP-01). Before asking Let's Encrypt, it asks the site's internal endpoint
  `http://host:4901/tls-ask`, which says yes only for the app host and for artifacts that exist and are not in the
  trash, so strangers cannot make Caddy request certificates for made-up names. The first visit to an artifact waits a
  few seconds. Let's Encrypt allows 50 new certificates per registered domain per week; past that, use the wildcard.
- **One wildcard certificate by DNS-01.** Add to `.env`:

  ```
  COMPOSE_FILE=compose.yaml:compose.dns.yaml
  CLOUDFLARE_API_TOKEN=<a token with Zone / DNS / Edit on the content domain's zone>
  ```

  Compose then builds a Caddy with the Cloudflare DNS plugin (`caddy/Dockerfile`, `caddy-dns/cloudflare@v0.2.4`) and
  uses `Caddyfile.dns`. For another DNS provider, set `CADDY_DNS_MODULE` and change the `dns cloudflare …` line, as the
  comments in `Caddyfile.dns` say.

Either way Caddy forwards the `Host` header, sets `X-Forwarded-Proto`/`-Host`/`-For` (the site trusts them because
compose sets `OA_TRUST_PROXY=1` and publishes no port of the site itself), streams server-sent events
(`flush_interval -1`), keeps idle upstream connections 90 s (shorter than the site's 130 s) and allows bodies up to 101
MiB.

### 4. Start it

```bash
docker compose up -d --build
```

**Expect:** two services, `host` and `caddy`. Caddy starts once `host` is healthy (its health check calls
`/__open-artifact/health` every 30 s).

**Check:**

```bash
docker compose ps
```

shows `host` as `healthy` and `caddy` as `running`, then:

```bash
curl -s https://artifacts.example.com/__open-artifact/health
```

**Expect:** `{"openArtifact":1,"version":"0.14.6"}` (that answer was seen from the same program run without Docker).

**If it fails:** `docker compose logs host` shows an `open-artifact-host: OA_…` line naming a wrong setting;
`docker compose logs caddy` shows certificate errors (DNS not pointing here yet, port 80 closed, or the ask endpoint
refusing a name). Caddy keeps retrying, so fixing DNS later is enough.

Not run here (no Docker).

### 5. Sign in as the owner

```bash
docker compose exec host node packages/host/src/node/main.ts owner-key
```

**Expect** (as printed by the same command run without Docker):

```
A new owner key replaces the old one. Sign in as the owner at:
  https://artifacts.example.com/auth/sign-in#key=<secret>
```

The person opens that address and keeps it in a password manager. If `OA_OWNER_KEY` is set in `.env`, this command
refuses; then the address is `https://artifacts.example.com/auth/sign-in#key=` followed by that value. Without either,
the first start printed one address in `docker compose logs host`.

**Check:** `https://artifacts.example.com/` shows the home page, not the sign-in page.

### 6. Connect your computers

Follow [connecting-agents.md](connecting-agents.md#connect-a-computer-to-a-site) with `https://artifacts.example.com`.

## Sign-in providers

`OA_AUTH` is a JSON array of sign-in methods, on one line in `.env`. Each redirect provider has a callback address to
register with it: `<app origin>/auth/<id>/callback`.

| Provider | Entry | Callback address to register |
| --- | --- | --- |
| Owner key | `{"kind":"owner-key"}` | none |
| Google (OIDC) | `{"kind":"oidc","id":"google","name":"Google","issuer":"https://accounts.google.com","clientId":"…","clientSecret":"…"}` | `https://artifacts.example.com/auth/google/callback` |
| GitHub (an **OAuth app**, not a GitHub App) | `{"kind":"github","clientId":"…","clientSecret":"…"}` | `https://artifacts.example.com/auth/github/callback` |
| Any OIDC (Okta, Keycloak, Authentik, Microsoft Entra) | `{"kind":"oidc","id":"sso","name":"Company SSO","issuer":"https://login.example.com/realms/staff","clientId":"…","clientSecret":"…","scopes":["openid","email","profile","groups"]}` | `https://artifacts.example.com/auth/sso/callback` |

- `id` is lower-case letters, digits, `-` and `_`; it is the part of the callback address after `/auth/`.
- An OIDC `issuer` must be https. An email counts only when the provider says it is verified; groups come from the
  `groups` claim. GitHub asks for `read:user user:email`.
- Keep `{"kind":"owner-key"}` in the list until another admin can sign in.

Example line:

```
OA_AUTH=[{"kind":"owner-key"},{"kind":"github","clientId":"Iv1.abc","clientSecret":"…"}]
```

Apply a change with `docker compose up -d` (it recreates the container with the new `.env`). Not run here against a
real provider; the callback path is `callbackUrl()` in `packages/host/src/core/auth/fetch.ts`.

## Who may sign up

`OA_SIGNUP` decides who gets an account the first time they sign in with a provider:

| Value | Who |
| --- | --- |
| `invite` (default) | people something was already shared with, by email, domain or group |
| `owners-only` | only the emails in `OA_OWNERS` |
| `domain:example.com` | anyone whose verified email is at that domain |
| `open` | anyone who can sign in with one of your providers |

People without an account can still open an artifact through a share link as a named guest, up to
`OA_LINK_MAX_ROLE`.

## On AWS with CloudFormation

**Not run here** (no AWS account was used; the template was checked offline only). `deploy/aws/open-artifact-host.yaml`
makes one EC2 instance (Ubuntu 24.04, t3.medium by default) with an encrypted data volume at `/srv`, an Elastic IP, a
security group (80, 443 tcp and udp; 22 only to `SshCidr` if you set it), and a role for Session Manager. On first
boot it installs Docker, clones the repository at `RepoRef`, writes `.env` with a new `OA_SIGNING_KEYS`, runs
`docker compose up -d --build`, and sets a daily backup timer (to `/srv/backups`, and to S3 if you give `BackupBucket`).

```bash
aws cloudformation deploy --stack-name open-artifact --template-file deploy/aws/open-artifact-host.yaml --capabilities CAPABILITY_IAM --parameter-overrides AppHost=artifacts.example.com ContentDomain=oa-content.example.net AcmeEmail=you@example.com VpcId=vpc-0123456789abcdef0 SubnetId=subnet-0123456789abcdef0
```

Then add the DNS records from the `DnsRecords` output, open a shell with the `Shell` output's command, and get the
owner address with
`sudo sh -c 'cd /srv/open-artifact/deploy/docker && docker compose exec host node packages/host/src/node/main.ts owner-key'`.
The subnet must be public. The bucket, if any, is yours to create. Costs are the instance, the volume, the Elastic IP
and data transfer. `deploy/aws/README.md` has upgrades and restore on the instance, and why not Fargate.

## Upgrades

```bash
cd deploy/docker && ../backup.sh
```

```bash
git pull && docker compose up -d --build
```

The catalog's schema migrates by itself when the new version starts. Compose gives the old container 30 s to stop.
**Check:** the health answer shows the new version. Not run here (no Docker). Without Docker it is
`git pull && npm ci && npm run build` and a restart of your service.

## Backup and restore

`deploy/backup.sh` writes one `.tar.gz` with an exact copy of the catalog (made while the site runs), the
`artifacts/` folder and `keys.json` if there is one. `BACKUP_DIR` (default `/var/backups/open-artifact`), `BACKUP_KEEP`
(default 7), `BACKUP_S3` (an `s3://bucket/prefix`, needs the `aws` CLI).

```bash
deploy/backup.sh
```

With Compose it reads the `host` container through `docker compose exec` (not run here). Without Docker, set
`OA_DATA_DIR`; that was run here:

```
wrote /…/backups/open-artifact-20261122T094930Z.tar.gz (112640 bytes)
```

Restore with Compose (not run here):

```bash
docker compose down
```

```bash
docker run --rm -v open-artifact_oa-data:/data -v /var/backups/open-artifact:/b alpine sh -c 'rm -rf /data/* /data/.backup-host.db; tar -xzf /b/open-artifact-20261122T094930Z.tar.gz -C /data && mv /data/.backup-host.db /data/host.db && chown -R 1000:1000 /data'
```

```bash
docker compose up -d
```

Without Docker, unpack into an empty folder, rename `.backup-host.db` to `host.db`, and start with `OA_DATA_DIR` on it
(run here: the restored site started, the owner key valid at backup time signed in, and an artifact opened).

Keep the same `OA_SIGNING_KEYS` (it is in `.env`, not in the archive): without it, share-link addresses and open pages
made before stop working. Keep a copy of `.env` in a password manager.

## Behind a reverse proxy you already run

Run `node packages/host/src/node/main.ts serve` under your service manager (see the systemd unit in
[hosting-lan.md](hosting-lan.md#linux-systemd)) with `OA_BIND=127.0.0.1`, `OA_TRUST_PROXY=1`, https origins and
`OA_SIGNING_KEYS`. Your proxy must:

- send both names (the app host and `*.` the content domain) to the site, passing `Host` unchanged or setting
  `X-Forwarded-Host`, and set `X-Forwarded-Proto: https`;
- pass WebSocket upgrades;
- not buffer `text/event-stream` (the site already sends `X-Accel-Buffering: no` for nginx);
- keep idle upstream connections for less than 130 s (the site's idle time behind a proxy), or you get random 502s;
- allow bodies up to 101 MiB;
- have a certificate for the wildcard (usually DNS-01).

nginx, **not run here** (`packages/host/test/proxy.test.ts` checks the same requirements through a small test proxy):

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
  listen 443 ssl;
  server_name artifacts.example.com *.oa-content.example.net;
  # ssl_certificate / ssl_certificate_key: covering both names
  client_max_body_size 101m;
  location / {
    proxy_pass http://127.0.0.1:4900;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

Set `OA_TRUST_PROXY=1` only when the proxy is the only way to reach the site; otherwise anyone can pick the origin the
site thinks it serves.

## One domain for both

With one domain, the app at `app.example.com` and the artifacts at `{id}.example.com`. On https this costs little,
but not nothing: artifact pages share a domain with the sign-in page (look-alike pages, password managers that fill
by domain) and with whatever else runs on `example.com` (its cookies). Read
[One domain for both](hosting.md#one-domain-for-both) with the person; it is their decision.

In `.env`:

```
APP_HOST=app.example.com
CONTENT_DOMAIN=example.com
OA_CONTENT_SAME_SITE=true
```

DNS, at step 1:

```
app.example.com.          A     203.0.113.10
*.example.com.            A     203.0.113.10
```

The wildcard also catches every name of the domain that has no record of its own, so give other services on
`example.com` (`www`, `mail`) their own records. A name that still reaches this server is not served: with
certificates on demand, the site's ask endpoint refuses it a certificate; with the DNS wildcard certificate, Caddy
passes it on and the site answers 421. The Let's Encrypt limit of 50 new certificates a week per registered domain is
now shared with everything else on `example.com`; past it, use the wildcard certificate. Caddy serves
`app.example.com` from its own block, since an exact name wins over `*.example.com`.

**Expect:** `docker compose logs host` shows `content: https://{id}.example.com (same site as the app:
OA_CONTENT_SAME_SITE)`.

**Check:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://app.example.com/
```

**Expect:** `303` (to the sign-in page). And a cookie sent twice is refused, its sessions ended, and deleted:

```bash
curl -s -o /dev/null -D - -H 'cookie: __Host-oa_session=a; __Host-oa_session=b' https://app.example.com/api/open-artifact.auth.me | grep -ci '^set-cookie'
```

**Expect:** `1` (a `__Host-` cookie has one place to delete), and `refused duplicate cookies (__Host-oa_session) on
/api/open-artifact.auth.me` in `docker compose logs host`.

**If it fails:** `must be a different site … OA_CONTENT_SAME_SITE=true allows it`: the setting is not in `.env`, or
`compose.yaml` is older than the setting (it passes `OA_CONTENT_SAME_SITE` to the site). A 421 on `app.example.com`:
`APP_HOST` does not match the name you typed. `the app's host name … is, or is under, an artifact's content host`:
the app's name starts with `art-`; pick another.

**Not run here** (no Docker, no domain). The site's own answers (the 421, the duplicate-cookie refusal, the startup
line) were run here without Docker, on http names; the `__Host-` case is covered by `packages/host/test/same-site.test.ts`.

## If something is wrong

| You see | Cause |
| --- | --- |
| The site stops with `open-artifact-host: OA_APP_ORIGIN: must use https …` | An `http://` origin on a public name. |
| `OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN …` | The content domain is a sub-domain of the app's registrable domain. Use another domain, or read [One domain for both](#one-domain-for-both). |
| `421 … is not this site's app host nor an artifact's` | One domain for both: a name of the domain that is neither `APP_HOST` nor an artifact's reached the site. |
| `OA_SIGNING_KEYS: is required: …` | Not set in `.env`. |
| Signing in loops back to the sign-in page | The browser reached the site over http while the origin is https (the cookie is `Secure`). |
| Artifact pages do not load | `dig +short anything.<content domain>` is not the server; or, on demand, `docker compose logs caddy` shows the ask endpoint refusing a name (an artifact that does not exist or is in the trash). |
| Live editing does not work behind your proxy | WebSocket upgrades are not passed. |
| Lists and Link updates arrive late | The proxy buffers `text/event-stream`. |

## Limits

- Pictures, PDFs and videos are made on people's computers, never on the site.
- A dashboard's figures on the site come from the owner's computer, as of its last refresh (every 6 hours by default,
  or when someone presses Refresh), and only once the owner confirmed its data may be published.
- One process serves the site; it is not built to run as several copies behind a load balancer.
- Uploads and Link pushes up to 100 MiB, one file in a push up to 64 MiB.
