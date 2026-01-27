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

docker build \
    -f docker/Dockerfile \
    -t "$TAG" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    .

echo ""
echo -e "${GREEN}Build complete!${NC}"
echo "Image: $TAG"
echo ""
echo "To run:"
echo "  docker run -p 3000:3000 --env-file docker/.env $TAG"
echo ""
echo "To push:"
echo "  docker tag $TAG your-registry/$TAG"
echo "  docker push your-registry/$TAG"
