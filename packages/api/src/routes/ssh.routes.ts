import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../auth/middleware';
import { db, sshHosts, sshGroups, sshCredentials, claudeSessions } from '../db';
import { sshService } from '../services/ssh/ssh.service';
import { encrypt } from '../services/crypto/secret-box';

const enc = (v?: string) => (v ? encrypt(v).toString('base64') : null);

// Strip secret material — enc* columns never leave the server.
function publicCred(c: typeof sshCredentials.$inferSelect) {
  return { id: c.id, name: c.name, type: c.type, createdAt: c.createdAt };
}

export const sshRoutes = new Elysia({ prefix: '/ssh' })
  .use(requireAuth)

  // ─── Hosts ───────────────────────────────────────────────────────────────
  .get('/hosts', async ({ user }) => {
    return db.query.sshHosts.findMany({ where: eq(sshHosts.userId, user!.id) });
  })
  .post('/hosts', async ({ user, body }) => {
    const id = nanoid();
    await db.insert(sshHosts).values({
      id, userId: user!.id,
      label: body.label, host: body.host, port: body.port ?? 22,
      username: body.username, authType: body.authType,
      credentialId: body.credentialId ?? null, groupId: body.groupId ?? null,
      tags: body.tags ? JSON.stringify(body.tags) : null, color: body.color ?? null,
    });
    return db.query.sshHosts.findFirst({ where: eq(sshHosts.id, id) });
  }, {
    body: t.Object({
      label: t.String({ minLength: 1 }),
      host: t.String({ minLength: 1 }),
      port: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
      username: t.String({ minLength: 1 }),
      authType: t.Union([t.Literal('password'), t.Literal('key'), t.Literal('agent')]),
      credentialId: t.Optional(t.String()),
      groupId: t.Optional(t.String()),
      tags: t.Optional(t.Array(t.String())),
      color: t.Optional(t.String()),
    }),
  })
  .put('/hosts/:id', async ({ user, params, body, set }) => {
    const host = await db.query.sshHosts.findFirst({ where: and(eq(sshHosts.id, params.id), eq(sshHosts.userId, user!.id)) });
    if (!host) { set.status = 404; return { error: 'Not found' }; }
    await db.update(sshHosts).set({
      ...(body.label !== undefined && { label: body.label }),
      ...(body.host !== undefined && { host: body.host }),
      ...(body.port !== undefined && { port: body.port }),
      ...(body.username !== undefined && { username: body.username }),
      ...(body.authType !== undefined && { authType: body.authType }),
      ...(body.credentialId !== undefined && { credentialId: body.credentialId }),
      ...(body.groupId !== undefined && { groupId: body.groupId }),
      ...(body.tags !== undefined && { tags: JSON.stringify(body.tags) }),
      ...(body.color !== undefined && { color: body.color }),
    }).where(eq(sshHosts.id, params.id));
    return db.query.sshHosts.findFirst({ where: eq(sshHosts.id, params.id) });
  }, {
    body: t.Partial(t.Object({
      label: t.String(), host: t.String(), port: t.Integer(), username: t.String(),
      authType: t.Union([t.Literal('password'), t.Literal('key'), t.Literal('agent')]),
      credentialId: t.Union([t.String(), t.Null()]), groupId: t.Union([t.String(), t.Null()]),
      tags: t.Array(t.String()), color: t.String(),
    })),
  })
  .delete('/hosts/:id', async ({ user, params }) => {
    await db.delete(sshHosts).where(and(eq(sshHosts.id, params.id), eq(sshHosts.userId, user!.id)));
    return { ok: true };
  })
  .get('/hosts/:id/logs', async ({ user, params, set }) => {
    const host = await db.query.sshHosts.findFirst({ where: and(eq(sshHosts.id, params.id), eq(sshHosts.userId, user!.id)) });
    if (!host) { set.status = 404; return { error: 'Not found' }; }
    return sshService.getLogs(params.id);
  })
  // Reset TOFU fingerprint (e.g. after a legitimate server key change).
  .post('/hosts/:id/trust-reset', async ({ user, params }) => {
    await db.update(sshHosts).set({ knownHostFp: null }).where(and(eq(sshHosts.id, params.id), eq(sshHosts.userId, user!.id)));
    return { ok: true };
  })

  // ─── Connect / stop ──────────────────────────────────────────────────────
  .post('/hosts/:id/connect', async ({ user, params, body, set }) => {
    try {
      return await sshService.connect({ userId: user!.id, hostId: params.id, cols: body?.cols, rows: body?.rows });
    } catch (err) {
      set.status = 400; return { error: (err as Error).message };
    }
  }, { body: t.Optional(t.Object({ cols: t.Optional(t.Integer()), rows: t.Optional(t.Integer()) })) })
  .post('/sessions/:sessionId/stop', async ({ params }) => {
    await sshService.close(params.sessionId);
    return { ok: true };
  })
  .get('/sessions', ({ user }) => sshService.listActive(user!.id))
  .get('/sessions/:sessionId', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.sessionId), eq(claudeSessions.userId, user!.id)),
    });
    if (!session?.sshHostId) { set.status = 404; return { error: 'Not found' }; }
    const host = await db.query.sshHosts.findFirst({ where: eq(sshHosts.id, session.sshHostId) });
    if (!host) { set.status = 404; return { error: 'Host not found' }; }
    const live = sshService.getInstance(params.sessionId);
    return { sessionId: session.id, hostId: host.id, status: live?.status ?? 'exited', host };
  })

  // ─── Groups ──────────────────────────────────────────────────────────────
  .get('/groups', async ({ user }) => db.query.sshGroups.findMany({ where: eq(sshGroups.userId, user!.id) }))
  .post('/groups', async ({ user, body }) => {
    const id = nanoid();
    await db.insert(sshGroups).values({ id, userId: user!.id, name: body.name, parentId: body.parentId ?? null, sortOrder: body.sortOrder ?? 0 });
    return db.query.sshGroups.findFirst({ where: eq(sshGroups.id, id) });
  }, { body: t.Object({ name: t.String({ minLength: 1 }), parentId: t.Optional(t.String()), sortOrder: t.Optional(t.Integer()) }) })
  .delete('/groups/:id', async ({ user, params }) => {
    await db.delete(sshGroups).where(and(eq(sshGroups.id, params.id), eq(sshGroups.userId, user!.id)));
    return { ok: true };
  })

  // ─── Credentials (secrets write-only) ────────────────────────────────────
  .get('/credentials', async ({ user }) => {
    const creds = await db.query.sshCredentials.findMany({ where: eq(sshCredentials.userId, user!.id) });
    return creds.map(publicCred);
  })
  .post('/credentials', async ({ user, body }) => {
    const id = nanoid();
    await db.insert(sshCredentials).values({
      id, userId: user!.id, name: body.name, type: body.type,
      encPassword: enc(body.password), encPrivateKey: enc(body.privateKey), encPassphrase: enc(body.passphrase),
    });
    const c = await db.query.sshCredentials.findFirst({ where: eq(sshCredentials.id, id) });
    return publicCred(c!);
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      type: t.Union([t.Literal('password'), t.Literal('key')]),
      password: t.Optional(t.String()),
      privateKey: t.Optional(t.String()),
      passphrase: t.Optional(t.String()),
    }),
  })
  .delete('/credentials/:id', async ({ user, params }) => {
    await db.delete(sshCredentials).where(and(eq(sshCredentials.id, params.id), eq(sshCredentials.userId, user!.id)));
    return { ok: true };
  });
