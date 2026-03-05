// In-memory user presence tracking
interface UserPresence {
  lastHeartbeat: number;
  activeTerminalIds: Set<string>;
}

class PresenceManager {
  private presence = new Map<string, UserPresence>();
  private static ACTIVE_THRESHOLD_MS = 60 * 1000; // 1 minute

  heartbeat(userId: string, terminalId?: string): void {
    // Prune stale entries to prevent unbounded growth
    if (this.presence.size > 100) {
      const now = Date.now();
      for (const [key, val] of this.presence) {
        if (now - val.lastHeartbeat > PresenceManager.ACTIVE_THRESHOLD_MS * 10) {
          this.presence.delete(key);
        }
      }
    }

    const activeTerminalIds = new Set<string>();
    if (terminalId) activeTerminalIds.add(terminalId);

    this.presence.set(userId, {
      lastHeartbeat: Date.now(),
      activeTerminalIds,
    });
  }

  isUserActive(userId: string): boolean {
    const p = this.presence.get(userId);
    if (!p) return false;
    return Date.now() - p.lastHeartbeat < PresenceManager.ACTIVE_THRESHOLD_MS;
  }

  isTerminalActive(userId: string, terminalId: string): boolean {
    const p = this.presence.get(userId);
    if (!p) return false;
    if (Date.now() - p.lastHeartbeat >= PresenceManager.ACTIVE_THRESHOLD_MS)
      return false;
    return p.activeTerminalIds.has(terminalId);
  }
}

export const presenceManager = new PresenceManager();
