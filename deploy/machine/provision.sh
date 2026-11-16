#!/usr/bin/env bash
# Prepares an Ubuntu machine to be the site: Docker, the AWS CLI, the site's
# directories, and the systemd unit for the services beside the app.
# Safe to run again.
#   sudo AWS_REGION=us-west-2 bash provision.sh
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=machine-paths.sh
. "${SOURCE_DIR}/machine-paths.sh"
require_root "$@"

AWS_REGION="${AWS_REGION:?set AWS_REGION, e.g. us-west-2}"
export DEBIAN_FRONTEND=noninteractive

# 1. Base packages
apt-get update -y
apt-get install -y ca-certificates curl jq chrony unattended-upgrades

# 2. Docker Engine with the compose plugin
if ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker

# 3. AWS CLI
if ! command -v aws >/dev/null 2>&1; then
  snap install aws-cli --classic
fi

# 4. Directories and files
install -d -m 0755 "$INSTALL_DIR" "$SITE_DATA_DIR" "${SITE_DATA_DIR}/work"
install -d -m 0700 "$CONFIG_DIR" "${SITE_DATA_DIR}/postgres"
install -m 0644 "${SOURCE_DIR}/docker-compose.yml" "${SOURCE_DIR}/nats.conf" "${SOURCE_DIR}/mosquitto.conf" "${SOURCE_DIR}/machine-paths.sh" "$INSTALL_DIR/"
install -m 0755 "${SOURCE_DIR}/provision.sh" "${SOURCE_DIR}/register.sh" "${SOURCE_DIR}/sync-secrets.sh" \
  "${SOURCE_DIR}/compose-services.sh" "${SOURCE_DIR}/enable-mock-printer.sh" "${SOURCE_DIR}/join-tailnet.sh" "$INSTALL_DIR/"

set_site_value PROJECT_NAME "$PROJECT_NAME"
set_site_value SITE_SLUG "$SITE_SLUG"
set_site_value AWS_REGION "$AWS_REGION"
set_site_value SITE_DATA_DIR "$SITE_DATA_DIR"
chmod 0600 "$SITE_ENV"

# 5. Services unit, started by register.sh once the secrets are on disk
cat > "/etc/systemd/system/${SERVICES_UNIT}" <<UNIT
[Unit]
Description=Postgres, NATS and Mosquitto for the site
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${INSTALL_DIR}/compose-services.sh up -d --remove-orphans
ExecStop=${INSTALL_DIR}/compose-services.sh stop

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

echo "Provisioned. Next: sudo ${INSTALL_DIR}/register.sh <activation-id> <activation-code>"
