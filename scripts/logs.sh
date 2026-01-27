#!/bin/bash
# View container logs
# Usage: ./scripts/logs.sh [dev|prod] [lines]

set -e
cd "$(dirname "$0")/.."

ENV="${1:-dev}"
LINES="${2:-100}"

if [ "$ENV" = "dev" ]; then
    docker compose -f docker/docker-compose.dev.yml logs -f --tail="$LINES"
else
    docker compose -f docker/docker-compose.yml logs -f --tail="$LINES"
fi
