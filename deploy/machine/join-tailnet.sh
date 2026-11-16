#!/usr/bin/env bash
# Joins the machine to a Tailscale tailnet and serves the dashboard over HTTPS
# at its tailnet name. Safe to run again.
#   sudo /opt/onpremsite/join-tailnet.sh [hostname]
set -euo pipefail

# shellcheck source=machine-paths.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/machine-paths.sh"
require_root "$@"

TAILNET_HOSTNAME="${1:-$(hostname -s)}"
APP_PORT="${APP_PORT:-3000}"

# 1. Tailscale from its apt repository
if ! command -v tailscale >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${codename}.noarmor.gpg" -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${codename}.tailscale-keyring.list" -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -y
  apt-get install -y tailscale
fi
systemctl enable --now tailscaled

# 2. Join: prints a sign-in link on first run and waits for the approval
tailscale up --hostname "$TAILNET_HOSTNAME"

# 3. Dashboard over HTTPS at the tailnet name
tailscale serve --bg "$APP_PORT"

address="https://$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
set_site_value TAILNET_ADDRESS "$address"
echo "Dashboard: ${address}"
