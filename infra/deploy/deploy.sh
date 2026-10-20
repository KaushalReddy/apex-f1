#!/usr/bin/env sh
# Deploy or update APEX F1 on the server (run from the repository root): checks .env, pulls main, rebuilds and restarts the stack, waits
# for the site to report healthy, then runs the smoke test against the public domain. Safe to re-run; data volumes are kept.
#   sh infra/deploy/deploy.sh            # pull and deploy main
#   sh infra/deploy/deploy.sh --no-pull  # deploy the checked-out commit (e.g. a rollback)
set -eu
cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

[ -f .env ] || { echo "No .env: copy infra/deploy/env.production.example to .env and fill it in." >&2; exit 1; }
for v in DOMAIN POSTGRES_PASSWORD APEX_DB_PASSWORD SYNC_SECRET; do
  grep -Eq "^$v=.+" .env || { echo ".env: $v is empty (see infra/deploy/env.production.example)." >&2; exit 1; }
done
DOMAIN=$(sed -n 's/^DOMAIN=//p' .env | tail -1)

if [ "${1:-}" != "--no-pull" ]; then
  git fetch --quiet origin
  git checkout --quiet main
  git pull --ff-only --quiet origin main
fi
echo "Deploying $(git rev-parse --short HEAD) to https://$DOMAIN"

$COMPOSE up -d --build --remove-orphans

printf "Waiting for the site to be healthy"
i=0
until [ "$($COMPOSE ps --format '{{.Health}}' web 2>/dev/null)" = "healthy" ]; do
  i=$((i + 1))
  [ $i -gt 60 ] && { echo; echo "The site did not become healthy in 5 minutes. Logs: $COMPOSE logs --tail=100 web" >&2; exit 1; }
  printf "."
  sleep 5
done
echo " ok"

sh infra/deploy/smoke.sh "https://$DOMAIN"
docker image prune -f >/dev/null
