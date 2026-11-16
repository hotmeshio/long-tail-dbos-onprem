#!/usr/bin/env bash
# Runs a stand-in printer from the site image beside the services. Needs the
# image in the repository and the machine online for the pull.
set -euo pipefail

# shellcheck source=machine-paths.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/machine-paths.sh"
require_root "$@"
# shellcheck disable=SC1090
. "$SITE_ENV"

registry="${SITE_IMAGE%%/*}"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$registry"

set_site_value COMPOSE_PROFILES mock
"${INSTALL_DIR}/compose-services.sh" pull printer
"${INSTALL_DIR}/compose-services.sh" up -d --remove-orphans
"${INSTALL_DIR}/compose-services.sh" ps
