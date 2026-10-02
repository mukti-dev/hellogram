#!/bin/sh
# Runs after every successful renewal (certbot --deploy-hook) and once from init-certs.sh.
# coturn runs unprivileged and can't read certbot's root-only key, so it gets its own copy.
set -eu
src=/etc/letsencrypt/live/hellogram
dst=/etc/letsencrypt/coturn
mkdir -p "$dst"
cp -L "$src/fullchain.pem" "$dst/fullchain.pem"
cp -L "$src/privkey.pem" "$dst/privkey.pem"
chmod 0755 "$dst"
chmod 0644 "$dst/fullchain.pem" "$dst/privkey.pem"
