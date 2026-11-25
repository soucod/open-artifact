#!/bin/sh
# Backs up an Open Artifact host's data: a consistent copy of the catalog (SQLite `VACUUM INTO`, taken while the host
# runs) and the artifacts folder, in one .tar.gz, optionally uploaded to S3.
#
#   deploy/backup.sh                         the compose set-up in deploy/docker (the `host` service's /data volume)
#   OA_DATA_DIR=/srv/oa deploy/backup.sh     a host run without Docker (`node packages/host/src/node/main.ts`)
#
# Settings (environment):
#   BACKUP_DIR    where archives are written (default /var/backups/open-artifact)
#   BACKUP_KEEP   how many archives to keep there (default 7)
#   BACKUP_S3     an S3 prefix to upload each archive to, e.g. s3://my-bucket/open-artifact (needs the aws CLI)
#   COMPOSE_DIR   the compose project's folder (default: deploy/docker beside this script)
#   OA_DATA_DIR   back up this folder directly instead of the compose volume (needs Node >= 22.13 for node:sqlite)
#
# The catalog copy is exact; the artifacts are read file by file while the host may be writing, so an artifact being
# edited at that moment can be caught mid-change. Restore: see packages/host/README.md ("Backup and restore").
set -eu

BACKUP_DIR=${BACKUP_DIR:-/var/backups/open-artifact}
BACKUP_KEEP=${BACKUP_KEEP:-7}
here=$(cd "$(dirname "$0")" && pwd)
COMPOSE_DIR=${COMPOSE_DIR:-$here/docker}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="open-artifact-$stamp.tar.gz"

# Runs in the data folder ($1): the catalog snapshot, then the archive on stdout, then the snapshot removed.
# Plain sh, node, tar and gzip: what the host image has.
inner='set -eu
cd "$1"
snap=".backup-host.db"
rm -f "$snap"
node --disable-warning=ExperimentalWarning -e "
  const { DatabaseSync } = require(\"node:sqlite\");
  const db = new DatabaseSync(\"host.db\", { readOnly: true });
  db.exec(\"PRAGMA busy_timeout = 10000\");
  db.exec(\"VACUUM INTO '\''.backup-host.db'\''\");
  db.close();
"
trap "rm -f \"$snap\"" EXIT
set -- "$snap"
[ -d artifacts ] && set -- "$@" artifacts
[ -f keys.json ] && set -- "$@" keys.json
tar -czf - "$@"'

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077
tmp="$BACKUP_DIR/.$name.part"
trap 'rm -f "$tmp"' EXIT
if [ -n "${OA_DATA_DIR:-}" ]; then
  sh -c "$inner" sh "$OA_DATA_DIR" > "$tmp"
else
  (cd "$COMPOSE_DIR" && docker compose exec -T host sh -c "$inner" sh /data) > "$tmp"
fi
# A truncated stream would still be a file: check the archive reads to the end and holds the catalog.
tar -tzf "$tmp" | grep -qx '.backup-host.db'
mv "$tmp" "$BACKUP_DIR/$name"
echo "wrote $BACKUP_DIR/$name ($(wc -c < "$BACKUP_DIR/$name" | tr -d ' ') bytes)"

if [ -n "${BACKUP_S3:-}" ]; then
  aws s3 cp --only-show-errors "$BACKUP_DIR/$name" "${BACKUP_S3%/}/$name"
  echo "uploaded to ${BACKUP_S3%/}/$name"
fi

# Keep the newest BACKUP_KEEP archives here (S3 keeps what its lifecycle rules say).
ls -1 "$BACKUP_DIR"/open-artifact-*.tar.gz 2>/dev/null | sort -r | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do rm -f "$old"; done
