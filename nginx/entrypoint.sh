#!/bin/sh
set -e

mkdir -p /certs

# ── Let's Encrypt via DNS-01 (if DOMAIN and DNS provider are configured) ────
if [ -n "$DOMAIN" ] && [ -n "$DNS_PROVIDER" ]; then
  ACME_HOME="/root/.acme.sh"
  CERT_DOMAIN_DIR="$ACME_HOME/${DOMAIN}_ecc"

  # Check if cert already exists and is still valid (>30 days remaining)
  NEED_CERT=true
  if [ -f "$CERT_DOMAIN_DIR/fullchain.cer" ] && [ -f "$CERT_DOMAIN_DIR/${DOMAIN}.key" ]; then
    # Check expiry — renew if less than 30 days remaining
    if openssl x509 -checkend 2592000 -noout -in "$CERT_DOMAIN_DIR/fullchain.cer" 2>/dev/null; then
      echo "[nginx] Let's Encrypt cert for $DOMAIN is valid (>30 days remaining)"
      NEED_CERT=false
    else
      echo "[nginx] Let's Encrypt cert for $DOMAIN is expiring soon — renewing..."
    fi
  fi

  if [ "$NEED_CERT" = true ]; then
    echo "[nginx] Requesting Let's Encrypt cert for $DOMAIN via DNS-01 ($DNS_PROVIDER)..."
    # GoDaddy DNS propagation is slow — use --dnssleep 600
    DNSSLEEP=""
    if [ "$DNS_PROVIDER" = "dns_gd" ]; then
      DNSSLEEP="--dnssleep 600"
    fi
    if acme.sh --issue --dns "$DNS_PROVIDER" -d "$DOMAIN" --keylength ec-256 $DNSSLEEP --force 2>&1; then
      echo "[nginx] Let's Encrypt cert issued successfully for $DOMAIN"
    else
      echo "[nginx] WARNING: Let's Encrypt cert request failed — falling back to self-signed"
      DOMAIN=""
    fi
  fi

  # Install cert to /certs if we have a valid LE cert
  if [ -n "$DOMAIN" ] && [ -f "$CERT_DOMAIN_DIR/fullchain.cer" ]; then
    cp "$CERT_DOMAIN_DIR/fullchain.cer" /certs/cert.pem
    cp "$CERT_DOMAIN_DIR/${DOMAIN}.key" /certs/key.pem
    echo "[nginx] Let's Encrypt cert installed to /certs/"

    # Set up daily renewal check via crond
    echo "0 3 * * * acme.sh --renew -d $DOMAIN --ecc && cp $CERT_DOMAIN_DIR/fullchain.cer /certs/cert.pem && cp $CERT_DOMAIN_DIR/${DOMAIN}.key /certs/key.pem && nginx -s reload 2>/dev/null" \
      | crontab -
    crond -b -l 8
    echo "[nginx] Auto-renewal cron enabled (daily at 03:00)"
  fi
fi

# ── Self-signed fallback (if no LE cert) ─────────────────────────────────────
if [ ! -f /certs/cert.pem ] || [ ! -f /certs/key.pem ]; then
  echo "[nginx] No certificate found — generating self-signed fallback..."
  openssl req -x509 -newkey rsa:2048 \
    -keyout /certs/key.pem \
    -out    /certs/cert.pem \
    -days 3650 -nodes \
    -subj "/CN=violetden.local"
  echo "[nginx] Self-signed certificate written to /certs/"
fi

# ── Generate nginx config and start ──────────────────────────────────────────
export BACKEND_PORT="${BACKEND_PORT:-4000}"
envsubst '${BACKEND_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g 'daemon off;'
