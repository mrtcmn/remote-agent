import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { getActiveTerminalIdFromUrl } from '@/lib/url-utils';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const IDLE_TIMEOUT_MS = 60_000; // 1 minute

/**
 * Sends heartbeat to backend when user is active (visible tab + recent interaction).
 * Extracts the currently viewed terminalId from the URL.
 */
export function useActivityHeartbeat() {
  const lastActivityRef = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // Track user interactions
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('scroll', onActivity, { passive: true });
    window.addEventListener('click', onActivity, { passive: true });

    const sendHeartbeat = () => {
      // Only send if tab is visible and user recently interacted
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) return;

      const terminalId = getActiveTerminalIdFromUrl();

      api.sendHeartbeat(terminalId).catch(() => {
        // Silently ignore heartbeat failures
      });
    };

    // Send immediately on mount, then every 30s
    sendHeartbeat();
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('scroll', onActivity);
      window.removeEventListener('click', onActivity);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
