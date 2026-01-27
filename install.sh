#!/bin/bash
# Remote Agent Installation Script
# Run with: curl -fsSL https://your-repo/install.sh | bash

set -e

INSTALL_DIR="${INSTALL_DIR:-$HOME/remote-agent}"
REPO_URL="${REPO_URL:-https://github.com/yourorg/remote-agent}"

echo "🚀 Remote Agent Installation"
echo "============================"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "📦 Docker not found. Installing..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "⚠️  Please log out and back in, then run this script again."
    exit 0
fi

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    echo "📦 Docker Compose not found. Installing..."
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
fi

# Create installation directory
echo "📁 Creating installation directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Download docker-compose.yml if not exists
if [ ! -f docker-compose.yml ]; then
    echo "📥 Downloading configuration..."
    curl -fsSL "$REPO_URL/raw/main/docker/docker-compose.yml" -o docker-compose.yml
fi

# Setup environment file
if [ ! -f .env ]; then
    echo ""
    echo "🔧 Setting up environment..."
    echo ""

    read -p "Enter ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
    read -p "Enter GITHUB_CLIENT_ID (for OAuth): " GITHUB_CLIENT_ID
    read -p "Enter GITHUB_CLIENT_SECRET: " GITHUB_CLIENT_SECRET

    echo ""
    read -p "Setup Firebase Push Notifications? (y/n): " SETUP_FIREBASE

    FIREBASE_PROJECT_ID=""
    FIREBASE_PRIVATE_KEY=""
    FIREBASE_CLIENT_EMAIL=""

    if [ "$SETUP_FIREBASE" = "y" ]; then
        read -p "Enter FIREBASE_PROJECT_ID: " FIREBASE_PROJECT_ID
        read -p "Enter FIREBASE_CLIENT_EMAIL: " FIREBASE_CLIENT_EMAIL
        echo "Enter FIREBASE_PRIVATE_KEY (paste and press Ctrl+D):"
        FIREBASE_PRIVATE_KEY=$(cat)
    fi

    # Generate JWT secret
    JWT_SECRET=$(openssl rand -hex 32)

    cat > .env << EOF
# Required
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY

# GitHub OAuth
GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET

# Security
JWT_SECRET=$JWT_SECRET

# Firebase (optional)
FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID
FIREBASE_PRIVATE_KEY=$FIREBASE_PRIVATE_KEY
FIREBASE_CLIENT_EMAIL=$FIREBASE_CLIENT_EMAIL

# App
PORT=5100
APP_URL=http://localhost:5100
NODE_ENV=production
EOF

    echo ""
    echo "✅ Environment file created"
fi

# Create config directories
mkdir -p config/skills config/hooks

# Pull and start
echo ""
echo "🐳 Starting Remote Agent..."
docker compose pull || docker compose build
docker compose up -d

# Wait for health check
echo ""
echo "⏳ Waiting for service to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:5100/health > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

echo ""
echo "✅ Remote Agent is running!"
echo ""
echo "📍 Access URL: http://localhost:5100"
echo ""
echo "📚 Quick Start:"
echo "   1. Open http://localhost:5100 in your browser"
echo "   2. Login with GitHub"
echo "   3. Set up a PIN for extra security"
echo "   4. Create a project and start coding!"
echo ""
echo "🔧 Management commands:"
echo "   cd $INSTALL_DIR"
echo "   docker compose logs -f     # View logs"
echo "   docker compose restart     # Restart"
echo "   docker compose down        # Stop"
echo "   docker compose pull && docker compose up -d  # Update"
echo ""
