#!/usr/bin/env bash
# One-time setup of Guardora on an Ubuntu server (for example a Hostinger VPS), so it runs 24/7.
# Run as root from the project folder:   sudo bash deploy/setup-ubuntu.sh cv.guardiansindia.com
# Before running: point a DNS "A" record for that address to this server's IP.
set -euo pipefail

DOMAIN="${1:?Usage: sudo bash deploy/setup-ubuntu.sh <address, e.g. cv.guardiansindia.com>}"
APP=/opt/guardora
DATA=/var/lib/guardora
CONF=/etc/guardora

echo "== Node.js 22 =="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx certbot python3-certbot-nginx rsync

echo "== App files =="
id guardora >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin guardora
mkdir -p "$APP" "$DATA" "$CONF"
rsync -a --delete --exclude node_modules --exclude data --exclude demo-data --exclude .git ./ "$APP/"
cd "$APP" && npm ci --omit=dev
chown -R root:root "$APP"
chown -R guardora:guardora "$DATA"
chmod 700 "$DATA"

echo "== Settings and master key =="
if [ ! -f "$CONF/guardora.env" ]; then
  KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > "$CONF/guardora.env" <<CFG
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
TRUST_PROXY=1
DATA_DIR=$DATA
MASTER_KEY=$KEY
CFG
  chmod 600 "$CONF/guardora.env"
  echo
  echo "  MASTER KEY (save it in a password manager NOW; without it backups cannot be opened):"
  echo "  $KEY"
  echo
fi

echo "== Service =="
cp "$APP/deploy/guardora.service" /etc/systemd/system/guardora.service
systemctl daemon-reload
systemctl enable --now guardora

echo "== nginx + HTTPS =="
sed "s/cv.guardiansindia.com/$DOMAIN/" "$APP/deploy/nginx-guardora.conf" > /etc/nginx/sites-available/guardora
ln -sf /etc/nginx/sites-available/guardora /etc/nginx/sites-enabled/guardora
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "certbot failed: check the DNS record, then run: certbot --nginx -d $DOMAIN"

sleep 2
echo
echo "Guardora is running at https://$DOMAIN"
echo "Setup code for the owner account:"
journalctl -u guardora --no-pager | grep -o "Setup code: [A-Z0-9]*" | tail -1 || true
echo "Update later with:  sudo bash deploy/update.sh"
