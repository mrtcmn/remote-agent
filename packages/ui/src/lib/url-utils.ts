/**
 * Extract the active terminalId from the current URL path.
 * Matches: /sessions/:sessionId/:terminalId
 */
export function getActiveTerminalIdFromUrl(): string | undefined {
  const match = window.location.pathname.match(/\/sessions\/[^/]+\/([^/]+)/);
  return match?.[1] || undefined;
}
