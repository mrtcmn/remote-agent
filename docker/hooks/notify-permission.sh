#!/bin/bash
# Hook: Notify when Claude needs permission

SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
PERMISSION="${1:-Permission required}"

# Call internal API to trigger notification
curl -s -X POST "http://localhost:5100/internal/hooks/attention" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"type\": \"permission_request\",
    \"prompt\": \"${PERMISSION}\"
  }" || true
