<p align="center">
  <img src="docs/screenshots/cover.jpg" width="800" alt="Remote Agent" />
</p>

<h1 align="center">Remote Agent</h1>

<p align="center">
  A self-hosted platform for running Claude Code from anywhere.<br/>
  Human-in-the-loop AI development — get push notifications when Claude needs you, review and respond from any device.
</p>

## Why Remote Agent?

Claude Code is powerful, but it runs in your local terminal. Close your laptop and the session dies. Remote Agent puts Claude Code on your server so it keeps working while you're away — and pings your phone when it needs your input.

- **Start a task, walk away** — Claude keeps coding on your server
- **Get notified instantly** — push alerts when Claude needs input, hits a permission wall, or finishes
- **Respond from anywhere** — phone, tablet, or another computer
- **Manage everything in the browser** — terminal, git, files, docker, and more

## Screenshots

<table>
  <tr>
    <td><img src="docs/screenshots/skills.png" alt="Skills Manager" /></td>
    <td><img src="docs/screenshots/mcp-servers.png" alt="MCP Servers" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Skills</strong> — Discover, install, and manage AI agent skills</td>
    <td align="center"><strong>MCP Servers</strong> — Browse and install Model Context Protocol servers</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/claude-terminal.png" alt="Claude Terminal" /></td>
    <td><img src="docs/screenshots/review-changes.png" alt="Review Changes" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Claude Terminal</strong> — Full PTY terminal with Claude Code running in the browser</td>
    <td align="center"><strong>Review Changes</strong> — LLM-powered git change review with commit narratives</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/notifications.png" alt="Notifications" /></td>
    <td><img src="docs/screenshots/vscode-browser.png" alt="VS Code in Browser" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Notifications</strong> — Push alerts when Claude needs input, with session management</td>
    <td align="center"><strong>VS Code</strong> — Full code-server IDE running in the browser</td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/screenshots/theme-selection.png" alt="Theme Selection" width="800" /></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><strong>Themes</strong> — Choose from multiple editor and UI themes (dark and light)</td>
  </tr>
</table>

## Features

### Human-in-the-Loop Notifications

Claude Code hooks integrate with Remote Agent's notification system. When Claude needs your attention — waiting for input, requesting permission, or finishing a task — you get a push notification on your phone or desktop. A notification panel in the UI keeps a full history so you never miss anything.

| Notification Type | Trigger |
|---|---|
| Input Required | Claude is waiting for your response |
| Permission Request | Claude needs approval to proceed |
| Task Complete | A session finished its work |
| Error | Something went wrong |

### Session Management

Create and manage multiple concurrent Claude Code sessions. Each session gets its own PTY terminal rendered with xterm.js in the browser. Multiple browser tabs can connect to the same session simultaneously — start a task on your desktop, check progress on your phone.

Sessions include a tabbed workspace with:

- **Claude** — Interactive Claude Code terminal
- **Shell** — Additional shell terminals
- **Git** — Stage, commit, push, pull, branch, and view diffs
- **Run** — Detect and execute npm scripts or custom commands
- **Env** — Manage environment variables per project
- **Docker** — List containers, build images, compose up/down
- **Preview** — Browser preview for web development
- **Editor** — Launch code-server for full VS Code editing
- **Files** — Browse, upload, edit, and manage project files

### Project Workspaces

Organize work into projects backed by git repositories. Clone repos via SSH or HTTPS, manage branches, and perform git operations directly from the UI.

**Multi-project workspaces** let you link multiple repositories under a single parent project using symlinks — useful for monorepo-style workflows where Claude needs access to several repos at once.

### Kanban Board

Built-in task management with:

- Drag-and-drop columns by status
- Priority levels, assignees, and project linking
- Task comments with threading
- File attachments
- Task dependencies
- Auto-flows for triggering Claude sessions on task transitions

### Docker Management

View and manage Docker containers running on the host. Start, stop, restart, and remove containers. Detect Dockerfiles and compose files in your project, build images, and run `docker compose up/down` from the UI.

### File Explorer

Browse project files with a tree view, view file contents with Shiki syntax highlighting, upload files, and perform move/copy/delete operations. Symlink-aware path validation ensures security across multi-project workspaces.

### Code Review

Add inline review comments to Claude's work, batch them, and send them back to Claude for iteration. Resolve or rerun review batches to refine output.

### Browser Preview

Launch a browser preview for web development projects with viewport presets (mobile, tablet, desktop). Powered by Puppeteer with real-time screenshot streaming.

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

Once complete, access the UI at **http://localhost:5100**.

> **Custom install path:** `INSTALL_DIR=~/remote-agent bash install.sh`

## Prerequisites

