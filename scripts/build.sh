#!/bin/bash
# Build production Docker image
# Usage: ./scripts/build.sh [tag]

set -e
cd "$(dirname "$0")/.."

TAG="${1:-remote-agent:latest}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Building production image: ${TAG}${NC}"

# Derive version from git: tag if on one, otherwise short SHA
VERSION=$(git describe --tags --always 2>/dev/null || echo "dev")
echo -e "${YELLOW}Version: ${VERSION}${NC}"

# Build with BuildKit.
# --no-cache-filter=app  → the "app" stage always runs fresh (deps + source + build)
# The "infra" stage (system deps, gh, claude) stays cached across builds.
DOCKER_BUILDKIT=1 docker build \
    -f docker/Dockerfile \
    -t "$TAG" \
    --build-arg VERSION="$VERSION" \
    --no-cache-filter=app \
    .

echo ""
echo -e "${GREEN}Build complete!${NC}"
echo "Image: $TAG"
echo ""
echo "To run:"
echo "  docker run -p 3000:3000 --env-file docker/.env $TAG"
echo ""
echo "To push:"
echo "  docker tag $TAG ghcr.io/mrtcmn/remote-agent:$VERSION"
echo "  docker push ghcr.io/mrtcmn/remote-agent:$VERSION"
