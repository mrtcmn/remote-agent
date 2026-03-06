import { Elysia } from 'elysia';
import { codeEditorService } from '../services/code-editor';
import { requireAuth } from '../auth/middleware';

export const editorProxyRoutes = new Elysia()
  .use(requireAuth)

  // Proxy all HTTP requests to code-server
  .all('/editor-proxy/:editorId/*', async ({ params, request, set }) => {
    const editor = codeEditorService.getEditor(params.editorId);
    if (!editor || (editor.status !== 'running' && editor.status !== 'starting')) {
      set.status = 502;
      return { error: 'Editor not running' };
    }

    const url = new URL(request.url);
    const proxyPath = url.pathname.replace(`/editor-proxy/${params.editorId}`, '') || '/';
    const targetUrl = `http://127.0.0.1:${editor.port}${proxyPath}${url.search}`;

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
  });
