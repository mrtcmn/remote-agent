#!/bin/bash
# Hook: Notify when Claude completes a task

SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
MESSAGE="${1:-Task completed}"

# Call internal API to trigger notification
curl -s -X POST "http://localhost:5100/internal/hooks/attention" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"type\": \"task_complete\",
    \"prompt\": \"${MESSAGE}\"
  }" || true
