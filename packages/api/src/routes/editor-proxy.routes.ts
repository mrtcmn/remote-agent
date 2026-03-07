import { Elysia } from 'elysia';
import { codeEditorService } from '../services/code-editor';
import { requireAuth } from '../auth/middleware';

async function proxyToEditor(editorId: string, request: Request, set: any) {
  const editor = codeEditorService.getEditor(editorId);
  if (!editor || (editor.status !== 'running' && editor.status !== 'starting')) {
    set.status = 502;
    return { error: 'Editor not running' };
  }

  const url = new URL(request.url);
  // Strip the /editor-proxy/<id> prefix — code-server serves from /
  const prefix = `/editor-proxy/${editorId}`;
  const strippedPath = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length) || '/'
    : url.pathname;
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
const handler = async ({ params, request, set }: any) => {
  return proxyToEditor(params.editorId, request, set);
};

const paths = ['/editor-proxy/:editorId', '/editor-proxy/:editorId/*'] as const;

const base = new Elysia().use(requireAuth);
for (const path of paths) {
  base
    .get(path, handler)
    .post(path, handler)
    .put(path, handler)
    .delete(path, handler)
    .patch(path, handler)
    .options(path, handler)
    .head(path, handler);
}

export const editorProxyRoutes = base;
