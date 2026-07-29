#!/bin/bash
# Remote Agent Installation Script
# Run with: curl -fsSL https://raw.githubusercontent.com/mrtcmn/remote-agent/main/install.sh | bash

set -e

# Configuration
INSTALL_DIR="${INSTALL_DIR:-/opt/remote-agent}"
REGISTRY="ghcr.io"
IMAGE_NAME="${IMAGE_NAME:-mrtcmn/remote-agent}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
GITHUB_REPO="${GITHUB_REPO:-mrtcmn/remote-agent}"
REPO_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/main"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo ""
echo "========================================"
echo "    Remote Agent Installation"
echo "========================================"
echo ""

# Fall back to home directory when not root (no sudo required)
if [ "$INSTALL_DIR" = "/opt/remote-agent" ] && [ "$EUID" -ne 0 ]; then
    INSTALL_DIR="$HOME/remote-agent"
    log_warn "Not running as root — installing to $INSTALL_DIR"
fi

# Prompt helper: works under `curl | bash` (reads /dev/tty), silently
# falls back to empty (=defaults) when no terminal is attached.
prompt() {
    local ans=""
    if [ -z "${NONINTERACTIVE:-}" ] && [ -r /dev/tty ]; then
        read -r -p "$1" ans < /dev/tty || true
    fi
    echo "$ans"
}

# --uninstall / -u / UNINSTALL=1: stop and remove containers, optionally
# wipe data volumes and the install directory. Exits before touching
# anything else.
if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "-u" ] || [ -n "${UNINSTALL:-}" ]; then
    if [ ! -d "$INSTALL_DIR" ] || [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
        log_error "No installation found at $INSTALL_DIR (set INSTALL_DIR=... if it's elsewhere)"
        exit 1
    fi
    cd "$INSTALL_DIR"
    log_warn "This stops and removes the Remote Agent containers at $INSTALL_DIR."
    RM_VOLUMES="$(prompt 'Also delete data (database, isolated-mode workspaces)? [y/N]: ')"
    RM_DIR="$(prompt "Also delete the install directory ($INSTALL_DIR)? [y/N]: ")"
    case "$RM_VOLUMES" in
        y|Y|yes) docker compose down -v --remove-orphans; log_warn "Containers and volumes removed." ;;
        *) docker compose down --remove-orphans; log_success "Containers removed (data volumes kept)." ;;
    esac
    case "$RM_DIR" in
        y|Y|yes) cd /; rm -rf "$INSTALL_DIR"; log_success "Removed $INSTALL_DIR" ;;
    esac
    log_success "Uninstall complete."
    exit 0
fi

rand_hex() {
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Port pre-flight: detect a busy host port and offer the next free one
# instead of letting `docker compose up` fail after everything else ran.
port_in_use() {
    if command -v ss &> /dev/null; then
        ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$1\$"
    elif command -v lsof &> /dev/null; then
        lsof -iTCP:"$1" -sTCP:LISTEN &> /dev/null
    else
        (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3<&-; exec 3>&-; return 0; } || return 1
    fi
}

next_free_port() {
    local p=$1
    while port_in_use "$p"; do p=$((p + 1)); done
    echo "$p"
}

# $1 = port var name, $2 = human label. Reads/writes the named var in place.
ensure_port_free() {
    local var="$1" label="$2" cur="${!1}"
    while port_in_use "$cur"; do
        local suggestion ans
        suggestion=$(next_free_port "$cur")
        log_warn "Port $cur ($label) is already in use."
        ans="$(prompt "Use port $suggestion instead? [Y/n, or type a port]: ")"
        case "$ans" in
            n|N|no) log_warn "Continuing with $cur anyway — container may fail to start."; break ;;
            ""|y|Y|yes) cur="$suggestion" ;;
            *) cur="$ans" ;;
        esac
    done
    eval "$var=\"\$cur\""
}

