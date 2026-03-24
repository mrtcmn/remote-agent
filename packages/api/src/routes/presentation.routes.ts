import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions, projectLinks } from '../db';
import { requireAuth } from '../auth/middleware';
import { presentationService } from '../services/presentation';
import type { PresentationRequest, SlideAnnotation } from '../services/presentation';

// In-memory annotation storage (ephemeral per session, capped per session)
const MAX_ANNOTATIONS_PER_SESSION = 100;
const annotationStore = new Map<string, SlideAnnotation[]>();

// Track active streams to prevent concurrent generation
const activeStreams = new Set<string>();

async function resolveProjectPath(
  sessionId: string,
  userId: string,
  projectId?: string,
): Promise<{ path: string } | null> {
  const session = await db.query.claudeSessions.findFirst({
    where: and(
      eq(claudeSessions.id, sessionId),
      eq(claudeSessions.userId, userId),
    ),
    with: { project: true },
  });

  if (!session?.project) return null;

  let targetPath = session.project.localPath;

  if (projectId && session.project.isMultiProject) {
    const link = await db.query.projectLinks.findFirst({
      where: and(
        eq(projectLinks.parentProjectId, session.project.id),
        eq(projectLinks.childProjectId, projectId),
      ),
      with: { childProject: true },
    });
    if (link && (link as any).childProject) {
      targetPath = (link as any).childProject.localPath;
    } else {
      return null;
    }
  } else if (!projectId && session.project.isMultiProject) {
    return null;
  }

  return { path: targetPath };
}

export const presentationRoutes = new Elysia({ prefix: '/sessions/:id/presentation' })
  .use(requireAuth)

  // Stream presentation via SSE
  .get('/stream', async ({ user, params, query, set }) => {
    const result = await resolveProjectPath(params.id, user!.id, query.projectId);

    if (!result) {
      set.status = 404;
      return { error: 'Session or project not found' };
    }

    // Concurrency guard
    if (activeStreams.has(params.id)) {
      set.status = 409;
      return { error: 'A presentation is already being generated for this session' };
    }

    const request: PresentationRequest = {
      projectPath: result.path,
      unstaged: query.unstaged === 'true',
      staged: query.staged === 'true',
      commitHashes: query.commitHashes
        ? query.commitHashes.split(',').filter(h => /^[a-f0-9]{4,40}$/.test(h))
        : undefined,
    };

    // Default to unstaged+staged if nothing specified
    if (!request.unstaged && !request.staged && !request.commitHashes?.length) {
      request.unstaged = true;
      request.staged = true;
    }

    activeStreams.add(params.id);
    const sessionId = params.id;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        function sendEvent(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          for await (const sseEvent of presentationService.generatePresentation(request)) {
            sendEvent(sseEvent.event, sseEvent.data);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          sendEvent('error', { message: msg });
        } finally {
          activeStreams.delete(sessionId);
          controller.close();
        }
      },
      cancel() {
        activeStreams.delete(sessionId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      unstaged: t.Optional(t.String()),
      staged: t.Optional(t.String()),
      commitHashes: t.Optional(t.String()),
      projectId: t.Optional(t.String()),
    }),
  })

  // Add annotation to a slide
  .post('/annotations', async ({ user, params, body, set }) => {
    const result = await resolveProjectPath(params.id, user!.id);
    if (!result) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const existing = annotationStore.get(params.id) || [];
    if (existing.length >= MAX_ANNOTATIONS_PER_SESSION) {
      set.status = 400;
      return { error: `Maximum ${MAX_ANNOTATIONS_PER_SESSION} annotations per session` };
    }

    const annotation: SlideAnnotation = {
      id: nanoid(),
      slideId: body.slideId,
      text: body.text,
      createdAt: new Date().toISOString(),
    };

    existing.push(annotation);
    annotationStore.set(params.id, existing);

    return annotation;
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      slideId: t.String(),
      text: t.String(),
    }),
  })

  // Delete annotation
  .delete('/annotations/:annotationId', async ({ user, params, set }) => {
    const result = await resolveProjectPath(params.id, user!.id);
    if (!result) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const existing = annotationStore.get(params.id) || [];
    const filtered = existing.filter(a => a.id !== params.annotationId);

    if (filtered.length === existing.length) {
      set.status = 404;
      return { error: 'Annotation not found' };
    }

    annotationStore.set(params.id, filtered);
    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
      annotationId: t.String(),
    }),
  })

  // Get annotations for a session
  .get('/annotations', async ({ user, params, query, set }) => {
    const result = await resolveProjectPath(params.id, user!.id);
    if (!result) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const annotations = annotationStore.get(params.id) || [];

    if (query.slideId) {
      return annotations.filter(a => a.slideId === query.slideId);
    }

    return annotations;
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      slideId: t.Optional(t.String()),
    }),
  });
