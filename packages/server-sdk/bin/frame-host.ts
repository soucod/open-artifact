#!/usr/bin/env node
/**
 * frame-host: the type server of an original hosted artifact type — a
 * folder (`OPEN_ARTIFACT_TYPE_DIR`) whose index.html declares itself in an inline
 * `// artifact.json` block. The daemon derives this entry for such a type
 * (runtime `frame`); it can also be started by hand with `OPEN_ARTIFACT_TYPE_DIR` set.
 * A page type (`openArtifact.style: "page"` in its artifact-type.json) runs in
 * page mode instead: each artifact's own index.html is its page.
 * Every artifact's page runs on its own origin, `<id>.frame.localhost:<port>`.
 * A restricted type (`OPEN_ARTIFACT_TYPE_RESTRICTED=1`, set by the daemon for a type of
 * an untrusted root: installed, or a project not trusted yet) has its page's origin
 * answer with a Content-Security-Policy (its own origin, inline scripts and styles,
 * `data:`, `blob:` and the manifest's `openArtifact.network`), and its page framed
 * with a `sandbox` (no popups, no top navigation).
 * Its actions are the frame core's (`info` and the reserved `open-artifact.*`) and
 * `snapshot`, a PNG of the page drawn by this computer's headless Chrome.
 * Nothing of the type folder is run here: its declaration is read as literal data.
 *
 * Runs from source (`node packages/server-sdk/bin/frame-host.ts`) or as the
 * bundle `scripts/build.mjs --only frame` writes to `dist/daemon/frame-host/`.
 */
import { basename, resolve } from 'node:path';
import { mountFrameSite, readDeclaration } from '../src/frame/index.ts';
import { localFrameActions } from '../src/frame/snapshot-action.ts';
import { installedTypeCsp, networkOrigins } from '@open-artifact/protocol';
import { serve, typeManifest } from '../src/serve.ts';

const dir = resolve(process.env.OPEN_ARTIFACT_TYPE_DIR ?? process.cwd());
const manifest = typeManifest(dir);
// A page type (`openArtifact.style: "page"`) has no index.html of its own: page mode runs each artifact's.
const page = manifest.openArtifact?.style === 'page';
if (!page && !readDeclaration(dir)) {
  process.stderr.write(`${dir}/index.html has no // artifact.json declaration: not an original artifact type.\n`);
  process.exit(2);
}
const restricted = process.env.OPEN_ARTIFACT_TYPE_RESTRICTED === '1';
const allowedNetworkOrigins = networkOrigins(manifest);
const contentSecurityPolicy = restricted ? installedTypeCsp(allowedNetworkOrigins) : null;
await serve({
  mountSite: (root, ctx) => mountFrameSite(root, { ...ctx, typeDir: dir, page, contentSecurityPolicy, allowedNetworkOrigins, restricted }),
  // The core's actions and `snapshot` (this computer's headless Chrome): a hosted site serves `frameActions` alone.
  actions: localFrameActions,
  // The type id: the daemon passes it; by hand, the folder name (as the daemon would derive it).
  type: process.env.OPEN_ARTIFACT_TYPE ?? basename(dir),
  version: manifest.version ?? '0',
  contentHosts: true,
  archive: true,
});
