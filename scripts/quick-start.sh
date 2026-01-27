#!/bin/bash
# Quick start script for new developers
# Usage: ./scripts/quick-start.sh

set -e
cd "$(dirname "$0")/.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "=================================="
echo "  Remote Agent - Quick Start"
echo "=================================="
echo -e "${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker from https://docker.com"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    echo "Please start Docker Desktop"
    exit 1
fi

echo -e "${GREEN}[1/4] Docker is running${NC}"

# Create .env file
if [ ! -f docker/.env ]; then
    echo -e "${YELLOW}[2/4] Creating docker/.env file...${NC}"
    cp docker/.env.example docker/.env

    echo ""
    echo -e "${YELLOW}Please configure your environment:${NC}"
    echo ""

    # Prompt for API key
    read -p "Enter your ANTHROPIC_API_KEY: " api_key
    if [ -n "$api_key" ]; then
        sed -i.bak "s/your_anthropic_api_key/$api_key/" docker/.env
        rm -f docker/.env.bak
    fi

    # Generate JWT secret
    jwt_secret=$(openssl rand -hex 32)
    sed -i.bak "s/generate_a_random_32_byte_hex_string/$jwt_secret/" docker/.env
    rm -f docker/.env.bak

    echo -e "${GREEN}Environment configured!${NC}"
else
    echo -e "${GREEN}[2/4] Environment file exists${NC}"
fi

# Build dev image
echo -e "${YELLOW}[3/4] Building development image...${NC}"
docker compose -f docker/docker-compose.dev.yml build

# Start services
echo -e "${YELLOW}[4/4] Starting development environment...${NC}"
docker compose -f docker/docker-compose.dev.yml up -d

# Wait for healthy
echo -e "${YELLOW}Waiting for service to start...${NC}"
sleep 5

for i in {1..20}; do
    if curl -sf http://localhost:5100/health > /dev/null 2>&1; then
        break
    fi
    sleep 2
done

echo ""
echo -e "${GREEN}=================================="
echo "  Setup Complete!"
echo "==================================${NC}"
echo ""
echo "Your development environment is running:"
echo ""
echo "  API:        http://localhost:5100"
echo "  Health:     http://localhost:5100/health"
echo "  Debug Port: 6499 (for VS Code attach)"
echo ""
echo "Useful commands:"
echo "  make dev-logs    - View logs"
echo "  make dev-shell   - Open shell in container"
echo "  make dev-stop    - Stop environment"
echo "  make dev-debug   - Start with debugger"
echo ""
echo "Or use scripts directly:"
echo "  ./scripts/dev.sh logs"
echo "  ./scripts/dev.sh shell"
echo ""
