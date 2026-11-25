# @open-artifact/host-plugin

The plugin API of the Open Artifact host: types, `definePlugin`, a few helpers, and a test kit. It comes with the
Open Artifact source and is not published on npm. A plugin that imports it runs from any folder without installing
it: the host hands every plugin its own copy (on Node when the plugin loads, on Cloudflare when the Worker is built).
A test that uses the test kit runs from inside the source folder. The operator's and author's guide,
with worked examples, is [docs/plugins.md](../../docs/plugins.md).

A **host plugin** adds to a self-hosted Open Artifact site what only your organisation knows: how people sign in, who
may open what, what must be refused, and where to tell other systems what happened. It is a plain object exported by an
ES module, listed by the operator in `OA_PLUGINS` (or `plugins.json` in the Node host's data directory). It runs inside
the host, on Node and on Cloudflare Workers alike, so it uses only web APIs (`fetch`, `crypto.subtle`), never `node:`.

## The smallest plugin

```js
export default {
  id: 'hello',
  apiVersion: 1,
  on: {
    'user.signed_in': (e, ctx) => ctx.log(`${e.user.name} signed in`),
  },
};
```

With TypeScript, `definePlugin({...})` from this package types `ctx.config` from your `config` schema.

## Hooks

Every hook is `(input, ctx)` and optional.

- `auth.authenticate`: who a request comes from by itself (a proxy header, your JWT); fails closed. `auth.recheck`
  (default true) asks it again on every request of the session it made.
- `auth.signIn` `{label, start, finish}`: a sign-in button and its round trip; fails closed.
- `auth.identity`: after any sign-in, add groups, rename, or `{reject}`; fails closed.
- `auth.signOutUrl`: where to send someone after signing out.
- `authz.role`: a person's role on an artifact, after the host's own shares; `authz.cacheSeconds` how long it may be reused (default 30); fails closed (no access).
- `authz.artifacts`: more artifact ids to list on someone's home page.
- `guard`: `{deny: sentence}` before an action (create, import, delete, export, share, link, type publish, MCP, agent ask); fails closed.
- `on[event]`: after the fact, in the background (`user.created`, `artifact.created`, `share.invited`, `audit`, …); fails open.
- `wake.deliver`: deliver a request for the owner's agent elsewhere; fails open (it goes to the outbox).
- `routes`: HTTP routes at `/plugins/<id>/<path>`; `public: true` for webhooks from other servers.
- `ui`: links in the account menu or on the home page, and the site's brand.

`ctx` has `config`, `log`, `fetch` (stopped at the time limit), `kv` (a small private store), `now`, `signal`, and
`host` (`users`, `artifacts.get`/`.list`, `access.invalidate`, `audit`, `supports(name)`). Each call has 5 seconds (the operator's
`timeoutMs`). A hook that throws, runs out of time or answers the wrong shape is logged; the policy above decides
what happens next.

Helpers: `json`, `readJson`, `readText`, `HttpError`, `timingSafeEqual`, `signHmacSha256`, `verifyHmacSha256`,
`verifyJwt` (RS256, ES256, HS256, with a JWKS URL or a key).

What each hook sees and when:

- `auth.authenticate`'s answer becomes a session, and the plugin is asked again on every request of it: the same
  subject keeps it, another identity replaces it, `null` ends it, and a throw makes that one request anonymous (the
  session is kept). With `recheck: false` it is asked only when there is no session. A person the host refuses (its
  sign-up rule, `auth.identity`) gets the sign-in page saying why, or a 401 `sign_in_refused` on the API.
- `authz.role` answers are reused per artifact, person and host role for `cacheSeconds`. `ctx.host.access.invalidate(id)`
  forgets one artifact's answers, `invalidate()` all of them (open pages pick the change up at once).
- Guards cover the paths in `GUARD_PATHS` (`packages/host/src/core/plugins/hooks.ts`). PDF and PowerPoint exports are
  made in the page, not by the host, so `artifact.export` sees only the archive (`.zip`) downloads.
- `wake.deliver` is offered a wake that carries requests only (the Ask pane); one with comment threads goes to the
  outbox always, because the agent answers in those threads from the owner's computer.
- `ctx.host.artifacts.list({owner?, after?, limit?})` pages the site's artifacts outside the trash by id (50 a page,
  at most 200). It is for small sites; keep what you build from it in `ctx.kv`.
