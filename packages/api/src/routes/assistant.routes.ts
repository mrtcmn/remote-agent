import { Elysia, t } from 'elysia';
import { authMiddleware } from '../auth/middleware';
import { handle, setBaseUrl } from '../mcp-server';
import { ask, MCP_SECRET, MCP_SECRET_HEADER } from '../services/assistant';
import { watchAgent, watchEvents, type AgentUpdate } from '../services/assistant/watch';
import { sonioxSettings } from '../services/soniox';

const SONIOX_TTS_URL = 'https://tts-rt.soniox.com/tts';
/** Raw PCM so the browser can play chunks as they stream in (first audio ≈0.5s). */
export const TTS_SAMPLE_RATE = 24000;
const PORT = process.env.RA_PORT || process.env.PORT || 5100;

// The in-process tools must call *this* API. Left alone they honour
// REMOTE_AGENT_API, which points elsewhere when the server itself was started
// from inside a remote-agent session (dev beside the installed app).
setBaseUrl(`http://localhost:${PORT}`);

/**
 * The remote-agent MCP tools over streamable HTTP, for the operator's claude
 * child only. JSON responses, no SSE — every tool is request/response.
 * Not behind requireAuth: the child has no cookie; the per-process secret is the
 * gate, and the tools themselves call the API with their own credentials.
 */
const mcpRoutes = new Elysia({ prefix: '/assistant' })
  .post('/mcp', async ({ request, body, set }) => {
    if (request.headers.get(MCP_SECRET_HEADER) !== MCP_SECRET) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    const msgs = Array.isArray(body) ? body : [body];
    const replies = (await Promise.all(msgs.map((m: any) => handle(m)))).filter(Boolean);
    if (!replies.length) {
      set.status = 202;
      return '';
    }
    return Array.isArray(body) ? replies : replies[0];
  })
  .get('/mcp', ({ set }) => {
    set.status = 405;
    return '';
  });

export const assistantRoutes = new Elysia()
  .use(mcpRoutes)
  .group('/assistant', (app) =>
    app
      .use(authMiddleware)
      // A local guard, not requireAuth: that plugin is name-deduped, so its
      // onBeforeHandle only runs on the first instance that used it.
      .onBeforeHandle(({ user, set }) => {
        if (!user) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
      })
      // One operator turn as SSE: tool steps as they happen, then the reply.
      .post('/ask', ({ body, user }) => {
        const encoder = new TextEncoder();
        let gen: ReturnType<typeof ask> | null = null;
        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            gen = ask({
              text: body.text,
              resume: body.sessionId,
              mcpUrl: `http://localhost:${PORT}/api/assistant/mcp`,
              onHandoff: (target) => void watchAgent(user!.id, target),
            });
            try {
              for await (const ev of gen) send(ev);
            } catch (err) {
              send({ type: 'error', message: (err as Error).message });
            } finally {
              controller.close();
            }
          },
          cancel() {
            gen?.return(undefined);
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        });
      }, {
        body: t.Object({ text: t.String({ minLength: 1, maxLength: 4000 }), sessionId: t.Optional(t.String()) }),
      })
      // Agent updates for this user (see watch.ts), as SSE. The panel keeps it open.
      .get('/events', ({ user }) => {
        const encoder = new TextEncoder();
        let cleanup = () => {};
        const stream = new ReadableStream({
          start(controller) {
            const send = (chunk: string) => {
              try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
            };
            const onUpdate = (u: AgentUpdate) => send(`data: ${JSON.stringify(u)}\n\n`);
            // A comment line every 20s keeps proxies from closing an idle stream.
            const ping = setInterval(() => send(': ping\n\n'), 20_000);
            watchEvents.on(user!.id, onUpdate);
            cleanup = () => {
              clearInterval(ping);
              watchEvents.off(user!.id, onUpdate);
            };
            send(': connected\n\n');
          },
          cancel() {
            cleanup();
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        });
      })
      // Soniox REST TTS, streamed through as raw PCM; the key never reaches the browser.
      .post('/speak', async ({ body, set }) => {
        const key = sonioxSettings.get();
        if (!key) {
          set.status = 503;
          return { error: 'Voice not configured — add a Soniox API key in Settings.' };
        }
        const res = await fetch(SONIOX_TTS_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'tts-rt-v2',
            language: body.language || 'en',
            voice: process.env.ASSISTANT_VOICE || 'Adrian',
            audio_format: 'pcm_s16le',
            sample_rate: TTS_SAMPLE_RATE,
            text: body.text,
          }),
        });
        if (!res.ok) {
          set.status = 502;
          return { error: `Soniox TTS failed (${res.status}): ${(await res.text()).slice(0, 200)}` };
        }
        return new Response(res.body, {
          headers: { 'Content-Type': 'audio/pcm', 'X-Sample-Rate': String(TTS_SAMPLE_RATE), 'Cache-Control': 'no-store' },
        });
      }, {
        body: t.Object({
          text: t.String({ minLength: 1, maxLength: 5000 }),
          language: t.Optional(t.String({ pattern: '^[a-z]{2}$' })),
        }),
      }),
  );
