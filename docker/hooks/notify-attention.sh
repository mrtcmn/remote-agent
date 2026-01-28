#!/bin/bash
# Hook: Notify when Claude needs user attention (Notification event)
# Receives JSON input via stdin from Claude Code
# Uses REMOTE_AGENT_SESSION_ID env var set by our terminal spawner

# Read JSON input from stdin
INPUT=$(cat)

# Use our session ID from environment (set when spawning Claude terminal)
SESSION_ID="${REMOTE_AGENT_SESSION_ID:-unknown}"

# Extract notification type and message from Claude's input
NOTIFICATION_TYPE=$(echo "$INPUT" | grep -o '"notification_type"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"notification_type"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || echo "notification")
MESSAGE=$(echo "$INPUT" | grep -o '"message"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"message"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || echo "Attention required")

# Determine notification type for API
if [ "$NOTIFICATION_TYPE" = "permission_prompt" ]; then
  API_TYPE="permission_request"
else
  API_TYPE="user_input_required"
fi

# Call internal API to trigger notification
curl -s -X POST "http://localhost:5100/internal/hooks/attention" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"type\": \"${API_TYPE}\",
    \"prompt\": \"${MESSAGE}\"
  }" || true

exit 0
