import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware';
import { artifactRepository } from '../services/artifact';
import { db, claudeSessions } from '../db';

export const artifactRoutes = new Elysia({ prefix: '/artifacts' })
  .use(requireAuth)

  // List artifacts for a session
  .get('/session/:sessionId', async ({ params, user, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.sessionId), eq(claudeSessions.userId, user!.id)),
    });
    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }
    return artifactRepository.findBySession(params.sessionId, {
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
  }, {
    params: t.Object({ sessionId: t.String() }),
    query: t.Object({
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
    }),
  })

  // Get artifact metadata
  .get('/:id', async ({ params, set }) => {
    const artifact = await artifactRepository.findById(params.id);
    if (!artifact) {
      set.status = 404;
      return { error: 'Artifact not found' };
    }
    return artifact;
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Serve artifact file
  .get('/:id/file', async ({ params, set }) => {
    const artifact = await artifactRepository.findById(params.id);
    if (!artifact) {
      set.status = 404;
      return { error: 'Artifact not found' };
    }
    const file = Bun.file(artifact.filepath);
    if (!await file.exists()) {
      set.status = 404;
      return { error: 'File not found on disk' };
    }
    set.headers['content-type'] = artifact.mimetype;
    set.headers['content-disposition'] = `inline; filename="${artifact.filename}"`;
    return file;
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Delete artifact
  .delete('/:id', async ({ params }) => {
    return artifactRepository.deleteById(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  });
