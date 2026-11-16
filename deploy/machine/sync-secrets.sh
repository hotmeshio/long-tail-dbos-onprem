#!/usr/bin/env bash
# Copies the Postgres password and NATS token from Secrets Manager to a
# root-only file, read with the machine's own role. The services start from
# that file, so they need AWS only when this script runs.
set -euo pipefail

# shellcheck source=machine-paths.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/machine-paths.sh"
require_root "$@"
# shellcheck disable=SC1090
. "$SITE_ENV"

read_secret() {
  aws secretsmanager get-secret-value --region "$AWS_REGION" \
    --secret-id "${PROJECT_NAME}/$1" --query SecretString --output text
}

postgres_password="$(read_secret PostgresPassword)"
nats_token="$(read_secret NatsToken)"

staged="$(mktemp "${CONFIG_DIR}/secrets.XXXXXX")"
chmod 0600 "$staged"
printf 'POSTGRES_PASSWORD=%s\nNATS_TOKEN=%s\n' "$postgres_password" "$nats_token" > "$staged"
mv "$staged" "$SECRETS_ENV"

echo "Wrote ${SECRETS_ENV}"
