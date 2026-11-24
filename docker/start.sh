#!/bin/sh
# Container entrypoint (Dockerfile, D-085): start the seeded Postgres, apply any migration the
# image's data lacks, then serve the production build. Stops both cleanly on SIGTERM.
set -e

pg_ctl -o "-k /tmp -c listen_addresses=localhost" -l /tmp/postgres.log -w start
npx prisma migrate deploy

node_modules/.bin/next start -p "${PORT:-7860}" &
APP=$!

shutdown() {
  kill -TERM "$APP" 2>/dev/null || true
  wait "$APP" 2>/dev/null || true
  pg_ctl -m fast -w stop
  exit 0
}
trap shutdown TERM INT

wait "$APP"
STATUS=$?
pg_ctl -m fast -w stop || true
exit "$STATUS"
