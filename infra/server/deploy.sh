#!/usr/bin/env bash
# Runs on the server, called by GitHub Actions over SSH (.github/workflows/deploy.yml):
#   pull the images for IMAGE_TAG → apply database migrations → restart → health check.
# The GitHub token for the image registry arrives on stdin (never on the command line or on disk).
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${GHCR_USER:?GHCR_USER is required}"
APP_DIR=/opt/hellogram
ENV_FILE=infra/.env.production
cd "$APP_DIR"

# First thing: take the token off stdin, before any command could read it.
IFS= read -r REGISTRY_TOKEN || true

missing=()
for f in "$ENV_FILE" infra/secrets/postgres_password infra/nginx/admin-allowlist.conf; do
  [ -f "$f" ] || missing+=("$APP_DIR/$f")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::The server isn't set up yet. Missing: ${missing[*]}"
  echo "Finish the one-time setup in docs/RUNBOOKS.md §1 (settings, Postgres password, admin allowlist, certificate), then re-run this deploy."
  exit 1
fi

COMPOSE=(docker compose -f infra/docker-compose.prod.yml --env-file "$ENV_FILE")
export IMAGE_TAG

if ! "${COMPOSE[@]}" run --rm -T --no-deps --entrypoint test certbot -f /etc/letsencrypt/live/hellogram/fullchain.pem </dev/null; then
  echo "::error::No HTTPS certificate yet. Run once on the server:  sh infra/nginx/init-certs.sh"
  exit 1
fi

echo "$REGISTRY_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
unset REGISTRY_TOKEN
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

previous=$(grep -E '^IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- || true)
echo "Deploying $IMAGE_TAG (was: ${previous:-none})"

"${COMPOSE[@]}" pull --quiet nginx api worker admin-api migrate
"${COMPOSE[@]}" up -d postgres redis
"${COMPOSE[@]}" run --rm -T migrate </dev/null
"${COMPOSE[@]}" up -d --remove-orphans

echo "Waiting for the API to report healthy…"
healthy=false
for _ in $(seq 1 45); do
  if "${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:4000/health/ready >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done
if [ "$healthy" != true ]; then
  "${COMPOSE[@]}" logs --tail=80 api
  echo "::error::The API didn't become healthy. Roll back by deploying ${previous:-the previous tag} (Actions → Deploy → Run workflow)."
  exit 1
fi

# Remember what's running, so manual 'docker compose' commands use the same images.
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" "$ENV_FILE"
# Keep ~10 days of old images for quick rollbacks.
docker image prune -af --filter "until=240h" >/dev/null || true
echo "Deployed $IMAGE_TAG."
