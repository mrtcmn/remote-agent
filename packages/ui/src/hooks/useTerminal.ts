import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';
import { getApiBase } from '@/lib/api-config';
import { getActiveMachineId, resolveWsPath } from '@/lib/active-machine';

// Decode a base64 WebSocket payload to raw bytes. We hand the Uint8Array
// straight to xterm.write(), which runs a single UTF-8 decoder whose state is
// preserved across writes — so multi-byte glyphs (box-drawing, emoji, …) that
// the PTY splits across separate `output` messages get reassembled correctly.
//
// Previously each message was decoded to a string here with a fresh,
// non-streaming TextDecoder. Any UTF-8 sequence straddling a chunk boundary
// decoded to replacement chars on both sides (E2 94 80 → "─" became "��"),
// surfacing as garbled box-drawing during TUI redraws like arrow-key
// navigation. The one-shot scrollback replay is a single message, so it never
// split — which is why the initial paint looked fine and only interaction broke.
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Kitty keyboard protocol key codes (unicode-key-code) for keys that need
// disambiguation. Only keys that produce legacy ambiguous encodings are
// included — other keys fall through to xterm's default handling.
const KITTY_KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 127,
  Escape: 27,
};

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
  theme?: ITheme;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onExit?: (exitCode: number) => void;
  onTitleChanged?: (name: string) => void;
}

interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement>;
  isConnected: boolean;
  status: 'connecting' | 'connected' | 'disconnected' | 'exited';
  fit: () => void;
  refresh: () => void;
  reconnect: () => void;
}

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { terminalId, theme: externalTheme, fontFamily: externalFontFamily, fontWeight: externalFontWeight, fontSize: externalFontSize, onConnect, onDisconnect, onExit, onTitleChanged } = options;

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
  const onTitleChangedRef = useRef(onTitleChanged);
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;
  onExitRef.current = onExit;
  onTitleChangedRef.current = onTitleChanged;

  const resizeDebounceRef = useRef<number>();
  const connectWebSocketRef = useRef<(() => void) | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const reconnect = useCallback(() => {
    // Don't reconnect if already connected/connecting or if process exited
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    if (statusRef.current === 'exited') return;
    if (!xtermRef.current) return;

    console.log('[Terminal] Reconnecting WebSocket...');

    // Close stale reference if any
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent triggering disconnect handler
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('connecting');
    connectWebSocketRef.current?.();
  }, []);

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
    let pasteCleanup: (() => void) | null = null;

    // Function to initialize terminal once container has dimensions
    const initTerminal = () => {
      if (isDisposed) return;

      // Initialize xterm with macOS Terminal-like appearance
      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

      const defaultTheme: ITheme = {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: '#3a3d41',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#c91b00',
        green: '#00c200',
        yellow: '#c7c400',
        blue: '#0225c7',
        magenta: '#c930c7',
        cyan: '#00c5c7',
        white: '#c7c7c7',
        brightBlack: '#676767',
        brightRed: '#ff6d67',
        brightGreen: '#5ff967',
        brightYellow: '#fefb67',
        brightBlue: '#6871ff',
        brightMagenta: '#ff76ff',
        brightCyan: '#5ffdff',
        brightWhite: '#feffff',
      };

      const resolvedTheme = externalTheme || defaultTheme;

      xterm = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: externalFontSize || (isMobile ? 10 : 11),
        fontFamily: externalFontFamily || '"Fira Code", "SF Mono", "Menlo", "Monaco", "Cascadia Code", "Consolas", monospace',
        fontWeight: String(externalFontWeight || 500) as any,
        fontWeightBold: String(Math.min((externalFontWeight || 500) + 100, 900)) as any,
        lineHeight: 1.2,
        letterSpacing: 0,
        scrollback: 5000,
        smoothScrollDuration: isMobile ? 100 : 0,
        theme: resolvedTheme,
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const clipboardAddon = new ClipboardAddon();

      xterm.loadAddon(fitAddon);
      xterm.loadAddon(webLinksAddon);
      xterm.loadAddon(clipboardAddon);

      // Kitty keyboard protocol: track enabled flags so TUIs (Claude Code, nvim,
      // helix, etc.) can request disambiguated key events — notably Shift+Enter.
      // https://sw.kovidgoyal.net/kitty/keyboard-protocol/
      let kittyFlags = 0;
      const kittyStack: number[] = [];

      const sendInput = (data: string) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: encodeBase64(data) }));
        }
      };

      xterm.parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => {
        sendInput(`\x1b[?${kittyFlags}u`);
        return true;
      });
      xterm.parser.registerCsiHandler({ prefix: '>', final: 'u' }, (params) => {
        const flags = (params[0] as number) ?? 1;
        kittyStack.push(kittyFlags);
        kittyFlags = flags;
        return true;
      });
      xterm.parser.registerCsiHandler({ prefix: '<', final: 'u' }, (params) => {
        const count = (params[0] as number) ?? 1;
        for (let i = 0; i < count; i++) kittyFlags = kittyStack.pop() ?? 0;
        return true;
      });
      xterm.parser.registerCsiHandler({ prefix: '=', final: 'u' }, (params) => {
        const flags = (params[0] as number) ?? 0;
        const mode = (params[1] as number) ?? 1;
        if (mode === 1) kittyFlags = flags;
        else if (mode === 2) kittyFlags |= flags;
        else if (mode === 3) kittyFlags &= ~flags;
        return true;
      });

      // Allow Ctrl+V/Cmd+V to trigger browser paste, and Ctrl+C/Cmd+C to copy selection
      xterm.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;

        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
          return false;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'c' && xterm!.hasSelection()) {
          return false;
        }

        // When kitty keyboard protocol is enabled by the TUI, encode modified
        // Enter/Tab/Backspace as CSI u so Shift+Enter (and friends) are
        // distinguishable from plain Enter.
        if (kittyFlags & 1) {
          const kittyCode = KITTY_KEY_CODES[event.key];
          if (kittyCode !== undefined) {
            const mod =
              1 +
              (event.shiftKey ? 1 : 0) +
              (event.altKey ? 2 : 0) +
              (event.ctrlKey ? 4 : 0) +
              (event.metaKey ? 8 : 0);
            if (mod > 1) {
              event.preventDefault();
              sendInput(`\x1b[${kittyCode};${mod}u`);
              return false;
            }
          }
        }

        return true;
      });

      xterm.open(container);

      // Handle paste events (text and image)
      const handlePaste = async (e: ClipboardEvent) => {
        if (isDisposed) return;
        e.preventDefault();

        // Check for image data first
        const items = e.clipboardData?.items;
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              const blob = item.getAsFile();
              if (blob) {
                await handleImagePaste(blob);
                return;
              }
            }
          }
        }

        // Fall back to text paste
        const text = e.clipboardData?.getData('text/plain');
        if (text && ws?.readyState === WebSocket.OPEN) {
          const base64 = encodeBase64(text);
          ws.send(JSON.stringify({ type: 'input', data: base64 }));
        }
      };

      const handleImagePaste = async (blob: File) => {
        try {
          const formData = new FormData();
          formData.append('image', blob);

          const headers: Record<string, string> = {};
          const activeId = getActiveMachineId();
          if (activeId && activeId !== 'self') headers['X-Machine-Id'] = activeId;

          const response = await fetch(`${getApiBase()}/api/terminals/${terminalId}/paste-image`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: formData,
          });
          const result = await response.json();

          if (result.filePath && ws?.readyState === WebSocket.OPEN) {
            const base64 = encodeBase64(result.filePath + ' ');
            ws.send(JSON.stringify({ type: 'input', data: base64 }));
          }
        } catch (error) {
          console.error('Failed to upload pasted image:', error);
        }
      };

      // Right-click to paste
      const handleContextMenu = async (e: MouseEvent) => {
        if (isDisposed) return;
        e.preventDefault();
        try {
          const text = await navigator.clipboard.readText();
          if (text && ws?.readyState === WebSocket.OPEN) {
            const base64 = encodeBase64(text);
            ws.send(JSON.stringify({ type: 'input', data: base64 }));
          }
        } catch {
          // Clipboard API not available or permission denied
        }
      };

      container.addEventListener('paste', handlePaste);
      container.addEventListener('contextmenu', handleContextMenu);

      // Improve mobile touch scrolling: boost scroll speed and momentum
      let touchStartY = 0;
      let touchScrollCleanup: (() => void) | null = null;
      if (isMobile) {
        const handleTouchStart = (e: TouchEvent) => {
          touchStartY = e.touches[0].clientY;
        };
        const handleTouchMove = (e: TouchEvent) => {
          if (!xterm) return;
          const deltaY = touchStartY - e.touches[0].clientY;
          touchStartY = e.touches[0].clientY;
          // Scroll by lines based on touch delta (amplify for momentum feel)
          const lines = Math.round(deltaY / 10);
          if (lines !== 0) {
            xterm.scrollLines(lines);
          }
          // Prevent page scroll while scrolling terminal
          e.preventDefault();
        };
        container.addEventListener('touchstart', handleTouchStart, { passive: true });
        container.addEventListener('touchmove', handleTouchMove, { passive: false });
        touchScrollCleanup = () => {
          container.removeEventListener('touchstart', handleTouchStart);
          container.removeEventListener('touchmove', handleTouchMove);
        };
      }

      pasteCleanup = () => {
        container.removeEventListener('paste', handlePaste);
        container.removeEventListener('contextmenu', handleContextMenu);
        touchScrollCleanup?.();
      };

      xtermRef.current = xterm;
      fitAddonRef.current = fitAddon;

      // Defer initial fit to next frame to ensure render service is initialized
      requestAnimationFrame(() => {
        if (isDisposed || !fitAddon) return;
        if (fitAddon.proposeDimensions()) {
          fitAddon.fit();
        }
        // Connect WebSocket only AFTER initial fit. On localhost the WS
        // handshake completes in ~1ms — without this ordering, `ws.onopen`
        // would race the rAF-deferred fit and send the pre-fit xterm default
        // (80×24) as the PTY size. The PTY then wraps at 80 cols while xterm
        // renders at the container width, garbling output (chars overwrite,
        // lines bleed into each other). Symptom is local-mode-specific.
        connectWebSocket();
      });

      // xterm computes the column count from the character cell width, which
      // depends on the loaded font. The initial fits above can run before the
      // web font ("Fira Code") has loaded, so they measure with a fallback
      // font's metrics and lock in the wrong cols (e.g. 72 when only 70 fit).
      // The cell width changes when the real font swaps in, but nothing
      // re-fits — a font swap doesn't resize the container, so the
      // ResizeObserver never fires. That's why output stays garbled until a
      // manual resize. Re-fit (and notify the PTY via fit()) once fonts are
      // ready so the measurement uses the real glyph metrics from the start.
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(() => {
          if (isDisposed) return;
          fit();
        });
      }
    };

    const connectWebSocket = () => {
      if (isDisposed || !xterm || !fitAddon) return;

      // Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${resolveWsPath(`/ws/terminal/${terminalId}`)}`;
      ws = new WebSocket(wsUrl);

      const currentXterm = xterm;
      const currentFitAddon = fitAddon;

      ws.onopen = () => {
        if (isDisposed || !currentXterm) return;
        setIsConnected(true);
        setStatus('connected');
        onConnectRef.current?.();

        // Fit one more time immediately before reading dimensions, so the size
        // sent to the PTY reflects the actual container — not any stale xterm
        // default. The earlier rAF-deferred fit usually already ran, but if the
        // container resized between init and connect, this catches it.
        if (currentFitAddon.proposeDimensions()) {
          currentFitAddon.fit();
        }
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
              // Write raw bytes; xterm decodes UTF-8 with streaming state so
              // glyphs split across messages survive (see base64ToBytes).
              currentXterm.write(base64ToBytes(message.data));
              break;
            }

            case 'scrollback': {
              // Restore scrollback (raw bytes — see base64ToBytes)
              currentXterm.write(base64ToBytes(message.data), () => {
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
              // Route through fit() (NOT fitAddon.fit() directly) so the
              // freshly measured cols/rows are also sent to the PTY. A bare
              // fitAddon.fit() changes xterm's grid without telling the
              // server, so the PTY keeps wrapping at the stale width while
              // xterm renders at the new one — output overwrites itself and
              // lines bleed together (the "70 visible but server thinks 72"
              // mismatch). Manually resizing the window only papered over it
              // because that path does notify the PTY.
              fit();
              // Refresh display to ensure content is visible
              currentXterm.refresh(0, currentXterm.rows - 1);
              break;
            }

            case 'title_changed': {
              onTitleChangedRef.current?.(message.data.name);
              break;
            }
          }
        } catch (e) {
          console.error('Failed to parse terminal message:', e);
        }
      };

      wsRef.current = ws;
      connectWebSocketRef.current = connectWebSocket;

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
      pasteCleanup?.();
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

  // Live-update theme and font without re-creating the terminal.
  // xterm 6 uses reference equality to detect option changes
  // (see xterm.d.ts: "a new object must be used ... as a reference comparison will be done"),
  // so the theme must be a fresh object each time or the change listener never fires.
  useEffect(() => {
    if (xtermRef.current) {
      if (externalTheme) {
        xtermRef.current.options.theme = { ...externalTheme };
      }
      if (externalFontFamily) xtermRef.current.options.fontFamily = externalFontFamily;
      if (externalFontWeight) {
        xtermRef.current.options.fontWeight = String(externalFontWeight) as any;
        xtermRef.current.options.fontWeightBold = String(Math.min(externalFontWeight + 100, 900)) as any;
      }
      if (externalFontSize) xtermRef.current.options.fontSize = externalFontSize;
      // Go through the `fit` callback (not fitAddon directly) so the PTY
      // gets notified of the new cols/rows — font size changes the char
      // dimensions, which changes how many cols fit in the container.
      // Without this the PTY keeps wrapping at the old width and output
      // overwrites itself.
      fit();
      // Repaint rows so new colors show on already-rendered content
      xtermRef.current.refresh(0, xtermRef.current.rows - 1);
    }
  }, [externalTheme, externalFontFamily, externalFontWeight, externalFontSize, fit]);

  return {
    terminalRef,
    isConnected,
    status,
    fit,
    refresh,
    reconnect,
  };
}
