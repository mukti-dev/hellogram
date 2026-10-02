#!/usr/bin/env sh
# First-time HTTPS certificate for every Hellogram domain (run once on the server, from the repo root):
#   sh infra/nginx/init-certs.sh
# Needs: DNS for all domains pointing at this server, port 80 open, nginx not running yet.
# Renewal is automatic afterwards (the certbot service), so this is only for the first certificate.
set -eu

ENV_FILE=infra/.env.production
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }
# Read only what's needed (sourcing the whole file would choke on values with spaces).
val() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
SITE_DOMAIN=$(val SITE_DOMAIN)
APP_DOMAIN=$(val APP_DOMAIN)
ADMIN_DOMAIN=$(val ADMIN_DOMAIN)
TURN_DOMAIN=$(val TURN_DOMAIN)
ACME_EMAIL=$(val ACME_EMAIL)
: "${SITE_DOMAIN:?set SITE_DOMAIN in $ENV_FILE}"
: "${APP_DOMAIN:?set APP_DOMAIN}"
: "${ADMIN_DOMAIN:?set ADMIN_DOMAIN}"
: "${TURN_DOMAIN:?set TURN_DOMAIN}"
: "${ACME_EMAIL:?set ACME_EMAIL}"

COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file $ENV_FILE"

echo "Requesting one certificate for: $SITE_DOMAIN www.$SITE_DOMAIN $APP_DOMAIN $ADMIN_DOMAIN $TURN_DOMAIN"
$COMPOSE stop nginx 2>/dev/null || true
$COMPOSE run --rm -p 80:80 --entrypoint certbot certbot certonly \
  --standalone --non-interactive --agree-tos --no-eff-email \
  --email "$ACME_EMAIL" --cert-name hellogram \
  -d "$SITE_DOMAIN" -d "www.$SITE_DOMAIN" -d "$APP_DOMAIN" -d "$ADMIN_DOMAIN" -d "$TURN_DOMAIN"

# Copy for the TURN relay (it can't read certbot's root-only key directly).
$COMPOSE run --rm -T --entrypoint sh certbot /hooks/copy-for-coturn.sh
echo "Done. Start everything with:  $COMPOSE up -d"
