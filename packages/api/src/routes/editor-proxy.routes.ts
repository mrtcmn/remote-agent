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

export const editorProxyRoutes = new Elysia()
  .use(requireAuth)

  // Handle exact /editor-proxy/:editorId (no trailing path)
  .all('/editor-proxy/:editorId', async ({ params, request, set }) => {
    return proxyToEditor(params.editorId, request, set);
  })

  // Handle /editor-proxy/:editorId/* (with sub-paths)
  .all('/editor-proxy/:editorId/*', async ({ params, request, set }) => {
    return proxyToEditor(params.editorId, request, set);
  });
