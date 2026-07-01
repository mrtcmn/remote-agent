/**
 * Single source of truth for session route URLs.
 *
 * A session's owning machine is part of its addressable identity, so it lives in
 * the URL — `/sessions/:machineId/:id[/:terminalId]` — rather than in ambient
 * global state. This keeps remote sessions routable across reloads, the back
 * button, and bookmarks. `machineId` is `'self'` for the local machine or a
 * paired master's id.
 */
export function sessionPath(machineId: string, sessionId: string, terminalId?: string): string {
  const base = `/sessions/${machineId}/${sessionId}`;
  return terminalId ? `${base}/${terminalId}` : base;
}

/**
 * Extract the session id from a `/sessions/...` pathname. Supports both the
 * machine-scoped form (`/sessions/:machineId/:id[/:terminalId]`) and the legacy
 * bare form (`/sessions/:id`). Returns null for non-session paths.
 *
 * Used where the route params aren't directly available (e.g. the sidebar,
 * which renders outside the session route) to highlight the active session.
 */
export function sessionIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean); // ['sessions', a, b?, ...]
  if (segments[0] !== 'sessions' || segments.length < 2) return null;
  // Machine-scoped: sessions/:machineId/:id -> id is the 3rd segment.
  // Legacy bare:    sessions/:id            -> id is the 2nd segment.
  return segments.length >= 3 ? segments[2] : segments[1];
}
