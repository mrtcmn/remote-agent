#!/usr/bin/env bash
set -e

echo "🚀 Starting dev server..."

# Initialize database if needed
if [ ! -f "/app/data/sqlite.db" ]; then
    echo "🗄️ Initializing database..."
    cd /app/packages/api && bun run db:generate && bun run db:migrate || true
fi

exec "$@"
