#!/bin/bash
# Remote Agent Upgrade Script
# Handles version checking, database backup, and safe upgrades with rollback

set -e

# Configuration
INSTALL_DIR="${INSTALL_DIR:-/opt/remote-agent}"
BACKUP_DIR="${INSTALL_DIR}/backups"
BACKUP_RETENTION=3
REGISTRY="ghcr.io"
IMAGE_NAME="${IMAGE_NAME:-yourorg/remote-agent}"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"
GITHUB_REPO="${GITHUB_REPO:-yourorg/remote-agent}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
CHECK_ONLY=false
FORCE=false
TARGET_VERSION=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --version)
            TARGET_VERSION="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: upgrade.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --check           Check for updates without upgrading"
            echo "  --force           Skip confirmation prompt"
            echo "  --version VERSION Upgrade to specific version (e.g., v1.2.3)"
            echo "  -h, --help        Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get current version from running container
get_current_version() {
    local version
    version=$(docker exec remote-agent printenv APP_VERSION 2>/dev/null || echo "unknown")
    echo "$version"
}

# Get latest version from GitHub Releases API
get_latest_version() {
    local response
    response=$(curl -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest")

    if echo "$response" | grep -q "Not Found"; then
        echo ""
        return 1
    fi

    echo "$response" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/"tag_name": *"//;s/"//'
}

# Get release info from GitHub
get_release_info() {
    local version="$1"
    curl -s "https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${version}"
}

# Compare versions (returns 0 if $1 < $2, 1 if $1 >= $2)
version_lt() {
    [ "$1" = "$(echo -e "$1\n$2" | sort -V | head -n1)" ] && [ "$1" != "$2" ]
}

# Create database backup
create_backup() {
    local current_version="$1"
    local timestamp
    timestamp=$(date +%Y-%m-%d_%H%M%S)
    local backup_file="${BACKUP_DIR}/${timestamp}_${current_version}.sql.gz"

    mkdir -p "$BACKUP_DIR"

    log_info "Creating database backup..."

    # Get database credentials from .env
    source "${INSTALL_DIR}/.env"

    docker exec remote-agent-db pg_dump \
        -U "${POSTGRES_USER:-agent}" \
        "${POSTGRES_DB:-remote_agent}" \
        | gzip > "$backup_file"

    if [ $? -eq 0 ]; then
        log_success "Backup created: $backup_file"
        echo "$backup_file"
    else
        log_error "Failed to create backup"
        return 1
    fi
}

# Restore database from backup
restore_backup() {
    local backup_file="$1"

    log_info "Restoring database from backup: $backup_file"

    source "${INSTALL_DIR}/.env"

    # Drop and recreate database
    docker exec remote-agent-db psql \
        -U "${POSTGRES_USER:-agent}" \
        -d postgres \
        -c "DROP DATABASE IF EXISTS ${POSTGRES_DB:-remote_agent};"

    docker exec remote-agent-db psql \
        -U "${POSTGRES_USER:-agent}" \
        -d postgres \
        -c "CREATE DATABASE ${POSTGRES_DB:-remote_agent};"

    # Restore from backup
    gunzip -c "$backup_file" | docker exec -i remote-agent-db psql \
        -U "${POSTGRES_USER:-agent}" \
        "${POSTGRES_DB:-remote_agent}"

    if [ $? -eq 0 ]; then
        log_success "Database restored successfully"
    else
        log_error "Failed to restore database"
        return 1
    fi
}

# Cleanup old backups, keep last N
cleanup_backups() {
    log_info "Cleaning up old backups (keeping last ${BACKUP_RETENTION})..."

    cd "$BACKUP_DIR" 2>/dev/null || return 0

    ls -t *.sql.gz 2>/dev/null | tail -n +$((BACKUP_RETENTION + 1)) | xargs -r rm -f
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."

    docker exec remote-agent bun run db:migrate

    if [ $? -eq 0 ]; then
        log_success "Migrations completed successfully"
    else
        log_error "Migration failed"
        return 1
    fi
}

# Health check
check_health() {
    log_info "Running health check..."

    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -sf http://localhost:5100/health > /dev/null 2>&1; then
            log_success "Health check passed"
            return 0
        fi

        sleep 2
        ((attempt++))
    done

    log_error "Health check failed after $max_attempts attempts"
    return 1
}

# Main upgrade flow
main() {
    echo ""
    echo "========================================"
    echo "     Remote Agent Upgrade Script"
    echo "========================================"
    echo ""

    cd "$INSTALL_DIR" || {
        log_error "Install directory not found: $INSTALL_DIR"
        exit 1
    }

    # Get current version
    CURRENT_VERSION=$(get_current_version)
    log_info "Current version: $CURRENT_VERSION"

    # Determine target version
    if [ -n "$TARGET_VERSION" ]; then
        LATEST_VERSION="$TARGET_VERSION"
    else
        log_info "Checking for updates..."
        LATEST_VERSION=$(get_latest_version)

        if [ -z "$LATEST_VERSION" ]; then
            log_error "Could not fetch latest version from GitHub"
            exit 1
        fi
    fi

    log_info "Target version: $LATEST_VERSION"

    # Compare versions
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        log_success "Already running the latest version ($CURRENT_VERSION)"
        exit 0
    fi

    # Show release info
    echo ""
    RELEASE_INFO=$(get_release_info "$LATEST_VERSION")
    RELEASE_NOTES=$(echo "$RELEASE_INFO" | grep -o '"body": *"[^"]*"' | head -1 | sed 's/"body": *"//;s/"$//' | sed 's/\\n/\n/g' | sed 's/\\r//g')
    RELEASE_URL=$(echo "$RELEASE_INFO" | grep -o '"html_url": *"[^"]*"' | head -1 | sed 's/"html_url": *"//;s/"//')

    if [ -n "$RELEASE_NOTES" ]; then
        echo "Release Notes:"
        echo "----------------------------------------"
        echo -e "$RELEASE_NOTES"
        echo "----------------------------------------"
        echo ""
        echo "Full release: $RELEASE_URL"
        echo ""
    fi

    # Check only mode
    if [ "$CHECK_ONLY" = true ]; then
        echo ""
        log_info "Update available: $CURRENT_VERSION -> $LATEST_VERSION"
        log_info "Run './upgrade.sh' to upgrade"
        exit 0
    fi

    # Confirmation prompt
    if [ "$FORCE" != true ]; then
        read -p "Upgrade from $CURRENT_VERSION to $LATEST_VERSION? (y/n): " CONFIRM
        if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
            log_info "Upgrade cancelled"
            exit 0
        fi
    fi

    echo ""
    log_info "Starting upgrade..."

    # Store current image for potential rollback
    CURRENT_IMAGE="${REGISTRY}/${IMAGE_NAME}:${CURRENT_VERSION}"
    TARGET_IMAGE="${REGISTRY}/${IMAGE_NAME}:${LATEST_VERSION}"

    # Step 1: Create backup
    BACKUP_FILE=$(create_backup "$CURRENT_VERSION")
    if [ $? -ne 0 ]; then
        log_error "Backup failed, aborting upgrade"
        exit 1
    fi

    # Step 2: Pull new image
    log_info "Pulling new image: $TARGET_IMAGE"
    if ! docker pull "$TARGET_IMAGE"; then
        log_error "Failed to pull new image"
        exit 1
    fi

    # Step 3: Stop containers
    log_info "Stopping containers..."
    docker compose -f "$COMPOSE_FILE" stop remote-agent

    # Step 4: Update compose file to use new image
    # The compose file uses the IMAGE_TAG env var, so we update .env
    sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${LATEST_VERSION}/" "${INSTALL_DIR}/.env" 2>/dev/null || \
        echo "IMAGE_TAG=${LATEST_VERSION}" >> "${INSTALL_DIR}/.env"

    # Step 5: Start new container
    log_info "Starting new container..."
    docker compose -f "$COMPOSE_FILE" up -d remote-agent

    # Wait for container to be ready
    sleep 5

    # Step 6: Run migrations
    if ! run_migrations; then
        log_error "Migration failed, rolling back..."

        # Rollback: restore database
        restore_backup "$BACKUP_FILE"

        # Rollback: revert to old image
        sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${CURRENT_VERSION}/" "${INSTALL_DIR}/.env" 2>/dev/null
        docker compose -f "$COMPOSE_FILE" up -d remote-agent

        log_error "Rollback completed. System restored to $CURRENT_VERSION"
        exit 1
    fi

    # Step 7: Health check
    if ! check_health; then
        log_error "Health check failed, rolling back..."

        # Rollback
        restore_backup "$BACKUP_FILE"
        sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${CURRENT_VERSION}/" "${INSTALL_DIR}/.env" 2>/dev/null
        docker compose -f "$COMPOSE_FILE" up -d remote-agent

        log_error "Rollback completed. System restored to $CURRENT_VERSION"
        exit 1
    fi

    # Step 8: Cleanup old backups
    cleanup_backups

    # Success
    echo ""
    log_success "========================================"
    log_success "  Upgrade completed successfully!"
    log_success "  $CURRENT_VERSION -> $LATEST_VERSION"
    log_success "========================================"
    echo ""
    log_info "Access Remote Agent at: http://localhost:5100"
}

main "$@"
