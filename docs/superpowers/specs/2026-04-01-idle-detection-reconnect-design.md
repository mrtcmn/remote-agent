# Idle Detection & Tab Visibility Reconnect

## Problem

When a user leaves a tab (switches away, goes idle), the terminal WebSocket connection dies. When the user returns, the terminal shows "disconnected" and requires a manual page refresh to reconnect. The WebSocket in `useTerminal.ts` has no reconnect logic at all.

## Solution

Enhance the existing activity/visibility detection and add automatic WebSocket reconnection when the user returns to an active terminal.

## Architecture

### 1. New Hook: `useConnectionRecovery`

**File:** `packages/ui/src/hooks/useConnectionRecovery.ts`

Listens for two "resume" signals:
- `visibilitychange` event: tab hidden -> visible
- User interaction after idle: mouse/keyboard/touch activity after being idle for >60s

When triggered:
1. Check if there's a `reconnect` function available (passed via parameter)
2. Call it (the reconnect function handles the "is it actually disconnected?" check internally)
3. Send an immediate heartbeat so the server knows the user is back

Debounced to avoid multiple reconnects from rapid tab switches.

**Interface:**
```typescript
function useConnectionRecovery(options: {
  onResume: () => void;
  idleTimeoutMs?: number; // default 60_000
}): void
```

### 2. Changes to `useTerminal.ts`

- Extract `connectWebSocket` so it can be called again after initial setup
- Add a `reconnect()` function that:
  - Checks if WebSocket is already OPEN or CONNECTING -> no-op
  - Checks if terminal is in 'exited' state -> no-op (don't reconnect dead processes)
  - Closes any stale WebSocket reference
  - Calls `connectWebSocket()` to establish a new connection
  - Server sends `scrollback` message on connect, so history is restored automatically
- Expose `reconnect` in the return value of `useTerminal`
- Reset status to 'connecting' when reconnect starts

**Updated return type:**
```typescript
interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement>;
  isConnected: boolean;
  status: 'connecting' | 'connected' | 'disconnected' | 'exited';
  fit: () => void;
  refresh: () => void;
  reconnect: () => void;  // NEW
}
```

### 3. Changes to `Terminal.tsx`

- Get `reconnect` from `useTerminal`
- Pass `reconnect` into `useConnectionRecovery`'s `onResume` callback
- Also send immediate heartbeat on resume

### 4. Changes to `useActivityHeartbeat.ts`

- Add reactive `visibilitychange` listener that sends an immediate heartbeat when tab becomes visible (instead of waiting for next 30s tick)

## Flow

```
User leaves tab
  -> Tab becomes hidden
  -> Heartbeats stop (existing behavior)
  -> WebSocket eventually closes (server timeout or network)

User returns
  -> visibilitychange fires (hidden -> visible)
  -> useConnectionRecovery detects resume
  -> Calls reconnect() on useTerminal
  -> reconnect() checks: WS closed + status != exited
  -> Opens new WebSocket to /ws/terminal/:terminalId
  -> Server sends scrollback history
  -> Terminal shows full conversation history
  -> Immediate heartbeat sent to server
```

## Edge Cases

- **Terminal process exited while away:** `reconnect()` is a no-op when status is 'exited'. User sees the exit message.
- **WebSocket still alive:** `reconnect()` is a no-op when WS is OPEN or CONNECTING.
- **Rapid tab switching:** Debounce on `useConnectionRecovery` prevents multiple reconnect attempts.
- **Multiple terminals open:** Only the currently rendered terminal reconnects (hook lives in Terminal component).

## Files Changed

| File | Change |
|------|--------|
| `packages/ui/src/hooks/useConnectionRecovery.ts` | New hook |
| `packages/ui/src/hooks/useTerminal.ts` | Add `reconnect()`, expose it |
| `packages/ui/src/components/Terminal.tsx` | Wire up `useConnectionRecovery` |
| `packages/ui/src/hooks/useActivityHeartbeat.ts` | Add reactive visibilitychange listener |

## No Changes Needed

- Backend: WebSocket server already handles new connections with scrollback replay
- `useWebSocket.ts`: Session-level WS, not related to terminal reconnection
- Presence routes: Already handle heartbeats correctly
