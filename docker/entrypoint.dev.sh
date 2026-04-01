#!/usr/bin/env bash
set -e

echo "Starting dev server..."

# Fix ownership of mounted volumes (runs as root)
chown -R agent:agent /app/workspaces /app/ssh-keys 2>/dev/null || true
chown -R agent:agent /app/config 2>/dev/null || true
mkdir -p /app/data
chown agent:agent /app/data

# Ensure agent can access mounted source code
chown agent:agent /app/packages /app/packages/api /app/packages/ui 2>/dev/null || true

# Fix ownership of Claude credentials so the agent user can read/write them
chown -R agent:agent /home/agent/.claude 2>/dev/null || true

# Ensure directories exist with correct ownership
mkdir -p /app/workspaces /app/ssh-keys /app/config
chown agent:agent /app/workspaces /app/ssh-keys /app/config

# Run database migrations
echo "Running database migrations..."
(cd /app/packages/api && gosu agent bun run src/db/migrate.ts) || true

# Check Claude Code installation
if command -v claude &> /dev/null; then
  echo "Claude Code CLI available"
elif su - agent -c "command -v claude" &> /dev/null; then
  echo "Claude Code CLI available (agent user)"
else
  echo "Claude Code CLI not found, installing..."
  gosu agent curl -fsSL https://claude.ai/install.sh | gosu agent bash || \
    gosu agent npm install -g @anthropic-ai/claude-code || true
fi

# Drop privileges and execute command as agent user
cd /app
exec gosu agent "$@"
