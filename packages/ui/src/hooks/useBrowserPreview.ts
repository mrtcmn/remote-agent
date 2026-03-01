import { useEffect, useRef, useState, useCallback } from 'react';
import type { ViewportPreset } from '@/lib/api';

interface PreviewStatus {
  connected: boolean;
  viewport: ViewportPreset;
  url: string;
  width: number;
  height: number;
}

const VIEWPORT_DIMENSIONS: Record<ViewportPreset, { width: number; height: number }> = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
  desktop_hd: { width: 1920, height: 1080 },
};

export function useBrowserPreview(previewId: string | null) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [fps, setFps] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimeout = useRef<number>();
  const frameTimestamps = useRef<number[]>([]);

  const connect = useCallback(() => {
    if (!previewId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/preview/${previewId}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      reconnectCount.current = 0;
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (reconnectCount.current < 5) {
        reconnectTimeout.current = window.setTimeout(() => {
          reconnectCount.current++;
          connect();
        }, 3000);
      }
    };

    ws.onerror = () => {};

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'connected':
            setStatus({
              connected: true,
              viewport: message.data.viewport,
              url: message.data.url,
              width: message.data.width,
              height: message.data.height,
            });
            break;

          case 'frame': {
            setImageSrc(`data:image/jpeg;base64,${message.data.image}`);
            // Track FPS
            const now = Date.now();
            frameTimestamps.current.push(now);
            // Keep only last second of timestamps
            frameTimestamps.current = frameTimestamps.current.filter(t => now - t < 1000);
            setFps(frameTimestamps.current.length);
            break;
          }

          case 'navigated':
            setStatus(prev => prev ? { ...prev, url: message.data.url } : null);
            break;

          case 'stopped':
            setIsConnected(false);
            setImageSrc(null);
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    wsRef.current = ws;
  }, [previewId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }
    reconnectCount.current = 5; // Prevent reconnection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((type: string, data?: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  const navigate = useCallback((url: string) => {
    send('navigate', { url });
  }, [send]);

  const setViewport = useCallback((preset: ViewportPreset) => {
    send('viewport', { preset });
    const dims = VIEWPORT_DIMENSIONS[preset];
    setStatus(prev => prev ? { ...prev, viewport: preset, width: dims.width, height: dims.height } : null);
  }, [send]);

  const sendMouseEvent = useCallback((
    type: 'mousedown' | 'mouseup' | 'mousemove' | 'click',
    x: number,
    y: number,
    button?: 'left' | 'right' | 'middle',
  ) => {
    send('mouse', { type, x, y, button: button || 'left' });
  }, [send]);

  const sendKeyEvent = useCallback((
    type: 'keydown' | 'keyup' | 'char',
    key: string,
    code?: string,
    modifiers?: number,
  ) => {
    send('key', { type, key, code, modifiers });
  }, [send]);

  const sendScrollEvent = useCallback((
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ) => {
    send('scroll', { type: 'scroll', x, y, deltaX, deltaY });
  }, [send]);

  // Scale mouse coordinates from display size to viewport size
  const scaleCoordinates = useCallback((
    clientX: number,
    clientY: number,
    imgElement: HTMLImageElement,
  ): { x: number; y: number } | null => {
    if (!status) return null;

    const rect = imgElement.getBoundingClientRect();
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;

    // Scale from display size to viewport size
    const scaleX = status.width / rect.width;
    const scaleY = status.height / rect.height;

    return {
      x: relX * scaleX,
      y: relY * scaleY,
    };
  }, [status]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    imageSrc,
    isConnected,
    status,
    fps,
    navigate,
    setViewport,
    sendMouseEvent,
    sendKeyEvent,
    sendScrollEvent,
    scaleCoordinates,
    disconnect,
  };
}
