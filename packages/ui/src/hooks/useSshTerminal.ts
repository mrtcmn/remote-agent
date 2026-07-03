import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { getApiBase } from '@/lib/api-config';
import { resolveWsPath } from '@/lib/active-machine';

// Lean SSH terminal: xterm bound to /ws/ssh/:sessionId. Separate from
// useTerminal (which is welded to the local-PTY protocol/URL) on purpose.
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export type SshStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export function useSshTerminal(sessionId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SshStatus>('connecting');
  const [attempt, setAttempt] = useState(0);

  const fit = useCallback(() => {
    try {
      fitRef.current?.fit();
      const t = termRef.current;
      if (t && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', data: { cols: t.cols, rows: t.rows } }));
      }
    } catch { /* not mounted yet */ }
  }, []);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true, fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 13,
      theme: { background: '#0a0a0a', foreground: '#fafafa' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;
    fitAddon.fit();

    const base = getApiBase();
    const proto = (base || window.location.origin).startsWith('https') ? 'wss' : 'ws';
    const host = base ? base.replace(/^https?:\/\//, '') : window.location.host;
    const ws = new WebSocket(`${proto}://${host}${resolveWsPath(`/ws/ssh/${sessionId}`)}`);
    wsRef.current = ws;

    term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: bytesToB64(d) }));
    });

    ws.onopen = () => fit();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'scrollback':
        case 'output':
          term.write(b64ToBytes(msg.data));
          break;
        case 'connected':
          setStatus('connected'); setAttempt(0); fit();
          break;
        case 'reconnecting':
          setStatus('reconnecting'); setAttempt(msg.data.attempt);
          break;
        case 'exit':
          setStatus('closed');
          term.write(`\r\n\x1b[38;5;208m● session closed${msg.data?.message ? ': ' + msg.data.message : ''}\x1b[0m\r\n`);
          break;
        case 'status':
          if (msg.data.status === 'exited') setStatus('closed');
          break;
      }
    };
    ws.onclose = () => setStatus((s) => (s === 'reconnecting' ? s : 'closed'));

    // keepalive
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 20000);

    return () => {
      clearInterval(ping);
      ws.close();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, fit]);

  return { containerRef, status, attempt, fit };
}
