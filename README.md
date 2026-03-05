# Remote Agent

Run Claude Code from anywhere. A self-hosted platform for remote Claude Code sessions accessible from any device — desktop, mobile, or tablet — with push notifications, Git integration, and full terminal access via your browser.

## Features

- **Remote Terminal Access** — Browser-based terminal connected to real PTY sessions running Claude Code
- **Docker Deployment** — One-command installation on any Linux server
- **GitHub OAuth** — Secure authentication with optional PIN for sensitive operations
- **Push Notifications** — Firebase push alerts when Claude needs your attention (idle prompt, permission request, task complete)
- **Multiple Sessions** — Run and manage multiple concurrent Claude Code sessions
- **Git Integration** — Clone, fetch, pull, push, branch, commit, and create/merge PRs directly from the UI
- **SSH Key Management** — Add, store, and assign SSH keys for private repository access
- **Project Workspaces** — Organize work into projects with multi-project symlink support
- **Kanban Board** — Built-in task management with Claude sessions linked to tasks
- **Browser Preview** — Playwright-powered browser preview service for web development
- **Custom Skills & Hooks** — Pair your Claude Code workspace with custom configurations
- **Auto-Upgrade** — Safe upgrade system with automatic database backup and rollback

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Docker Compose Setup](#docker-compose-setup)
- [Environment Variables](#environment-variables)
- [SSH Key Configuration](#ssh-key-configuration)
- [Firebase Push Notifications](#firebase-push-notifications)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Upgrading](#upgrading)
- [Development Setup](#development-setup)
- [Architecture](#architecture)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Quick Start

### One-Command Installation

```bash
curl -fsSL https://raw.githubusercontent.com/mrtcmn/remote-agent/main/install.sh | bash
```

The installer will:
1. Check and install Docker & Docker Compose if needed
2. Create the installation directory at `/opt/remote-agent`
3. Prompt you for required API keys (Anthropic, GitHub OAuth)
4. Optionally configure Firebase push notifications
5. Auto-generate secure `POSTGRES_PASSWORD` and `JWT_SECRET`
6. Pull the Docker image and start services
7. Verify the health check passes

Once complete, access the UI at **http://localhost:5100**.

> **Custom install path:** `INSTALL_DIR=~/remote-agent bash install.sh`

## Prerequisites

- **Linux server** (Debian/Ubuntu recommended)
- **Docker** (20.10+) and **Docker Compose** (v2)
- **Anthropic API Key** — Get one at [console.anthropic.com](https://console.anthropic.com)
- **GitHub OAuth App** — For authentication (see [GitHub OAuth Setup](#github-oauth-setup))

## Docker Compose Setup

Remote Agent provides three Docker Compose configurations for different use cases.

### Production (Recommended)

Uses the pre-built image from GitHub Container Registry.

```
docker/docker-compose.prod.yml
```

**Services:**

| Service | Image | Description |
|---------|-------|-------------|
| `db` | `postgres:16-alpine` | PostgreSQL database |
| `remote-agent` | `ghcr.io/mrtcmn/remote-agent:latest` | Application server |

**Persistent Volumes:**

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `remote-agent-postgres` | `/var/lib/postgresql/data` | Database storage |
| `remote-agent-workspaces` | `/app/workspaces` | Project files and cloned repositories |
| `remote-agent-ssh-keys` | `/app/ssh-keys` | SSH private/public key pairs |
| `remote-agent-config` | `/app/config` (read-only) | Custom hooks and skills |

**Ports:**
- `127.0.0.1:5100` — API + UI (bound to localhost only; use a reverse proxy for external access)

**Health checks:**
- PostgreSQL: `pg_isready` every 5s
- App: `curl http://localhost:5100/health` every 30s (with 30s startup grace period)

### Default (Build or Pull)

```
docker/docker-compose.yml
```

Supports both building from source and pulling a pre-built image. If `IMAGE_TAG` is set in `.env`, it pulls from GHCR; otherwise, it builds locally from the Dockerfile.

```bash
# Build from source
cd docker
docker compose up -d

# Or pull a specific version
IMAGE_TAG=v1.0.0 docker compose up -d
```

### Development (Hot-Reload)

```
docker/docker-compose.dev.yml
```

Designed for active development with:
- **Hot-reloading** via Bun's `--watch` flag
- **Source code bind-mounted** from host into the container
- **PostgreSQL exposed** to host at `127.0.0.1:5432` for direct DB access
- **Bun inspector** on port `6499` for debugging with VS Code or Chrome DevTools
- Anonymous volumes to preserve `node_modules` from the image

```bash
cd docker
docker compose -f docker-compose.dev.yml up -d
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key for Claude Code |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `POSTGRES_PASSWORD` | PostgreSQL database password |
| `JWT_SECRET` | 64-character hex string for session signing (auto-generated if not set) |

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5100` | Server port |
| `APP_URL` | `http://localhost:5100` | Public-facing URL (used for OAuth callbacks) |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (comma-separated or `*`) |
| `NODE_ENV` | `production` | Node environment |
| `IMAGE_TAG` | `latest` | Docker image version tag |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `agent` | PostgreSQL username |
| `POSTGRES_PASSWORD` | *(required)* | PostgreSQL password |
| `POSTGRES_DB` | `remote_agent` | PostgreSQL database name |
| `DATABASE_URL` | *(auto-composed)* | Full connection string (auto-built from above) |

### Firebase Push Notifications (Optional)

**Server-side (Admin SDK):**

| Variable | Description |
|----------|-------------|
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_PRIVATE_KEY` | Service account private key (PEM format) |
| `FIREBASE_CLIENT_EMAIL` | Service account email |

**Client-side (injected into frontend at runtime):**

| Variable | Description |
|----------|-------------|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_FIREBASE_MEASUREMENT_ID` | Firebase analytics measurement ID |
| `VITE_FIREBASE_VAPID_KEY` | VAPID key for web push |

### Example `.env` File

```env
# Docker Image
IMAGE_TAG=latest

# Database
POSTGRES_USER=agent
POSTGRES_PASSWORD=your-secure-password-here
POSTGRES_DB=remote_agent

# Required API Keys
ANTHROPIC_API_KEY=sk-ant-xxxxx

# GitHub OAuth
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Security
JWT_SECRET=your-64-char-hex-string

# Application
PORT=5100
APP_URL=http://your-server-ip:5100
NODE_ENV=production
```

## SSH Key Configuration

SSH keys allow Remote Agent to clone and interact with private Git repositories.

### How It Works

1. **Add keys via the UI** — Go to **Settings > SSH Keys** and paste your private/public key pair
2. **Keys are stored securely** — Private keys are saved to `/app/ssh-keys/{userId}/` with `chmod 600` permissions
3. **Assign keys to projects** — When creating or editing a project, select which SSH key to use
4. **Automatic agent registration** — On container startup, all SSH keys are automatically registered with `ssh-agent`

### File Naming Convention

Keys follow a specific naming pattern:
```
/app/ssh-keys/{userId}/{keyId}_id_rsa       # Private key (mode 600)
/app/ssh-keys/{userId}/{keyId}_id_rsa.pub   # Public key (mode 644)
```

### Startup Behavior

The container entrypoint (`entrypoint.sh`) automatically:
1. Copies all keys from `/app/ssh-keys/` to `/home/agent/.ssh/`
2. Sets correct file permissions (`600` for private, `644` for public, `700` for directories)
3. Adds `github.com` to SSH known hosts via `ssh-keyscan`
4. Starts `ssh-agent` and registers all `*_id_rsa` keys found

### Git Operations with SSH

When a project has an assigned SSH key, all Git operations use:
```bash
GIT_SSH_COMMAND='ssh -i "/path/to/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no'
```

Projects without a specific key fall back to the `ssh-agent` socket (which has all keys registered).

### Generating an SSH Key for Remote Agent

```bash
# Generate a new key pair (on your local machine or server)
ssh-keygen -t ed25519 -C "remote-agent" -f remote-agent-key

# Copy the public key to your Git provider (GitHub, GitLab, etc.)
cat remote-agent-key.pub

# Add both keys via the Remote Agent Settings UI
```

> **Tip:** Use a dedicated deploy key per repository for better security isolation.

## Firebase Push Notifications

Firebase Cloud Messaging (FCM) sends push notifications to your devices when Claude Code needs attention.

### Setup Steps

1. **Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com)

2. **Enable Cloud Messaging:**
   - Go to Project Settings > Cloud Messaging
   - Enable the Firebase Cloud Messaging API (V2)

3. **Generate a VAPID key:**
   - Go to Project Settings > Cloud Messaging > Web configuration
   - Click "Generate key pair"
   - Copy the key for `VITE_FIREBASE_VAPID_KEY`

4. **Create a service account:**
   - Go to Project Settings > Service accounts
   - Click "Generate new private key"
   - From the downloaded JSON, extract:
     - `project_id` → `FIREBASE_PROJECT_ID`
     - `client_email` → `FIREBASE_CLIENT_EMAIL`
     - `private_key` → `FIREBASE_PRIVATE_KEY`

5. **Get web app config:**
   - Go to Project Settings > General > Your apps
   - Add a web app if you haven't
   - Copy the config values to the corresponding `VITE_FIREBASE_*` variables

6. **Add all variables to your `.env`** and restart:
   ```bash
   docker compose restart remote-agent
   ```

### Notification Types

| Type | Trigger |
|------|---------|
| `user_input_required` | Claude is waiting for input (idle prompt) |
| `permission_request` | Claude needs permission to proceed |
| `task_complete` | Claude finished a task |
| `error` | An error occurred |

Notifications are **debounced** — duplicate notifications with the same content within 2 minutes are suppressed.

## Reverse Proxy Setup

The app binds to `127.0.0.1:5100` by default. To expose it externally with HTTPS, use a reverse proxy.

### Nginx Example

```nginx
server {
    listen 443 ssl;
    server_name agent.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/agent.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agent.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_for_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (required for terminal)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Longer timeouts for terminal sessions
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

After setting up the proxy, update your `.env`:
```env
APP_URL=https://agent.yourdomain.com
```

And update your GitHub OAuth callback URL to `https://agent.yourdomain.com/api/auth/callback/github`.

## Upgrading

Remote Agent includes a safe upgrade script with automatic database backup and rollback.

### Using the Upgrade Script

```bash
cd /opt/remote-agent

# Check for available updates
./upgrade.sh --check

# Upgrade to latest version
./upgrade.sh

# Upgrade without confirmation prompt
./upgrade.sh --force

# Upgrade to a specific version
./upgrade.sh --version v1.2.3
```

### What the Upgrade Script Does

1. Checks current vs. latest version (via GitHub Releases API)
2. Shows release notes for the new version
3. **Creates a PostgreSQL backup** (gzipped SQL dump in `backups/`)
4. Pulls the new Docker image
5. Stops the old container and starts the new one
6. Runs database migrations
7. Runs a health check
8. **Automatic rollback** if migrations or health check fail (restores DB + reverts image)
9. Cleans up old backups (keeps last 3 by default)

### Manual Upgrade

```bash
cd /opt/remote-agent

# Pull the new image
docker pull ghcr.io/mrtcmn/remote-agent:latest

# Restart with the new image
docker compose down
docker compose up -d

# Check logs
docker compose logs -f remote-agent
```

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- Docker & Docker Compose (for PostgreSQL)

### Option 1: Native Development (Fastest)

```bash
# Clone the repository
git clone https://github.com/mrtcmn/remote-agent.git
cd remote-agent

# Install dependencies
bun install

# Start PostgreSQL (if not running)
docker run -d --name remote-agent-db \
  -e POSTGRES_USER=agent \
  -e POSTGRES_PASSWORD=agent \
  -e POSTGRES_DB=remote_agent \
  -p 5432:5432 \
  postgres:16-alpine

# Set up environment
export ANTHROPIC_API_KEY=sk-ant-xxxxx
export DATABASE_URL=postgres://agent:agent@localhost:5432/remote_agent
export JWT_SECRET=dev-secret-change-in-production

# Run database migrations
bun run db:migrate

# Start API server (port 5100)
bun run dev

# In another terminal, start UI dev server (port 5173, proxies to API)
bun run dev:ui

# Or run both concurrently
bun run dev:all
```

### Option 2: Docker Development Environment

```bash
cd docker

# Create a .env file with at minimum:
echo 'ANTHROPIC_API_KEY=sk-ant-xxxxx' > .env

# Start the dev environment
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f api

# Access the Bun debugger at 127.0.0.1:6499
```

Source code is bind-mounted, so changes to files under `packages/` trigger automatic reloading.

### Project Structure

```
remote-agent/
├── packages/
│   ├── api/                      # Backend (Bun + Elysia)
│   │   ├── src/
│   │   │   ├── index.ts          # Server entry point
│   │   │   ├── auth/             # GitHub OAuth + PIN authentication
│   │   │   ├── db/               # Drizzle ORM + PostgreSQL schema
│   │   │   ├── routes/           # API routes + WebSocket handlers
│   │   │   └── services/
│   │   │       ├── terminal/     # PTY terminal management
│   │   │       ├── git/          # Git + GitHub CLI operations
│   │   │       ├── notification/ # Push notification adapters
│   │   │       ├── workspace/    # SSH keys, skills, hooks
│   │   │       ├── browser-preview/ # Playwright browser preview
│   │   │       └── kanban/       # Task board service
│   │   └── drizzle/              # SQL migration files
│   └── ui/                       # Frontend (React + Vite + Tailwind)
│       └── src/
│           ├── pages/            # Route pages (Dashboard, Session, etc.)
│           ├── components/       # UI components (Terminal, etc.)
│           └── hooks/            # React Query data hooks
├── docker/
│   ├── Dockerfile                # Production multi-stage build
│   ├── Dockerfile.dev            # Development build with hot-reload
│   ├── docker-compose.yml        # Default (build or pull)
│   ├── docker-compose.prod.yml   # Production (pre-built image)
│   ├── docker-compose.dev.yml    # Development (hot-reload + debug)
│   ├── entrypoint.sh             # Production entrypoint
│   └── entrypoint.dev.sh         # Development entrypoint
├── scripts/
│   ├── upgrade.sh                # Safe upgrade with backup + rollback
│   ├── build.sh                  # Build script
│   └── dev.sh                    # Dev helper script
└── install.sh                    # One-command installer
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Docker Environment                            │
│                                                                      │
│  ┌─────────────────┐       ┌──────────────────────────────────────┐  │
│  │   React UI      │──────▶│         Elysia API (Bun)            │  │
│  │   (Vite build)  │       │                                      │  │
│  │                 │  WS   │  Routes:                             │  │
│  │  - Dashboard    │◀─────▶│  /api/auth     - GitHub OAuth + PIN │  │
│  │  - Terminal     │       │  /api/sessions - Session management  │  │
│  │  - Projects     │       │  /api/projects - Git repositories    │  │
│  │  - Kanban       │       │  /api/terminals - PTY terminals     │  │
│  │  - Settings     │       │  /ws/terminal  - Terminal WebSocket  │  │
│  └─────────────────┘       └──────────┬───────────────────────────┘  │
│                                       │                              │
│                        ┌──────────────▼──────────────┐               │
│                        │     Terminal Service         │               │
│                        │  (Bun native PTY spawn)      │               │
│                        └──────┬───────────┬───────────┘               │
│                               │           │                           │
│          ┌────────────────────▼──┐   ┌────▼────────────────────┐     │
│          │  Claude Code CLI      │   │   Shell / Process       │     │
│          │  (with hooks →        │   │   terminals             │     │
│          │   notifications)      │   │                         │     │
│          └───────────────────────┘   └─────────────────────────┘     │
│                                                                      │
│  ┌──────────────┐              ┌──────────────────────────────┐      │
│  │ PostgreSQL   │◀─────────────│  Drizzle ORM                │      │
│  │ (persistent) │              │  (sessions, projects, keys)  │      │
│  └──────────────┘              └──────────────────────────────┘      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  (push notifications)
                    ┌──────────────────┐
                    │  Firebase FCM    │──▶ Mobile / Desktop alerts
                    └──────────────────┘
```

### How Terminal Sessions Work

1. User creates a session and a Claude terminal is spawned
2. The server allocates a real PTY using Bun's native `spawn()` with `terminal: true`
3. Claude Code CLI starts with `--dangerously-skip-permissions` and an optional initial prompt
4. Terminal I/O streams over WebSocket to the browser (xterm.js renders the output)
5. Claude Code hooks call back to the internal API when attention is needed
6. The notification service dispatches push alerts through configured adapters
7. Multiple browser tabs can connect to the same terminal simultaneously

## Security

### Authentication & Authorization

- **GitHub OAuth** is the primary authentication method
- **Optional PIN** (4-8 digits, bcrypt hashed) protects sensitive operations like deleting projects or SSH keys
- All sessions and data are **scoped per user** — queries always filter by `userId`
- JWT-based session tokens with 7-day expiry

### Container Security

- The `agent` user inside the container has **no sudo access**
- SSH private keys are stored with `chmod 600`
- The `.env` file is created with `chmod 600` by the installer
- Internal hook endpoints (`/internal/*`) only accept requests from `localhost`
- The app binds to `127.0.0.1` only — not exposed to the network without a reverse proxy

### Important Notes

- Claude Code runs with `--dangerously-skip-permissions` — this is by design for remote autonomous operation
- A test user (`test@t.com` / `123456`) is seeded at startup for development. Remove or change it for production use
- If `JWT_SECRET` is not set, one is auto-generated at startup but **not persisted** — sessions will invalidate on container restart

## Management Commands

```bash
cd /opt/remote-agent

# View logs
docker compose logs -f

# View only app logs
docker compose logs -f remote-agent

# Restart services
docker compose restart

# Stop services
docker compose down

# Check for updates
./upgrade.sh --check

# Upgrade to latest
./upgrade.sh

# Access the database
docker exec -it remote-agent-db psql -U agent remote_agent

# Access the app container shell
docker exec -it remote-agent bash
```

## Troubleshooting

### Container won't start
```bash
# Check logs for errors
docker compose logs remote-agent

# Most common: missing ANTHROPIC_API_KEY
# The entrypoint will exit with "Error: ANTHROPIC_API_KEY is required"
```

### OAuth login fails
- Verify `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are correct
- Ensure the callback URL in your GitHub OAuth App matches: `{APP_URL}/api/auth/callback/github`
- If using a reverse proxy, make sure `APP_URL` uses `https://` and the correct domain

### SSH key not working
```bash
# Check if keys are properly mounted
docker exec remote-agent ls -la /app/ssh-keys/

# Check ssh-agent has keys loaded
docker exec remote-agent ssh-add -l

# Test SSH connection to GitHub
docker exec remote-agent ssh -T git@github.com
```

### Push notifications not arriving
- Verify all `FIREBASE_*` and `VITE_FIREBASE_*` variables are set
- Check that the Firebase Cloud Messaging API (V2) is enabled
- Ensure the browser has granted notification permissions
- Check notification preferences in Settings

### Database issues
```bash
# Run migrations manually
docker exec remote-agent bun run db:migrate

# Connect to database directly
docker exec -it remote-agent-db psql -U agent remote_agent
```

## License

MIT
