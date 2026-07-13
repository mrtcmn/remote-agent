import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
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

// Extract dropped-file paths. Electron/legacy webviews put a real path on the
// File; WKWebView (Electrobun) only exposes it as a file:// URI in dataTransfer.
function pathsFromDrop(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const fromFiles = Array.from(dt.files).map((f) => (f as { path?: string }).path).filter(Boolean) as string[];
  if (fromFiles.length) return fromFiles;
  const list = dt.getData('text/uri-list') || dt.getData('text/plain');
  return list.split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.startsWith('file://') ? decodeURIComponent(new URL(l).pathname) : l)
    .filter(Boolean);
}
// Single-quote paths with whitespace so the shell/Claude sees one argument.
const quotePath = (p: string) => /\s/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p;

export type SshStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface SshTerminalOptions {
  theme?: ITheme;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
}

export function useSshTerminal(sessionId: string | null, options: SshTerminalOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SshStatus>('connecting');
  const [attempt, setAttempt] = useState(0);
  // Read at terminal creation; live changes are applied by the options effect below.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fit = useCallback(() => {
    try {
      fitRef.current?.fit();
      const t = termRef.current;
      if (t && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', data: { cols: t.cols, rows: t.rows } }));
      }
    } catch { /* not mounted yet */ }
  }, []);

  // Apply theme/font changes to an already-open terminal.
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    if (options.theme) t.options.theme = options.theme;
    if (options.fontFamily) t.options.fontFamily = options.fontFamily;
    if (options.fontSize) t.options.fontSize = options.fontSize;
    if (options.fontWeight) t.options.fontWeight = options.fontWeight as never;
    fit();
  }, [options.theme, options.fontFamily, options.fontSize, options.fontWeight, fit]);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;
    const opts = optionsRef.current;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: opts.fontFamily ?? "'SF Mono','Fira Code',monospace",
      fontSize: opts.fontSize ?? 13,
      fontWeight: (opts.fontWeight ?? 'normal') as never,
      theme: opts.theme ?? { background: '#0a0a0a', foreground: '#fafafa' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    // Pass the URL straight to window.open — the webview routes _blank opens to
    // the system browser (see desktop window.ts). The addon's default handler
    // opens a blank window first, so the real URL never reaches that route.
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank', 'noopener,noreferrer')));
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

    // File drag-and-drop → type the path(s) into the session (for Claude's file import).
    const el = containerRef.current;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const paths = pathsFromDrop(e.dataTransfer);
      if (!paths.length || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'input', data: bytesToB64(paths.map(quotePath).join(' ') + ' ') }));
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);

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
        case 'error':
          setStatus('closed');
          break;
        case 'status':
          // Sent on attach: reflect the live instance state instead of
          // sitting on "connecting" forever when we reattach to a running session.
          if (msg.data.status === 'running') { setStatus('connected'); fit(); }
          else if (msg.data.status === 'exited') setStatus('closed');
          break;
      }
    };
    ws.onclose = () => setStatus((s) => (s === 'reconnecting' || s === 'closed' ? s : 'closed'));

    // keepalive
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 20000);

    return () => {
      clearInterval(ping);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
      ws.close();
      term.dispose();
      termRef.current = null;
      setStatus('connecting');
      setAttempt(0);
    };
  }, [sessionId, fit]);

  return { containerRef, status, attempt, fit };
}
