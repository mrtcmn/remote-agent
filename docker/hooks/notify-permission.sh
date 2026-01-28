#!/bin/bash
# Hook: Notify when Claude needs permission (legacy - now handled by notify-attention.sh)
# Receives JSON input via stdin from Claude Code
# Uses REMOTE_AGENT_SESSION_ID env var set by our terminal spawner

# Read JSON input from stdin (consume it even if not used)
cat > /dev/null

# Use our session ID from environment (set when spawning Claude terminal)
SESSION_ID="${REMOTE_AGENT_SESSION_ID:-unknown}"

# Call internal API to trigger notification
curl -s -X POST "http://localhost:5100/internal/hooks/attention" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"type\": \"permission_request\",
    \"prompt\": \"Permission required\"
  }" || true

exit 0
