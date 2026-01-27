import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

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
}

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { terminalId, onConnect, onDisconnect, onExit } = options;

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'exited'>('connecting');

  const resizeDebounceRef = useRef<number>();

  const fit = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit();

      // Send resize to backend (debounced)
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = window.setTimeout(() => {
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

    // Initialize xterm
    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#264f78',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);

    xterm.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${terminalId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      setStatus('connected');
      onConnect?.();

      // Send initial size
      const { cols, rows } = xterm;
      ws.send(JSON.stringify({
        type: 'resize',
        data: { cols, rows },
      }));
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (status !== 'exited') {
        setStatus('disconnected');
      }
      onDisconnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'output': {
            // Decode base64 and write to terminal
            const data = atob(message.data);
            xterm.write(data);
            break;
          }

          case 'scrollback': {
            // Restore scrollback
            const data = atob(message.data);
            xterm.write(data);
            break;
          }

          case 'exit': {
            setStatus('exited');
            xterm.write(`\r\n\x1b[31mProcess exited with code ${message.data.exitCode}\x1b[0m\r\n`);
            onExit?.(message.data.exitCode);
            break;
          }

          case 'connected': {
            // Resize to match server expectations if different
            if (message.data.cols !== xterm.cols || message.data.rows !== xterm.rows) {
              fitAddon.fit();
            }
            break;
          }
        }
      } catch (e) {
        console.error('Failed to parse terminal message:', e);
      }
    };

    wsRef.current = ws;

    // Handle terminal input
    xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Encode as base64
        const base64 = btoa(data);
        ws.send(JSON.stringify({
          type: 'input',
          data: base64,
        }));
      }
    });

    // Handle window resize
    const handleResize = () => fit();
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      ws.close();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [terminalId, onConnect, onDisconnect, onExit, fit, status]);

  return {
    terminalRef,
    isConnected,
    status,
    fit,
  };
}
