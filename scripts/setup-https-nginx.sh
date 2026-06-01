#!/usr/bin/env bash
set -euo pipefail

DEFAULT_DOMAIN="app.parkia.cl"
DOMAIN="${1:-${PARKIA_DOMAIN:-${TIOLUCHIN_DOMAIN:-$DEFAULT_DOMAIN}}}"
EMAIL="${2:-${LETSENCRYPT_EMAIL:-}}"
APP_ROOT="${APP_ROOT:-/opt/parkia/current}"
NGINX_SITE="/etc/nginx/sites-available/parkia.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/parkia.conf"
STAGING="${CERTBOT_STAGING:-false}"
SKIP_DRY_RUN="${CERTBOT_SKIP_DRY_RUN:-false}"
FORCE_RENEWAL="${CERTBOT_FORCE_RENEWAL:-false}"

usage() {
  cat <<USAGE
Usage:
  sudo bash scripts/setup-https-nginx.sh <domain> <letsencrypt-email>

Environment overrides:
  APP_ROOT=/opt/parkia/current
  CERTBOT_STAGING=true
  CERTBOT_SKIP_DRY_RUN=true
  CERTBOT_FORCE_RENEWAL=true

Example:
  sudo bash scripts/setup-https-nginx.sh app.parkia.cl admin@parkia.cl
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  usage
  exit 64
fi

if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid domain: $DOMAIN" >&2
  exit 64
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script with sudo on the VPS." >&2
  exit 1
fi

if command -v getent >/dev/null 2>&1 && ! getent ahosts "$DOMAIN" >/dev/null; then
  echo "DNS does not resolve $DOMAIN yet. Point the A/AAAA record to this VPS before requesting HTTPS." >&2
  exit 1
fi

if [[ ! -f "$APP_ROOT/deploy/nginx/parkia.conf" ]]; then
  echo "Missing nginx template at $APP_ROOT/deploy/nginx/parkia.conf" >&2
  exit 1
fi

echo "Installing nginx and certbot..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx curl ca-certificates

echo "Installing nginx site for $DOMAIN..."
sed -E "s/server_name[[:space:]]+[^;]+;/server_name ${DOMAIN};/" \
  "$APP_ROOT/deploy/nginx/parkia.conf" > "$NGINX_SITE"
ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"

nginx -t
systemctl reload nginx || systemctl restart nginx

certbot_args=(
  --nginx
  --non-interactive
  --agree-tos
  --redirect
  --email "$EMAIL"
  -d "$DOMAIN"
)

if [[ "$FORCE_RENEWAL" == "true" ]]; then
  certbot_args+=(--force-renewal)
else
  certbot_args+=(--keep-until-expiring)
fi

if [[ "$STAGING" == "true" ]]; then
  certbot_args+=(--staging)
fi

echo "Requesting Let's Encrypt certificate for $DOMAIN..."
certbot "${certbot_args[@]}"

systemctl reload nginx
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

if [[ "$SKIP_DRY_RUN" != "true" ]]; then
  echo "Testing automatic renewal..."
  certbot renew --dry-run
fi

if curl -fsS "https://${DOMAIN}/api/health" >/dev/null; then
  echo "HTTPS is serving the application at https://${DOMAIN}"
else
  echo "Certificate installed, but https://${DOMAIN}/api/health did not respond. Check parkia service status." >&2
fi