- Routes: the principal is the signed-in person (a request with `Authorization: Bearer` is anonymous), bodies are at
  most 1 MiB, and a write must come from the site's own origin unless the route is `public`.
- `ui` links are a path on the site or an `https:`/`http:` address; anything else stops the host at start-up. Pages
  also leave out `http:` addresses on other hosts. Account-menu links show to signed-in people only.

## Settings

`config` in the plugin is a schema; the operator's entry gives the values:

```js
config: {
  url: { type: 'string', required: true },
  secret: { type: 'secret' },                // never shown in `plugin list` or the admin API
  groups: { type: 'map', default: {} },      // {"name": "value"}, strings only
  rules: { type: 'json' },                   // any JSON value
  retries: { type: 'number', default: 3 },   // also 'boolean' and 'string[]'
},
validate(config) {                           // optional, synchronous: nothing, a sentence or a list of them
  if (!config.url.startsWith('https:')) return '"url" must be an https: address.';
},
```

Any value can be read from an environment variable with `{"env": "NAME"}` (a `map` or `json` one as JSON text). The
host checks every setting and runs `validate` when it starts; a problem stops it with `Plugin "<id>", <setting>: …` or
`Plugin "<id>": <your sentence>` (a promise from `validate` is a problem too: it must answer at once).

## The operator's list

```json
[
  { "use": "@acme/oa-sso", "config": { "clientSecret": { "env": "SSO_SECRET" } } },
  { "use": "./static-groups.mjs", "config": { "groups": { "staff": "@acme.com" }, "roles": { "staff": "viewer" } }, "cacheSeconds": 60 },
  { "use": "./audit-feed.mjs", "optional": true, "timeoutMs": 2000, "enabled": false }
]
```

| Field | Meaning |
| --- | --- |
| `use` | A package name or a path to the module (on Cloudflare: the name it is bundled under). |
| `config` | The plugin's settings. |
| `enabled` | `false` keeps it listed but off. |
| `optional` | When it cannot load or its settings are wrong, start without it (logged) instead of refusing to start. |
| `timeoutMs` | Each hook call's time limit, default 5000, at most 60000. |
| `cacheSeconds` | How long role answers are reused (0 to 86400); wins over the plugin's `authz.cacheSeconds` (default 30). |

When a plugin fails: sign-in, roles and guards fail closed (no sign-in, no access, refused with "This could not be
checked just now (<plugin name>). Try again in a moment."); events and `wake.deliver` fail open (logged; the request
goes on). Every failure of a closed hook is in the audit log as `plugin.failed` `{plugin, hook, reason, error}`. A site
admin sees the running plugins, their hooks and setting names at `GET /api/open-artifact.admin.plugins`, and the audit
log at `GET /api/open-artifact.admin.audit` (filters `artifact`, `actor`, `action`, `before`, `limit`).

## Running plugins on Node

The list is `OA_PLUGINS` (JSON), which wins over the file `OA_PLUGINS_FILE` (default `<data dir>/plugins.json`).
Relative paths in the file start at the file's folder; in `OA_PLUGINS`, at the working folder. A package is looked for
in `<data dir>/plugins/node_modules` (install it with `npm install --prefix <data dir>/plugins <package>`), then where
the host itself can import it.

From the source folder, `open-artifact-host` is `node packages/host/src/node/main.ts`:

