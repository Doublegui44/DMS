#!/bin/sh
# Server for the Playwright suite (playwright.config.ts). Resets and seeds dms_e2e while the app
# is built, then serves the production build. E2E_DEV=1 serves the dev server instead (no build,
# hot reload, slower pages): for debugging a spec.
set -e
PORT="${PORT:-3100}"
if [ "${E2E_DEV:-}" = "1" ]; then
  npx tsx scripts/db-reset.ts
  exec npx next dev -p "$PORT"
fi
npx tsx scripts/db-reset.ts &
RESET=$!
if ! npx next build; then
  kill "$RESET" 2>/dev/null || true
  exit 1
fi
wait "$RESET"
exec npx next start -p "$PORT"
