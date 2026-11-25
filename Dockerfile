# syntax=docker/dockerfile:1
#
# The Open Artifact cloud host (`open-artifact-host serve`) in one image: one Node process, the artifacts as folders
# and the catalog as a SQLite file on the /data volume. See packages/host/README.md.
#
#   docker build -t open-artifact-host .
#   docker run -p 4900:4900 -v oa-data:/data --env-file .env open-artifact-host
#
# Stage 1 builds the editors, the board runtime and the Shell; stage 2 carries only what the host runs: its workspace
# packages as .ts source (Node strips the types), the built pages, the types' metadata and the production
# dependencies (deploy/docker/stage.sh lists them). The WebAssembly engines are committed (packages/wasm-*/generated),
# so no Rust toolchain is needed.

ARG NODE_IMAGE=node:22.23.5-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
COPY packages/ packages/
# npm ci needs every workspace's manifest; the DSH plugin is not built here.
COPY plugins/dsh/package.json plugins/dsh/
COPY scripts/ scripts/
COPY artifact-types/ artifact-types/
COPY deploy/docker/stage.sh deploy/docker/
RUN npm ci --no-audit --no-fund
# What the host serves: the board runtime (dist/server/support.js), the eight editors (dist/server/editors/), and the
# Shell and home page (dist/daemon/{shell,home}, which the editors build makes when they are missing). The CLI bundle,
# frame-host and the DSH plugin that a full `npm run build` adds are not used by the host.
RUN node scripts/build.mjs --only support \
 && node scripts/build.mjs --only editors \
 && test -f dist/daemon/shell/index.html -a -f dist/daemon/home/index.html -a -f dist/server/support.js
RUN sh deploy/docker/stage.sh /out \
 && cd /out \
 && npm ci --omit=dev --omit=optional --no-audit --no-fund --workspace @open-artifact/host \
 && npm cache clean --force
COPY LICENSE NOTICE /out/

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="Open Artifact host" \
      org.opencontainers.image.description="Open Artifact on your own server: artifacts shared through the browser, with sign-in and roles." \
      org.opencontainers.image.source="https://github.com/JimLiu/open-artifact" \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production \
    OA_DATA_DIR=/data \
    OA_BIND=0.0.0.0 \
    OA_PORT=4900 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
# Root owns the program (read-only to the process); the node user (uid 1000) owns only the data.
COPY --from=build /out/ /app/
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
VOLUME /data
EXPOSE 4900
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.OA_PORT||4900}/__open-artifact/health`).then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# main.ts stops the listeners, the type server and the catalog on SIGTERM, then exits.
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "packages/host/src/node/main.ts"]
CMD ["serve"]