```
open-artifact-host plugin list            the plugins, their hooks and setting names, and what is wrong
open-artifact-host plugin check           the same; exits 1 when the host would not start
open-artifact-host plugin add <package or path> [--config <json>] [--optional] [--disabled] [--timeout-ms <n>] [--cache-seconds <n>]
open-artifact-host plugin remove|enable|disable <id or use>
open-artifact-host plugin set <id or use> [<setting>=<value>…] [--secret <setting>=<ENV_NAME>…] [--timeout-ms <n>] [--cache-seconds <n>] [--optional | --required]
open-artifact-host plugin unset <id or use> <setting>…
open-artifact-host audit [--artifact <id>] [--actor <id>] [--action <prefix>] [--before <time>] [--limit <n>] [--json]
```

`add`, `remove`, `enable`, `disable`, `set` and `unset` change the list file (written with mode 0600) and say "The
change takes effect when the host restarts."; they refuse while `OA_PLUGINS` is set. A relative path given to `add`
starts where you typed it, and is stored so it keeps pointing there. `check` ends with "All N plugin(s) that are on can
run." or "The host would not start: <the problems>". At start-up the host logs `plugins: <ids> (from <source>)`. A
plugin in TypeScript (`.ts`) loads from a path outside `node_modules` only (Node does not strip types inside
`node_modules`); publish packages as JavaScript.

## Running plugins on Cloudflare

A Worker cannot load code at run time, so plugins are bundled when it is built. `deploy/cloudflare/plugins.mjs`
exports them by name:

```js
import headerAuth from '../../examples/host-plugins/header-auth.mjs';
import acmeSso from '@acme/oa-sso';
export default { 'header-auth': headerAuth, 'acme-sso': acmeSso };
```

`OA_PLUGINS` (a var, or a secret with `wrangler secret put OA_PLUGINS`) then picks and configures them, by those names:
`[{"use":"header-auth","config":{"secret":{"env":"PROXY_SECRET"}}}]`, with `PROXY_SECRET` a Worker secret. Changing
`OA_PLUGINS` needs no build; adding a module does (`npm run build`; `OA_PLUGINS_MODULE=<file>` bundles another file
instead of `plugins.mjs`). A name that is not bundled stops the Worker with "The plugin "x" could not be loaded: it is
not bundled into this Worker: add it to deploy/cloudflare/plugins.mjs as "x" and build again (bundled: …)".

Differences from Node:

- There is no `plugin` command; the admin API above lists what runs.
- Each isolate (the Worker, and each artifact's Durable Object) runs its own copy of the plugins: keep state in
  `ctx.kv`, not in module variables. Role answers in a room are the room's own; `invalidate` reaches the rooms that
  are awake, and a page opened elsewhere sees the change within about 2 seconds.
- `ctx.fetch` and background work (events) end with the request's `waitUntil`; a plugin cannot keep timers running.

## Stability

`apiVersion` is a major version. Within it, the host only adds: new hooks, events, guard actions, input fields and
`ctx` members, so a plugin must ignore what it does not know (an unknown principal `kind`, an unknown guard action:
answer nothing). Ask `ctx.host.supports('on.share.invited')` before relying on something newer. A host refuses a plugin
written for a newer major with a message saying which release to use, and runs plugins of the previous major through
an adapter for at least one major release.

## Testing

```js
import { createPluginHarness } from '@open-artifact/host-plugin/testing';
import plugin from './my-plugin.mjs';

const h = createPluginHarness(plugin, { config: { url: 'https://perms.example.com' }, fetch: async () => Response.json({ role: 'editor' }) });
const artifact = h.addArtifact();
const { role } = await h.role({ principal: h.userPrincipal(h.addUser({ email: 'ann@example.com' })), artifact, role: null });
```

The harness checks the plugin and its settings with the host's rules, and calls each hook as the host does (time
limit, failure policy, answer checks). It records `logs`, `audits`, `fetches`, `failures` and `invalidated`, and has an
in-memory `kv`. `h.request('POST', '/invalidate', {body})` calls a route. See `examples/host-plugins/` in the
repository for six plugins; their tests are `examples/host-plugins/company-jwt.test.mjs` and
`packages/host-plugin/test/examples.test.ts`.
