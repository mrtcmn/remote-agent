#!/bin/bash
# Development environment script
# Usage: ./scripts/dev.sh [command]

set -e
cd "$(dirname "$0")/.."

COMPOSE_FILE="docker/docker-compose.dev.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check for .env file
if [ ! -f docker/.env ]; then
    echo -e "${YELLOW}No docker/.env file found. Creating from .env.example...${NC}"
    cp docker/.env.example docker/.env
    echo -e "${YELLOW}Please edit docker/.env with your API keys${NC}"
fi

# Load environment
set -a
source docker/.env 2>/dev/null || true
set +a

case "${1:-up}" in
    up|start)
        echo -e "${GREEN}Starting development environment...${NC}"
        docker compose -f "$COMPOSE_FILE" up -d
        echo ""
        echo -e "${GREEN}Development server running at:${NC}"
        echo "  API:       http://localhost:${PORT:-5100}"
        echo "  Health:    http://localhost:${PORT:-5100}/health"
        echo ""
        echo "Commands:"
        echo "  ./scripts/dev.sh logs    - View logs"
        echo "  ./scripts/dev.sh shell   - Open shell in container"
        echo "  ./scripts/dev.sh stop    - Stop the environment"
        ;;

    down|stop)
        echo -e "${YELLOW}Stopping development environment...${NC}"
        docker compose -f "$COMPOSE_FILE" down
        ;;

    restart)
        echo -e "${YELLOW}Restarting development environment...${NC}"
        docker compose -f "$COMPOSE_FILE" restart
        ;;

    logs)
        docker compose -f "$COMPOSE_FILE" logs -f --tail=100
        ;;

    shell|sh)
        echo -e "${GREEN}Opening shell in container...${NC}"
        docker compose -f "$COMPOSE_FILE" exec api bash
        ;;

    build)
        echo -e "${GREEN}Building development image (cached)...${NC}"
        docker compose -f "$COMPOSE_FILE" build
        ;;

    build:clean)
        echo -e "${YELLOW}Rebuilding development image from scratch...${NC}"
        docker compose -f "$COMPOSE_FILE" build --no-cache
        ;;

    install)
        echo -e "${GREEN}Installing dependencies in container...${NC}"
        docker compose -f "$COMPOSE_FILE" exec api bun install
        ;;

    db:migrate)
        echo -e "${GREEN}Running database migrations...${NC}"
        docker compose -f "$COMPOSE_FILE" exec api bun run --cwd packages/api db:migrate
        ;;

    db:studio)
        echo -e "${GREEN}Opening Drizzle Studio...${NC}"
        docker compose -f "$COMPOSE_FILE" exec api bun run --cwd packages/api db:studio
        ;;

    clean)
        echo -e "${YELLOW}Removing volumes and containers...${NC}"
        docker compose -f "$COMPOSE_FILE" down -v
        echo -e "${GREEN}Cleaned up!${NC}"
        ;;

    debug)
        echo -e "${GREEN}Starting with Bun debugger...${NC}"
        docker compose -f "$COMPOSE_FILE" run --rm -p 3000:3000 -p 6499:6499 api \
            bun --inspect=0.0.0.0:6499 run --watch --cwd packages/api src/index.ts
        ;;

    status)
        docker compose -f "$COMPOSE_FILE" ps
        ;;

    *)
        echo "Usage: $0 {up|down|restart|logs|shell|build|build:clean|install|db:migrate|db:studio|clean|debug|status}"
        echo ""
        echo "Commands:"
        echo "  up, start    - Start the development environment"
        echo "  down, stop   - Stop the development environment"
        echo "  restart      - Restart the environment"
        echo "  logs         - View container logs (follow mode)"
        echo "  shell, sh    - Open bash shell in container"
        echo "  build        - Build image (uses cache)"
        echo "  build:clean  - Rebuild image from scratch (no cache)"
        echo "  install      - Run bun install in container"
        echo "  db:migrate   - Run database migrations"
        echo "  db:studio    - Open Drizzle Studio"
        echo "  clean        - Remove containers and volumes"
        echo "  debug        - Start with Bun inspector for debugging"
        echo "  status       - Show container status"
        exit 1
        ;;
esac
