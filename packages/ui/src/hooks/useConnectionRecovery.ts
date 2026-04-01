import { useEffect, useRef } from 'react';

const IDLE_TIMEOUT_MS = 60_000; // 1 minute
const DEBOUNCE_MS = 1_000; // 1 second debounce for rapid tab switches

interface UseConnectionRecoveryOptions {
  onResume: () => void;
  idleTimeoutMs?: number;
}

/**
 * Detects when a user returns from tab-hidden or idle state and calls onResume.
 * Used to trigger WebSocket reconnection after the user comes back.
 */
export function useConnectionRecovery({
  onResume,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
}: UseConnectionRecoveryOptions) {
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  const lastActivityRef = useRef(Date.now());
  const wasIdleRef = useRef(false);
  const wasHiddenRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const triggerResume = () => {
      if (debounceRef.current) return;
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
      }, DEBOUNCE_MS);
      console.log('[ConnectionRecovery] Triggering resume');
      onResumeRef.current();
    };

    // Track tab visibility
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHiddenRef.current = true;
      } else if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        triggerResume();
      }
    };

    // Track user activity for idle detection
    const onActivity = () => {
      const now = Date.now();
      const wasIdle = now - lastActivityRef.current > idleTimeoutMs;
      lastActivityRef.current = now;

      if (wasIdle || wasIdleRef.current) {
        wasIdleRef.current = false;
        triggerResume();
      }
    };

    // Mark as idle when no activity for idleTimeoutMs
    const idleChecker = setInterval(() => {
      if (Date.now() - lastActivityRef.current > idleTimeoutMs) {
        wasIdleRef.current = true;
      }
    }, 10_000); // check every 10s

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('click', onActivity, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('click', onActivity);
      clearInterval(idleChecker);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [idleTimeoutMs]);
}
