#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# VioletDen — Install as a systemd service (Docker-based)
#
# Supports: Debian/Ubuntu, AlmaLinux/Rocky/RHEL, Fedora
# Requires: root/sudo, Docker, Docker Compose plugin
#
# Always uses the full 3-container stack (nginx + frontend + backend).
#
# Usage:
#   sudo ./install.sh              # Standalone mode
#   sudo ./install.sh --ha         # + Home Assistant integration
#                                  #   Auto-detects HA Docker network,
#                                  #   sets HA env vars in .env.
#                                  #   Then install via HACS to get the
#                                  #   sidebar panel in HA.
#   sudo ./install.sh --uninstall  # Remove service
#
# Reads configuration from .env in the same directory as this script.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="violetden"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE_FILE="docker-compose.yml"
HA_FLAG=false
NETWORK_OVERRIDE=""

# ── Parse arguments ──────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --ha)        HA_FLAG=true ;;
    --uninstall) exec "$SCRIPT_DIR/uninstall.sh"; exit ;;
    --help|-h)
      echo "Usage: sudo ./install.sh [--ha] [--uninstall]"
      echo ""
      echo "  --ha         Enable Home Assistant integration"
      echo "               Auto-detects HA Docker network and sets HA_INTEGRATION"
      echo "               and HA_URL in .env. Install VioletDen in HA via HACS"
      echo "               to get the sidebar panel."
      echo "  --uninstall  Remove the VioletDen service"
      echo ""
      echo "Configuration is read from .env (copy .env.example first)."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Run: ./install.sh --help"
      exit 1
      ;;
  esac
done

# ── Preflight checks ────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run as root (use sudo)."
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "Error: Docker is not installed."
  echo "Install it first: https://docs.docker.com/engine/install/"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "Error: Docker Compose plugin is not installed."
  echo "Install it first: https://docs.docker.com/compose/install/"
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/$COMPOSE_FILE" ]; then
  echo "Error: $COMPOSE_FILE not found in $SCRIPT_DIR"
  exit 1
fi

# ── .env setup ───────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$SCRIPT_DIR/.env.example" ]; then
    echo "No .env found — copying .env.example to .env"
    cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
    echo "IMPORTANT: Edit $ENV_FILE with your settings before starting the service."
    echo ""
  else
    echo "Error: No .env or .env.example found in $SCRIPT_DIR"
    exit 1
  fi
fi

