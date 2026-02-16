#!/usr/bin/env bash
set -e

echo "Starting dev server..."

# Fix ownership of mounted volumes (runs as root)
chown -R agent:agent /app/workspaces /app/ssh-keys 2>/dev/null || true
mkdir -p /app/data
chown agent:agent /app/data

# Initialize database if needed
if [ ! -f "/app/data/sqlite.db" ]; then
    echo "Initializing database..."
    cd /app/packages/api && gosu agent bun run db:generate && gosu agent bun run db:migrate || true
fi

# Drop privileges and execute command as agent user
exec gosu agent "$@"
