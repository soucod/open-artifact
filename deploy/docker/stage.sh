#!/bin/sh
# Copies what `open-artifact-host serve` needs out of a built checkout into <out>, laid out as the checkout is (the host
# finds dist/, artifact-types/ and the workspace packages relative to packages/host/src/node/):
#
#   package.json, package-lock.json      the workspace root (then `npm ci --omit=dev` in <out>)
#   packages/*/package.json, plugins/dsh/package.json
#                                        every workspace's manifest, so the lockfile's workspaces resolve
#   packages/<p>/{src,generated,fonts}   the packages the host imports, run as .ts source (tests left out)
#   dist/server/{editors,shell,support.js}
#                                        the editors, the type server's Shell and the board runtime
#   dist/daemon/{shell,home}             the app origin's Shell and home page
#   artifact-types/<type>/{artifact-type.json,SKILL.md}
#                                        the installed types' metadata (remote MCP)
#
# Usage (from the checkout, after `npm ci && npm run build`): sh deploy/docker/stage.sh <out>
# The Dockerfile runs it; it is also how the file set was checked without Docker.
set -eu

out=${1:?usage: stage.sh <out>}
if [ ! -f dist/server/support.js ] || [ ! -f dist/daemon/shell/index.html ]; then echo "stage.sh: run npm run build first" >&2; exit 1; fi

# The workspace packages the host imports, directly or through another package (packages/host's imports, followed;
# packages/host/test/docker-stage.test.ts checks this list against them). host-plugin is also the copy a site's
# plugins import without installing it.
PACKAGES="host host-plugin protocol runtime server-sdk type-server
  data-core dc design-core design-system-core docs-core editor-kit live-store motion-core motion-stage
  sheets-core slides-core ui wasm-data-rules wasm-sheets wasm-wb-geom whiteboard-core"

mkdir -p "$out"
cp package.json package-lock.json "$out/"
for manifest in packages/*/package.json plugins/dsh/package.json; do
  mkdir -p "$out/$(dirname "$manifest")"
  cp "$manifest" "$out/$manifest"
done
for p in $PACKAGES; do
  for part in src generated fonts; do
    if [ -d "packages/$p/$part" ]; then cp -R "packages/$p/$part" "$out/packages/$p/$part"; fi
  done
done
find "$out/packages" \( -name '*.test.ts' -o -name '*.test.tsx' \) -type f -exec rm -f {} +

mkdir -p "$out/dist/server" "$out/dist/daemon"
cp -R dist/server/editors dist/server/shell "$out/dist/server/"
cp dist/server/support.js "$out/dist/server/"
cp -R dist/daemon/shell dist/daemon/home "$out/dist/daemon/"

for dir in artifact-types/*/; do
  type=$(basename "$dir")
  [ -f "$dir/artifact-type.json" ] || continue
  mkdir -p "$out/artifact-types/$type"
  cp "$dir/artifact-type.json" "$out/artifact-types/$type/"
  if [ -f "$dir/SKILL.md" ]; then cp "$dir/SKILL.md" "$out/artifact-types/$type/"; fi
done
echo "staged the host into $out"
