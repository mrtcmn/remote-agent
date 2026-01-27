import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage {
  type: string;
  data: unknown;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(sessionId: string | null, options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimeout = useRef<number>();

  // Use refs for callbacks to avoid reconnection on callback changes
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const {
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const connect = useCallback(() => {
    if (!sessionId) return;

    // Prevent multiple connections
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/session/${sessionId}`;

    console.log('[WebSocket] Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      setIsConnected(true);
      reconnectCount.current = 0;
      optionsRef.current.onConnect?.();
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] Closed:', event.code, event.reason);
      setIsConnected(false);
      optionsRef.current.onDisconnect?.();

      // Auto reconnect
      if (reconnectCount.current < maxReconnectAttempts) {
        reconnectTimeout.current = window.setTimeout(() => {
          reconnectCount.current++;
          console.log('[WebSocket] Reconnecting, attempt:', reconnectCount.current);
          connect();
        }, reconnectInterval);
      }
    };

    ws.onerror = (event) => {
      console.error('[WebSocket] Error:', event);
      optionsRef.current.onError?.(event);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        setMessages((prev) => [...prev, message]);
        optionsRef.current.onMessage?.(message);
      } catch {
        console.error('Failed to parse WebSocket message:', event.data);
      }
    };

    wsRef.current = ws;
  }, [sessionId, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }
    reconnectCount.current = maxReconnectAttempts; // Prevent reconnection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [maxReconnectAttempts]);

  const send = useCallback((type: string, payload?: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const sendInput = useCallback((text: string) => {
    send('input', { text });
  }, [send]);

  const respondPermission = useCallback((allow: boolean) => {
    send('respond_permission', { allow });
  }, [send]);

  const terminate = useCallback(() => {
    send('terminate');
  }, [send]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    messages,
    send,
    sendInput,
    respondPermission,
    terminate,
    clearMessages: () => setMessages([]),
  };
}
