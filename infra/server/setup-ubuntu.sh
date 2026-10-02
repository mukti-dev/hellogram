#!/usr/bin/env bash
# One-time setup of a fresh AWS Lightsail Ubuntu 24.04 server for Hellogram. Safe to re-run.
#
#   scp infra/server/setup-ubuntu.sh ubuntu@<server-ip>:
#   ssh ubuntu@<server-ip> 'sudo bash setup-ubuntu.sh "ssh-ed25519 AAAA… github-actions-deploy"'
#
# The argument is the PUBLIC half of the SSH key GitHub Actions deploys with (its private half is the
# SSH_PRIVATE_KEY secret). Installs Docker, creates the "deploy" user, firewall, swap, automatic
# security updates, SSH hardening, log rotation and the backup / relay-restart cron jobs.
set -euo pipefail

DEPLOY_KEY="${1:?Pass the deploy public key, e.g. sudo bash setup-ubuntu.sh \"ssh-ed25519 AAAA… github-actions\"}"
APP_DIR=/opt/hellogram
DEPLOY_USER=deploy
export DEBIAN_FRONTEND=noninteractive

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "Warning: written for Ubuntu 24.04, this is ${PRETTY_NAME:-unknown}."

echo "==> System packages"
apt-get update -q
apt-get -y -q upgrade
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades rsync

echo "==> Docker Engine + Compose (Docker's official repository)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Keep container logs from filling the disk.
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
systemctl enable --now docker
systemctl restart docker

echo "==> Deploy user"
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
grep -qxF "$DEPLOY_KEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" || echo "$DEPLOY_KEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> App folder $APP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/infra" "$APP_DIR/infra/nginx" "$APP_DIR/backups"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/infra/secrets"

echo "==> Swap (the build-free server still needs headroom for Postgres + Node)"
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/60-hellogram.conf
sysctl -q -p /etc/sysctl.d/60-hellogram.conf

echo "==> Firewall (open the SAME ports in the Lightsail console → Networking)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 3478 >/dev/null          # call relay (TCP + UDP)
ufw allow 5349/tcp >/dev/null      # call relay over TLS
ufw allow 49152:65535/udp >/dev/null  # call relay media
ufw --force enable >/dev/null

echo "==> SSH: keys only, no root login"
cat > /etc/ssh/sshd_config.d/60-hellogram.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
SSH
sshd -t
systemctl reload ssh

echo "==> Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now fail2ban >/dev/null

echo "==> Scheduled jobs"
cat > /etc/cron.d/hellogram <<CRON
# Nightly database backup (keeps 7 days in $APP_DIR/backups).
30 2 * * * $DEPLOY_USER [ -x $APP_DIR/infra/server/backup.sh ] && $APP_DIR/infra/server/backup.sh >> $APP_DIR/backups/backup.log 2>&1
# Weekly: the call relay re-reads its renewed HTTPS certificate (nginx reloads by itself).
0 4 * * 1 $DEPLOY_USER cd $APP_DIR && [ -f infra/.env.production ] && docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production restart coturn >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/hellogram

cat <<DONE

Server ready. Next (docs/RUNBOOKS.md §1):
  1. Add the GitHub secrets/variables and push to main — the first deploy uploads the config files
     to $APP_DIR/infra and then stops, listing what's still missing.
  2. As the deploy user (sudo -iu $DEPLOY_USER), in $APP_DIR:
       cp infra/.env.production.example infra/.env.production   # fill every value
       openssl rand -base64 32 > infra/secrets/postgres_password   # same password in DATABASE_URL
       cp infra/nginx/admin-allowlist.conf.example infra/nginx/admin-allowlist.conf   # your IPs
       sh infra/nginx/init-certs.sh                                # first HTTPS certificate
  3. Re-run the deploy (GitHub → Actions → Deploy → Run workflow, or push again).
DONE
