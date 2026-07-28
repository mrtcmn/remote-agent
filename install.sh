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

rand_hex() {
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
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
APP_URL=${APP_URL}
NODE_ENV=production
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

# Start services
echo ""
log_info "Starting Remote Agent..."
docker compose up -d

# Wait for health check
log_info "Waiting for service to be ready..."
MAX_ATTEMPTS=60
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    if curl -sf http://localhost:5100/health > /dev/null 2>&1; then
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
        if curl -sf -c "$COOKIE_JAR" -X POST http://localhost:5100/api/auth/sign-in/email \
            -H 'Content-Type: application/json' \
            -d '{"email":"test@t.com","password":"123456"}' > /dev/null 2>&1; then
            SIGNED_IN=1
            break
        fi
        sleep 2
    done

    if [ -n "$SIGNED_IN" ]; then
        PAIR_RESP=$(curl -s -b "$COOKIE_JAR" -X POST http://localhost:5100/api/paired-masters \
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
echo "  URL:       http://localhost:5100"
echo ""
echo "Quick Start:"
echo "  1. Open http://localhost:5100 in your browser"
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
echo ""
