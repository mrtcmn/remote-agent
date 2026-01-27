#!/bin/bash
# Hook: Notify when Claude needs user attention

SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
PROMPT="${1:-User input required}"

# Call internal API to trigger notification
curl -s -X POST "http://localhost:5100/internal/hooks/attention" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"type\": \"user_input_required\",
    \"prompt\": \"${PROMPT}\"
  }" || true
