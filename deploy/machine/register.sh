#!/usr/bin/env bash
# Registers the machine with the site's ECS cluster through Systems Manager,
# then starts the services beside the app. The activation comes from
# `aws ssm create-activation` on a workstation.
#   sudo register.sh <activation-id> <activation-code>
set -euo pipefail

# shellcheck source=machine-paths.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/machine-paths.sh"
require_root "$@"
# shellcheck disable=SC1090
. "$SITE_ENV"

INSTALLER_URL="https://amazon-ecs-agent.s3.amazonaws.com/ecs-anywhere-install-latest.sh"

# 1. Register with Systems Manager and the cluster
if systemctl is-active --quiet ecs; then
  echo "The ECS agent is running; registration kept as is"
else
  activation_id="${1:?usage: register.sh <activation-id> <activation-code>}"
  activation_code="${2:?usage: register.sh <activation-id> <activation-code>}"
  installer="$(mktemp)"
  curl --proto https -fsSL -o "$installer" "$INSTALLER_URL"
  bash "$installer" --region "$AWS_REGION" --cluster "$SITE_SLUG" \
    --activation-id "$activation_id" --activation-code "$activation_code"
  rm -f "$installer"
fi

# 2. Record the image repository, for the mock printer
account="$(aws sts get-caller-identity --region "$AWS_REGION" --query Account --output text)"
set_site_value SITE_IMAGE "${account}.dkr.ecr.${AWS_REGION}.amazonaws.com/${SITE_SLUG}:latest"

# 3. Secrets to disk
"${INSTALL_DIR}/sync-secrets.sh"

# 4. Services, now and at every boot
systemctl enable --now "$SERVICES_UNIT"
"${INSTALL_DIR}/compose-services.sh" ps

echo "Registered with cluster ${SITE_SLUG}; services are up"
