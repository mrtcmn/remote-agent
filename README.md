# Remote Agent

Run Claude Code from anywhere. A Docker-based infrastructure for remote Claude Code sessions with mobile access and push notifications.

## Features

- **Remote Access** - Access Claude Code from any device (desktop, mobile, tablet)
- **Docker Deployment** - Easy installation on any Debian machine
- **GitHub OAuth** - Secure authentication with PIN for sensitive operations
- **Push Notifications** - Firebase push when Claude needs your attention
- **Multiple Sessions** - Manage multiple Claude Code sessions
- **Git Integration** - Clone, fetch, pull, push, and create PRs
- **SSH Key Management** - Securely store and use SSH keys for git
- **Permission Bypass** - Pre-configured with `--dangerously-skip-permissions`
- **Custom Skills & Hooks** - Pair your workspace with custom configurations

## Quick Start

### One-Command Installation

```bash
curl -fsSL https://raw.githubusercontent.com/yourorg/remote-agent/main/install.sh | bash
```

### Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/yourorg/remote-agent.git
cd remote-agent
```

2. Copy environment file and configure:
```bash
cp docker/.env.example docker/.env
# Edit docker/.env with your API keys
```

3. Start with Docker Compose:
```bash
cd docker
docker compose up -d
```

4. Access the UI at `http://localhost:3000`

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `JWT_SECRET` | Random 32-byte hex string for JWT signing |

### Optional Environment Variables

| Variable | Description |
|----------|-------------|
| `FIREBASE_PROJECT_ID` | Firebase project ID for push notifications |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `PORT` | Server port (default: 3000) |
| `APP_URL` | Public URL of the application |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Container                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐     ┌──────────────────────────────────────┐  │
│  │   Web UI    │────▶│           Elysia API                 │  │
│  │  (React)    │     │  /auth, /sessions, /projects, /ws    │  │
│  └─────────────┘     └──────────────┬───────────────────────┘  │
│                                     │                           │
│                      ┌──────────────▼───────────────┐          │
│                      │      Session Manager         │          │
│                      │  Spawns Claude CLI processes │          │
│                      └──────────────┬───────────────┘          │
│                                     │                           │
│  ┌──────────────┐    ┌──────────────▼───────────────┐          │
│  │   SQLite     │◀───│     Claude CLI Process       │          │
│  │  (state)     │    │  --dangerously-skip-perms    │          │
│  └──────────────┘    └──────────────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (when attention needed)
                    ┌─────────────────────┐
                    │   Firebase Push     │
                    └─────────────────────┘
```

## API Endpoints

### Authentication
- `POST /api/auth/github` - GitHub OAuth
- `GET /api/auth/me` - Get current user
- `POST /api/auth/pin/set` - Set security PIN
- `POST /api/auth/pin/verify` - Verify PIN

### Sessions
- `GET /api/sessions` - List sessions
- `POST /api/sessions` - Create session
- `POST /api/sessions/:id/message` - Send message
- `POST /api/sessions/:id/resume` - Resume session
- `DELETE /api/sessions/:id` - Terminate session

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Clone/create project
- `POST /api/projects/:id/fetch` - Git fetch
- `POST /api/projects/:id/pull` - Git pull
- `POST /api/projects/:id/push` - Git push
- `POST /api/projects/:id/pr` - Create PR
- `POST /api/projects/:id/pr/:number/merge` - Merge PR

### WebSocket
- `WS /ws/session/:sessionId` - Real-time session output

## Development

### Prerequisites
- Bun 1.1+
- Docker & Docker Compose

### Local Development

```bash
# Install dependencies
bun install

# Run database migrations
bun run db:generate
bun run db:migrate

# Start API (dev mode)
bun run dev

# Start UI (dev mode)
bun run dev:ui

# Or run both
bun run dev:all
```

### Project Structure

```
remote-agent/
├── packages/
│   ├── api/                    # Bun + Elysia backend
│   │   ├── src/
│   │   │   ├── auth/          # Better Auth + PIN
│   │   │   ├── db/            # Drizzle + SQLite
│   │   │   ├── routes/        # API routes
│   │   │   └── services/
│   │   │       ├── claude/    # Claude CLI manager
│   │   │       ├── git/       # Git operations
│   │   │       └── notification/
│   │   │           └── adapters/  # Firebase, etc.
│   │   └── drizzle/           # Migrations
│   └── ui/                    # React + Tailwind + shadcn
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── hooks/                 # Notification hook scripts
└── install.sh
```

## Notification Adapters

The notification system uses an adapter pattern for extensibility:

- **Firebase** (default) - Web push notifications
- **Webhook** - Custom webhook endpoints
- Coming soon: Email, Telegram, Discord, SQS

## Security Considerations

- GitHub OAuth for authentication
- Optional PIN for sensitive operations (delete projects, SSH keys)
- SSH keys stored with 600 permissions
- Internal hook endpoints only accessible from localhost
- All sessions isolated to user-specific directories

## License

MIT
