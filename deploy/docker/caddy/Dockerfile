# Caddy with a DNS provider's plugin, for the wildcard certificate set-up (compose.dns.yaml, Caddyfile.dns).
# CADDY_DNS_MODULE is the plugin's Go module, pinned to a version: Cloudflare by default; others at https://github.com/caddy-dns.

ARG CADDY_VERSION=2.11.9

FROM caddy:${CADDY_VERSION}-builder AS build
ARG CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare@v0.2.4
RUN xcaddy build --with "${CADDY_DNS_MODULE}"

FROM caddy:${CADDY_VERSION}
COPY --from=build /usr/bin/caddy /usr/bin/caddy
