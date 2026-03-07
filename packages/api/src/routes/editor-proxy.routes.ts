import { Elysia } from 'elysia';
import { codeEditorService } from '../services/code-editor';
import { requireAuth } from '../auth/middleware';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stripProxyPrefix(pathname: string, editorId: string): string {
  const prefix = `/editor-proxy/${editorId}`;
  return pathname.startsWith(prefix)
    ? pathname.slice(prefix.length) || '/'
    : pathname;
}

// ---------------------------------------------------------------------------
// HTTP reverse-proxy
// ---------------------------------------------------------------------------

async function proxyToEditor(editorId: string, request: Request, set: any) {
  const editor = codeEditorService.getEditor(editorId);
  if (!editor || (editor.status !== 'running' && editor.status !== 'starting')) {
    set.status = 502;
    return { error: 'Editor not running' };
  }

  const url = new URL(request.url);
  const strippedPath = stripProxyPrefix(url.pathname, editorId);
  const targetUrl = `http://127.0.0.1:${editor.port}${strippedPath}${url.search}`;

  try {
    const headers = new Headers(request.headers);
    headers.set('Host', `127.0.0.1:${editor.port}`);
    headers.delete('connection');

    const proxyResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(proxyResponse.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    set.status = 502;
    return { error: 'Editor is starting up, please retry' };
  }
}

// Elysia's .all() in plugins loses priority to .get('*') catch-all on the main app.
// Register each HTTP method explicitly so the proxy routes match before the SPA catch-all.
const httpHandler = async ({ params, request, set }: any) => {
  return proxyToEditor(params.editorId, request, set);
};

const paths = ['/editor-proxy/:editorId', '/editor-proxy/:editorId/*'] as const;

const base = new Elysia().use(requireAuth);
for (const path of paths) {
  base
    .get(path, httpHandler)
    .post(path, httpHandler)
    .put(path, httpHandler)
    .delete(path, httpHandler)
    .patch(path, httpHandler)
    .options(path, httpHandler)
    .head(path, httpHandler);
}

// ---------------------------------------------------------------------------
// WebSocket reverse-proxy
// ---------------------------------------------------------------------------

// Store upstream (code-server) WebSocket per client connection.
// WeakMap avoids leaks — entries are GC'd when the client ws is collected.
const upstreamSockets = new WeakMap<object, WebSocket>();
const messageBuffers = new WeakMap<object, (string | ArrayBuffer)[]>();

function wsOpen(ws: any) {
  const { params, requestUrl } = ws.data;
  const editorId = params.editorId;

  const editor = codeEditorService.getEditor(editorId);
  if (!editor || (editor.status !== 'running' && editor.status !== 'starting')) {
    ws.close();
    return;
  }

  const url = new URL(requestUrl);
  const strippedPath = stripProxyPrefix(url.pathname, editorId);
  const targetUrl = `ws://127.0.0.1:${editor.port}${strippedPath}${url.search}`;

  // Forward Sec-WebSocket-Protocol if the client sent one
  const protocolHeader: string | undefined = ws.data.headers?.['sec-websocket-protocol'];
  const protocols = protocolHeader
    ? protocolHeader.split(',').map((p: string) => p.trim())
    : undefined;

  const upstream = new WebSocket(targetUrl, protocols);
  upstream.binaryType = 'arraybuffer';
  upstreamSockets.set(ws, upstream);

  const buffer: (string | ArrayBuffer)[] = [];
  messageBuffers.set(ws, buffer);

  upstream.addEventListener('open', () => {
    for (const msg of buffer) upstream.send(msg);
    buffer.length = 0;
  });

  upstream.addEventListener('message', (event: MessageEvent) => {
    try {
      if (typeof event.data === 'string') {
        ws.send(event.data);
      } else {
        ws.send(new Uint8Array(event.data as ArrayBuffer));
      }
    } catch {
      // Client already disconnected
    }
  });

  upstream.addEventListener('close', () => {
    upstreamSockets.delete(ws);
    messageBuffers.delete(ws);
    try { ws.close(); } catch {}
  });

  upstream.addEventListener('error', () => {
    upstreamSockets.delete(ws);
    messageBuffers.delete(ws);
    try { ws.close(); } catch {}
  });
}

function wsMessage(ws: any, message: string | Buffer) {
  const upstream = upstreamSockets.get(ws);
  if (!upstream) return;

  if (upstream.readyState === WebSocket.OPEN) {
    upstream.send(message);
  } else if (upstream.readyState === WebSocket.CONNECTING) {
    const buffer = messageBuffers.get(ws);
    if (buffer) {
      if (typeof message === 'string') {
        buffer.push(message);
      } else {
        // Store a copy as ArrayBuffer
        const ab = message.buffer.slice(
          message.byteOffset,
          message.byteOffset + message.byteLength,
        );
        buffer.push(ab as ArrayBuffer);
      }
    }
  }
}

function wsClose(ws: any) {
  const upstream = upstreamSockets.get(ws);
  if (upstream) {
    upstreamSockets.delete(ws);
    messageBuffers.delete(ws);
    upstream.close();
  }
}

const wsHandler = { open: wsOpen, message: wsMessage, close: wsClose };

// .resolve() captures the request URL for the ws open handler (runs before upgrade).
base.resolve(({ request }) => ({ requestUrl: request.url }));

for (const path of paths) {
  base.ws(path, wsHandler);
}

export const editorProxyRoutes = base;