# Machine role: a master hosts sessions and is driven by paired machines; a
# connector pairs to an existing master and drives it from its own UI.
# Auth on a connector comes from the master via the pairing token — no
# credentials are asked here.
ROLE="${ROLE:-}"
if [ -z "$ROLE" ]; then
    echo ""
    echo "How will this machine be used?"
    echo "  1) master    — hosts sessions, other machines pair to it (needs a reachable URL)"
    echo "  2) connector — pairs to an existing master and controls it from here"
    ROLE_CHOICE="$(prompt 'Select role [1]: ')"
    case "$ROLE_CHOICE" in
        2|connector) ROLE="connector" ;;
        *) ROLE="master" ;;
    esac
fi

MASTER_URL="${MASTER_URL:-}"
PAIRING_TOKEN="${PAIRING_TOKEN:-}"
if [ "$ROLE" = "connector" ]; then
    if [ -z "$MASTER_URL" ]; then
        MASTER_URL="$(prompt 'Master URL (e.g. https://master.example.com): ')"
    fi
    if [ -z "$PAIRING_TOKEN" ]; then
        PAIRING_TOKEN="$(prompt 'Pairing token (rapt_..., from master Settings > Paired secondaries): ')"
    fi
    if [ -z "$MASTER_URL" ] || [ -z "$PAIRING_TOKEN" ]; then
        log_warn "No master URL/token given — install continues, pair later in Settings > Paired masters."
    fi
fi

# Check Docker
log_info "Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    log_warn "Docker not found. Installing..."
    curl -fsSL https://get.docker.com | sh
    if [ "$EUID" -ne 0 ]; then
        sudo usermod -aG docker "$USER"
        log_warn "Please log out and back in, then run this script again."
        exit 0
    fi
fi
log_success "Docker is installed"

# Check Docker Compose
log_info "Checking Docker Compose..."
if ! docker compose version &> /dev/null; then
    log_warn "Docker Compose not found. Installing..."
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y docker-compose-plugin
    else
        log_error "Please install Docker Compose manually"
        exit 1
    fi
fi
log_success "Docker Compose is installed"

# Create installation directories
log_info "Creating installation directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"/{workspaces,ssh-keys,backups,config/skills,config/hooks}

cd "$INSTALL_DIR"

# Download docker-compose.yml
log_info "Downloading configuration files..."
curl -fsSL "${REPO_URL}/docker/docker-compose.prod.yml" -o docker-compose.yml

# Download upgrade script
curl -fsSL "${REPO_URL}/scripts/upgrade.sh" -o upgrade.sh
chmod +x upgrade.sh

# Save this installer too, so `./install.sh --uninstall` works later
# without re-curling
curl -fsSL "${REPO_URL}/install.sh" -o install.sh
chmod +x install.sh

log_success "Configuration files downloaded"

