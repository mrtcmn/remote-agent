# Docker Distribution & Upgrade System Design

## Overview

A system for distributing Remote Agent via GitHub Container Registry with user-triggered upgrades and safe data persistence.

## Architecture

### Distribution Flow

```
GitHub repo (main branch)
       ↓ (push)
GitHub Actions (buildx) → ghcr.io/yourorg/remote-agent:latest
                          ├── linux/amd64
                          └── linux/arm64

GitHub Release (v1.2.3)
       ↓ (publish)
GitHub Actions (buildx) → ghcr.io/yourorg/remote-agent:v1.2.3
                          ├── linux/amd64
                          └── linux/arm64
```

### User Data Layout

```
/opt/remote-agent/
├── workspaces/          # Host-mounted (user projects)
├── ssh-keys/            # Host-mounted (git SSH keys)
├── backups/             # Database backups
├── docker-compose.yml   # Compose file
├── .env                 # Configuration
└── upgrade.sh           # Upgrade script

Docker volumes:
└── remote-agent-postgres  # Named volume (database)
```

### Key Principles

- App container is disposable (can be replaced anytime)
- User data persists in `/opt/remote-agent/` and postgres volume
- Upgrades are always user-initiated, never automatic
- Failed migrations trigger automatic rollback
- Multi-architecture support (amd64 + arm64)

## CI/CD Pipeline

### Workflow: `.github/workflows/docker-publish.yml`

**Triggers:**
- Push to `main` → builds and pushes `latest` tag
- GitHub Release published → builds and pushes version tag

**Build steps:**
1. Checkout code
2. Set up QEMU (for ARM emulation)
3. Set up Docker Buildx
4. Login to ghcr.io using `GITHUB_TOKEN`
5. Extract metadata (tags, labels)
6. Build and push multi-platform image

**Image tags produced:**

| Event | Tags |
|-------|------|
| Push to main | `latest` |
| Release v1.2.3 | `v1.2.3`, `latest`, `1.2`, `1` |

## Upgrade Script

### Location

`/opt/remote-agent/upgrade.sh`

### Process

1. Check current version (from running container)
2. Fetch latest version from GitHub Releases API
3. Compare versions - exit if already up-to-date
4. Show changelog / release notes
5. Prompt user to confirm upgrade
6. Create database backup (pg_dump to timestamped file)
7. Stop containers (docker compose down)
8. Pull new image (docker pull ghcr.io/...)
9. Run database migrations
10. If migration fails → restore backup, restart old version
11. Start containers (docker compose up -d)
12. Run health check
13. If health check fails → rollback to previous image
14. Success: show new version, cleanup old backups (keep last 3)

### CLI Options

- `./upgrade.sh` - interactive upgrade
- `./upgrade.sh --check` - just check for updates
- `./upgrade.sh --force` - skip confirmation prompt
- `./upgrade.sh --version v1.2.3` - upgrade to specific version

### Backup Location

```
/opt/remote-agent/backups/
├── 2025-01-30_143022_v1.2.2.sql.gz
├── 2025-01-30_120000_v1.2.1.sql.gz
└── 2025-01-29_090000_v1.2.0.sql.gz
```

Retention: 3 most recent backups.

## Version Checking & UI

### Backend Endpoint

`GET /api/version`

```json
{
  "current": "1.2.3",
  "latest": "1.3.0",
  "updateAvailable": true,
  "releaseUrl": "https://github.com/yourorg/remote-agent/releases/tag/v1.3.0",
  "releaseNotes": "### What's New\n- Feature X\n- Bug fix Y",
  "lastChecked": "2025-01-30T14:30:00Z"
}
```

### Caching

- Cache GitHub API response for 4 hours in memory
- `GET /api/version?force=true` bypasses cache
- Cache resets on container restart

### UI Components

**Startup banner** (dismissible):
```
┌─────────────────────────────────────────────────┐
│ Update available: v1.3.0                        │
│ Run ./upgrade.sh to update  [View Release] [×]  │
└─────────────────────────────────────────────────┘
```

**Settings page widget:**
```
Version
├── Current: v1.2.3
├── Latest: v1.3.0 (update available)
├── Last checked: 2 hours ago
└── [Check Now] [View Changelog]
```

## Install Script

### Changes

1. Pull from ghcr.io only (no local build)
2. Create host directories at `/opt/remote-agent/`
3. Download management scripts (upgrade.sh, docker-compose.yml)
4. Configure host-mounted volumes

### Post-Install Output

```
✓ Remote Agent installed successfully!

Location: /opt/remote-agent/
Upgrade:  /opt/remote-agent/upgrade.sh
Logs:     docker compose -f /opt/remote-agent/docker-compose.yml logs -f

Access at: http://localhost:5100
```

## Dockerfile Updates

### Version Build Argument

```dockerfile
ARG VERSION=dev
ENV APP_VERSION=$VERSION
```

### Labels

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/yourorg/remote-agent"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.description="Remote Claude Code sessions"
```

### Health Check

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s \
  CMD curl -f http://localhost:5100/api/health || exit 1
```

## Implementation Files

### To Create

| File | Purpose |
|------|---------|
| `.github/workflows/docker-publish.yml` | CI/CD pipeline for multi-arch builds |
| `scripts/upgrade.sh` | User-facing upgrade script |
| `scripts/install.sh` | Updated install script (ghcr.io only) |

### To Modify

| File | Changes |
|------|---------|
| `docker/Dockerfile` | Add VERSION arg, labels, health check |
| `docker/docker-compose.yml` | Update volumes to host mounts |
| `packages/api/src/routes/version.ts` | New endpoint for version info |
| `packages/ui/src/components/UpdateBanner.tsx` | Startup notification |
| `packages/ui/src/pages/Settings.tsx` | Version widget |

## Configuration Summary

| Item | Value |
|------|-------|
| Registry | `ghcr.io/yourorg/remote-agent` |
| Install path | `/opt/remote-agent/` |
| Cache duration | 4 hours |
| Backup retention | 3 most recent |
| Platforms | `linux/amd64`, `linux/arm64` |
| Versioning | Semantic (v1.2.3, latest) |
