# Remote Agent - Development & Deployment Commands
# Usage: make [command]

.PHONY: help dev dev-stop dev-logs dev-shell dev-build dev-build-clean dev-clean dev-debug \
        build deploy logs status install db-migrate db-studio

# Default target
help:
	@echo "Remote Agent - Available Commands"
	@echo ""
	@echo "Development:"
	@echo "  make dev          - Start dev environment with hot-reload"
	@echo "  make dev-stop     - Stop dev environment"
	@echo "  make dev-logs     - View dev logs"
	@echo "  make dev-shell    - Open shell in dev container"
	@echo "  make dev-build    - Build dev image (cached)"
	@echo "  make dev-build-clean - Rebuild from scratch (no cache)"
	@echo "  make dev-clean    - Remove dev containers and volumes"
	@echo "  make dev-debug    - Start with Bun debugger (port 6499)"
	@echo ""
	@echo "Production:"
	@echo "  make build        - Build production image"
	@echo "  make deploy       - Deploy production"
	@echo "  make logs         - View production logs"
	@echo "  make status       - Show container status"
	@echo ""
	@echo "Database:"
	@echo "  make db-migrate   - Run database migrations"
	@echo "  make db-studio    - Open Drizzle Studio"
	@echo ""
	@echo "Setup:"
	@echo "  make install      - Install dependencies in container"

# Development commands
dev:
	@./scripts/dev.sh up

dev-stop:
	@./scripts/dev.sh stop

dev-logs:
	@./scripts/dev.sh logs

dev-shell:
	@./scripts/dev.sh shell

dev-build:
	@./scripts/dev.sh build

dev-build-clean:
	@./scripts/dev.sh build:clean

dev-clean:
	@./scripts/dev.sh clean

dev-debug:
	@./scripts/dev.sh debug

# Production commands
build:
	@./scripts/build.sh

deploy:
	@./scripts/deploy.sh

logs:
	@./scripts/logs.sh prod

status:
	@docker compose -f docker/docker-compose.yml ps
	@docker compose -f docker/docker-compose.dev.yml ps

# Database commands
db-migrate:
	@./scripts/dev.sh db:migrate

db-studio:
	@./scripts/dev.sh db:studio

# Setup
install:
	@./scripts/dev.sh install