# Setup environment file
if [ ! -f .env ]; then
    echo ""
    log_info "Setting up environment configuration..."
    echo ""

    # Generated secrets
    POSTGRES_PASSWORD=$(rand_hex 16)
    JWT_SECRET=$(rand_hex 32)

    # GitHub OAuth is optional — email/password login works out of the box.
    # Connectors skip these prompts entirely: they sit behind NAT and get
    # their identity from the master via the pairing token.
    if [ "$ROLE" = "master" ]; then
        GITHUB_CLIENT_ID="${GITHUB_CLIENT_ID:-$(prompt 'GITHUB_CLIENT_ID (optional, Enter to skip): ')}"
        if [ -n "$GITHUB_CLIENT_ID" ] && [ -z "${GITHUB_CLIENT_SECRET:-}" ]; then
            GITHUB_CLIENT_SECRET="$(prompt 'GITHUB_CLIENT_SECRET: ')"
        fi

        # Get external IP or use localhost
        EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || echo "localhost")
        if [ -z "${APP_URL:-}" ]; then
            APP_URL="$(prompt "APP_URL [http://${EXTERNAL_IP}:5100]: ")"
            APP_URL=${APP_URL:-"http://${EXTERNAL_IP}:5100"}
        fi
    else
        APP_URL="${APP_URL:-http://localhost:5100}"
    fi

    # Firebase push notifications: optional, env-only (FIREBASE_* vars)

    # Where Claude's session files (workspaces, ssh keys) live
    if [ -z "${WORKSPACES_SRC:-}" ]; then
        echo ""
        echo "Where should Claude's workspace/project files live?"
        echo "  1) Host directory — ${INSTALL_DIR}/workspaces, directly browsable/editable from the host (default)"
        echo "  2) Isolated Docker volume — sandboxed, not directly accessible on the host"
        STORAGE_CHOICE="$(prompt 'Select [1]: ')"
        case "$STORAGE_CHOICE" in
            2|volume|isolated)
                WORKSPACES_SRC="workspaces"
                SSH_KEYS_SRC="ssh-keys"
                ;;
            *)
                WORKSPACES_SRC="./workspaces"
                SSH_KEYS_SRC="./ssh-keys"
                ;;
        esac
    fi

    # Which interface the app port (5100) binds to on the host
    if [ -z "${BIND_HOST:-}" ]; then
        echo ""
        echo "Bind the app port (5100) to which address?"
        echo "  1) 127.0.0.1 — localhost only, put a reverse proxy in front (default)"
        echo "  2) 0.0.0.0   — all interfaces, reachable directly from the network"
        echo "  3) custom IP"
        BIND_CHOICE="$(prompt 'Select [1]: ')"
        case "$BIND_CHOICE" in
            2|0.0.0.0) BIND_HOST="0.0.0.0" ;;
            3|custom) BIND_HOST="$(prompt 'Bind IP: ')" ;;
            *) BIND_HOST="127.0.0.1" ;;
        esac
    fi

    cat > .env << EOF
# Remote Agent Configuration
# Generated on $(date)

# Docker Image
IMAGE_TAG=${IMAGE_TAG}

# Database
POSTGRES_USER=agent
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=remote_agent

# GitHub OAuth (optional — email/password login works without it)
GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID:-}
GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET:-}

# Security
JWT_SECRET=${JWT_SECRET}

# Firebase Push Notifications (optional)
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-}
FIREBASE_PRIVATE_KEY=${FIREBASE_PRIVATE_KEY:-}
FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL:-}

# Application
PORT=5100
BIND_HOST=${BIND_HOST}
APP_URL=${APP_URL}
NODE_ENV=production

# Storage
WORKSPACES_SRC=${WORKSPACES_SRC}
SSH_KEYS_SRC=${SSH_KEYS_SRC}
EOF

    chmod 600 .env
    log_success "Environment configuration created"
else
    log_info "Using existing .env file"
fi

# Pull Docker image
echo ""
log_info "Pulling Docker image: ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
docker pull "${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
log_success "Docker image pulled"

# Tear down any existing/stale containers first — both so the port check
# below isn't fooled by our own old containers still holding the ports, and
# so a broken container from a prior failed run gets fully recreated.
docker compose down --remove-orphans 2>/dev/null || true

# Check the ports we're about to bind — every run, not just first install,
# since another container (e.g. something already using 8080) can show up later.
log_info "Checking required ports are free..."
PORT="$(grep -m1 '^PORT=' .env 2>/dev/null | cut -d= -f2)"
PORT="${PORT:-5100}"
CODE_SERVER_PORT="$(grep -m1 '^CODE_SERVER_PORT=' .env 2>/dev/null | cut -d= -f2)"
CODE_SERVER_PORT="${CODE_SERVER_PORT:-8080}"
ensure_port_free PORT "app UI"
ensure_port_free CODE_SERVER_PORT "code-server"
grep -v '^PORT=\|^CODE_SERVER_PORT=' .env > .env.tmp || true
{
    cat .env.tmp
    echo "PORT=${PORT}"
    echo "CODE_SERVER_PORT=${CODE_SERVER_PORT}"
} > .env
rm -f .env.tmp
chmod 600 .env
log_success "Ports OK (app: ${PORT}, code-server: ${CODE_SERVER_PORT})"

