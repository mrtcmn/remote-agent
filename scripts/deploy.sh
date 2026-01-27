#!/bin/bash
# Deploy production container
# Usage: ./scripts/deploy.sh [environment]

set -e
cd "$(dirname "$0")/.."

ENV="${1:-production}"
COMPOSE_FILE="docker/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Deploying to ${ENV}...${NC}"

# Check for required environment variables
if [ ! -f docker/.env ]; then
    echo -e "${RED}Error: docker/.env file not found${NC}"
    echo "Copy docker/.env.example to docker/.env and configure it"
    exit 1
fi

# Load and validate environment
set -a
source docker/.env
set +a

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${RED}Error: ANTHROPIC_API_KEY is required${NC}"
    exit 1
fi

if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "generate_a_random_32_byte_hex_string" ]; then
    echo -e "${YELLOW}Generating secure JWT_SECRET...${NC}"
    JWT_SECRET=$(openssl rand -hex 32)
    echo "JWT_SECRET=$JWT_SECRET" >> docker/.env
fi

# Build and deploy
echo -e "${GREEN}Building production image...${NC}"
docker compose -f "$COMPOSE_FILE" build

echo -e "${GREEN}Starting production services...${NC}"
docker compose -f "$COMPOSE_FILE" up -d

# Wait for health check
echo -e "${YELLOW}Waiting for service to be healthy...${NC}"
for i in {1..30}; do
    if curl -sf http://localhost:${PORT:-5100}/health > /dev/null 2>&1; then
        echo -e "${GREEN}Service is healthy!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Service failed to become healthy${NC}"
        docker compose -f "$COMPOSE_FILE" logs --tail=50
        exit 1
    fi
    sleep 2
done

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "Service running at: http://localhost:${PORT:-5100}"
echo ""
echo "Useful commands:"
echo "  docker compose -f $COMPOSE_FILE logs -f    # View logs"
echo "  docker compose -f $COMPOSE_FILE down       # Stop service"
echo "  docker compose -f $COMPOSE_FILE restart    # Restart service"
