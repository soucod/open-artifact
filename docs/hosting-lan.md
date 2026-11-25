# A site on your home or office network

[中文](hosting-lan.zh-CN.md)

**At the end** you will have an Open Artifact site on one always-on computer of your network, at an address like
`http://192.168.1.20:4900`. Everyone on the same network can open what is shared with them, and your agents can publish
to it. It uses plain http, so it needs no domain and no certificate.

**Before you start** you need:

- an always-on computer on the network (a NAS, a mini PC, a spare Mac or Linux box) with Node 22.18 or later and git,
  or with Docker;
- its LAN address, and a way to keep it fixed (a DHCP reservation on the router);
- about 300 MB of disk for the program, plus your artifacts.

**What it cannot do:** reach anyone outside the network, or encrypt the traffic. Use it only on a network you trust.
For a site on the internet, see [hosting-server.md](hosting-server.md) or [hosting-cloudflare.md](hosting-cloudflare.md).

> **If you are an agent doing this for someone**
>
> - Ask, never guess: which computer runs the site and its LAN address; `nip.io` or the network's own DNS; who may
>   sign up; whether artifacts may be made public; whether a dashboard's data may be published.
> - Only the person can: change the router or DNS server, open the owner sign-in address (it is a secret), approve a
>   computer.
> - Never print a secret. The owner sign-in address is printed once by `owner-key`; tell the person to open it
>   themselves, and do not paste it into chat. Signing keys are in `<OA_DATA_DIR>/keys.json`.
> - Ask before changing a firewall or installing a service.
> - Check each step before the next. After two failures of the same step, stop and report.

**How to read the steps.** Every step has the command, **Expect:** (real output), **Check:** and **If it fails:**.
"Run here" means the command was run while writing this guide, on one Mac, with `127.0.0.1` and
`127-0-0-1.nip.io` on port 4977 in place of a real LAN address (no second computer and no router were involved).
"Not run here" says why and what the step rests on.

## How plain http is allowed

Both the site and your computer's Open Artifact allow `http://` only for names that are on this computer or a
private network. This is decided from the name **as written**; nothing is looked up in DNS
(`packages/protocol/src/network.ts`):

| Allowed over http | Examples |
| --- | --- |
| This computer | `localhost`, `*.localhost`, `127.x.x.x`, `::1` |
| Private addresses | `10.x`, `172.16.x`–`172.31.x`, `192.168.x`, link-local `169.254.x`, IPv6 `fc00::/7` and `fe80::/10` (also written as IPv4-mapped IPv6) |
| Private names | anything under `.local`, `.lan`, `.home.arpa`, `.internal`; a one-word name such as `nas` (no trailing dot) |
| `nip.io` / `sslip.io` | a name that spells only private or loopback addresses, such as `192-168-1-20.nip.io` |

Refused (https needed): every other name, including `100.64.0.0/10` addresses. That range is "carrier-grade NAT",
which **Tailscale** uses for its `100.x.y.z` addresses; it is shared address space, not a private network, so the
rule does not treat it as one. `0.0.0.0` and look-alike spellings (octal, hex, empty labels) are refused too.

On the site, `OA_ALLOW_HTTP=true` allows http for any name. On your computer, `remote add … --insecure-http` (or
`OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1`) does the same.

## Choose the names

