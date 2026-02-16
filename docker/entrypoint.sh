#!/usr/bin/env bash
set -e

echo "Starting Remote Agent..."

# Fix ownership of mounted volumes (runs as root)
chown -R agent:agent /app/workspaces /app/ssh-keys /app/data 2>/dev/null || true
chown -R agent:agent /app/config 2>/dev/null || true

# Ensure directories exist with correct ownership
mkdir -p /app/data /app/workspaces /app/ssh-keys
chown agent:agent /app/data /app/workspaces /app/ssh-keys

# Run database migrations as agent
echo "Running database migrations..."
cd /app && gosu agent bun run db:migrate

# Setup SSH directory for agent user
gosu agent mkdir -p /home/agent/.ssh
chmod 700 /home/agent/.ssh
chown agent:agent /home/agent/.ssh

# Copy SSH keys if mounted
if [ -d /app/ssh-keys ] && [ "$(ls -A /app/ssh-keys 2>/dev/null)" ]; then
  echo "Setting up SSH keys..."
  gosu agent cp -r /app/ssh-keys/* /home/agent/.ssh/ 2>/dev/null || true
  chmod 600 /home/agent/.ssh/* 2>/dev/null || true
  chown -R agent:agent /home/agent/.ssh
fi

# Add GitHub to known hosts
gosu agent bash -c 'ssh-keyscan -t rsa github.com >> ~/.ssh/known_hosts 2>/dev/null' || true

# Check Claude Code installation
if command -v claude &> /dev/null; then
  echo "Claude Code CLI available"
elif su - agent -c "command -v claude" &> /dev/null; then
  echo "Claude Code CLI available (agent user)"
else
  echo "Claude Code CLI not found, installing..."
  gosu agent npm install -g @anthropic-ai/claude-code || true
fi

# Verify required environment variables
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY is required"
  exit 1
fi

if [ -z "$JWT_SECRET" ]; then
  echo "Warning: JWT_SECRET not set, generating random secret..."
  export JWT_SECRET=$(openssl rand -hex 32)
fi

echo "Environment ready"
echo ""

# Drop privileges and execute command as agent user
exec gosu agent "$@"