# Start services
echo ""
log_info "Starting Remote Agent..."
docker compose up -d --remove-orphans

# Wait for health check
log_info "Waiting for service to be ready..."
MAX_ATTEMPTS=60
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
        break
    fi
    sleep 2
    ((ATTEMPT++))
done

if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
    log_error "Service failed to start. Check logs with: docker compose logs"
    exit 1
fi

# Auto-pair connector with its master using the seeded local account —
# identity on the master side comes from the pairing token, so no
# credentials are ever asked.
PAIRED=""
if [ "$ROLE" = "connector" ] && [ -n "$MASTER_URL" ] && [ -n "$PAIRING_TOKEN" ]; then
    log_info "Pairing with master ${MASTER_URL}..."
    COOKIE_JAR=$(mktemp)
    SIGNED_IN=""
    # Seed user is created shortly after boot — retry sign-in briefly
    for _ in 1 2 3 4 5; do
        if curl -sf -c "$COOKIE_JAR" -X POST "http://localhost:${PORT}/api/auth/sign-in/email" \
            -H 'Content-Type: application/json' \
            -d '{"email":"test@t.com","password":"123456"}' > /dev/null 2>&1; then
            SIGNED_IN=1
            break
        fi
        sleep 2
    done

    if [ -n "$SIGNED_IN" ]; then
        PAIR_RESP=$(curl -s -b "$COOKIE_JAR" -X POST "http://localhost:${PORT}/api/paired-masters" \
            -H 'Content-Type: application/json' \
            -d "{\"url\":\"${MASTER_URL}\",\"token\":\"${PAIRING_TOKEN}\",\"name\":\"$(hostname 2>/dev/null || echo connector)\"}")
        if echo "$PAIR_RESP" | grep -q '"master"'; then
            PAIRED=1
            log_success "Paired with master ${MASTER_URL}"
        else
            log_warn "Auto-pair failed: ${PAIR_RESP}"
        fi
    else
        log_warn "Could not sign in to local instance for pairing."
    fi
    rm -f "$COOKIE_JAR"

    if [ -z "$PAIRED" ]; then
        log_info "Pair manually: Settings > Paired masters (token is single-use — generate a fresh one on the master if needed)"
    fi
fi

# Get current version
CURRENT_VERSION=$(docker exec remote-agent printenv APP_VERSION 2>/dev/null || echo "latest")

echo ""
echo "========================================"
log_success "Remote Agent installed successfully!"
echo "========================================"
echo ""
echo "  Version:   ${CURRENT_VERSION}"
echo "  Location:  ${INSTALL_DIR}"
echo "  URL:       http://localhost:${PORT}"
echo ""
echo "Quick Start:"
echo "  1. Open http://localhost:${PORT} in your browser"
if [ -n "${GITHUB_CLIENT_ID:-}" ]; then
    echo "  2. Login with GitHub"
else
    echo "  2. Login with test@t.com / 123456 (change it after first login)"
fi
if [ "$ROLE" = "connector" ]; then
    if [ -n "$PAIRED" ]; then
        echo "  3. Your master's sessions appear in the sidebar (machine switcher)"
    else
        echo "  3. Finish pairing: Settings > Paired masters"
    fi
else
    echo "  3. Set up a PIN for extra security"
    echo "  4. To control this machine from another PC: Settings > Paired secondaries"
    echo "     > Generate pairing token, then install with role 'connector' there."
fi
echo ""
echo "Management Commands:"
echo "  cd ${INSTALL_DIR}"
echo "  ./upgrade.sh              # Check for and install updates"
echo "  ./upgrade.sh --check      # Check for updates only"
echo "  docker compose logs -f    # View logs"
echo "  docker compose restart    # Restart services"
echo "  docker compose down       # Stop services"
echo "  ./install.sh --uninstall  # Remove Remote Agent"
echo ""