The site needs two origins on two different sites (see [hosting.md](hosting.md#two-web-origins)): one for the app and
one wildcard for the artifacts. A bare address such as `http://192.168.1.20:4900` can be the app, but not the
artifacts, because every artifact needs its own host name. Two ways:

| | `nip.io` | Your network's wildcard DNS |
| --- | --- | --- |
| App | `http://192.168.1.20:4900` | `http://oa.lan:4900` |
| Artifacts | `http://{id}.192-168-1-20.nip.io:4900` | `http://{id}.oa-content.lan:4900` |
| Needs | Computers that can reach the public `nip.io` DNS, and a router that does not block DNS answers pointing at private addresses | A router or DNS server that answers a wildcard (dnsmasq, Pi-hole, AdGuard Home, OpenWrt) |
| Breaks when | The internet is down, or `nip.io` is | The DNS server is changed |

In the `nip.io` column the **app is the bare address** (`http://192.168.1.20:4900`, no `nip.io`) and the **artifacts
are the `nip.io` names** under it. The site answers each name only for what it is: the app only at exactly
`OA_APP_ORIGIN` (the name and port as written there), an artifact only at its own name, and every other name that
reaches it with a 421 and nothing else (no page, no cookie, no redirect). So `http://192-168-1-20.nip.io:4900` (the
bare `nip.io` name), `http://www.192-168-1-20.nip.io:4900` and `http://localhost:4900` are refused even though they
reach the same computer. Run here, with the app at `http://127.0.0.1:4977` and the artifacts on `127-0-0-1.nip.io`:

```bash
curl -s http://127-0-0-1.nip.io:4977/
```

**Expect** (status 421):

```
127-0-0-1.nip.io:4977 is not this site's app host nor an artifact's: Open Artifact does not answer it.
```

`curl -s http://www.127-0-0-1.nip.io:4977/` and `curl -s http://localhost:4977/` answered the same with their own
names. Give people the app's address exactly as `OA_APP_ORIGIN` has it.

Note for the DNS route: the two names should be different sites. `oa.lan` and `oa-content.lan` are; `nas.lan` and
`{id}.nas.lan` are not, and the site refuses them (run here):

```
open-artifact-host: OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN (http://nas.lan:4977), so that artifact pages cannot reach the session cookie: use another registrable domain. With only one domain, OA_CONTENT_SAME_SITE=true allows it, at a cost: read "One domain for both" in docs/hosting.md first.
```

If the network's DNS can only answer under one name, see [One domain for both](#one-domain-for-both) below.

## One domain for both

`nas.lan` for the app and `{id}.nas.lan` for the artifacts, with `OA_CONTENT_SAME_SITE=true`. **On plain http this
is the weakest layout**: a person who opens a hostile artifact while signed out can end up signed in as someone else
(the table in [hosting.md](hosting.md#one-domain-for-both) says how). The person who runs the site decides; an agent
asks and shows them that table first. Two names are better, and `nip.io` gives the second one for free.

Use these instead of the exports in [step 3](#3-make-the-owner-sign-in-address), and follow the steps as written:

```bash
export OA_APP_ORIGIN=http://nas.lan:4900 OA_CONTENT_ORIGIN='http://{id}.nas.lan:4900' OA_CONTENT_SAME_SITE=true OA_DATA_DIR="$HOME/.open-artifact-host"
```

The DNS server must answer `nas.lan` and every `*.nas.lan` with the computer's address (dnsmasq:
`address=/nas.lan/192.168.1.20` does both).

**Expect** at [step 4](#4-start-the-site), the content line says so:

```
  app:     http://nas.lan:4900
  content: http://{id}.nas.lan:4900 (same site as the app: OA_CONTENT_SAME_SITE)
```

**Check** the site keeps the two apart. Another name of the domain is refused, and a cookie sent twice is refused
and deleted. The commands send the name in a `Host` header to the address, so they work before the DNS server answers
`www.nas.lan` (with DNS in place, `curl -s http://www.nas.lan:4900/` is the same):

```bash
curl -s -H 'Host: www.nas.lan:4900' http://192.168.1.20:4900/
```

**Expect:** `www.nas.lan:4900 is not this site's app host nor an artifact's: Open Artifact does not answer it.`
(status 421).

```bash
curl -s -o /dev/null -D - -H 'Host: nas.lan:4900' -H 'cookie: oa_session=a; oa_session=b' http://192.168.1.20:4900/api/open-artifact.auth.me | grep -ci '^set-cookie'
```

**Expect:** `5` (the copies deleted on `nas.lan`, on its paths, and with `Domain=nas.lan`), and in the site's log
`refused duplicate cookies (oa_session) on /api/open-artifact.auth.me: another host of this domain set them`.

**If it fails:** `must be a different site … OA_CONTENT_SAME_SITE=true allows it` means the setting is not in the
site's environment (a systemd unit or launchd plist needs it too). `the app's host name (art-app.nas.lan) is, or is
under, an artifact's content host` means the app's own name starts with `art-`: every `art-…` label is an artifact's,
so pick another. A 421 on the app's own name means `OA_APP_ORIGIN` does not match the name people type (port
included).

`curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: nas.lan:4900' http://192.168.1.20:4900/` answers `303` (the app,
sending you to sign in), and the bare address `http://192.168.1.20:4900/` answers 421: in this layout the address is
not the app either.

Run here with `nas.lan` names on port 4976 of this computer (the requests sent to `127.0.0.1` with a `Host` header,
as above); the start-up lines, the 421, the `5`, the log line and the 303 are from that run. Not run on a real LAN
DNS server.

## Steps

In the commands, replace `192.168.1.20` with the computer's address and `192-168-1-20` with the same address written
with dashes.

### 1. Get the program and build it

```bash
git clone https://github.com/JimLiu/open-artifact.git && cd open-artifact
```

```bash
npm ci
```

```bash
npm run build
```

**Expect:** `npm ci` ends with `added 284 packages, and audited 325 packages in 3s` (numbers vary by version);
`npm run build` ends with `built everything in 28.6s`.

**Check:**

```bash
node packages/host/src/node/main.ts version
```

prints the version, for example `0.14.6`.

**If it fails:** `node --version` must be 22.18 or later. A build error names the package; run `npm ci` again after
`git pull`.

Run here (on a copy of the checkout). The clone URL was not run here.

### 2. Check the names resolve

With `nip.io`:

```bash
dig +short anything.192-168-1-20.nip.io
```

**Expect:** `192.168.1.20`. (Run here with `127-0-0-1.nip.io`, which printed `127.0.0.1`.)

**If it fails:** an empty answer usually means the router drops DNS answers that point at private addresses ("DNS
rebinding protection"). Allow `nip.io` in the router, use `sslip.io` the same way, or use your own wildcard DNS.

With your own DNS, dnsmasq for example (Pi-hole: a file in `/etc/dnsmasq.d/`; OpenWrt: **Network > DHCP and DNS**):

```
address=/oa.lan/192.168.1.20
address=/oa-content.lan/192.168.1.20
```

The second line answers `oa-content.lan` and every name under it.

```bash
dig +short art-test.oa-content.lan
```

**Expect:** `192.168.1.20`. Not run here: no LAN DNS server was available. The two lines are dnsmasq's documented
`address=/domain/ip` form, which also answers sub-domains.

### 3. Make the owner sign-in address

The **owner key** is a secret sign-in address for you, the person running the site; whoever signs in with it is a site
admin. Make it before the first start, so it is printed here and not into a service log:

```bash
export OA_APP_ORIGIN=http://192.168.1.20:4900 OA_CONTENT_ORIGIN='http://{id}.192-168-1-20.nip.io:4900' OA_DATA_DIR="$HOME/.open-artifact-host"
```

```bash
node packages/host/src/node/main.ts owner-key
```

**Expect:**

```
Generated a signing key for this local host in /Users/you/.open-artifact-host/keys.json.
A new owner key replaces the old one. Sign in as the owner at:
  http://192.168.1.20:4900/auth/sign-in#key=<secret>
```

Keep that address in a password manager. Running `owner-key` again makes a new one and the old one stops working.
The **signing key** (it signs page addresses and share links) was made in `keys.json` because the app origin is a
private address; anywhere else you must set `OA_SIGNING_KEYS` yourself.

**Check:** `ls -l "$OA_DATA_DIR"` shows `host.db` and `keys.json`, both `-rw-------`.

**If it fails:** a message starting `open-artifact-host: OA_…` names the setting that is wrong (see
[If the site refuses to start](#if-the-site-refuses-to-start)).

Run here, with the loopback addresses.

### 4. Start the site

```bash
OA_BIND=192.168.1.20 OA_PORT=4900 node packages/host/src/node/main.ts serve
```

`OA_BIND` is the address the site listens on. The default, `127.0.0.1`, is this computer only. Use the LAN address
(as here) so only that network can connect, or `0.0.0.0` for every network the computer is on.

**Expect:**

```
Open Artifact host 0.14.6 listening on http://192.168.1.20:4900
  app:     http://192.168.1.20:4900
  content: http://{id}.192-168-1-20.nip.io:4900
  data:   /Users/you/.open-artifact-host
```

**Check**, from another terminal:

```bash
curl -s http://192.168.1.20:4900/__open-artifact/health
```

**Expect:** `{"openArtifact":1,"version":"0.14.6"}`. (The health address answers on any name, for load balancers and
container checks; everything else answers only on the site's own names.) Then from **another computer** on the network,
open `http://192.168.1.20:4900/`: it goes to the sign-in page.

**If it fails:** `EADDRNOTAVAIL` means `OA_BIND` is not this computer's address (the address changed: reserve it in
the router). It works here but not from another computer: see [step 5](#5-open-the-firewall).

Run here with `OA_BIND=127.0.0.1 OA_PORT=4977` and `OA_APP_ORIGIN=http://127.0.0.1:4977`. The start-up lines were:

```
Open Artifact host 0.14.6 listening on http://127.0.0.1:4977
  app:     http://127.0.0.1:4977
  content: http://{id}.127-0-0-1.nip.io:4977
  data:   /private/tmp/…/run8/host
```

followed by the owner sign-in address, since that run skipped step 3 (`Sign in as the owner (shown this once; …
owner-key makes a new one):`). The health answer was as above, `/` answered `303` to
`/auth/sign-in?return_to=%2F`, and an artifact page on `http://art-….127-0-0-1.nip.io:4977/` answered 200 with no
cookie. Not run here: another computer.

### 5. Open the firewall

Only if another computer cannot connect. Ask the person first.

macOS: the first start asks "Do you want the application node to accept incoming network connections?" Choose
**Allow**. Or in **System Settings > Network > Firewall > Options**, allow `node`.

Linux with ufw, allowing only your network:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 4900 proto tcp
```

**Check:** `sudo ufw status` lists the rule.

Not run here (one computer, and the firewall is a system setting).

### 6. Sign in

The person opens the owner sign-in address from step 3 in their browser. **Expect:** the home page, empty:
"No artifacts yet. Publish one from an agent with the Artifact tool, or ask someone to share one with you."

The cookie is `oa_session` without `Secure` over http (browsers keep `Secure` cookies only over https).

**Check without a browser** (on the site's computer; the key is the part after `#key=` in the address). The page
posts the key to `/auth/owner-key`; curl can do the same, keeping the session in a cookie file:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -c jar -H 'Origin: http://192.168.1.20:4900' \
  --data-urlencode "key=<secret>" http://192.168.1.20:4900/auth/owner-key
```

**Expect:** `303 http://192.168.1.20:4900/` (signed in; a wrong key answers 401 with the sign-in page again, saying "That is not
the owner key."). Then

```bash
curl -s -b jar http://192.168.1.20:4900/api/open-artifact.auth.me
```

answers the `Owner` with `"siteRole":"admin"`. The `Origin` header may be left out (a client without a browser's
`Sec-Fetch-Site` is judged by it); one naming another origin is refused with 403. Delete `jar` afterwards: it holds a
live session.

Run here against `http://127.0.0.1:4977` (303 to `/`, then `auth.me` as above).

### 7. Put an artifact on it

An agent's computer publishes artifacts once it is connected (step 8). To put one on the site without that, there
are two ways.

**From the site's computer**, with the same environment as the site (step 3's exports): a folder that holds an
artifact, or its `.zip`:

```bash
node packages/host/src/node/main.ts import ./team-board
```

**Expect:**

```
Imported "Whiteboard element test" (whiteboard) as art_0mwrwyd1w7a6a58eb2f431e47
  http://192.168.1.20:4900/a/art_0mwrwyd1w7a6a58eb2f431e47
```

It belongs to the owner-key owner (`--owner <email>` gives it to someone else, made if missing). It works while the
site runs; the address printed is built from `OA_APP_ORIGIN`, so a missing export prints `http://localhost:4900`.

**From a browser:** on the home page, **Upload** takes the `.zip` an artifact's Export tab makes ("Whole folder
(.zip)"), up to 100 MiB. The same upload with curl and the session from step 6:

```bash
curl -s -b jar -H 'Origin: http://192.168.1.20:4900' -H 'content-type: application/zip' \
  --data-binary @team-board.zip http://192.168.1.20:4900/api/open-artifact.artifacts.import
```

**Expect:** a JSON answer starting `{"id":"art_…","url":"http://192.168.1.20:4900/a/art_…","title":…`. A zip must hold
one folder with files only: one made with `zip -r` of the folder's contents is refused with `".artifact.json" is at
the top of the zip; an artifact archive holds one folder.`, and one with folder entries with `"team-board/" is not a
regular file …`; `zip -qrD team-board.zip team-board` (from the folder's parent) makes a good one.

**Check:** the home page lists it, and its address opens it.

Run here: the folder import, the zip import with the CLI, both refusals and the upload with curl, against
`http://127.0.0.1:4977`. Not run here: the **Upload** button in a browser.

### 8. Connect your computers

Follow [connecting-agents.md](connecting-agents.md#connect-a-computer-to-a-site), with the site's address:

```bash
open-artifact remote add home http://192.168.1.20:4900
```

Plain http on a private address is accepted without a flag. For a `nip.io` name the command first prints
`Warning: http://… uses plain http: the connection is not encrypted, so use it only on a network you trust.`

## Keep it running

Pick one. Each runs `serve` with the same settings and restarts it after a crash or a reboot. Make the owner key with
step 3 first, as the same user and with the same `OA_DATA_DIR`.

### Linux: systemd

Not run here (macOS). `/etc/open-artifact/host.env` (mode 600, owned by root):

```
OA_APP_ORIGIN=http://192.168.1.20:4900
OA_CONTENT_ORIGIN=http://{id}.192-168-1-20.nip.io:4900
OA_BIND=192.168.1.20
OA_PORT=4900
OA_DATA_DIR=/var/lib/open-artifact
```

`/etc/systemd/system/open-artifact.service`:

```ini
[Unit]
Description=Open Artifact site
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=oa
Group=oa
WorkingDirectory=/opt/open-artifact
EnvironmentFile=/etc/open-artifact/host.env
ExecStart=/usr/bin/node packages/host/src/node/main.ts serve
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/open-artifact

[Install]
WantedBy=multi-user.target
```

`/opt/open-artifact` is the built checkout, `oa` a user made for it, and `/var/lib/open-artifact` a folder `oa` owns.
`serve` stops cleanly on SIGTERM, which is what `systemctl stop` sends.

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now open-artifact
```

**Check:** `systemctl status open-artifact` shows `active (running)`; `journalctl -u open-artifact -n 20` shows the
`listening on` lines; the health check from step 4 answers.

**If it fails:** `journalctl -u open-artifact` shows the `open-artifact-host: OA_…` message. With a LAN address in
`OA_BIND`, the network may not be up yet at boot: `network-online.target` above waits for it, and `Restart=on-failure`
tries again.

### macOS: launchd

`~/Library/LaunchAgents/ai.openartifact.host.plist` (it runs while you are logged in; for a Mac that sits logged out,
put it in `/Library/LaunchDaemons` with a `UserName` key):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openartifact.host</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>packages/host/src/node/main.ts</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/you/open-artifact</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OA_APP_ORIGIN</key>
    <string>http://192.168.1.20:4900</string>
    <key>OA_CONTENT_ORIGIN</key>
    <string>http://{id}.192-168-1-20.nip.io:4900</string>
    <key>OA_BIND</key>
    <string>192.168.1.20</string>
    <key>OA_PORT</key>
    <string>4900</string>
    <key>OA_DATA_DIR</key>
    <string>/Users/you/.open-artifact-host</string>
    <key>NODE_OPTIONS</key>
    <string>--disable-warning=ExperimentalWarning</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/you/Library/Logs/open-artifact-host.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/Library/Logs/open-artifact-host.log</string>
</dict>
</plist>
```

Use the output of `which node` for the first string, and your own paths for `/Users/you`.

```bash
plutil -lint ~/Library/LaunchAgents/ai.openartifact.host.plist
```

**Expect:** `…/ai.openartifact.host.plist: OK` (run here).

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openartifact.host.plist
```

**Check:** `launchctl print gui/$(id -u)/ai.openartifact.host | grep state` shows `state = running`; the log file has
the `listening on` lines. Stop it with `launchctl bootout gui/$(id -u)/ai.openartifact.host`.

Not run here: loading the job (it would have started a service on the writer's computer). The file passed `plutil`.

### Docker

Not run here: Docker was not installed. Behind no proxy, on a LAN, with the repository's `Dockerfile`. A
`compose.yaml` in a folder of its own:

```yaml
name: open-artifact-lan
services:
  host:
    build:
      context: /opt/open-artifact      # the checkout
    image: open-artifact-host:local
    restart: unless-stopped
    init: true
    environment:
      OA_APP_ORIGIN: http://192.168.1.20:4900
      OA_CONTENT_ORIGIN: http://{id}.192-168-1-20.nip.io:4900
    ports:
      - "192.168.1.20:4900:4900"        # only the LAN address
    volumes:
      - oa-data:/data
volumes:
  oa-data:
```

The image sets `OA_DATA_DIR=/data`, `OA_BIND=0.0.0.0` (inside the container) and `OA_PORT=4900`, runs as the `node`
user, and has a health check on `/__open-artifact/health`.

```bash
docker compose up -d --build
```

```bash
docker compose exec host node packages/host/src/node/main.ts owner-key
```

**Expect:** the `Sign in as the owner at:` address, as in step 3. (Without this, the first start prints the address
once in `docker compose logs host`.) The signing key is made in the volume's `keys.json`.

**Check:** `docker compose ps` shows `healthy`; `curl -s http://192.168.1.20:4900/__open-artifact/health`.

## The owner key, backups and upgrades

- **A new owner key:** run `owner-key` again with the same `OA_DATA_DIR` (step 3). **Expect:** `A new owner key replaces
  the old one. Sign in as the owner at:` and the address (run here). If `OA_OWNER_KEY` is set in the environment,
  `owner-key` refuses: change the variable instead.
- **Back up** while the site runs:

  ```bash
  OA_DATA_DIR="$HOME/.open-artifact-host" BACKUP_DIR="$HOME/oa-backups" sh deploy/backup.sh
  ```

  **Expect:** `wrote /Users/you/oa-backups/open-artifact-20261122T094930Z.tar.gz (112640 bytes)` (run here). The
  archive holds `.backup-host.db` (an exact copy of the catalog), `artifacts/` and `keys.json`. `BACKUP_KEEP` (default
  7) archives are kept. An artifact being edited at that moment can be caught half-way through a change. Schedule it
  with cron or a second launchd job.
- **Restore:** stop the site, unpack into an empty folder, rename the catalog, start with that folder:

  ```bash
  mkdir -m 700 "$HOME/.open-artifact-host-restored"
  ```

  ```bash
  tar -xzf "$HOME/oa-backups/open-artifact-20261122T094930Z.tar.gz" -C "$HOME/.open-artifact-host-restored"
  ```

  ```bash
  mv "$HOME/.open-artifact-host-restored/.backup-host.db" "$HOME/.open-artifact-host-restored/host.db"
  ```

  Then start it with `OA_DATA_DIR` set to that folder. **Check:** the health answer, then the owner key that was valid
  when the backup was made signs in, and the artifacts open. Run here: the restored copy started on another port, the
  owner key signed in (303), and an artifact page answered 200.
- **Upgrade:** back up, then `git pull && npm ci && npm run build`, then restart the service. The catalog migrates by
  itself on start. Not run here as an upgrade between two versions.

## Security, plainly

- **Nothing is encrypted.** Anyone on the same network who can watch traffic (a shared Wi-Fi, a compromised device)
  can read the pages, the session cookie and the Link tokens of computers connected to the site. Use it on a network
  you trust, or use https.
- **Two isolation headers are not in force.** Browsers honour `Cross-Origin-Opener-Policy` and
  `Origin-Agent-Cluster` only on https or `localhost`, so on a plain-http LAN name the site does not send them (Chrome
  would only log that it ignored them). What still holds: `Cross-Origin-Resource-Policy`, no framing, the CSPs and the
  checks on every write. What that leaves, mostly in the one-name layout: a window an artifact page opened the Shell
  from can send it to another address, and an artifact page and the Shell may share a browser process. The table in
  [hosting.md](hosting.md#one-domain-for-both) has each case.
- **Who can connect** is decided by `OA_BIND` and the firewall, not by the site. Bind to the LAN address, not
  `0.0.0.0`, on a computer that is also on another network (a VPN, a second interface).
- **One name for both** (`OA_CONTENT_SAME_SITE=true`) is weaker on http than anywhere else: see
  [One domain for both](#one-domain-for-both).
- **Accounts still apply.** Nobody gets an artifact without signing in or a share link. With only the owner key as a
  sign-in method, other people join as guests through links, or you add a sign-in provider (see
  [hosting-server.md](hosting-server.md#sign-in-providers); an OIDC issuer must be https, and most providers accept an
  http callback address only on `localhost`, so on a plain-http LAN site the owner key and share links are the usual
  way in).
- **The data folder** is created with mode 0700, and `host.db` and `keys.json` with 0600 (checked here). Back up
  `keys.json` with the rest: without it, share-link addresses and open pages stop working.
- **Tailscale.** A `100.x.y.z` address or a `*.ts.net` name is not treated as private, so plain http needs
  `OA_ALLOW_HTTP=true` on the site and `--insecure-http` on each computer, and the site then also needs
  `OA_SIGNING_KEYS` set by you (a signing key is only made automatically for a loopback or private app origin). Run
  here: with an app origin of `http://100.101.102.103:4977` and `OA_ALLOW_HTTP=true`, the site stopped with
  `open-artifact-host: OA_SIGNING_KEYS: is required: …`; without `OA_ALLOW_HTTP` it stopped with `must use https`; and
  `open-artifact remote add pub http://100.101.102.103:4977` answered:

  ```
  open-artifact: http://100.101.102.103:4977: a host must use https (http only on this computer or a private network: a private address, .local, .lan, .home.arpa, .internal or a one-word name).
    Use its https address. If it really is on a network you trust and has no https, add it with --insecure-http (OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1).
  ```

  Tailscale's own traffic is encrypted by WireGuard, but the rule is about the name, not the tunnel. A whole Tailscale
  set-up (MagicDNS has no wildcard names, so the artifacts would need `{id}.100-101-102-103.nip.io` with
  `OA_ALLOW_HTTP`) was not run here. `tailscale serve` with an https `*.ts.net` name gives only one host name, which is
  not enough for the artifacts' wildcard.

## If the site refuses to start

It prints one line naming the setting. Lines seen while writing this guide:

| Message (start) | Meaning |
| --- | --- |
| `OA_CONTENT_ORIGIN: must contain {id} exactly once, … A bare address such as http://192.168.1.20:4900 cannot be the content origin.` | Use a `nip.io` name or a wildcard DNS name for the artifacts. |
| `OA_APP_ORIGIN: must use https (http is only for this computer or a private network: …; OA_ALLOW_HTTP=true allows any)` | The name is not private (a public name, a `100.x` address). |
| `OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN …` | The two names are one site (`nas.lan` and `{id}.nas.lan`). Use two names, or read [One domain for both](#one-domain-for-both). |
| `OA_CONTENT_ORIGIN: the app's host name (…) is, or is under, an artifact's content host …` | The app's name starts with `art-`, which is an artifact's. Pick another. |
| `OA_SIGNING_KEYS: is required: …` | The app origin is not loopback or private: set `OA_SIGNING_KEYS` to one or more random secrets of 32 characters or more, comma-separated. |

To make a signing key:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Limits

- Everyone must be on the network (or on a VPN into it).
- Pictures and PDFs are made on people's own computers, never on the site.
- A dashboard's figures on the site come from the owner's computer: as of the last refresh (every 6 hours by
  default), and only after the owner confirms that its data may be published.
- Several settings are described in `packages/host/README.md`: sign-in providers, `OA_SIGNUP`, `OA_LINK_MAX_ROLE`,
  `OA_PUBLIC_ACCESS`, `OA_TRASH_DAYS`, `OA_PAGE_NETWORK`.
