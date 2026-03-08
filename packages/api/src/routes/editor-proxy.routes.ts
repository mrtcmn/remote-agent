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
// vsda stubs — code-server doesn't ship Microsoft's proprietary vsda module.
// Serving stubs prevents 404 console noise; VS Code falls back gracefully.
// ---------------------------------------------------------------------------

// Minimal valid WebAssembly module (magic + version, no sections)
const VSDA_WASM_STUB = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

// VS Code loads vsda.js via its AMD loader, so the stub must use define().
const VSDA_JS_STUB = `\
define([], function() {
  return {
    default: function init() { return Promise.resolve(); },
    get_machine_id: function() { return "00000000000000000000000000000000"; }
  };
});
`;

// ---------------------------------------------------------------------------
// Response compression — code-server responses are auto-decompressed by fetch()
// so we re-compress before sending to the client to avoid huge transfers.
// ---------------------------------------------------------------------------

const COMPRESSIBLE_RE = /^(text\/|application\/(javascript|json|xml|wasm|xhtml\+xml|x-javascript)|image\/svg\+xml)/;

function compressResponse(request: Request, response: Response): Response {
  const acceptEncoding = request.headers.get('accept-encoding');
  if (!acceptEncoding?.includes('gzip')) return response;

  const contentType = response.headers.get('content-type');
  if (!contentType || !COMPRESSIBLE_RE.test(contentType)) return response;
  if (!response.body) return response;

  const headers = new Headers(response.headers);
  headers.set('content-encoding', 'gzip');
  headers.set('vary', 'Accept-Encoding');
  headers.delete('content-length');

  return new Response(
    response.body.pipeThrough(new CompressionStream('gzip')),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

function serveVsdaStub(path: string): Response | null {
  if (path.endsWith('/vsda_bg.wasm')) {
    return new Response(VSDA_WASM_STUB, {
      headers: { 'content-type': 'application/wasm' },
    });
  }
  if (path.endsWith('/vsda.js')) {
    return new Response(VSDA_JS_STUB, {
      headers: { 'content-type': 'application/javascript' },
    });
  }
  return null;
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

  // Intercept vsda requests before hitting code-server
  const vsdaResponse = serveVsdaStub(strippedPath);
  if (vsdaResponse) return vsdaResponse;

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

    const rawResponse = new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers: responseHeaders,
    });

    return compressResponse(request, rawResponse);
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

function buildUpstreamWsUrl(ws: any, editorId: string, port: number): string {
  // Primary: use requestUrl captured by derive()
  const requestUrl: string | undefined = ws.data.requestUrl;
  if (requestUrl) {
    const url = new URL(requestUrl);
    const strippedPath = stripProxyPrefix(url.pathname, editorId);
    return `ws://127.0.0.1:${port}${strippedPath}${url.search}`;
  }

  // Fallback: reconstruct from route params and query
  console.warn('[EditorProxy] WS: requestUrl missing from context, reconstructing from params/query');
  const wildcardPath = ws.data.params['*'] || '';
  const forwardPath = wildcardPath ? `/${wildcardPath}` : '/';
  const queryObj = ws.data.query || {};
  const qs = new URLSearchParams(queryObj as Record<string, string>).toString();
  return `ws://127.0.0.1:${port}${forwardPath}${qs ? '?' + qs : ''}`;
}

function wsOpen(ws: any) {
  const editorId = ws.data.params.editorId;

  try {
    const editor = codeEditorService.getEditor(editorId);
    if (!editor || (editor.status !== 'running' && editor.status !== 'starting')) {
      console.warn(`[EditorProxy] WS: Editor ${editorId} not available (status: ${editor?.status ?? 'not found'})`);
      ws.close();
      return;
    }

    const targetUrl = buildUpstreamWsUrl(ws, editorId, editor.port);
    console.log(`[EditorProxy] WS open: editor=${editorId} → ${targetUrl}`);

    // Forward Sec-WebSocket-Protocol if the client sent one
    const headers = ws.data.headers || {};
    const protocolHeader: string | undefined = headers['sec-websocket-protocol'];
    const protocols = protocolHeader
      ? protocolHeader.split(',').map((p: string) => p.trim())
      : undefined;

    const upstream = protocols?.length
      ? new WebSocket(targetUrl, protocols)
      : new WebSocket(targetUrl);
    upstream.binaryType = 'arraybuffer';
    upstreamSockets.set(ws, upstream);

    const buffer: (string | ArrayBuffer)[] = [];
    messageBuffers.set(ws, buffer);

    // Use property-based handlers (more reliable than addEventListener in Bun)
    upstream.onopen = () => {
      console.log(`[EditorProxy] WS upstream connected: editor=${editorId}, flushing ${buffer.length} buffered msgs`);
      for (const msg of buffer) upstream.send(msg);
      buffer.length = 0;
    };

    upstream.onmessage = (event: MessageEvent) => {
      try {
        // Always use ws.raw.send() to bypass Elysia's JSON serialization —
        // ws.send() would corrupt both text and binary protocol messages.
        if (typeof event.data === 'string') {
          ws.raw.send(event.data);
        } else {
          ws.raw.send(new Uint8Array(event.data as ArrayBuffer));
        }
      } catch {
        // Client already disconnected
      }
    };

    upstream.onclose = (event: CloseEvent) => {
      console.log(`[EditorProxy] WS upstream closed: editor=${editorId} code=${event.code}`);
      upstreamSockets.delete(ws);
      messageBuffers.delete(ws);
      try { ws.close(); } catch {}
    };

    upstream.onerror = (event: Event) => {
      console.error(`[EditorProxy] WS upstream error: editor=${editorId}`, event);
      upstreamSockets.delete(ws);
      messageBuffers.delete(ws);
      try { ws.close(); } catch {}
    };

    // Safety timeout: if upstream never connects, clean up
    setTimeout(() => {
      if (upstream.readyState === WebSocket.CONNECTING) {
        console.error(`[EditorProxy] WS upstream connect timeout (10s): editor=${editorId}`);
        upstream.close();
        upstreamSockets.delete(ws);
        messageBuffers.delete(ws);
        try { ws.close(); } catch {}
      }
    }, 10_000);
  } catch (err) {
    console.error(`[EditorProxy] WS open error: editor=${editorId}`, err);
    try { ws.close(); } catch {}
  }
}

function wsMessage(ws: any, message: string | Buffer) {
  const upstream = upstreamSockets.get(ws);
  if (!upstream) return;

  // Normalize binary data to Uint8Array for reliable sending across Bun WebSocket APIs
  const toSend: string | Uint8Array = typeof message === 'string'
    ? message
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);

  if (upstream.readyState === WebSocket.OPEN) {
    upstream.send(toSend);
  } else if (upstream.readyState === WebSocket.CONNECTING) {
    const buffer = messageBuffers.get(ws);
    if (buffer) {
      if (typeof toSend === 'string') {
        buffer.push(toSend);
      } else {
        // Store an owned copy so pooled Buffer memory can't be reused
        buffer.push(toSend.slice().buffer as ArrayBuffer);
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

// derive() captures the raw request URL for the ws open handler.
// Using derive (not resolve) because resolve can fail to pass data to ws handlers in Elysia.
// We only store requestUrl — Elysia's default ws.data.headers already has request headers.
base.derive(({ request }) => ({
  requestUrl: request.url,
}));

for (const path of paths) {
  base.ws(path, {
    ...wsHandler,
    idleTimeout: 960,   // 16 min — default 120s is too short for VS Code
  });
}

export const editorProxyRoutes = base;
