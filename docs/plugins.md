# Plugins: your own sign-in, permissions and rules on a site

[中文](plugins.zh-CN.md)

A **plugin** adds to a site what only your organisation knows: how people sign in, who may open what, what must be
refused, and which other systems to tell when something happens. It is one JavaScript file (or an npm package) that
the site loads when it starts. The same plugin runs on the Node site and on Cloudflare.

Most people only **use** plugins: pick one, write its settings in a list, restart the site. That is the first half of
this page. The second half is for people who **write** one.

> **If you are an agent doing this for someone**
>
> - Ask, never guess: whether to install a plugin at all; which sign-in or permission system to trust; what the
>   permission service may see about people (each question sends the person's e-mail, groups and the artifact's
>   title); which department, group or address gets which role.
> - A plugin runs with the site's full authority. Install only code the person chose, and say where it comes from.
> - Never print a secret (shared secrets, keys, webhook URLs, the owner key). Put it in an environment variable or a
>   Worker secret and say where it is.
> - Run `plugin check` before every restart. On a live site, restart only with the person's go-ahead.
> - Check each step with its **Check:** before the next one. After two failures of the same step, stop and report
>   what you ran and what you saw.

## What a plugin can do, in one screen

| You want | Hook | Example in `examples/host-plugins/` |
| --- | --- | --- |
| People sign in with the company login (a proxy header, your JWT cookie, your SSO) | `auth.authenticate`, `auth.signIn` | `header-auth.mjs`, `company-jwt.mjs` |
| Add groups after any sign-in, or refuse some people | `auth.identity` | `company-jwt.mjs` (refuses unlisted departments) |
| Permissions from your own service | `authz.role` | `http-authz.mjs` |
| Permissions from a table in the settings ("design edits everything") | `authz.role` | `static-groups.mjs`, `company-jwt.mjs` |
| Refuse an action by policy (no public links, no downloads, no uploads over 10 MB) | `guard` | `company-jwt.mjs` (no public links) |
| Tell Slack or your log what happened | `on.<event>` | `webhook-events.mjs` |
| E-mail people when something is shared with them | `on.share.invited` | `invite-email.mjs` |
| A link or the company's name on the site's pages | `ui` | `company-jwt.mjs` ("My department" in the account menu) |
| A web address of its own (a webhook, a small page) | `routes` | `http-authz.mjs` (`/plugins/http-authz/invalidate`) |
| Hand requests for the owner's agent to your own runner | `wake.deliver` | none yet |

