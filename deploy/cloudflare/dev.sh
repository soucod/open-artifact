#!/bin/sh
# Builds and starts the product Worker under wrangler dev: the app on http://localhost:${PORT:-8787}, artifacts on
# http://{id}.content.localhost:${PORT:-8787}, the state (D1, objects) in ./.state (PERSIST_TO picks another folder).
# The secrets come from .dev.vars (copy .dev.vars.example). Other arguments go to wrangler dev; `-c
# wrangler.rooms.jsonc` runs the rooms test Worker instead.
set -e
cd "$(dirname "$0")"
node build.mjs
PORT="${PORT:-8787}"
exec ./node_modules/.bin/wrangler dev --port "$PORT" --persist-to "${PERSIST_TO:-./.state}" \
  --var "OA_APP_ORIGIN:http://localhost:$PORT" --var "OA_CONTENT_ORIGIN:http://{id}.content.localhost:$PORT" "$@"
