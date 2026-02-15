#!/usr/bin/env bash
set -e

echo "🚀 Starting Remote Agent..."

# Ensure directories exist
mkdir -p /app/data /app/workspaces /app/ssh-keys

# Run database migrations
echo "📦 Running database migrations..."
cd /app && bun run db:migrate

# Setup SSH directory
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Copy SSH keys if mounted
if [ -d /app/ssh-keys ] && [ "$(ls -A /app/ssh-keys 2>/dev/null)" ]; then
  echo "🔑 Setting up SSH keys..."
  cp -r /app/ssh-keys/* ~/.ssh/ 2>/dev/null || true
  chmod 600 ~/.ssh/* 2>/dev/null || true
fi

# Add GitHub to known hosts
ssh-keyscan -t rsa github.com >> ~/.ssh/known_hosts 2>/dev/null || true

# Check Claude Code installation
if command -v claude &> /dev/null; then
  echo "✅ Claude Code CLI available"
else
  echo "⚠️ Claude Code CLI not found, installing..."
  npm install -g @anthropic-ai/claude-code || true
fi

# Verify required environment variables
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ Error: ANTHROPIC_API_KEY is required"
  exit 1
fi

if [ -z "$JWT_SECRET" ]; then
  echo "⚠️ Warning: JWT_SECRET not set, generating random secret..."
  export JWT_SECRET=$(openssl rand -hex 32)
fi

echo "✅ Environment ready"
echo ""

# Execute command
exec "$@"
