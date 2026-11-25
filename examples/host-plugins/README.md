# Example host plugins

Six plugins for an Open Artifact host (Node or Cloudflare), each one file. The guide that walks through them, with
real output, is [docs/plugins.md](../../docs/plugins.md). A plugin is listed in the operator's plugin list
(`OA_PLUGINS`, or `plugins.json` in the data directory on Node):

```json
[{ "use": "/path/to/examples/host-plugins/header-auth.mjs", "config": { "secret": { "env": "PROXY_SECRET" } } }]
```

`{"env": "NAME"}` reads a setting from an environment variable (a Worker secret on Cloudflare).

Copy any of them anywhere (the data directory too). `header-auth`, `http-authz` and `company-jwt` import
`@open-artifact/host-plugin`, which is not on npm and need not be installed: the host hands every plugin its own copy
(on Node when the plugin loads, on Cloudflare when the Worker is built).

Tests: `company-jwt.test.mjs` here (`node --test examples/host-plugins/company-jwt.test.mjs`); the other five in
`packages/host-plugin/test/examples.test.ts`. Both use the test kit (`@open-artifact/host-plugin/testing`). The five
also run together in a real Node host in `packages/host/test/plugins-node.test.ts`.

**On Node**, from the Open Artifact folder (`open-artifact-host` in the messages is
`node packages/host/src/node/main.ts`), add one to the data directory's list (a relative path starts where you are, and is
stored so it keeps pointing there), and check it before restarting:

```sh
node packages/host/src/node/main.ts plugin add "$PWD/examples/host-plugins/static-groups.mjs" \
  --config '{"groups":{"staff":"@example.com"},"roles":{"staff":"viewer"}}'
node packages/host/src/node/main.ts plugin check
```

or start the host with the list in `OA_PLUGINS` (relative paths start at the working folder):

```sh
PROXY_SECRET=… OA_PLUGINS='[{"use":"./examples/host-plugins/header-auth.mjs","config":{"secret":{"env":"PROXY_SECRET"}}}]' node packages/host/src/node/main.ts serve
```

**On Cloudflare**, bundle them in `deploy/cloudflare/plugins.mjs` under a name, build, and name them in `OA_PLUGINS`:

```js
// deploy/cloudflare/plugins.mjs
import headerAuth from '../../examples/host-plugins/header-auth.mjs';
import staticGroups from '../../examples/host-plugins/static-groups.mjs';
export default { 'header-auth': headerAuth, 'static-groups': staticGroups };
```

```
# .dev.vars (locally), or wrangler secret put for each
OA_PLUGINS=[{"use":"header-auth","config":{"secret":{"env":"PROXY_SECRET"}}}]
PROXY_SECRET=…
```

`e2e/host-plugins.test.mjs` (Node, behind a test proxy) and `e2e/cloudflare-plugins.test.mjs` (`wrangler dev`) run
`header-auth` and `static-groups` with a ten-line guard (`e2e/fixtures/host-plugins/no-export.mjs`) end to end.

## company-jwt.mjs

A complete example with several hooks: signs people in from your company's JWT cookie (`auth.authenticate`, with
`verifyJwt`, a key or a JWKS URL), refuses departments not in `departments` (`auth.identity`), gives each department
its role on every artifact without lowering the site's own (`authz.role`), refuses public links (`guard`), and adds
"My department" to the account menu (`ui`, `routes`). The session, once made, outlives the cookie: see the guide.

## header-auth.mjs

Signs people in from headers an authenticating proxy sets (`x-forwarded-email`, `x-forwarded-user`, optional groups).

**Precondition: a header proves nothing by itself.** Anyone who can reach Open Artifact without going through the
proxy can send `x-forwarded-email: ceo@example.com`. So the plugin also requires either a shared secret the proxy adds
(`secretHeader` + `secret`), or a JWT the proxy signs (`jwtHeader` + `jwksUrl`, with `issuer` and `audience`). With
neither, its `validate` refuses the settings and the host does not start. Even then, keep the host reachable only through the proxy where you can.

## http-authz.mjs

Asks your permission service for each person's role on an artifact: a signed POST to `url`, the answer reused for 60
seconds, no access when the service fails. The service calls `POST /plugins/http-authz/invalidate` (signed with the same
secret) when permissions change.

## static-groups.mjs

Roles from the configuration, no network. Both settings are maps:

```json
{
  "use": "./static-groups.mjs",
  "config": {
    "groups": { "design": "ann@example.com, bo@example.com", "staff": "@example.com" },
    "roles": { "staff": "viewer", "design": "editor:lead@example.com" }
  }
}
```

`staff` may view everything; `design` may edit what `lead@example.com` owns. Only verified addresses count. `validate`
refuses a role other than viewer, commenter or editor, or a role for a group that is not in `groups`. Imports nothing.

## webhook-events.mjs

Posts chosen events to a URL, as Slack text or JSON, optionally signed; a failed post is retried with later events.
Imports nothing.

## invite-email.mjs

E-mails people an artifact is shared with, through any HTTP mail API (`apiUrl`, `apiKey`), from a template with the
title, role and link. Imports nothing.
