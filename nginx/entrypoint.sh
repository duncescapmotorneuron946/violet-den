#!/bin/sh
# Generate a self-signed fallback cert if /certs is empty
if [ ! -f /certs/cert.pem ] || [ ! -f /certs/key.pem ]; then
  echo "[nginx] No certificate found — generating self-signed fallback..."
  mkdir -p /certs
  openssl req -x509 -newkey rsa:2048 \
    -keyout /certs/key.pem \
    -out    /certs/cert.pem \
    -days 3650 -nodes \
    -subj "/CN=violetden.local"
  echo "[nginx] Self-signed certificate written to /certs/"
fi

# Substitute env vars in nginx config (only BACKEND_PORT, preserve nginx vars like $host)
export BACKEND_PORT="${BACKEND_PORT:-4000}"
envsubst '${BACKEND_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

exec nginx -g 'daemon off;'