- **Linux server** (Debian/Ubuntu recommended)
- **Docker** (20.10+) and **Docker Compose** (v2)
- **Anthropic API Key** — [console.anthropic.com](https://console.anthropic.com)
- **GitHub OAuth App** — For authentication

## Docker Compose Setup

Three configurations are provided:

| File | Use Case |
|------|----------|
| `docker/docker-compose.prod.yml` | Production — pulls pre-built image from GHCR |
| `docker/docker-compose.yml` | Default — build from source or pull image |
| `docker/docker-compose.dev.yml` | Development — hot-reload with source bind-mount |

### Production (Recommended)

```bash
cd docker
docker compose -f docker-compose.prod.yml up -d
```

**Persistent Volumes:**

| Volume | Purpose |
|--------|---------|
| `remote-agent-postgres` | Database storage |
| `remote-agent-workspaces` | Project files and cloned repositories |
| `remote-agent-ssh-keys` | SSH key pairs |
| `remote-agent-config` | Custom hooks and skills |

### Development

```bash
cd docker
docker compose -f docker-compose.dev.yml up -d
```

Hot-reloading via Bun's `--watch` flag, PostgreSQL exposed at `127.0.0.1:5432`, and Bun inspector on port `6499`.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `POSTGRES_PASSWORD` | PostgreSQL database password |
| `JWT_SECRET` | 64-character hex string for session signing |

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5100` | Server port |
| `APP_URL` | `http://localhost:5100` | Public-facing URL (used for OAuth callbacks) |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `NODE_ENV` | `production` | Node environment |
| `IMAGE_TAG` | `latest` | Docker image version tag |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `agent` | PostgreSQL username |
| `POSTGRES_DB` | `remote_agent` | PostgreSQL database name |
| `DATABASE_URL` | *(auto-composed)* | Full connection string |

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

### Example `.env`

```env
IMAGE_TAG=latest

POSTGRES_USER=agent
POSTGRES_PASSWORD=your-secure-password-here
POSTGRES_DB=remote_agent

ANTHROPIC_API_KEY=sk-ant-xxxxx

GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

JWT_SECRET=your-64-char-hex-string

PORT=5100
APP_URL=http://your-server-ip:5100
NODE_ENV=production
```

## SSH Key Configuration

1. **Add keys via the UI** — Settings > SSH Keys
2. **Keys are stored securely** — `/app/ssh-keys/{userId}/` with `chmod 600`
3. **Assign keys to projects** — Select an SSH key when creating or editing a project
4. **Automatic agent registration** — All keys registered with `ssh-agent` on container startup

```bash
# Generate a dedicated key pair
ssh-keygen -t ed25519 -C "remote-agent" -f remote-agent-key

# Add the public key to your Git provider, then paste both keys into Settings
```

## Firebase Push Notifications

Firebase Cloud Messaging sends push notifications when Claude needs attention.

### Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Cloud Messaging API (V2) in Project Settings > Cloud Messaging
3. Generate a VAPID key under Web configuration
4. Create a service account and download the JSON key
5. Add a web app and copy the config values
6. Set all `FIREBASE_*` and `VITE_FIREBASE_*` variables in `.env` and restart

### Notification Features

- **Quiet hours** — suppress notifications during set times
- **Per-type preferences** — choose which notification types to receive
- **Device management** — register/unregister multiple devices
- **Debouncing** — duplicate notifications within 2 minutes are suppressed
- **Action buttons** — tap to jump directly to the session

## Reverse Proxy Setup

The app binds to `127.0.0.1:5100`. Use a reverse proxy for external HTTPS access.

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

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Update `.env` after setup:
```env
APP_URL=https://agent.yourdomain.com
```

## Upgrading

```bash
cd /opt/remote-agent

# Check for updates
./upgrade.sh --check

# Upgrade to latest
./upgrade.sh

# Upgrade to a specific version
./upgrade.sh --version v1.2.3
```

The upgrade script creates a PostgreSQL backup before updating, and automatically rolls back if migrations or the health check fail.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- Docker & Docker Compose (for PostgreSQL)

### Native Development

```bash
git clone https://github.com/mrtcmn/remote-agent.git
cd remote-agent
bun install

# Start PostgreSQL
docker run -d --name remote-agent-db \
  -e POSTGRES_USER=agent \
  -e POSTGRES_PASSWORD=agent \
  -e POSTGRES_DB=remote_agent \
  -p 5432:5432 \
  postgres:16-alpine

export DATABASE_URL=postgres://agent:agent@localhost:5432/remote_agent
export JWT_SECRET=dev-secret-change-in-production

# Run migrations and start
bun run db:migrate
bun run dev:all
```

API runs on port 5100, UI dev server on 5173 (proxied to API).

### Project Structure

```
remote-agent/
├── packages/
│   ├── api/                    # Backend (Bun + Elysia)
│   │   ├── src/
│   │   │   ├── auth/           # Authentication (Better Auth + OAuth)
│   │   │   ├── db/             # Drizzle ORM + PostgreSQL schema
│   │   │   ├── routes/         # API routes + WebSocket handlers
│   │   │   └── services/
│   │   │       ├── terminal/       # PTY terminal management
│   │   │       ├── git/            # Git operations
│   │   │       ├── notification/   # Push notification adapters
│   │   │       ├── workspace/      # SSH keys, multi-project, env vars
│   │   │       ├── docker/         # Docker container management
│   │   │       ├── browser-preview/ # Puppeteer browser preview
│   │   │       ├── run-config/     # Run configuration execution
│   │   │       ├── code-editor/    # code-server integration
│   │   │       ├── kanban/         # Task board service
│   │   │       ├── auto-flow/      # Task automation flows
│   │   │       └── cli-adapter/    # CLI tool adapters
│   │   └── drizzle/            # SQL migration files
│   └── ui/                     # Frontend (React + Vite + Tailwind)
│       └── src/
│           ├── pages/          # Dashboard, Session, Projects, Kanban, Settings
│           ├── components/     # Terminal, Git, Docker, File Explorer, etc.
│           └── hooks/          # React Query data hooks
├── docker/                     # Dockerfiles and compose configs
├── scripts/                    # Upgrade, build, and dev scripts
└── install.sh                  # One-command installer
```

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      Docker Environment                        │
│                                                                │
│  ┌──────────────┐       ┌────────────────────────────────────┐ │
│  │   React UI   │──────>│        Elysia API (Bun)            │ │
│  │  (Vite SPA)  │       │                                    │ │
│  │              │  WS   │  /api/sessions   Session mgmt      │ │
│  │  Dashboard   │<─────>│  /api/terminals  PTY terminals     │ │
│  │  Terminal    │       │  /api/projects   Git repositories  │ │
│  │  Projects    │       │  /api/kanban     Task board        │ │
│  │  Kanban      │       │  /api/docker     Containers        │ │
│  │  Settings    │       │  /api/notifications  Push alerts   │ │
│  └──────────────┘       └──────────┬─────────────────────────┘ │
│                                    │                           │
│                     ┌──────────────▼──────────────┐            │
│                     │     Terminal Service         │            │
│                     │  (Bun native PTY spawn)      │            │
│                     └──────┬───────────┬──────────┘            │
│                            │           │                       │
│          ┌─────────────────▼─┐   ┌─────▼─────────────────┐    │
│          │  Claude Code CLI  │   │  Shell / Process       │    │
│          │  (hooks → push    │   │  terminals             │    │
│          │   notifications)  │   │                        │    │
│          └───────────────────┘   └────────────────────────┘    │
│                                                                │
│  ┌──────────────┐           ┌────────────────────────────┐     │
│  │ PostgreSQL   │<──────────│  Drizzle ORM               │     │
│  │ (persistent) │           │  sessions, projects, tasks  │     │
│  └──────────────┘           └────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                           │
                           ▼ push notifications
                 ┌──────────────────┐
                 │  Firebase FCM    │──> Phone / Desktop alerts
                 └──────────────────┘
```

## Security

- **GitHub OAuth** primary authentication with optional **PIN protection** for sensitive operations
- All data **scoped per user** — queries always filter by `userId`
- JWT session tokens with 7-day expiry
- SSH keys stored with `chmod 600`, container user has no sudo access
- Internal hook endpoints only accept requests from `localhost`
- App binds to `127.0.0.1` only — use a reverse proxy for external access
- Symlink-aware path validation prevents directory traversal
- Claude Code runs with `--dangerously-skip-permissions` — by design for remote autonomous operation

## Troubleshooting

### Container won't start
```bash
docker compose logs remote-agent
# Most common: missing ANTHROPIC_API_KEY
```

### OAuth login fails
- Verify `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- Callback URL must match: `{APP_URL}/api/auth/callback/github`
- With a reverse proxy, ensure `APP_URL` uses `https://`

### SSH key not working
```bash
docker exec remote-agent ls -la /app/ssh-keys/
docker exec remote-agent ssh-add -l
docker exec remote-agent ssh -T git@github.com
```

### Push notifications not arriving
- Verify all `FIREBASE_*` and `VITE_FIREBASE_*` variables are set
- Check that Cloud Messaging API (V2) is enabled
- Ensure browser has granted notification permissions

### Database issues
```bash
docker exec remote-agent bun run db:migrate
docker exec -it remote-agent-db psql -U agent remote_agent
```

## License

MIT
