import { useState, useCallback, useRef } from 'react';
import type { PresentationRequest, SlidePlan, PresentationSlide } from '@/lib/api';

export type PresentationStatus = 'idle' | 'connecting' | 'planning' | 'narrating' | 'done' | 'error';

export interface UsePresentationStreamReturn {
  plan: SlidePlan | null;
  slides: PresentationSlide[];
  status: PresentationStatus;
  error: string | null;
  start: (sessionId: string, request: PresentationRequest) => void;
  cancel: () => void;
}

export function usePresentationStream(): UsePresentationStreamReturn {
  const [plan, setPlan] = useState<SlidePlan | null>(null);
  const [slides, setSlides] = useState<PresentationSlide[]>([]);
  const [status, setStatus] = useState<PresentationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback((sessionId: string, request: PresentationRequest) => {
    // Reset state
    setPlan(null);
    setSlides([]);
    setError(null);
    setStatus('connecting');

    // Abort any existing stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Build URL
    const params = new URLSearchParams();
    if (request.unstaged) params.set('unstaged', 'true');
    if (request.staged) params.set('staged', 'true');
    if (request.commitHashes?.length) params.set('commitHashes', request.commitHashes.join(','));
    if (request.projectId) params.set('projectId', request.projectId);

    const url = `/api/sessions/${sessionId}/presentation/stream?${params.toString()}`;

    fetch(url, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(body.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        setStatus('planning');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = '';

          let eventType = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              try {
                const data = JSON.parse(dataStr);
                handleEvent(eventType, data);
              } catch {
                // Incomplete JSON, put back in buffer
                buffer = `event: ${eventType}\n${line}\n`;
              }
            } else if (line.trim() === '') {
              // Event boundary — reset
              eventType = '';
            } else {
              // Incomplete line, keep in buffer
              buffer += line + '\n';
            }
          }
        }

        // Stream finished — if we haven't received a done event, mark as done
        setStatus((prev) => (prev === 'error' ? 'error' : 'done'));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setStatus('error');
      });

    function handleEvent(event: string, data: unknown) {
      switch (event) {
        case 'plan':
          setPlan(data as SlidePlan);
          setStatus('narrating');
          break;
        case 'slide':
          setSlides((prev) => [...prev, data as PresentationSlide]);
          break;
        case 'done':
          setStatus('done');
          break;
        case 'error':
          setError((data as { message: string }).message);
          setStatus('error');
          break;
      }
    }
  }, []);

  return { plan, slides, status, error, start, cancel };
}