What a plugin cannot do yet is listed under [What a plugin cannot do](#what-a-plugin-cannot-do).

## Use a plugin (operators)

### The plugin list

The site reads one list. Each entry names a plugin (`use`) and gives its settings (`config`):

```json
[
  { "use": "/srv/open-artifact/examples/host-plugins/header-auth.mjs",
    "config": { "secret": { "env": "PROXY_SECRET" }, "groupsHeader": "x-forwarded-groups" } },
  { "use": "/srv/open-artifact/examples/host-plugins/static-groups.mjs",
    "config": { "groups": { "design": "bob@example.com, carol@example.com", "staff": "@example.com" },
                "roles": { "staff": "viewer", "design": "editor" } },
    "cacheSeconds": 300 },
  { "use": "/srv/open-artifact/examples/host-plugins/webhook-events.mjs",
    "config": { "url": { "env": "SLACK_WEBHOOK_URL" }, "format": "slack" },
    "optional": true, "timeoutMs": 2000 }
]
```

| Field | Meaning |
| --- | --- |
| `use` | A path to the plugin's file, or an npm package name. On Cloudflare: the name it is bundled under. |
| `config` | The plugin's settings. Each plugin lists its own (`plugin list` shows the names). |
| `enabled` | `false` keeps the entry but does not run it. |
| `optional` | When it cannot load or its settings are wrong, the site starts without it (and logs why) instead of refusing to start. Use it for nice-to-have plugins, never for sign-in or permissions. |
| `timeoutMs` | How long each call may take, 1 to 60000 ms. Default 5000. |
| `cacheSeconds` | How long the site reuses a permission answer, 0 to 86400. Wins over the plugin's own default. |

A bare string (`"./audit.mjs"`) is an entry with only `use`. Order matters for sign-in (the first plugin that knows
the person wins) and for roles (each plugin sees the answer of the one before).

### Where the list lives

| Site | The list | Which wins |
| --- | --- | --- |
| Node | the environment variable `OA_PLUGINS` (JSON), or the file `OA_PLUGINS_FILE` (default `<data dir>/plugins.json`) | `OA_PLUGINS` when it is set; the file is then ignored |
| Cloudflare | the Worker variable or secret `OA_PLUGINS` | there is only this one |

Relative paths in the file start at the file's folder; in `OA_PLUGINS`, at the folder the site starts in. Use full
paths and there is nothing to work out. A package name is looked for in `<data dir>/plugins/node_modules` (install with
`npm install --prefix <data dir>/plugins <package>`), then where the site itself finds packages.

A plugin can import `@open-artifact/host-plugin` (the helpers; `header-auth.mjs`, `http-authz.mjs` and
`company-jwt.mjs` do) from any folder, without installing it: the site hands every plugin its own copy of that package
(on Node when the plugin loads, on Cloudflare when the Worker is built). So any plugin file, the examples included,
can be copied anywhere, the data folder too, and listed by its path there.

### Settings and secrets

Never write a secret into the list. Give any setting as `{"env": "NAME"}` and the site reads it from that environment
variable (on Cloudflare: a Worker variable or secret of that name). The text is read as the setting's type: a `map` or
`json` setting as JSON, a `string[]` as a comma-separated list or a JSON array.

The site checks every setting when it starts. A misspelt name stops it, and says what was meant:

```
! Plugin "header-auth": unknown setting "emailHeadr". Did you mean "emailHeader"? Its settings are: emailHeader, nameHeader, groupsHeader, secretHeader, secret, jwtHeader, jwksUrl, issuer, audience.
```

A secret written into the list is only a warning, so the site still starts; move it out:

```
! Plugin "header-auth", setting "secret": the secret is written into the configuration; give it as {"env": "NAME"} to keep it out of the file.
```

Secrets never appear in `plugin list`, the admin API or the logs.

### Commands on the Node site

Run from the Open Artifact folder, with the same `OA_DATA_DIR` the site uses. (The messages say
`open-artifact-host`; from the source folder that command is `node packages/host/src/node/main.ts`.)

```
node packages/host/src/node/main.ts plugin list                 the plugins, their hooks and settings, and what is wrong
node packages/host/src/node/main.ts plugin check                the same; exits 1 when the site would not start
node packages/host/src/node/main.ts plugin role <artifact id> --as <email> [--json]   that person's role and what decided it
node packages/host/src/node/main.ts plugin add <path or package> [--config <json>] [--optional] [--disabled] [--timeout-ms <n>] [--cache-seconds <n>]
node packages/host/src/node/main.ts plugin remove|enable|disable <id or path>
node packages/host/src/node/main.ts plugin set <id or path> [<setting>=<value>…] [--secret <setting>=<ENV_NAME>…] [--timeout-ms <n>] [--cache-seconds <n>] [--optional | --required]
node packages/host/src/node/main.ts plugin unset <id or path> <setting>…
node packages/host/src/node/main.ts audit [--artifact <id>] [--actor <id>] [--action <prefix>] [--before <time>] [--limit <n>] [--json]
```

`add`, `remove`, `enable`, `disable`, `set` and `unset` change `plugins.json` (written readable by its owner only) and
take effect when the site restarts. They refuse while `OA_PLUGINS` is set:

```
open-artifact-host: OA_PLUGINS is set, and it wins over the plugin list file: change OA_PLUGINS instead (or unset it to use the file).
```

`plugin add ./my-plugin.mjs` is read from the folder you typed it in, and stored so it keeps pointing there: relative
to the list file's folder when it is under that folder, as a full path otherwise. The command says what it stored.

`plugin set` changes settings without editing the file: `plugin set static-groups 'roles={"design":"editor"}'` (a
value is read as the setting's type, as from an environment variable), `--secret key=CORP_JWT_KEY` stores
`{"env":"CORP_JWT_KEY"}` (the secret itself never goes into the file), and `--timeout-ms`, `--cache-seconds`,
`--optional` or `--required` change the entry. The plugin checks the new settings before anything is written; a variable
not set in your shell is named, to set where the site runs. `plugin unset <id> <setting>` removes settings.

`plugin role` runs the site's own rule and then every permission plugin for one person and one artifact, with this
shell's settings, and says which one decided (example 2 shows it); a site admin gets the same from
`GET /api/open-artifact.admin.access?artifact=<id>&email=<address>`, on Node and on Cloudflare.

`plugin check` ends with `All N plugin(s) that are on can run.` (exit 0) or `The host would not start: …` (exit 1).
In `plugin list`, `on` means it runs, `off` that it is disabled in the list, and `failed` that it cannot run; the `!`
lines say why (for a file that is missing, which file was looked for).

### On Cloudflare

A Worker cannot load code while it runs, so plugins are built into it:

1. Import each plugin in `deploy/cloudflare/plugins.mjs` and export it under a name:

   ```js
   import companyJwt from '../../examples/host-plugins/company-jwt.mjs';
   import staticGroups from '../../examples/host-plugins/static-groups.mjs';
   export default { 'company-jwt': companyJwt, 'static-groups': staticGroups };
   ```

2. Build and deploy (`npm run build`, then `wrangler deploy`, as in [the Cloudflare guide](hosting-cloudflare.md)).
3. Choose and configure them with `OA_PLUGINS`, by those names:
   `[{"use":"company-jwt","config":{"key":{"env":"CORP_JWT_KEY"},"issuer":"https://login.corp.example","departments":{"design":"editor"}}}]`,
   with `CORP_JWT_KEY` a Worker secret (`wrangler secret put CORP_JWT_KEY`).

| You change | You need |
| --- | --- |
| a plugin's settings, or which bundled plugins run | a new `OA_PLUGINS` only, no build: as a variable in your wrangler config, then `wrangler deploy`; or as a secret, `wrangler secret put OA_PLUGINS`, which deploys a new version by itself |
| a new plugin, or a new version of one | edit `plugins.mjs`, `npm run build`, `wrangler deploy` |

`plugins.mjs` (or your own file, given to the build as `OA_PLUGINS_MODULE`) can import plugins from any folder; a
plugin that imports `@open-artifact/host-plugin` gets the copy the Worker is built with.

A name in `OA_PLUGINS` that is not built in stops every request with (the file named is the one the build used):

```
Open Artifact is not configured: The plugin "header-auth" could not be loaded: it is not bundled into this Worker: add it to deploy/cloudflare/plugins.mjs as "header-auth" and build again (bundled: "company-jwt", "static-groups")
```

Run here: `company-jwt` and `static-groups` were built with `OA_PLUGINS_MODULE=<file> OA_BUILD_DIST=<folder> node
build.mjs` (both point the build at a file and folder of your own) and run under `wrangler dev`: sign-in by cookie,
the department roles (editor, viewer), the guard's refusal and the admin API worked as on Node; a new `OA_PLUGINS`
(sales from viewer to commenter) took effect on restart without a build; an unbuilt name gave the message above.
Not run here: `wrangler deploy` and `wrangler secret put` (no deployment was touched).

There is no `plugin` command on Cloudflare. Each part of the Worker (the site, and each artifact's room) runs its own
copy of the plugins; see [Limits](#limits).

### When a plugin fails

A plugin fails when it throws, runs past its time limit, or answers something the site cannot use. What happens next
depends on what was asked:

| Asked | When it fails | Why |
| --- | --- | --- |
| Sign-in (`auth.*`) | Nobody is signed in by it; at `auth.identity`, the sign-in is refused with "This sign-in could not be checked just now. Try again in a moment." | A failing check must not let anyone in. |
| Permissions (`authz.role`) | **No access**, for that person and artifact, not cached. This includes the artifact's owner and people it is shared with: the site treats a failing plugin as "no". A signed-in person is told "A permission check could not be completed just now. Try again in a moment; if it persists, the site's operator can see why in the audit log." (403 `not_granted` from the API) instead of "not shared with you". | A failing permission check must not open anything. |
| A guarded action (`guard`) | Refused: "This could not be checked just now (<plugin name>). Try again in a moment." | Same. |
| Events (`on.*`), `wake.deliver` | Logged and ignored; the action has already happened. A request for an agent goes to the owner's outbox as usual. | Telling Slack must not stop the work. |
| Its own web address (`routes`) | An error answer to that request only. | |

So a permission plugin whose service is down locks people out until the service is back. Keep such a service as
available as the site, give the plugin a `cacheSeconds` that covers short outages, or make it `optional` only if you
accept that the site then starts without it. Every failure is in the audit log as `plugin.failed`, with the plugin,
the hook and the error (see below).

To let people back in while the service stays down, take the plugin out; then the site's own sharing decides again:

- **Node**: `plugin disable <id>` and restart the site (with `OA_PLUGINS` set, remove the entry there and restart).
- **Cloudflare**: remove the entry from `OA_PLUGINS` (`wrangler secret put OA_PLUGINS`, or the variable and
  `wrangler deploy`). No build is needed.

Put it back the same way once the service answers again.

### Seeing what runs

- **At start-up** the Node site logs `  plugins: header-auth, static-groups (from /srv/oa/plugins.json)`.
- **A site admin** sees the list, signed in, at `GET /api/open-artifact.admin.plugins` (id, name, version, hooks,
  setting names, problems; never values). Others get 403 `Only a site admin sees the plugin list.`
- **The log** gets one line per failure: `plugin http-authz: authz.role failed (refused): threw: fetch failed`.
  Lines a plugin writes itself start with `plugin <id>: `.
- **The audit log** gets `plugin.failed` (`{"plugin","hook","reason","error"}`, the error with the plugin's secrets
  taken out) when sign-in, permissions or a guard failed, `plugin.denied` (`{"action","artifact"}`) when a guard
  refused, `auth.sign_in_refused` when a sign-in was refused, and whatever plugins write themselves (`invite.sent`).
  On Node read it with `audit`:

  ```bash
  node packages/host/src/node/main.ts audit --action plugin.
  ```

  ```
  2026-11-22T12:05:06.533Z  plugin.failed  system:plugin:http-authz  {"plugin":"http-authz","hook":"authz.role","reason":"threw","error":"threw: fetch failed"}
  ```

  `--artifact <id>`, `--actor <id>`, `--action <prefix>` (`auth.` is every sign-in entry) and `--before <time>` narrow
  it; the newest come first, 100 at a time (`--limit`, at most 500), and a last line `More: … audit --before '…'` gives
  the next page. `--json` prints the page as the API answers it.

  A site admin, signed in, reads the same on either host at
  `GET /api/open-artifact.admin.audit?action=plugin.&limit=50`: `{"entries":[…],"next":"…"}`, newest first; pass
  `next` as `before` for the page after (`next` is null on the last page). The filters are `artifact`, `actor`,
  `action`, `before` and `limit`; any other name is a 400. Others get 403 `Only a site admin reads the audit log.`; agent
  tokens are refused.

### Upgrades: what stays stable

A plugin says which version of the plugin API it was written for (`apiVersion: 1`). Within one version the site only
**adds**: new hooks, events, guard actions, fields in what a hook receives, members of `ctx`. A plugin written for
version 1 keeps working on every later release that speaks version 1, so you do not touch your plugins when you
upgrade the site.

A **breaking** change is one that would make a working plugin wrong: removing or renaming a hook, event, setting type
or `ctx` member, changing what an answer means (say, `null` from `authz.role`), or making a failure policy looser.
Such a change raises the API version. A site then refuses a plugin written for a newer version with a message saying
which release it needs, and keeps running plugins of the previous version for at least one more major release. The
release notes (CHANGELOG.md) say when this happens.

After an upgrade, run `plugin check` before restarting; it loads every plugin and checks its settings against the new
release.

### Docker

The Docker image runs the same Node site but holds only the files the site needs, not the examples. Put a plugin
into the data volume (`/data`, for example `/data/plugins/header-auth.mjs`) and list it by its path there, in
`/data/plugins.json` or `OA_PLUGINS` (`deploy/docker/compose.yaml` passes `OA_PLUGINS` and `OA_PLUGINS_FILE` through;
add the plugins' secrets to the container's environment). Every example loads from there, those that import
`@open-artifact/host-plugin` too: the image carries that package.

Run here: the files the Dockerfile copies were staged into a folder by hand, made read-only, and the site run from it
with `/data` elsewhere; `plugin add` of `header-auth.mjs` and a plugin that imports nothing from the data folder, the
start-up, sign-in through the header and an imported artifact worked. Not run here: the image itself was not built.

## Worked examples on your computer

Five examples, each on a Node site on your own computer, in a folder of its own, on ports that do not clash with a site
you may already run (4911 for the site, 4912 for the sign-in proxy in front of it). Everything here was run while
writing this page; ids, times and keys differ on yours. Paths are shortened to `~/oa-plugins-demo`.

You need the Open Artifact source folder with `npm install` done, Node 22 or later, `curl` and `openssl`.

### 0. A site to try plugins on

1. In the Open Artifact folder, make the demo folder and its settings:

   ```bash
   mkdir -p ~/oa-plugins-demo
   cat > ~/oa-plugins-demo/env.sh <<'EOF'
   export WORK=~/oa-plugins-demo
   export OA_DATA_DIR=$WORK/site OA_PORT=4911
   export OA_APP_ORIGIN=http://localhost:4912 OA_CONTENT_ORIGIN='http://{id}.content.localhost:4912'
   export OA_OWNERS=ann@example.com OA_SIGNUP=domain:example.com
   unset OA_PLUGINS OA_PLUGINS_FILE
   oah() { node packages/host/src/node/main.ts "$@"; }
   EOF
   source ~/oa-plugins-demo/env.sh
   oah plugin list
   ```

   The site's address is the proxy's (4912): people reach the site only through it. `OA_SIGNUP=domain:example.com`
   lets anyone with an `@example.com` address in; Ann is the site's admin.

   **Expect:**

   ```
   No plugins (no OA_PLUGINS and no /Users/you/oa-plugins-demo/site/plugins.json).
   ```

   **If it fails:** `Cannot find module` means you are not in the Open Artifact folder or `npm install` was not run.

2. Make a sample artifact to upload later:

   ```bash
   node -e "import('./packages/type-server/src/archive.ts').then(a => a.writeArchive('test-artifacts/whiteboard/elements', process.argv[1])).then(console.log)" "$WORK/sample.zip"
   ```

   **Expect:** `{ file: '/Users/you/oa-plugins-demo/sample.zip', bytes: 253451, files: 199 }`

In every new terminal, `cd` to the Open Artifact folder and `source ~/oa-plugins-demo/env.sh` first.

### 1. Sign in through your company's proxy (`header-auth`)

Many companies put a sign-in proxy (oauth2-proxy, an SSO gateway, an ingress) in front of internal sites. It signs the
person in and passes their address in a header. `header-auth` trusts that header only when it also carries a shared
secret, which only the proxy knows.

1. Make the secret and add the plugin:

   ```bash
   openssl rand -hex 24 > "$WORK/proxy-secret" && chmod 600 "$WORK/proxy-secret"
   oah plugin add "$PWD/examples/host-plugins/header-auth.mjs" --config '{"secret":{"env":"PROXY_SECRET"}}'
   oah plugin check
   ```

   **Expect:** `Added …/header-auth.mjs to …/site/plugins.json.`, then, because `PROXY_SECRET` is not set in this
   shell yet:

   ```
   ! Plugin "header-auth", setting "secret": the environment variable PROXY_SECRET is not set.
   ```

   and exit 1. Without any secret in the config, the plugin itself refuses to run:
   `! Plugin "header-auth": set "secret" (with "secretHeader") or "jwtHeader" and "jwksUrl": without one, anyone could send the header.`

2. Check again with the secret in the environment:

   ```bash
   export PROXY_SECRET=$(cat "$WORK/proxy-secret")
   oah plugin check
   ```

   **Expect:**

   ```
   Plugins from /Users/you/oa-plugins-demo/site/plugins.json:
     on   header-auth 1.0.0  (/Users/you/open-artifact/examples/host-plugins/header-auth.mjs)
            Header sign-in
            hooks: auth.authenticate
            settings: emailHeader, nameHeader, groupsHeader, secretHeader, secret, jwtHeader, jwksUrl, issuer, audience
   All 1 plugin(s) that are on can run.
   ```

3. A stand-in for the proxy. A real one checks a password or your SSO; this one believes `/login?as=<email>`, which is
   enough to see what the site does. Save it as `~/oa-plugins-demo/proxy.mjs`:

   ```js
   // A stand-in sign-in proxy: listens on 4912, forwards to the site on 4911, and says who is asking.
   import http from 'node:http';
   import net from 'node:net';

   const who = (req) => /(?:^|;\s*)demo_user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
   const headers = (req) => {
     const h = { ...req.headers };
     delete h['x-forwarded-email']; delete h['x-forwarded-user']; delete h['x-proxy-secret']; // never pass on the client's own
     const email = who(req) && decodeURIComponent(who(req));
     if (email) Object.assign(h, { 'x-forwarded-email': email, 'x-forwarded-user': email.split('@')[0], 'x-proxy-secret': process.env.PROXY_SECRET });
     return h;
   };
   http.createServer((req, res) => {
     const as = new URL(req.url, 'http://x').searchParams.get('as');
     if (req.url.startsWith('/login') && as) {
       // Someone else now: the site sees the new header on the next request and changes its session to them.
       res.writeHead(302, { location: '/', 'set-cookie': `demo_user=${encodeURIComponent(as)}; Path=/; HttpOnly` });
       return res.end();
     }
     const up = http.request({ host: '127.0.0.1', port: 4911, method: req.method, path: req.url, headers: headers(req) }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
     up.on('error', () => res.destroy());
     req.pipe(up);
   }).on('upgrade', (req, socket, head) => {
     const up = net.connect(4911, '127.0.0.1', () => {
       up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers(req)).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
       up.write(head); up.pipe(socket); socket.pipe(up);
     });
     up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy());
   }).listen(4912, '127.0.0.1', () => console.log('proxy on http://localhost:4912 -> site on 127.0.0.1:4911'));
   ```

4. Start the site in one terminal and the proxy in another (both with `PROXY_SECRET` exported):

   ```bash
   oah serve
   ```

   ```bash
   node ~/oa-plugins-demo/proxy.mjs
   ```

   **Expect** from the site:

   ```
   Open Artifact host 0.14.6 listening on http://127.0.0.1:4911
     app:     http://localhost:4912
     content: http://{id}.content.localhost:4912
     data:    /Users/you/oa-plugins-demo/site
     plugins: header-auth (from /Users/you/oa-plugins-demo/site/plugins.json)
   ```

   followed by the owner's sign-in address (a secret; you do not need it here). From the proxy:
   `proxy on http://localhost:4912 -> site on 127.0.0.1:4911`.

5. Sign in as Ann through the proxy, and ask the site who she is:

   ```bash
   curl -s -c "$WORK/ann.jar" 'http://localhost:4912/login?as=ann@example.com' -o /dev/null
   curl -s -b "$WORK/ann.jar" -c "$WORK/ann.jar" http://localhost:4912/api/open-artifact.auth.me | head -c 130; echo
   ```

   **Expect:**
   `{"principal":{"kind":"user","id":"usr_…","name":"ann","email":"ann@example.com","siteRole":"admin"},…`, and the
   jar now holds an `oa_session` cookie. In a browser, `http://localhost:4912/login?as=ann@example.com` opens the
   site's home page as Ann.

6. **Check** that nobody else can send the header:

   ```bash
   # straight to the site, with a guessed secret
   curl -s -H 'x-forwarded-email: ceo@example.com' -H 'x-proxy-secret: guess' http://127.0.0.1:4911/api/open-artifact.auth.me | head -c 40; echo
   # through the proxy, without signing in there
   curl -s -H 'x-forwarded-email: ceo@example.com' http://localhost:4912/api/open-artifact.auth.me | head -c 40; echo
   ```

   **Expect** both times: `{"principal":{"kind":"anonymous"},"provi`.

   Someone the proxy knows but the site's sign-up rule does not allow (`eve@other.org`) is not signed in: a page
   shows the sign-in page saying why ("This site only lets invited people in, …"), an API request answers 401
   `{"code":"sign_in_refused","reason":"not_invited",…}`. The site logs
   `sign-in refused (plugin:header-auth): not_invited: plugin:header-auth eve@other.org` and the audit log gets
   `auth.sign_in_refused` with `{"provider":"plugin:header-auth","subject":"eve@other.org","reason":"not_invited"}`
   (`plugin` too when a plugin's `auth.identity` refused), at most once an hour for the same person and reason.

**If it fails:** anonymous for Ann means the site and the proxy do not share the same `PROXY_SECRET` (each terminal
needs it exported) or the proxy is not in front (you used port 4911). `Address already in use`: something already
runs on 4911 or 4912; stop it or change both ports.

**In production:** the proxy is your real one, configured to set `X-Forwarded-Email` and the secret header; the site
must listen where only the proxy can reach it (`OA_BIND=127.0.0.1`, a private network, a firewall), because anyone
who reaches the site directly and knows the secret is whoever they say. The site keeps a session (its `oa_session`
cookie) but checks it against the headers on every request: the same person goes on, someone else replaces the
session, and no header (signed out of the company) ends it. The proxy has nothing to clear. If your proxy signs a JWT
(Cloudflare Access, Pomerium), use `jwtHeader`, `jwksUrl`, `issuer` and `audience` instead of the shared secret.

### 2. Roles from a table (`static-groups`)

`static-groups` names groups of people in its settings and gives each group a role on every artifact (or on one
person's artifacts). It never lowers a role the site already gives. This example needs only step 0: no proxy and no
running site, because `oah plugin role` asks the plugin what someone would get. (If you did example 1, its
`header-auth` entry stays in the list; that changes nothing here.)

1. A deliberately wrong configuration first, to see what the check says:

   ```bash
   oah plugin add "$PWD/examples/host-plugins/static-groups.mjs" --config '{"groups":{"design":"bob@example.com"},"roles":{"desing":"editor","design":"admin"}}'
   oah plugin check
   ```

   **Expect** (exit 1):

   ```
   ! Plugin "static-groups": roles.desing: there is no group "desing" in groups.
   ! Plugin "static-groups": roles.design is "admin": the role is viewer, commenter or editor.
   The host would not start: The plugin configuration has 2 problems:
   - Plugin "static-groups": roles.desing: there is no group "desing" in groups.
   - Plugin "static-groups": roles.design is "admin": the role is viewer, commenter or editor.
   ```

2. Replace it with a working one. Bob is in `design`; everyone at example.com is `staff`. Staff view everything;
   design edits Ann's artifacts:

   ```bash
   oah plugin remove static-groups
   oah plugin add "$PWD/examples/host-plugins/static-groups.mjs" --config '{"groups":{"design":"bob@example.com","staff":"@example.com"},"roles":{"staff":"viewer","design":"editor:ann@example.com"}}'
   oah plugin check
   ```

   **Expect:** `Removed …static-groups.mjs from …/plugins.json. Its stored data (ctx.kv) is kept.`, then the list
   with `on      static-groups 1.2.0`, `hooks: authz.role, authz.artifacts`, `settings: groups, roles` and
   `All 1 plugin(s) that are on can run.` (`All 2 …` if example 1's `header-auth` is still on.)

3. Put the sample on the site as Ann's (the site may be stopped or running):

   ```bash
   oah import "$WORK/sample.zip" --owner ann@example.com
   ```

   **Expect:**

   ```
   Imported "Whiteboard element test" (whiteboard) as art_0mwrx200v024c5bf72ea3ec78
     http://localhost:4912/a/art_0mwrx200v024c5bf72ea3ec78
   ```

   Keep the id: `ID=art_…` (yours differs).

4. Ask what Bob, Carol and someone outside the company would get:

   ```bash
   for who in bob@example.com carol@example.com eve@other.org; do oah plugin role $ID --as $who; done
   ```

   **Expect:**

   ```
   bob@example.com (never signed in: what they would get once they do, with a verified address) on "Whiteboard element test" (art_0mwrx200v024c5bf72ea3ec78, owned by ann@example.com, general access restricted):
     host: no access: no share, link or public access gives a role
     plugin static-groups: answered editor; role no access -> editor
   Role: editor (decided by plugin:static-groups).
   carol@example.com (never signed in: …) on "Whiteboard element test" (…):
     host: no access: no share, link or public access gives a role
     plugin static-groups: answered viewer; role no access -> viewer
   Role: viewer (decided by plugin:static-groups).
   eve@other.org (never signed in: …) on "Whiteboard element test" (…):
     host: no access: no share, link or public access gives a role
     plugin static-groups: no opinion; role stays no access
   Role: no access (decided by the host).
   ```

   The command runs the host's own rule (owner, site admin, shares, links, public access) and then every plugin's
   `authz.role` with this shell's settings, exactly as the site would on a request, and says which one decided.
   Nobody has to sign in: someone who never did is taken as a new account with that address, verified. Someone who
   did is looked at as they are (their site role, their groups from the sign-in, the share links they opened, a
   disabled account). `--json` prints the same as JSON. It does not check whether the address may sign in at all:
   here `eve@other.org` is also kept out by `OA_SIGNUP=domain:example.com`.

**Check:** `oah plugin role $ID --as ann@example.com` answers `host: owner: the artifact's owner` and
`Role: owner (decided by the host).`: the plugin never lowers a role.

**On a running site,** a site admin asks the same over HTTP, with their session (in a browser, or the jar from
example 1): `GET /api/open-artifact.admin.access?artifact=<id>&email=<address>`.

```bash
curl -s -b "$WORK/ann.jar" "http://localhost:4912/api/open-artifact.admin.access?artifact=$ID&email=bob@example.com"
```

**Expect:** `{"artifact":{"id":"art_…",…},"person":{"email":"bob@example.com","userId":null,…},"host":{"role":null,"reason":"no share, link or public access gives a role"},"plugins":[{"plugin":"static-groups","before":null,"answer":"editor","after":"editor"}],"role":"editor","decidedBy":"plugin:static-groups"}`.
Anyone who is not a site admin gets 403, nobody signed in 401, an agent's token 401. The same route answers on a
Cloudflare site (where there is no command line).

**The owner-key account has no address** unless `OA_OWNERS` names one: an owner who only ever signed in with the owner
key cannot be named in `--as` or `email=`, and no group by address includes them. They are a site admin, so they own
every artifact anyway.

**If it fails:** `Role: no access` for someone you expected in a group means the address in `groups` is not the one
they sign in with (case does not matter; `@domain` matches the whole domain), or the plugin is `off` in
`oah plugin list`. On the site itself, also check the start-up log lists `static-groups`: the list is read at
start-up, so a change needs a restart.

**Good to know:** the artifacts a group gets a role on are listed on its members' home pages too (the hook
`authz.artifacts`, which lists them with `ctx.host.artifacts.list`). The plugin keeps each list for 300 seconds and
takes at most 1000 artifacts, so a new artifact can take five minutes to appear there (its link works at once); that
suits a small site; on a large one, share with the group instead. The role is reused for 300 seconds (the plugin's
`cacheSeconds`), so a changed setting, which needs a restart anyway, applies at once after it. `plugin role` never uses
or fills that cache.

### 3. Permissions from your own service (`http-authz`)

`http-authz` asks your service, for each person and artifact, what role they have. The question is signed with a
shared secret; the answer is `{"role":"editor"}`, `{"role":null}` (no access) or `{}` (no opinion: keep what the
site says). Your service can tell the site to forget cached answers at `/plugins/http-authz/invalidate`.

1. Turn off `static-groups` (to see this plugin alone), add `http-authz`, check:

   ```bash
   oah plugin disable static-groups
   openssl rand -hex 24 > "$WORK/perms-secret" && chmod 600 "$WORK/perms-secret"
   export PERMS_SECRET=$(cat "$WORK/perms-secret")
   oah plugin add "$PWD/examples/host-plugins/http-authz.mjs" --config '{"url":"http://127.0.0.1:4913/","secret":{"env":"PERMS_SECRET"}}'
   oah plugin list
   ```

   **Expect:** `Disabled …static-groups.mjs in …/plugins.json.`; in the list, `off  static-groups 1.2.0 …` with
   `! disabled in the plugin list`, and `on   http-authz 1.0.0`, `Permission service`,
   `hooks: authz.role, routes`, `settings: url, secret`.

2. A stand-in for your service, `~/oa-plugins-demo/perms-service.mjs`. It answers from a table and, when the table
   changes, tells the site:

   ```js
   // A stand-in permission service: answers the site's signed questions from a table (e-mail -> role).
   //   curl 'http://127.0.0.1:4913/set?email=bob@example.com&role=viewer'   (role=none: no access)
   import http from 'node:http';
   import { createHmac, timingSafeEqual } from 'node:crypto';

   const SECRET = process.env.PERMS_SECRET;
   const SITE = 'http://localhost:4912';
   const table = { 'bob@example.com': 'editor' };
   const sign = (body) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
   const signedBy = (body, given = '') => given.length === sign(body).length && timingSafeEqual(Buffer.from(given), Buffer.from(sign(body)));

   http.createServer(async (req, res) => {
     const url = new URL(req.url, 'http://x');
     if (url.pathname === '/set') {
       const email = url.searchParams.get('email');
       table[email] = url.searchParams.get('role');
       const body = JSON.stringify({}); // {} forgets every cached answer; {"artifactId": "art_…"} one artifact's
       const told = await fetch(`${SITE}/plugins/http-authz/invalidate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-oa-signature': sign(body) }, body });
       console.log(`set ${email} -> ${table[email]}; the site answered ${told.status} ${await told.text()}`);
       return res.end('ok\n');
     }
     let body = '';
     for await (const chunk of req) body += chunk;
     if (!signedBy(body, req.headers['x-oa-signature'])) return res.writeHead(401).end();
     const asked = JSON.parse(body); // {user: {id, email, groups}, artifact: {id, type, title, owner}, role}
     const role = table[asked.user.email];
     const answer = role === undefined ? {} : { role: role === 'none' ? null : role };
     console.log(`${asked.user.email} on "${asked.artifact.title}" (site says ${asked.role}) -> ${JSON.stringify(answer)}`);
     res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
   }).listen(4913, '127.0.0.1', () => console.log('permission service on http://127.0.0.1:4913'));
   ```

3. Start it in a third terminal (`node ~/oa-plugins-demo/perms-service.mjs`, with `PERMS_SECRET` exported), and
   restart the site in its own (also with `PERMS_SECRET` exported).

4. Sign in as Bob, Carol and Ann through the proxy of example 1 and ask for the sample of example 2 (`$ID`):

   ```bash
   for who in bob carol ann; do
     curl -s -c "$WORK/$who.jar" "http://localhost:4912/login?as=$who@example.com" -o /dev/null
     printf '%s: ' $who; curl -s -b "$WORK/$who.jar" -c "$WORK/$who.jar" "http://localhost:4912/api/open-artifact.artifact?id=$ID" | node -p "const j = JSON.parse(require('fs').readFileSync(0)); j.role ?? j.message"
   done
   ```

   **Expect:** `bob: editor`, `carol: No such artifact, or it is not shared with you.` (the service has no opinion on
   Carol, and the site gives her nothing), `ann: owner`. The service prints one line per question:

   ```
   bob@example.com on "Whiteboard element test" (site says null) -> {"role":"editor"}
   ann@example.com on "Whiteboard element test" (site says owner) -> {}
   ```

   Ask three times quickly: the service hears it once. The answer is reused for 60 seconds.

5. Change Bob's role in the service:

   ```bash
   curl -s 'http://127.0.0.1:4913/set?email=bob@example.com&role=viewer'
   ```

   **Expect** in the service: `set bob@example.com -> viewer; the site answered 200 {"ok":true}`, and Bob's next
   request answers `viewer` at once (not after 60 seconds). With `role=none`, Bob gets `not_found`.

6. **Check** that only your service can clear the cache: a call with a wrong signature is refused:

   ```bash
   curl -s -X POST -H 'x-oa-signature: sha256=00' -d '{}' http://localhost:4912/plugins/http-authz/invalidate; echo
   ```

   **Expect:** `{"code":"plugin_error","message":"Bad signature."}` (status 401).

7. See what happens when the service is down: stop it (Ctrl-C), clear the cache with a correctly signed call, and ask
   again:

   ```bash
   SIG=$(printf '%s' '{}' | openssl dgst -sha256 -hmac "$PERMS_SECRET" | sed 's/^.* //')
   curl -s -X POST -H "x-oa-signature: sha256=$SIG" -d '{}' http://localhost:4912/plugins/http-authz/invalidate; echo
   ```

   **Expect:** `{"ok":true}`. Now Bob **and Ann, the owner,** are refused: the API answers 403 `not_granted` with
   "A permission check could not be completed just now. Try again in a moment; if it persists, the site's operator
   can see why in the audit log.", and the artifact's page says the same. The site logs
   `plugin http-authz: authz.role failed (refused): threw: fetch failed` and the audit log gets `plugin.failed` with
   `{"plugin":"http-authz","hook":"authz.role","reason":"threw","error":"threw: fetch failed"}`. Start the service again and access comes back on the next request.
   Until the cache is cleared, answers given before the outage are still used.

**If it fails:** every request `not_found`, and `401` in the service: the two `PERMS_SECRET`s differ. Nothing in the
service's terminal: `url` points elsewhere, or the site was not restarted.

**In production:** your service must answer within the time limit (5 seconds unless `timeoutMs` says otherwise) and
be as available as the site: while it is down, nobody (not even owners) opens anything the plugin is asked about. It
sees each person's e-mail, their groups and the artifact's title. Use `https:` for `url`.

### 4. Tell another system what happened (`webhook-events`)

`webhook-events` posts chosen events to a URL: as JSON (optionally signed), or as a Slack message
(`"format": "slack"` with a Slack incoming-webhook URL).

1. A stand-in receiver that prints what it gets, `~/oa-plugins-demo/receiver.mjs` (also used in example 5):

   ```js
   // Prints every request it gets. PORT=4914 node receiver.mjs
   import http from 'node:http';

   const PORT = Number(process.env.PORT ?? 4914);
   http.createServer(async (req, res) => {
     let body = '';
     for await (const chunk of req) body += chunk;
     const shown = ['content-type', 'authorization', 'x-oa-signature'].filter((h) => req.headers[h]).map((h) => `${h}: ${h === 'authorization' ? req.headers[h].replace(/ .*/, ' …') : req.headers[h]}`);
     console.log(`${req.method} ${req.url}\n  ${shown.join('\n  ')}\n  ${body}\n`);
     res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
   }).listen(PORT, '127.0.0.1', () => console.log(`listening on http://127.0.0.1:${PORT}`));
   ```

   Start it: `PORT=4914 node ~/oa-plugins-demo/receiver.mjs`.

2. Remove `http-authz` (so everyone has their normal access again) and add the plugin, with the URL and a signing
   secret from the environment:

   ```bash
   oah plugin remove http-authz
   oah plugin add "$PWD/examples/host-plugins/webhook-events.mjs" --config '{"url":{"env":"EVENTS_URL"},"events":["artifact.created","share.changed","share.invited"],"signingSecret":{"env":"EVENTS_SECRET"}}'
   openssl rand -hex 24 > "$WORK/events-secret" && chmod 600 "$WORK/events-secret"
   export EVENTS_URL=http://127.0.0.1:4914/events EVENTS_SECRET=$(cat "$WORK/events-secret")
   oah plugin check
   ```

   **Expect:** `on   webhook-events 1.0.0`, `Webhook events`, its hooks `on.user.created, on.user.signed_in, …`,
   `settings: url, events, format, signingSecret`, and `All N plugin(s) that are on can run.`

3. Restart the site (with `EVENTS_URL` and `EVENTS_SECRET` exported). Ann uploads the sample again, and shares it
   with Dave, who has never signed in:

   ```bash
   curl -s -b "$WORK/ann.jar" -H 'origin: http://localhost:4912' -H 'content-type: application/zip' \
     --data-binary @"$WORK/sample.zip" http://localhost:4912/api/open-artifact.artifacts.import > "$WORK/art2.json"
   ID=$(node -p "require(process.argv[1]).id" "$WORK/art2.json")
   curl -s -b "$WORK/ann.jar" -H 'origin: http://localhost:4912' -H 'content-type: application/json' \
     -d "{\"id\":\"$ID\",\"members\":{\"email:dave@example.com\":\"commenter\"}}" http://localhost:4912/api/open-artifact.artifact.share -o /dev/null -w '%{http_code}\n'
   ```

   **Expect:** `200`, and in the receiver three posts (shortened):

   ```
   POST /events
     content-type: application/json
     x-oa-signature: sha256=b2c73431f8d154d2a1880e8fe3df1644a878d3f14b7a8b29d13385c053ad3bdb
     {"artifact":{"id":"art_0mwrsl0nl1e93b6314acbdfc5","type":"whiteboard","title":"Whiteboard element test","owner":"usr_MHNWuy2i52-pw931ZINjiQ"},"by":{"kind":"user","id":"usr_MHNWuy2i52-pw931ZINjiQ","name":"ann"},"via":"import","event":"artifact.created","at":"2026-11-22T12:07:21.529Z"}

   POST /events
     …
     {…,"changes":{"grants":[{"subjectKind":"email","subject":"dave@example.com","role":"commenter"}]},"event":"share.changed",…}

   POST /events
     …
     {…,"invitee":{"email":"dave@example.com"},"role":"commenter","url":"http://localhost:4912/a/art_0mwrsl0nl1e93b6314acbdfc5","event":"share.invited",…}
   ```

4. **Check** the signature as your receiver would: HMAC-SHA256 of the exact body with the signing secret, in hex.
   With the first body saved in `body.json`:

   ```bash
   printf '%s' "$(cat body.json)" | openssl dgst -sha256 -hmac "$EVENTS_SECRET"
   ```

   **Expect** the same hex as after `sha256=` in `x-oa-signature`.

5. When the receiver is down, the action still happens: stop the receiver and upload again. **Expect** `201` for the
   upload and the log line `plugin webhook-events: on.artifact.created failed (ignored): threw: fetch failed`. The
   plugin keeps the post in its store and sends it before the next event, up to 5 tries within a day: start the
   receiver, share again, and the receiver gets the missed `artifact.created` first, then `share.changed`.

**If it fails:** nothing arrives: check `EVENTS_URL` was exported where the site runs and the site was restarted. Only
some events arrive: `events` lists which; `share.invited` is sent only for people newly given a role by address or
name, not for a changed role.

**In production:** for Slack, set `"format": "slack"` and give the incoming-webhook URL as a secret
(`{"env":"SLACK_WEBHOOK_URL"}`); a Slack URL is itself the password. Your own receiver should check the signature
and answer quickly.

### 5. Invitation e-mails (`invite-email`)

The site sends no e-mail itself. When someone is given a role by address, `invite-email` sends the invitation
through your mail service's HTTP API (one JSON `POST` with `from`, `to`, `subject`, `text`). Here the receiver from
example 4 stands in for the mail service.

1. Start a second receiver on 4915: `PORT=4915 node ~/oa-plugins-demo/receiver.mjs`.
2. Add the plugin, with the API key from the environment:

   ```bash
   openssl rand -hex 16 > "$WORK/mail-key" && chmod 600 "$WORK/mail-key"
   export MAIL_KEY=$(cat "$WORK/mail-key")
   oah plugin add "$PWD/examples/host-plugins/invite-email.mjs" --config '{"apiUrl":"http://127.0.0.1:4915/send","apiKey":{"env":"MAIL_KEY"},"from":"Artifacts <artifacts@example.com>"}'
   oah plugin check
   ```

   **Expect:** `on   invite-email 1.0.0`, `Invitation e-mail`, `hooks: on.share.invited`,
   `settings: apiUrl, apiKey, authHeader, authScheme, from, subject, text`, and
   `All 3 plugin(s) that are on can run.`

3. Restart the site (with `MAIL_KEY` exported) and share an artifact with Dave as in example 4, step 3.

   **Expect** in the 4915 receiver:

   ```
   POST /send
     content-type: application/json
     authorization: Bearer …
     {"from":"Artifacts <artifacts@example.com>","to":"dave@example.com","subject":"ann shared \"Whiteboard element test\" with you","text":"Hello dave@example.com,\n\nann gave you commenter access to \"Whiteboard element test\".\n\nOpen it: http://localhost:4912/a/art_0mwrsl0nl1e93b6314acbdfc5\n"}
   ```

4. **Check** the audit log:

   ```bash
   oah audit --action invite.sent
   ```

   **Expect:** `2026-11-22T12:07:21.617Z  invite.sent  system:plugin:invite-email  {"artifact":"art_0mwrsl0nl1e93b6314acbdfc5","role":"commenter"}`

**If it fails:** nothing at 4915: the share went to someone who already had a role (no invitation then), or `apiUrl`
is wrong. The site's log names the plugin and the error.

**In production:** point `apiUrl` at your mail service's send endpoint. The plugin posts
`{from, to, subject, text}` as JSON; Resend takes exactly that, other services want other field names and need a small
relay or your own copy of the plugin. `authHeader` and `authScheme` set how the key is sent (`Authorization: Bearer
<key>` by default). Change the words with `subject` and `text` (`{title}`, `{role}`, `{url}`, `{inviter}`,
`{name}`). Not run here: a real mail service.

### Clean up

Stop the site, the proxy, the service and the receivers (Ctrl-C in each), then `rm -rf ~/oa-plugins-demo`.

## A complete example: your company's JWT cookie, a role per department

The situation: your company's sign-in already sets a cookie `corp_token` on `.corp.example`, holding a JWT with the
person's id, e-mail, name and `department`. The site will live at `artifacts.corp.example`, so the browser sends that
cookie to it. You want:

- people signed in from that cookie, nobody else by it;
- people from departments not on the list refused;
- design to edit and sales to view every artifact;
- no public links;
- a "My department" entry in the account menu.

The plugin is `examples/host-plugins/company-jwt.mjs` (76 lines) and its test `company-jwt.test.mjs` beside it.

```js
import { verifyJwt } from '@open-artifact/host-plugin';

const RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const departmentOf = (principal) => {
  const person = principal.kind === 'agent' ? principal.user : principal; // an agent acts with its person's role
  const group = person.kind === 'user' && person.groups?.find((g) => g.startsWith('plugin:company-jwt:dept:'));
  return group ? group.slice('plugin:company-jwt:dept:'.length) : null;
};

export default {
  id: 'company-jwt',
  apiVersion: 1,
  name: 'Company sign-in',
  version: '1.0.0',
  config: {
    cookie: { type: 'string', default: 'corp_token', description: 'The cookie that holds the JWT.' },
    key: { type: 'secret', description: 'The HS256 key the tokens are signed with (or use jwksUrl).' },
    jwksUrl: { type: 'string', description: 'Where the signing keys are published (RS256, ES256).' },
    issuer: { type: 'string', required: true, description: 'The `iss` every token must carry.' },
    departments: { type: 'map', default: {}, description: 'Department -> viewer, commenter or editor on every artifact.' },
  },
  validate(c) { /* exactly one of key and jwksUrl; every role viewer, commenter or editor */ },
  auth: {
    async authenticate({ request }, ctx) {
      // read the cookie, verifyJwt(...) against the key or the JWKS and the issuer, and answer
      // {subject: sub, email, emailVerified: true, name, groups: ['dept:<department>']}, or null
    },
    identity({ identity, provider }, ctx) {
      // for plugin:company-jwt sign-ins: {reject: 'Your department does not use this site yet.'} unless listed
    },
  },
  authz: {
    cacheSeconds: 300,
    role({ principal, role }, ctx) { /* the department's role, never lower than the site's own */ },
  },
  guard({ action, detail }) {
    if (action === 'share.change' && detail.changes.access === 'public') return { deny: 'Public links are turned off here: share with people or departments instead.' };
    return undefined;
  },
  routes: [{ method: 'GET', path: '/me', handler: ({ principal }) => Response.json({ department: departmentOf(principal) }) }],
  ui: { links: [{ label: 'My department', href: '/plugins/company-jwt/me', where: 'account-menu' }] },
};
```

(The bodies left out above are in the file.) Note how the pieces fit: `authenticate` puts the department in the
identity's `groups` as `dept:design`; the site stores it as `plugin:company-jwt:dept:design`, and that is what
`authz.role` and the route read back.

1. Run its tests:

   ```bash
   node --test examples/host-plugins/company-jwt.test.mjs
   ```

   **Expect:** seven tests, `ℹ pass 7`, `ℹ fail 0`.

2. A site for it (its own folder and port, no proxy: the cookie is the proof). Use a fresh terminal:

   ```bash
   mkdir -p ~/oa-jwt-demo && openssl rand -hex 32 > ~/oa-jwt-demo/corp-key && chmod 600 ~/oa-jwt-demo/corp-key
   export OA_DATA_DIR=~/oa-jwt-demo/site OA_PORT=4921 OA_APP_ORIGIN=http://localhost:4921 OA_CONTENT_ORIGIN='http://{id}.content.localhost:4921'
   export OA_OWNERS=ann@corp.example OA_SIGNUP=domain:corp.example CORP_JWT_KEY=$(cat ~/oa-jwt-demo/corp-key)
   unset OA_PLUGINS OA_PLUGINS_FILE
   node packages/host/src/node/main.ts plugin add "$PWD/examples/host-plugins/company-jwt.mjs" \
     --config '{"key":{"env":"CORP_JWT_KEY"},"issuer":"https://login.corp.example","departments":{"design":"editor","sales":"viewer"}}'
   node packages/host/src/node/main.ts plugin check
   ```

   **Expect:**

   ```
     on   company-jwt 1.0.0  (/Users/you/open-artifact/examples/host-plugins/company-jwt.mjs)
            Company sign-in
            hooks: auth.authenticate, auth.identity, authz.role, guard, routes, ui
            settings: cookie, key, jwksUrl, issuer, departments
   All 1 plugin(s) that are on can run.
   ```

3. Start it: `node packages/host/src/node/main.ts serve`. **Expect** `plugins: company-jwt (from …)`.

4. Make tokens as your company's sign-in would. Save `~/oa-jwt-demo/mint.mjs`:

   ```js
   // node mint.mjs <sub> <email> <name> <department>: an HS256 token signed with CORP_JWT_KEY
   import { createHmac } from 'node:crypto';
   const [sub, email, name, department] = process.argv.slice(2);
   const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
   const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'https://login.corp.example', sub, email, name, department, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
   console.log(`${body}.${createHmac('sha256', process.env.CORP_JWT_KEY).update(body).digest('base64url')}`);
   ```

   and, in a second terminal with the same exports, sign four people in:

   ```bash
   cd ~/oa-jwt-demo
   signin() { node mint.mjs "$@" > "$1.tok"; printf '%s: ' "$3"; curl -s -c "$1.jar" -b "corp_token=$(cat $1.tok)" http://localhost:4921/api/open-artifact.auth.me | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0)).principal)"; }
   signin e1001 ann@corp.example Ann design
   signin e1002 bob@corp.example Bob design
   signin e1003 cy@corp.example Cy sales
   signin e1004 lee@corp.example Lee legal
   ```

   **Expect:**

   ```
   Ann: {"kind":"user","id":"usr_…","name":"Ann","email":"ann@corp.example","siteRole":"admin"}
   Bob: {"kind":"user","id":"usr_…","name":"Bob","email":"bob@corp.example","siteRole":"member"}
   Cy: {"kind":"user","id":"usr_…","name":"Cy","email":"cy@corp.example","siteRole":"member"}
   Lee: {"kind":"anonymous"}
   ```

   Lee's department (legal) is not listed; the site logs
   `sign-in refused (plugin:company-jwt): plugin_refused: plugin company-jwt: Your department does not use this site yet.`
   A token signed with another key leaves the person anonymous and logs
   `plugin company-jwt: refused a token: bad signature`.

5. Ann uploads; Bob and Cy open it; Ann tries to make it public:

   ```bash
   O='origin: http://localhost:4921'
   ID=$(curl -s -b e1001.jar -H "$O" -H 'content-type: application/zip' --data-binary @"$HOME/oa-plugins-demo/sample.zip" \
     http://localhost:4921/api/open-artifact.artifacts.import | node -p "JSON.parse(require('fs').readFileSync(0)).id")
   for u in e1001 e1002 e1003; do printf '%s: ' $u; curl -s -b $u.jar "http://localhost:4921/api/open-artifact.artifact?id=$ID" | node -p "JSON.parse(require('fs').readFileSync(0)).role"; done
   curl -s -w ' %{http_code}\n' -b e1001.jar -H "$O" -H 'content-type: application/json' -d "{\"id\":\"$ID\",\"access\":\"public\"}" http://localhost:4921/api/open-artifact.artifact.share
   curl -s -b e1002.jar http://localhost:4921/plugins/company-jwt/me; echo
   ```

   (Make `sample.zip` as in [step 0](#0-a-site-to-try-plugins-on) if you skipped the other examples.)

   **Expect:**

   ```
   e1001: owner
   e1002: editor
   e1003: viewer
   {"code":"not_granted","message":"Public links are turned off here: share with people or departments instead."} 403
   {"department":"design"}
   ```

   Sharing by link (`"access":"link"`) is allowed (200). The account menu shows "My department" (the site answers it in
   `auth.me` as `"site":{"links":[{"label":"My department","href":"/plugins/company-jwt/me","where":"account-menu"}]}`).
   `oah audit --action plugin.denied` shows `… plugin.denied  system:plugin:company-jwt  {"action":"share.change","artifact":"art_…"}`.

**If it fails:** everyone anonymous: the site and `mint.mjs` use different `CORP_JWT_KEY`s, or the token's `iss`
differs from `issuer`. Bob not an editor: his token's `department` is not exactly a key of `departments`.

**Things to know before production:**

- The cookie is checked on every request, with the site's session too: the same person goes on, a cookie of someone
  else replaces the session with theirs, and no cookie (signed out of the company) ends it. Bob's session with Cy's
  cookie answers Cy. When the plugin cannot check (it throws), that request is anonymous and the session is kept.
- The department is taken when the session starts. Someone who moves department keeps the old role until the session
  ends (they sign out, of the site or the company, and in again).
- Role answers are reused for 300 seconds; set `cacheSeconds` in the entry to change that.
- With an RS256 or ES256 identity provider, give `jwksUrl` instead of `key`.
- On Cloudflare: Run here under `wrangler dev`, as described in [On Cloudflare](#on-cloudflare).

## Write a plugin (developers)

### The smallest plugin

```js
// hello.mjs
export default {
  id: 'hello',
  apiVersion: 1,
  on: {
    'user.signed_in': (e, ctx) => ctx.log(`${e.user.name} signed in`),
  },
};
```

`oah plugin add "$PWD/hello.mjs"`, restart, sign in: the site logs `plugin hello: ann signed in`.

A plugin is a plain object exported as the module's default. `id` is lower case letters, digits and dashes (at most
64); `apiVersion` is `1`. `name`, `version` and `description` are shown in `plugin list`. Unknown keys, hooks and
events are reported as warnings and ignored. With TypeScript, `definePlugin({...})` from `@open-artifact/host-plugin`
types `ctx.config` from your settings; a `.ts` plugin loads on Node from a path outside `node_modules` only.

Plugins run on Node and in Cloudflare Workers, so they use web APIs (`fetch`, `crypto.subtle`, `Request`,
`Response`), never `node:` modules.

### Hooks

Every hook is `(input, ctx) => answer`, may be `async`, and is optional.

| Hook | Input | Answer | Fails |
| --- | --- | --- | --- |
| `auth.authenticate` | `{request}` (headers and cookies; no body) | an identity, or `null` | closed (nobody) |
| `auth.recheck` | (a boolean, not a function; default true) | whether the sessions `authenticate` makes are checked again on each request | |
| `auth.signIn` | `{label, start({request, returnTo, callbackUrl}), finish({request})}` | `start`: a `Response` (usually a redirect); `finish`: `{identity, returnTo?}` | closed |
| `auth.identity` | `{identity, provider}` after any sign-in | a changed identity, `{reject: sentence}`, or nothing | closed (sign-in refused) |
| `auth.signOutUrl` | `{principal}` | a URL to send them to after signing out, or nothing | the usual page (they are signed out anyway) |
| `authz.role` | `{principal, artifact, role}` (`role`: the site's answer or the previous plugin's) | a role, `null` (no access), or nothing (no opinion) | closed (no access) |
| `authz.cacheSeconds` | (a number, not a function) | how long role answers may be reused; default 30 | |
| `authz.artifacts` | `{principal}` | more artifact ids for their home page | open |
| `guard` | `{action, principal, artifact?, detail}` | nothing, or `{deny: sentence}` | closed (refused) |
| `on.<event>` | the event (below) | nothing; runs after the fact, in the background | open |
| `wake.deliver` | `{artifact, owner, payload, from}`, a request for the owner's agent from the Ask pane | `{delivered: true}`, or nothing (it goes to the outbox) | open |
| `routes` | a list of `{method, path, public?, handler({request, principal, params}, ctx)}` | a `Response` | error answer |
| `ui` | (an object) `{links: [{label, href, where: 'account-menu' \| 'home'}], brand: {name?, logoUrl?}}` | | |

An identity is `{subject, email?, emailVerified?, name?, avatar?, groups?}`. A principal is `{kind: 'user', id,
name, email?, groups?, siteRole}`, `{kind: 'guest', …}`, `{kind: 'agent', label, user}` or `{kind: 'anonymous'}`;
answer nothing for a kind you do not know. An artifact is `{id, type, title, owner, generalAccess, createdAt,
updatedAt, trashedAt}`. Roles are `owner`, `editor`, `commenter`, `viewer`.

`wake.deliver` is asked for requests from the Ask pane only. A comment that asks for the agent always goes to the
owner's outbox, because the agent answers in the comment thread from the owner's computer.

### Events

Every event also carries `event` (its name) and `at` (an ISO time). `artifact` is `{id, type, title, owner}`; `by` is
`{kind, id, name?}`.

| Event | Fields |
| --- | --- |
| `user.created` | `user {id, name, email}`, `provider` |
| `user.signed_in` | `user {id, name, email}`, `provider` (`github`, `oidc:<id>`, `plugin:<id>`, …) |
| `artifact.created` | `artifact`, `by`, `via` (`import`, `link`, `mcp`) |
| `artifact.changed` | `artifact`, `by`, `changes {title?, files?}` |
| `artifact.trashed`, `artifact.restored` | `artifact`, `by` |
| `artifact.deleted` | `artifact`, `by`, `reason` (`owner`, `expired`) |
| `share.changed` | `artifact`, `by`, `changes {access?, grants?, links?, guests?, settings?}` |
| `share.invited` | `artifact`, `by`, `invitee {email?, userId?, name?}`, `role`, `url` |
| `agent.requested` | `artifact`, `by`, `owner`, `text`, `label?` |
| `audit` | `action`, `actor`, `artifact`, `detail`: every audit entry except the plugin's own |

### Guarded actions

| Action | `detail` | Asked at |
| --- | --- | --- |
| `artifact.create` | `{type, title, via}` (`via`: `import`, `link`, `mcp`) | an upload, after unpacking; a new artifact published from a computer; an agent's create over MCP. The site has no "New" of its own. |
| `artifact.import` | `{type: null, bytes, via: 'library'}` | an upload on the home page, before it is unpacked (a computer's publish is `link.publish`) |
| `artifact.delete` | `{permanent}` | to the trash, deleting from the trash, unpublishing, an agent's delete |
| `artifact.export` | `{format}` | downloading the artifact's `.zip` (from the site, or by a computer) |
| `share.change` | `{changes}` (as in `share.changed`) | any change to who may open it |
| `link.connect` | `{client {name, harness?, version?}}` | approving a computer's connection |
| `link.publish` | `{type, bytes, replaces}` | a computer publishing or replacing an artifact |
| `type.publish` | `{id, uid, version, bytes, visibility, replaces}` (`visibility`: `private`, `site`, `link`) | a type published to the site's catalog (`open-artifact types publish`), after the package is checked and before anything of it is kept; `replaces` for a new version (or the same one again) of a type already there. Who may publish at all is `OA_TYPES_PUBLISH`, asked first. |
| `mcp.connect` | `{client {id, name}}` | approving a remote MCP client |
| `agent.ask` | `{text, label?}` | a request to the owner's agent from the Ask pane |

A refusal answers 403 with your sentence (`{"code":"not_granted","message":"<your sentence>"}`) and writes
`plugin.denied` to the audit log. Answer nothing for an action you do not know: new ones may be added.

### `ctx`, member by member

| Member | What it is |
| --- | --- |
| `ctx.plugin.id` | Your plugin's id. |
| `ctx.config` | The checked settings, frozen. Defaults filled in, `{"env"}` references read. |
| `ctx.log(message, fields?)` | A line in the site's log, as `plugin <id>: <message>`. Secret settings are blanked out of it. |
| `ctx.fetch(url, init?)` | `fetch`, stopped when the call's time runs out. Use it rather than the global `fetch`. |
| `ctx.kv` | A small store of your own: `get(key)`, `set(key, value, {ttlSeconds?})`, `delete(key)`, `list({prefix?, after?, limit?})` (default 100, at most 1000). Keys up to 512 bytes, values up to 64 KiB of JSON, 10,000 keys. Kept across restarts; `plugin remove` keeps it. |
| `ctx.now()` | The time (the test kit can move it). |
| `ctx.signal` | Aborts when the call's time runs out. |
| `ctx.host.apiVersion`, `ctx.host.version` | The plugin API version and the site's release. |
| `ctx.host.appOrigin` | The site's address (`https://artifacts.example.com`). |
| `ctx.host.supports(name)` | Whether this site has a hook, event or guard action (`'on.share.invited'`, `'guard.agent.ask'`). |
| `ctx.host.users.get(id)`, `.findByEmail(email)` | A user `{id, name, email, emailVerified, avatar, siteRole, createdAt, disabled}`, or null. |
| `ctx.host.artifacts.get(id)` | An artifact, or null. |
| `ctx.host.artifacts.list({owner?, after?, limit?})` | A page of the site's artifacts outside the trash, by id: `{artifacts: [{id, title, type, owner, updatedAt}], next}` (pass `next` as `after`; null on the last page). `limit` defaults to 50, at most 200. For small sites: keep what you build from it in `ctx.kv` rather than listing on every request. |
| `ctx.host.access.invalidate(artifactId?)` | Forget cached role answers: for one artifact, or all. |
| `ctx.host.audit(action, detail?)` | Write an audit entry (`action` like `invite.sent`; `detail` JSON up to 8 KiB), with `plugin:<id>` as the actor. Your own entries are not sent back to your `on.audit`. |

### Settings

`config` in the plugin is the schema; the operator's `config` gives the values:

```js
config: {
  url: { type: 'string', required: true, description: 'Where to ask.' },
  secret: { type: 'secret' },               // never shown in plugin list, the admin API or the logs
  events: { type: 'string[]', default: [] },
  retries: { type: 'number', default: 3 },
  verbose: { type: 'boolean', default: false },
  groups: { type: 'map', default: {} },     // {"name": "text"}, strings only
  rules: { type: 'json' },                  // any JSON value
},
validate(config) {                          // optional, synchronous
  if (!config.url.startsWith('https:')) return '"url" must be an https: address.';
},
```

`validate` answers nothing, a sentence, or a list of sentences (each is a problem that stops the site); it may also
throw. It must answer at once: a promise is a problem too. The `description` shows in the "is required" message.

### Who someone is: the rules

- `subject` is the stable id of the person in your system (at most 256 characters). Never reuse one for somebody else.
- The site finds the account by provider and subject. If there is none, it links to an existing account only by an
  e-mail address you mark `emailVerified: true`, then creates one if the site's sign-up rule (`OA_SIGNUP`) allows.
  Say `emailVerified: true` only when your system has checked the address.
- `OA_OWNERS` makes those addresses site admins, whichever way they sign in.
- `auth.identity` may add groups or change the name, but not `subject`: a changed subject refuses the sign-in.
- Groups are stored as `plugin:<id>:<group>`; that is how `authz.role` sees them and how a share names a group.
- `auth.authenticate`'s answer becomes a session (30 days or until sign-out), and the plugin is asked again on every
  request of it: the same `subject` keeps the session, another identity ends it and signs that one in, `null` or
  nothing ends it. When the plugin throws or runs out of time, that request is anonymous and the session is kept.
  With `recheck: false` in `auth`, the plugin is asked only when there is no session, and the session lasts whatever
  the upstream says later. Groups and name are taken when the session starts.
- A person `authenticate` names but the site refuses (its sign-up rule, a plugin's `auth.identity`) is told why: the
  sign-in page on a page visit, a 401 `sign_in_refused` with the reason on the API. Other sign-in methods still work.

### Roles and caching

The site works out a role from its own shares, then asks each plugin with `authz.role` in list order; each sees the
role so far. The final answer is reused for the same person, artifact and site role for the smallest
`cacheSeconds` of the plugins asked (the entry's `cacheSeconds`, else the plugin's `authz.cacheSeconds`, else 30).
A failed answer is not reused.

- A change to the site's own shares applies at once.
- `ctx.host.access.invalidate(id)` or `invalidate()` makes every part of the site forget the cached answers on its
  next lookup; open pages pick the change up. Call it from a route your system calls when permissions change, as
  `http-authz` does.
- Otherwise, a change in your system is seen at the latest `cacheSeconds` later.

### Routes

```js
routes: [
  { method: 'POST', path: '/hook', public: true, async handler({ request }, ctx) {
      const body = await readText(request);                    // at most 1 MiB
      const ok = await verifyHmacSha256({ secret: ctx.config.secret, body, signature: request.headers.get('x-signature') ?? '', prefix: 'sha256=' });
      if (!ok) throw new HttpError(401, 'Bad signature.');
      return json({ ok: true });
  } },
],
```

- A route lives at `/plugins/<id><path>`; `:name` matches one path part into `params.name`, a final `*` the rest.
- `principal` is the signed-in person from the site's cookie (a request with `Authorization: Bearer` is anonymous).
- A write (not GET, HEAD, OPTIONS) is accepted only from the site's own pages
  (403 `Cross-site requests may not change anything here.`) unless `public: true`. A public route is for other
  servers, and must check a signature itself.
- Bodies are limited to 1 MiB. `throw new HttpError(status, message)` answers `{"code":"plugin_error","message"}`;
  running out of time answers 504; anything else 500.

### Links and brand

`ui.links` adds links to the account menu (signed-in people only) or the home page. `href` is a path on the site or
an `https:`/`http:` address (pages leave out `http:` addresses on other hosts); anything else stops the site.
`ui.brand {name, logoUrl}` replaces Open Artifact's name and logo; the first plugin that sets one wins.

### Helpers

From `@open-artifact/host-plugin`: `json(value, init?)`, `readText`, `readJson` (1 MiB by default), `readBody`,
`HttpError`, `timingSafeEqual(a, b)`, `signHmacSha256({secret, body, encoding?})`,
`verifyHmacSha256({secret, body, signature, encoding?, prefix?})`, and
`verifyJwt({token, jwksUrl | key, issuer?, audience?, algorithms?, clockToleranceSeconds?, requireExpiry?, now?}, fetch)`
(RS256, ES256, HS256; answers `{valid: true, claims, header}` or `{valid: false, reason}`). Pass `ctx.fetch` as the
`fetch` and `ctx.now()` as `now`.

### Testing

`@open-artifact/host-plugin/testing` runs a plugin as the site would, without a site: it checks the plugin and its
settings with the site's rules, calls each hook with the time limit, failure policy and answer checks, and records
what happened.

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPluginHarness } from '@open-artifact/host-plugin/testing';
import plugin from './my-plugin.mjs';

test('the service makes Ann an editor', async () => {
  const h = createPluginHarness(plugin, {
    config: { url: 'https://perms.example.com', secret: { env: 'PERMS_SECRET' } },
    env: { PERMS_SECRET: 'test-secret' },
    fetch: async (request) => Response.json({ role: 'editor' }),
  });
  const artifact = h.addArtifact({ title: 'Plan' });
  const ann = h.userPrincipal(h.addUser({ email: 'ann@example.com' }), ['plugin:my-plugin:design']);
  assert.deepEqual(await h.role({ principal: ann, artifact, role: null }), { role: 'editor', cacheSeconds: 30 });
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.failures, []);
});
```

`createPluginHarness(plugin, {config, env, now, fetch, timeoutMs, cacheSeconds, appOrigin, hostVersion, features})`
throws `PluginRefusedError` (with `problems`) when the site would refuse to start. The harness has `authenticate`,
`signInStart`, `signInFinish`, `identity`, `signOutUrl`, `role`, `artifactsFor`, `guard`, `emit`, `deliverWake` and
`request(method, path, {principal, body, headers})`; the records `logs`, `audits`, `fetches`, `failures`,
`invalidated`, `warnings`; an in-memory `kv` (`kv.dump()`); and `addUser`, `addArtifact`, `userPrincipal`,
`advance(ms)`. See `examples/host-plugins/company-jwt.test.mjs` for a complete file, and
`packages/host-plugin/test/examples.test.ts` for the other examples' tests.

Run: `node --test my-plugin.test.mjs`. The test kit, like the helpers, comes with the Open Artifact source, so run it
from inside that folder.

### Limits

- **Time:** each call has `timeoutMs` (5 s). `ctx.fetch` is stopped then. Code that never waits (a `while (true)`
  loop, a huge regular expression) cannot be stopped and blocks the site: keep work small.
- **Store:** `ctx.kv` keys 512 bytes, values 64 KiB, 10,000 keys per plugin.
- **Routes:** bodies 1 MiB.
- **State:** do not keep state in module variables. On Cloudflare each part of the site (the Worker, each artifact's
  room) runs its own copy of your plugin; use `ctx.kv`. In a room, `invalidate` reaches the rooms that are open; pages
  elsewhere see the change within about 2 seconds. Background work ends with the request; there are no timers.

### What a plugin cannot do

In API version 1, a plugin cannot:

- put scripts or styles into the site's pages (only `ui` links and the brand);
- add artifact types, or change how an editor works;
- store artifacts or files somewhere else (the site's storage is fixed);
- see exports made inside the page: PDF, PowerPoint and image exports are made in the browser, so the guard's
  `artifact.export` sees only `.zip` downloads;
- change who someone is after sign-in (`subject`), or read a request's body in `auth.authenticate`.

## Security notes for operators

- **A plugin has the site's full authority.** It runs inside the site, reads every request it is given, sees
  people's addresses and groups, can call any address on the internet (`ctx.fetch`), keep data (`ctx.kv`), read any
  user and artifact record (`ctx.host`), clear the permission cache and write the audit log. Install code you have
  read or trust as much as the site itself, and pin its version.
- **Header sign-in is only as safe as the network.** With `header-auth`, the proxy must be the only way to reach the
  site. Bind the site to `127.0.0.1` or a private address, or firewall it, and keep the shared secret long and secret.
- **Secrets in the environment**, never in `plugins.json` or `OA_PLUGINS`: `{"env":"NAME"}`. On Cloudflare, Worker
  secrets. The file is written readable by its owner only, but it is still a file.
- **Permissions fail closed.** A permission service that is down locks people out, owners included; they are told a
  check could not be completed, and `plugin.failed` in the audit log says why. Watch it like the site; to let people in
  meanwhile, turn the plugin off ([When a plugin fails](#when-a-plugin-fails)).
- **Sessions follow the upstream sign-in.** A session a plugin's `auth.authenticate` made is checked on every request:
  signing out of the company, or someone else on the same browser, ends it. Sessions from the site's own sign-in
  methods (and a plugin with `recheck: false`) last 30 days or until people sign out on the site; for leavers, disable
  the account on the site as well.
- **What leaves the site:** a permission plugin sends each person's e-mail and groups and the artifact's title to its
  service; an events plugin sends what its events carry (titles, addresses, request text). Decide that before you
  turn it on.
- **The audit trail** records sign-ins, refusals (`auth.sign_in_refused`), failures (`plugin.failed`), refusals by a
  guard (`plugin.denied`) and what plugins write themselves.

## Files

| File | What it is |
| --- | --- |
| `examples/host-plugins/` | The six example plugins, and `company-jwt.test.mjs`. |
| `packages/host-plugin/README.md` | The plugin API in short, for plugin authors. |
| `packages/host-plugin/src/index.ts` | The types, with a comment on every field. |
| `deploy/cloudflare/plugins.mjs` | The plugins built into the Worker. |
| `<data dir>/plugins.json` | The Node site's plugin list (unless `OA_PLUGINS` is set). |
