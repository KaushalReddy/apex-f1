#!/usr/bin/env sh
# Smoke test of a running APEX F1 site: main pages answer, a race replay downloads, unknown pages are 404, security headers are present,
# data freshness is reported, and the protected sync routes refuse anonymous calls. Exits non-zero on any failure.
#   sh infra/deploy/smoke.sh https://apexf1.example.com
#   SYNC_SECRET=... sh infra/deploy/smoke.sh https://...   # also checks /api/sync/health with the secret
set -u
BASE="${1:?usage: smoke.sh <base url>}"
BASE="${BASE%/}"
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1" >&2; fails=$((fails + 1)); }
warn() { echo "warn $1"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$@"; }

for p in / /live /drivers /drivers/russell /teams /cars /circuits /circuits/monza /standings /replay /telemetry /strategy /race-engineer /analysis; do
  c=$(code "$BASE$p"); [ "$c" = 200 ] && ok "$c $p" || bad "$c $p (expected 200)"
done

for p in /does-not-exist /drivers/not-a-driver; do
  c=$(code "$BASE$p"); [ "$c" = 404 ] && ok "$c $p" || bad "$c $p (expected 404)"
done

# A race replay (the newest one listed on /replay) downloads compressed.
key=$(curl -s --max-time 60 "$BASE/replay" | grep -o 'href="/replay/[0-9]*"' | head -1 | grep -o '[0-9][0-9]*')
if [ -n "$key" ]; then
  c=$(code -H 'accept-encoding: br, gzip' "$BASE/api/replay/$key"); [ "$c" = 200 ] && ok "$c /api/replay/$key" || bad "$c /api/replay/$key"
else
  bad "no race listed on /replay"
fi

headers=$(curl -sI --max-time 60 "$BASE/" | tr -d '\r')
for h in "x-content-type-options: nosniff" "x-frame-options: deny" "referrer-policy:" "permissions-policy:"; do
  printf '%s\n' "$headers" | grep -qi "^$h" && ok "header $h" || bad "missing header $h"
done
printf '%s\n' "$headers" | grep -qi "^x-powered-by" && bad "x-powered-by is exposed" || ok "no x-powered-by"

status=$(curl -s --max-time 60 "$BASE/api/data-status")
case "$status" in
  *'"health":"fresh"'*) ok "data-status fresh" ;;
  # Before the worker's first run completes (a few minutes after a first deploy) nothing has synced yet.
  *'"health":"stale"'*) warn "data-status stale: normal for the first minutes after a first deploy, else check the sync worker ($status)" ;;
  *'"health":"bundled"'*) bad "data-status bundled: DATA_DIR is not set, so synced races are never read" ;;
  *) bad "data-status: $status" ;;
esac

c=$(code -X POST -d '{"kinds":["replay"]}' "$BASE/api/revalidate"); case "$c" in 401|503) ok "$c /api/revalidate refuses anonymous calls" ;; *) bad "$c /api/revalidate (expected 401 or 503)" ;; esac
c=$(code "$BASE/api/sync/health"); case "$c" in 401|503) ok "$c /api/sync/health refuses anonymous calls" ;; *) bad "$c /api/sync/health (expected 401 or 503)" ;; esac
if [ -n "${SYNC_SECRET:-}" ]; then
  c=$(code -H "authorization: Bearer $SYNC_SECRET" "$BASE/api/sync/health"); [ "$c" = 200 ] && ok "$c /api/sync/health with the secret" || bad "$c /api/sync/health with the secret"
fi

[ $fails -eq 0 ] && echo "Smoke test passed: $BASE" || { echo "Smoke test: $fails failure(s)" >&2; exit 1; }
