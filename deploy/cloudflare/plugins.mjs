// The host plugins bundled into the Worker. A Worker cannot load code at run time, so every plugin OA_PLUGINS names
// must be imported here and exported under the name its entry's "use" gives; then `npm run build` again.
//
// OA_PLUGINS (a variable in wrangler.local.jsonc, or a secret: `wrangler secret put OA_PLUGINS`) is the list, as on
// the Node host: [{"use": "<a key below>", "config": {…}}]. An entry whose "use" is not a key here stops the site
// with: The plugin "<use>" could not be loaded: it is not bundled into this Worker: add it to
// deploy/cloudflare/plugins.mjs as "<use>" and build again (bundled: …).
//
// Example (the examples in examples/host-plugins, or any npm package installed in this folder):
//
//   import headerAuth from '../../examples/host-plugins/header-auth.mjs';
//   import staticGroups from '../../examples/host-plugins/static-groups.mjs';
//
//   export default {
//     'header-auth': headerAuth,
//     'static-groups': staticGroups,
//   };
//
// with OA_PLUGINS='[{"use":"static-groups","config":{"groups":{"design":"ann@example.com"},"roles":{"design":"editor"}}}]'.
//
// To build with another file instead of this one (a test, a second site), set OA_PLUGINS_MODULE=<path> when building.

export default {};
