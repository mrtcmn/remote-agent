#!/usr/bin/env bash
# Git credential helper for GitHub App authentication.
# Called by git with "get" as the first argument.
# Reads the project ID from git config (credential.projectId)
# and fetches a fresh installation token from the local API.

if [ "$1" != "get" ]; then
  exit 0
fi

# Read input from git (protocol, host, path)
while IFS='=' read -r key value; do
  case "$key" in
    protocol) protocol="$value" ;;
    host) host="$value" ;;
    *) ;;
  esac
done

# Only handle github.com HTTPS requests
if [ "$host" != "github.com" ] || [ "$protocol" != "https" ]; then
  exit 0
fi

# Get project ID from git config
PROJECT_ID=$(git config --get credential.projectId 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  exit 0
fi

API_PORT="${API_PORT:-5100}"

# Fetch credentials from the internal API
RESPONSE=$(curl -sf "http://localhost:${API_PORT}/internal/git-credential/${PROJECT_ID}" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
  exit 1
fi

USERNAME=$(echo "$RESPONSE" | jq -r '.username // empty' 2>/dev/null)
PASSWORD=$(echo "$RESPONSE" | jq -r '.password // empty' 2>/dev/null)

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  exit 1
fi

echo "protocol=https"
echo "host=github.com"
echo "username=${USERNAME}"
echo "password=${PASSWORD}"
echo ""