# ── Read port from .env for status display ───────────────────────────────────
BACKEND_PORT=$(grep -E '^BACKEND_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo "4000")
HTTPS_PORT=$(grep -E '^HTTPS_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo "443")
[ -z "$BACKEND_PORT" ] && BACKEND_PORT="4000"
[ -z "$HTTPS_PORT" ] && HTTPS_PORT="443"

# ── HA network auto-detection ───────────────────────────────────────────────
if [ "$HA_FLAG" = true ]; then
  echo "Detecting Home Assistant Docker network..."

  HA_CONTAINER=""
  HA_NETWORK=""

  # Search for HA container by common names
  for pattern in homeassistant home-assistant hass hassio; do
    found=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i "$pattern" | head -1 || true)
    if [ -n "$found" ]; then
      HA_CONTAINER="$found"
      break
    fi
  done

  if [ -n "$HA_CONTAINER" ]; then
    echo "Found HA container: $HA_CONTAINER"

    # Get HA's network mode
    HA_NETWORK_MODE=$(docker inspect "$HA_CONTAINER" \
      --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || true)

    # Get the first custom (non-default) network
    HA_NETWORK=$(docker inspect "$HA_CONTAINER" \
      --format '{{range $net, $_ := .NetworkSettings.Networks}}{{$net}}{{"\n"}}{{end}}' 2>/dev/null \
      | grep -v '^bridge$' | grep -v '^host$' | grep -v '^none$' | head -1 || true)

    # Determine HA_URL and network strategy based on HA's network mode
    HOST_IP=$(hostname -I | awk '{print $1}')

    if [ "$HA_NETWORK_MODE" = "host" ] || [ -z "$HA_NETWORK" ]; then
      # HA uses host networking (common for HA Container installs).
      # The host network is special — other containers can't join it.
      # VioletDen reaches HA via the Docker gateway IP instead.
      DOCKER_GATEWAY=$(docker network inspect bridge \
        --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "$HOST_IP")

      echo "HA uses host networking — no network override needed"
      echo "VioletDen will reach HA via gateway: $DOCKER_GATEWAY"

      HA_URL_VALUE="http://${DOCKER_GATEWAY}:8123"

      # Generate a minimal override that just injects HA env vars
      NETWORK_OVERRIDE="docker-compose.ha.network.yml"
      cat > "$SCRIPT_DIR/$NETWORK_OVERRIDE" <<NETEOF
# Auto-generated by install.sh --ha
# HA uses host networking — no external network needed.
# VioletDen reaches HA via Docker gateway ($DOCKER_GATEWAY).

services:
  violetden-backend:
    environment:
      - HA_INTEGRATION=true
      - HA_URL=\${HA_URL:-${HA_URL_VALUE}}
NETEOF
      echo "Generated $NETWORK_OVERRIDE (HA env vars only, no network join)"

    else
      # HA uses a custom Docker network — join it
      echo "Found HA network: $HA_NETWORK"

      HA_URL_VALUE="http://${HA_CONTAINER}:8123"

      NETWORK_OVERRIDE="docker-compose.ha.network.yml"
      cat > "$SCRIPT_DIR/$NETWORK_OVERRIDE" <<NETEOF
# Auto-generated by install.sh --ha
# Connects VioletDen backend to HA's Docker network
# Network: $HA_NETWORK (from container: $HA_CONTAINER)

services:
  violetden-backend:
    networks:
      - default
      - ha_network
    environment:
      - HA_INTEGRATION=true
      - HA_URL=\${HA_URL:-${HA_URL_VALUE}}

networks:
  ha_network:
    external: true
    name: $HA_NETWORK
NETEOF
      echo "Generated $NETWORK_OVERRIDE (external network: $HA_NETWORK)"
    fi

    # Auto-configure HA_URL in .env if not already set
    CURRENT_HA_URL=$(grep -E '^HA_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
    if [ -z "$CURRENT_HA_URL" ] || echo "$CURRENT_HA_URL" | grep -q '<'; then
      if grep -qE '^#?\s*HA_URL=' "$ENV_FILE"; then
        sed -i.bak "s|^#\?\s*HA_URL=.*|HA_URL=${HA_URL_VALUE}|" "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
      else
        echo "HA_URL=${HA_URL_VALUE}" >> "$ENV_FILE"
      fi
      echo "Set HA_URL=${HA_URL_VALUE} in .env"
    fi

    # Ensure HA_INTEGRATION=true is set
    if ! grep -qE '^HA_INTEGRATION=true' "$ENV_FILE"; then
      if grep -qE '^#?\s*HA_INTEGRATION=' "$ENV_FILE"; then
        sed -i.bak "s|^#\?\s*HA_INTEGRATION=.*|HA_INTEGRATION=true|" "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
      else
        echo "HA_INTEGRATION=true" >> "$ENV_FILE"
      fi
      echo "Set HA_INTEGRATION=true in .env"
    fi
  else
    echo "Warning: No Home Assistant container found."
    echo "Searched for: homeassistant, home-assistant, hass, hassio"
    echo ""
    echo "Make sure HA is running, or manually configure:"
    echo "  1. Set HA_URL and HA_INTEGRATION=true in .env"
    echo "  2. Connect VioletDen backend to HA's Docker network"
  fi
fi

# ── Build compose command ────────────────────────────────────────────────────
COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
if [ -n "$NETWORK_OVERRIDE" ] && [ -f "$SCRIPT_DIR/$NETWORK_OVERRIDE" ]; then
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE -f $NETWORK_OVERRIDE"
fi

# ── Build images ─────────────────────────────────────────────────────────────
echo ""
echo "Building VioletDen Docker images..."
cd "$SCRIPT_DIR"

if ! BUILDX_NO_DEFAULT_ATTESTATIONS=1 $COMPOSE_CMD build; then
  echo "Error: Docker build failed."
  exit 1
fi

echo "Build complete."

# ── Stop existing service if running ─────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "Stopping existing $SERVICE_NAME service..."
  systemctl stop "$SERVICE_NAME"
fi

# ── Create systemd service ──────────────────────────────────────────────────
echo "Installing systemd service: $SERVICE_NAME"

# Build the compose args for the service file
COMPOSE_ARGS="-f ${COMPOSE_FILE}"
if [ -n "$NETWORK_OVERRIDE" ] && [ -f "$SCRIPT_DIR/$NETWORK_OVERRIDE" ]; then
  COMPOSE_ARGS="-f ${COMPOSE_FILE} -f ${NETWORK_OVERRIDE}"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VioletDen — Smart Home Dashboard
Documentation=https://github.com/askrejans/violet-den
After=network-online.target docker.service
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
EnvironmentFile=${ENV_FILE}

ExecStartPre=/usr/bin/docker compose ${COMPOSE_ARGS} down --remove-orphans
ExecStart=/usr/bin/docker compose ${COMPOSE_ARGS} up --remove-orphans
ExecStop=/usr/bin/docker compose ${COMPOSE_ARGS} down
ExecReload=/usr/bin/docker compose ${COMPOSE_ARGS} restart

Restart=on-failure
RestartSec=10
TimeoutStartSec=120
TimeoutStopSec=30

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

# ── Enable and start ─────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

HOST_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VioletDen installed and running!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  URL:     https://${HOST_IP}:${HTTPS_PORT}"
if [ "$HA_FLAG" = true ]; then
  if [ -n "$HA_NETWORK" ]; then
    echo "  HA:      Connected to HA network ($HA_NETWORK)"
  elif [ -n "$NETWORK_OVERRIDE" ]; then
    echo "  HA:      Reaching HA via Docker gateway (host network)"
  fi
  echo ""
  echo "  Add VioletDen to Home Assistant sidebar:"
  echo "    1. HACS → Custom repositories → add repo as Integration"
  echo "    2. Download VioletDen → restart HA"
  echo "    3. Settings → Devices & Services → Add Integration → VioletDen"
  echo "    4. Enter URL: https://${HOST_IP}:${HTTPS_PORT}"
fi
echo ""
echo "  Config:  ${ENV_FILE}"
echo "  Logs:    journalctl -u ${SERVICE_NAME} -f"
echo "  Status:  systemctl status ${SERVICE_NAME}"
echo "  Restart: systemctl restart ${SERVICE_NAME}"
echo "  Stop:    systemctl stop ${SERVICE_NAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
