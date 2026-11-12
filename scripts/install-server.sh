#!/usr/bin/env bash
# NabuLink Linux installer for Debian/Ubuntu and RHEL-like hosts (run as root).
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo."; exit 1; fi
if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null; then apt-get update; apt-get install -y git ca-certificates
  elif command -v dnf >/dev/null; then dnf install -y git ca-certificates
  elif command -v yum >/dev/null; then yum install -y git ca-certificates
  else echo "Install git manually."; exit 1; fi
fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with Compose plugin required. Install via your distribution package manager and rerun."
  exit 1
fi
if ! docker network inspect coolify >/dev/null 2>&1; then
  echo "External docker network 'coolify' is missing. Create it with: docker network create coolify"
  echo "Or adapt docker-compose.yml to your reverse proxy."
  exit 1
fi
INSTALL_DIR="${NBL_INSTALL_DIR:-/opt/nabulink}"
DOMAIN="${NBL_DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then echo "Set NBL_DOMAIN to a DNS name pointing to this server."; exit 1; fi
if [[ -d "$INSTALL_DIR/.git" ]]; then git -C "$INSTALL_DIR" pull --ff-only
elif [[ ! -e "$INSTALL_DIR" ]]; then git clone https://github.com/NabuxAi/NabuLink.git "$INSTALL_DIR"
else echo "Refusing to overwrite $INSTALL_DIR"; exit 1; fi
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  TOKEN=$(openssl rand -hex 32)
  umask 077
  printf 'NBL_ADMIN_TOKEN=%s\nNBL_DOMAIN=%s\n' "$TOKEN" "$DOMAIN" > "$INSTALL_DIR/.env"
  echo "Admin token saved in $INSTALL_DIR/.env (root-readable; do not print/share)."
fi
cd "$INSTALL_DIR"
docker compose up -d --build
docker compose ps
echo "NabuLink started behind Coolify Traefik: https://$DOMAIN"
