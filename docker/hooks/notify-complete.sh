#!/bin/bash
# Hook: Notify when Claude completes a task (Stop event)
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
    \"type\": \"task_complete\",
    \"prompt\": \"Task completed\"
  }" || true

exit 0
