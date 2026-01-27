import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

// Proper base64 to UTF-8 decoding (atob doesn't handle multi-byte UTF-8)
function decodeBase64(base64: string): string {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// Proper UTF-8 to base64 encoding
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface UseTerminalOptions {
  terminalId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onExit?: (exitCode: number) => void;
}

interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement>;
  isConnected: boolean;
  status: 'connecting' | 'connected' | 'disconnected' | 'exited';
  fit: () => void;
  refresh: () => void;
}

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { terminalId, onConnect, onDisconnect, onExit } = options;

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const disposedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'exited'>('connecting');

  // Store callbacks in refs to avoid re-running effect when they change
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onExitRef = useRef(onExit);
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;
  onExitRef.current = onExit;

  const resizeDebounceRef = useRef<number>();

  const refresh = useCallback(() => {
    if (disposedRef.current || !xtermRef.current) return;
    xtermRef.current.refresh(0, xtermRef.current.rows - 1);
  }, []);

  const fit = useCallback(() => {
    // Guard against calling fit after terminal is disposed
    if (disposedRef.current) {
      return;
    }
    if (fitAddonRef.current && xtermRef.current) {
      // proposeDimensions() returns null if terminal isn't ready for fitting
      // This prevents errors when fit() is called before render service is initialized
      if (!fitAddonRef.current.proposeDimensions()) {
        return;
      }
      fitAddonRef.current.fit();
      // Also refresh after fit to ensure content is visible
      xtermRef.current.refresh(0, xtermRef.current.rows - 1);

      // Send resize to backend (debounced)
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = window.setTimeout(() => {
        if (disposedRef.current) return;
        if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
          const { cols, rows } = xtermRef.current;
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            data: { cols, rows },
          }));
        }
      }, 100);
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current || !terminalId) return;

    const container = terminalRef.current;

    // Reset disposed flag for new terminal
    disposedRef.current = false;
    let isDisposed = false;

    let xterm: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let ws: WebSocket | null = null;
    let dataDisposable: { dispose: () => void } | null = null;

    // Function to initialize terminal once container has dimensions
    const initTerminal = () => {
      if (isDisposed) return;

      // Initialize xterm with macOS Terminal-like appearance
      xterm = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 11,
        fontFamily: '"Fira Code", "SF Mono", "Menlo", "Monaco", "Cascadia Code", "Consolas", monospace',
        fontWeight: '500',
        fontWeightBold: '600',
        lineHeight: 1.2,
        letterSpacing: 0,
        allowTransparency: false,
        theme: {
          background: '#1e1e1e',
          foreground: '#cccccc',
          cursor: '#ffffff',
          cursorAccent: '#000000',
          selectionBackground: '#3a3d41',
          selectionForeground: '#ffffff',
          // Standard ANSI colors (macOS Terminal inspired)
          black: '#000000',
          red: '#c91b00',
          green: '#00c200',
          yellow: '#c7c400',
          blue: '#0225c7',
          magenta: '#c930c7',
          cyan: '#00c5c7',
          white: '#c7c7c7',
          // Bright colors
          brightBlack: '#676767',
          brightRed: '#ff6d67',
          brightGreen: '#5ff967',
          brightYellow: '#fefb67',
          brightBlue: '#6871ff',
          brightMagenta: '#ff76ff',
          brightCyan: '#5ffdff',
          brightWhite: '#feffff',
        },
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      xterm.loadAddon(fitAddon);
      xterm.loadAddon(webLinksAddon);

      xterm.open(container);

      xtermRef.current = xterm;
      fitAddonRef.current = fitAddon;

      // Defer initial fit to next frame to ensure render service is initialized
      requestAnimationFrame(() => {
        if (isDisposed || !fitAddon) return;
        if (fitAddon.proposeDimensions()) {
          fitAddon.fit();
        }
      });

      // Now connect WebSocket
      connectWebSocket();
    };

    const connectWebSocket = () => {
      if (isDisposed || !xterm || !fitAddon) return;

      // Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${terminalId}`;
      ws = new WebSocket(wsUrl);

      const currentXterm = xterm;
      const currentFitAddon = fitAddon;

      ws.onopen = () => {
        if (isDisposed || !currentXterm) return;
        setIsConnected(true);
        setStatus('connected');
        onConnectRef.current?.();

        // Send initial size
        const { cols, rows } = currentXterm;
        ws?.send(JSON.stringify({
          type: 'resize',
          data: { cols, rows },
        }));
      };

      ws.onclose = () => {
        if (isDisposed) return;
        setIsConnected(false);
        setStatus((prev) => prev === 'exited' ? 'exited' : 'disconnected');
        onDisconnectRef.current?.();
      };

      ws.onmessage = (event) => {
        if (isDisposed || !currentXterm) return;
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'output': {
              // Decode base64 to UTF-8 and write to terminal
              const data = decodeBase64(message.data);
              currentXterm.write(data);
              break;
            }

            case 'scrollback': {
              // Restore scrollback
              const data = decodeBase64(message.data);
              currentXterm.write(data, () => {
                // Refresh terminal display after scrollback is written
                currentXterm.refresh(0, currentXterm.rows - 1);
                // Scroll to bottom to show latest content
                currentXterm.scrollToBottom();
              });
              break;
            }

            case 'exit': {
              setStatus('exited');
              currentXterm.write(`\r\n\x1b[31mProcess exited with code ${message.data.exitCode}\x1b[0m\r\n`);
              onExitRef.current?.(message.data.exitCode);
              break;
            }

            case 'connected': {
              // Fit and refresh terminal when connected
              if (currentFitAddon?.proposeDimensions()) {
                currentFitAddon.fit();
              }
              // Refresh display to ensure content is visible
              currentXterm.refresh(0, currentXterm.rows - 1);
              break;
            }
          }
        } catch (e) {
          console.error('Failed to parse terminal message:', e);
        }
      };

      wsRef.current = ws;

      // Handle terminal input
      dataDisposable = currentXterm.onData((data) => {
        if (isDisposed) return;
        if (ws?.readyState === WebSocket.OPEN) {
          // Encode as UTF-8 base64
          const base64 = encodeBase64(data);
          ws.send(JSON.stringify({
            type: 'input',
            data: base64,
          }));
        }
      });
    };

    // Handle window resize
    const handleResize = () => {
      if (isDisposed) return;
      fit();
    };
    window.addEventListener('resize', handleResize);

    // Wait for container to have dimensions before initializing
    // This prevents xterm errors when opening in a zero-size container
    let initResizeObserver: ResizeObserver | null = null;

    if (container.clientWidth > 0 && container.clientHeight > 0) {
      initTerminal();
    } else {
      // Use ResizeObserver to wait for container to have dimensions
      initResizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          initResizeObserver?.disconnect();
          initResizeObserver = null;
          initTerminal();
        }
      });
      initResizeObserver.observe(container);
    }

    // Cleanup
    return () => {
      isDisposed = true;
      disposedRef.current = true;
      initResizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      dataDisposable?.dispose();
      ws?.close();
      xterm?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [terminalId, fit]);

  return {
    terminalRef,
    isConnected,
    status,
    fit,
    refresh,
  };
}
