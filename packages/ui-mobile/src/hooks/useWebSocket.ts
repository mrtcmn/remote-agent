import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseUrl } from '../lib/api';
import * as SecureStore from 'expo-secure-store';

interface WebSocketMessage {
  type: string;
  data?: unknown;
  payload?: unknown;
}

interface UseWebSocketOptions {
  onMessage?: (msg: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(
  terminalId: string | null,
  options: UseWebSocketOptions = {}
) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(async () => {
    if (!terminalId) return;

    const base = getBaseUrl().replace(/^http/, 'ws');
    const cookie = await SecureStore.getItemAsync('auth_session_cookie');
    const url = `${base}/ws/terminal/${terminalId}${cookie ? `?token=${encodeURIComponent(cookie)}` : ''}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectCount.current = 0;
      onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WebSocketMessage;
        onMessage?.(msg);
      } catch {
        // non-JSON message
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      onDisconnect?.();

      if (reconnectCount.current < maxReconnectAttempts) {
        reconnectTimer.current = setTimeout(() => {
          reconnectCount.current++;
          connect();
        }, reconnectInterval);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [terminalId, onMessage, onConnect, onDisconnect, reconnectInterval, maxReconnectAttempts]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback(
    (type: string, payload?: unknown) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type, payload }));
      }
    },
    []
  );

  const sendInput = useCallback(
    (text: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Send raw terminal input as base64-encoded
        const encoded = btoa(unescape(encodeURIComponent(text)));
        wsRef.current.send(JSON.stringify({ type: 'input', data: encoded }));
      }
    },
    []
  );

  return {
    isConnected,
    send,
    sendInput,
    disconnect: () => {
      clearTimeout(reconnectTimer.current);
      reconnectCount.current = maxReconnectAttempts;
      wsRef.current?.close();
    },
  };
}
