#!/bin/bash
# Hook: Notify when Claude stops (Stop event)
# Receives JSON input via stdin from Claude Code
# Forwards full context to internal API for LLM-based classification
# Uses REMOTE_AGENT_SESSION_ID env var set by our terminal spawner

# Read JSON input from stdin
INPUT=$(cat)

# Use our session ID from environment (set when spawning Claude terminal)
SESSION_ID="${REMOTE_AGENT_SESSION_ID:-unknown}"

# Extract fields from Claude's Stop hook input
LAST_MESSAGE=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('last_assistant_message', ''))
except:
    print('')
" 2>/dev/null || echo "")

TRANSCRIPT_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('transcript_path', ''))
except:
    print('')
" 2>/dev/null || echo "")

STOP_REASON=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('stop_reason', ''))
except:
    print('')
" 2>/dev/null || echo "")

HOOK_EVENT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('hook_event_name', 'Stop'))
except:
    print('Stop')
" 2>/dev/null || echo "Stop")

# Escape strings for JSON
escape_json() {
  python3 -c "import sys, json; print(json.dumps(sys.stdin.read().strip()))" <<< "$1" 2>/dev/null || echo '""'
}

LAST_MESSAGE_JSON=$(escape_json "$LAST_MESSAGE")
TRANSCRIPT_PATH_JSON=$(escape_json "$TRANSCRIPT_PATH")

# Call internal API to trigger classified notification
curl -s -X POST "http://localhost:5100/internal/hooks/complete" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"last_assistant_message\": ${LAST_MESSAGE_JSON},
    \"transcript_path\": ${TRANSCRIPT_PATH_JSON},
    \"hook_event_name\": \"${HOOK_EVENT}\",
    \"prompt\": \"Task completed\"
  }" || true

exit 0
