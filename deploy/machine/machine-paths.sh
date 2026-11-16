# Sourced by the scripts in this directory: names and paths on the machine.
PROJECT_NAME="${PROJECT_NAME:-OnPremSite}"
SITE_SLUG="${SITE_SLUG:-$(printf '%s' "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-')}"

INSTALL_DIR="/opt/${SITE_SLUG}"
CONFIG_DIR="/etc/${SITE_SLUG}"
SITE_DATA_DIR="/var/lib/${SITE_SLUG}"
SITE_ENV="${CONFIG_DIR}/site.env"
SECRETS_ENV="${CONFIG_DIR}/secrets.env"
SERVICES_UNIT="${SITE_SLUG}-services.service"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo $0 $*" >&2
    exit 1
  fi
}

# Sets or replaces one NAME=value line in site.env.
set_site_value() {
  local name="$1" value="$2"
  touch "$SITE_ENV"
  sed -i "/^${name}=/d" "$SITE_ENV"
  printf '%s=%s\n' "$name" "$value" >> "$SITE_ENV"
}
