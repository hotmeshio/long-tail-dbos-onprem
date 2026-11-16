#!/usr/bin/env bash
# Runs docker compose for the site's services with the machine's settings.
#   sudo compose-services.sh ps
set -euo pipefail

# shellcheck source=machine-paths.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/machine-paths.sh"
require_root "$@"

if [ ! -s "$SECRETS_ENV" ]; then
  echo "${SECRETS_ENV} is missing: run ${INSTALL_DIR}/sync-secrets.sh while online" >&2
  exit 1
fi

exec docker compose --env-file "$SITE_ENV" --env-file "$SECRETS_ENV" -f "${INSTALL_DIR}/docker-compose.yml" "$@"
