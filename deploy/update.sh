#!/usr/bin/env bash
# Install a new version of Guardora on the server: run from the new project folder as root.
set -euo pipefail
rsync -a --delete --exclude node_modules --exclude data --exclude demo-data --exclude .git ./ /opt/guardora/
cd /opt/guardora && npm ci --omit=dev
systemctl restart guardora
echo "Updated. Status:"; systemctl --no-pager status guardora | head -5
