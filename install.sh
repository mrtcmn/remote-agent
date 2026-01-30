#!/bin/bash
# Remote Agent Installation Script
# Run with: curl -fsSL https://raw.githubusercontent.com/yourorg/remote-agent/main/install.sh | bash

set -e

# Configuration
INSTALL_DIR="${INSTALL_DIR:-/opt/remote-agent}"
REGISTRY="ghcr.io"
IMAGE_NAME="${IMAGE_NAME:-yourorg/remote-agent}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
GITHUB_REPO="${GITHUB_REPO:-yourorg/remote-agent}"
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

# Check if running as root for /opt installation
if [ "$INSTALL_DIR" = "/opt/remote-agent" ] && [ "$EUID" -ne 0 ]; then
    log_error "Installing to /opt requires root privileges."
    log_info "Run with: sudo bash install.sh"
    log_info "Or set custom directory: INSTALL_DIR=~/remote-agent bash install.sh"
    exit 1
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

    # Database password
    POSTGRES_PASSWORD=$(openssl rand -hex 16)

    # Prompt for required values
    read -p "Enter ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        log_error "ANTHROPIC_API_KEY is required"
        exit 1
    fi

    read -p "Enter GITHUB_CLIENT_ID (for OAuth): " GITHUB_CLIENT_ID
    if [ -z "$GITHUB_CLIENT_ID" ]; then
        log_error "GITHUB_CLIENT_ID is required"
        exit 1
    fi

    read -p "Enter GITHUB_CLIENT_SECRET: " GITHUB_CLIENT_SECRET
    if [ -z "$GITHUB_CLIENT_SECRET" ]; then
        log_error "GITHUB_CLIENT_SECRET is required"
        exit 1
    fi

    echo ""
    read -p "Setup Firebase Push Notifications? (y/n) [n]: " SETUP_FIREBASE
    SETUP_FIREBASE=${SETUP_FIREBASE:-n}

    FIREBASE_PROJECT_ID=""
    FIREBASE_PRIVATE_KEY=""
    FIREBASE_CLIENT_EMAIL=""

    if [ "$SETUP_FIREBASE" = "y" ] || [ "$SETUP_FIREBASE" = "Y" ]; then
        read -p "Enter FIREBASE_PROJECT_ID: " FIREBASE_PROJECT_ID
        read -p "Enter FIREBASE_CLIENT_EMAIL: " FIREBASE_CLIENT_EMAIL
        echo "Enter FIREBASE_PRIVATE_KEY (paste and press Ctrl+D):"
        FIREBASE_PRIVATE_KEY=$(cat)
    fi

    # Generate JWT secret
    JWT_SECRET=$(openssl rand -hex 32)

    # Get external IP or use localhost
    EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || echo "localhost")
    read -p "Enter APP_URL [http://${EXTERNAL_IP}:5100]: " APP_URL
    APP_URL=${APP_URL:-"http://${EXTERNAL_IP}:5100"}

    cat > .env << EOF
# Remote Agent Configuration
# Generated on $(date)

# Docker Image
IMAGE_TAG=${IMAGE_TAG}

# Database
POSTGRES_USER=agent
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=remote_agent

# Required API Keys
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

# GitHub OAuth
GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}

# Security
JWT_SECRET=${JWT_SECRET}

# Firebase Push Notifications (optional)
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
FIREBASE_PRIVATE_KEY=${FIREBASE_PRIVATE_KEY}
FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL}

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
echo "  2. Login with GitHub"
echo "  3. Set up a PIN for extra security"
echo "  4. Create a project and start coding!"
echo ""
echo "Management Commands:"
echo "  cd ${INSTALL_DIR}"
echo "  ./upgrade.sh              # Check for and install updates"
echo "  ./upgrade.sh --check      # Check for updates only"
echo "  docker compose logs -f    # View logs"
echo "  docker compose restart    # Restart services"
echo "  docker compose down       # Stop services"
echo ""
