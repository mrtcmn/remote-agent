import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../auth/middleware';
import { db, sshHosts, sshGroups, sshCredentials, terminals } from '../db';
import { sshService } from '../services/ssh/ssh.service';
import { encrypt, decrypt } from '../services/crypto/secret-box';
import { inspectKey, generateKey, listLocalIdentities, readLocalIdentity } from '../services/ssh/keys';
import { isLocalMode } from '../config/mode';

const enc = (v?: string) => (v ? encrypt(v).toString('base64') : null);

// Strip secret material — enc* columns never leave the server. A key shows its
// public half, so the user can put it in the server's authorized_keys.
function publicCred(c: typeof sshCredentials.$inferSelect) {
  let key: { publicKey: string; fingerprint: string } | null = null;
  if (c.type === 'key' && c.encPrivateKey) {
    try {
      const open = (b: string) => decrypt(Buffer.from(b, 'base64'));
      const { publicKey, fingerprint } = inspectKey(open(c.encPrivateKey), c.encPassphrase ? open(c.encPassphrase) : undefined);
      key = { publicKey, fingerprint };
    } catch {
      // unreadable (secret.key replaced?): list it without the public half
    }
  }
  return { id: c.id, name: c.name, type: c.type, createdAt: c.createdAt, ...key };
}

/** Store a key credential, after checking it parses with the given passphrase. */
async function storeKey(userId: string, name: string, privateKey: string, passphrase?: string) {
  inspectKey(privateKey, passphrase); // throws a readable message
  const id = nanoid();
  await db.insert(sshCredentials).values({
    id, userId, name, type: 'key',
    encPrivateKey: enc(privateKey.trim() + '\n'), encPassphrase: enc(passphrase),
  });
  return publicCred((await db.query.sshCredentials.findFirst({ where: eq(sshCredentials.id, id) }))!);
}

/** An SSH terminal in one of this user's sessions, or null. */
async function ownSshTerminal(userId: string, terminalId: string) {
  const terminal = await db.query.terminals.findFirst({ where: eq(terminals.id, terminalId), with: { session: true } });
  return terminal?.type === 'ssh' && terminal.session.userId === userId ? terminal : null;
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
    sshService.dropPooled(params.id);
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
    sshService.dropPooled(params.id);
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
    sshService.dropPooled(params.id);
    return { ok: true };
  })

  // ─── Connect / stop ──────────────────────────────────────────────────────
  .post('/hosts/:id/connect', async ({ user, params, body, set }) => {
    try {
      return await sshService.connect({ userId: user!.id, hostId: params.id, sessionId: body?.sessionId, cols: body?.cols, rows: body?.rows });
    } catch (err) {
      set.status = 400; return { error: (err as Error).message };
    }
  }, {
    body: t.Optional(t.Object({
      // Open it as a tab in this session instead of a session of its own.
      sessionId: t.Optional(t.String()),
      cols: t.Optional(t.Integer()), rows: t.Optional(t.Integer()),
    })),
  })
  .post('/terminals/:terminalId/stop', async ({ user, params, set }) => {
    if (!(await ownSshTerminal(user!.id, params.terminalId))) { set.status = 404; return { error: 'Not found' }; }
    await sshService.close(params.terminalId);
    return { ok: true };
  })
  // Dial again into the same terminal (same id, tab, scrollback).
  .post('/terminals/:terminalId/reconnect', async ({ user, params, set }) => {
    try {
      return await sshService.resume(user!.id, params.terminalId);
    } catch (err) {
      set.status = 400; return { error: (err as Error).message };
    }
  })

  // ─── For agents (MCP) ────────────────────────────────────────────────────
  // One command on the host's shared connection; no terminal, no secrets out.
  .post('/hosts/:id/exec', async ({ user, params, body, set }) => {
    try {
      return await sshService.exec(user!.id, params.id, body.command, body.timeoutMs);
    } catch (err) {
      set.status = 400; return { error: (err as Error).message };
    }
  }, {
    body: t.Object({
      command: t.String({ minLength: 1 }),
      timeoutMs: t.Optional(t.Integer({ minimum: 1000, maximum: 30 * 60_000 })),
    }),
  })
  // Type into a live shell the user can watch; returns what it printed.
  .post('/terminals/:terminalId/send', async ({ user, params, body, set }) => {
    try {
      return await sshService.send(user!.id, params.terminalId, body.input, body.waitMs);
    } catch (err) {
      set.status = 400; return { error: (err as Error).message };
    }
  }, {
    body: t.Object({
      input: t.String(),
      waitMs: t.Optional(t.Integer({ minimum: 0, maximum: 120_000 })),
    }),
  })
  .get('/terminals/:terminalId/output', ({ user, params, query, set }) => {
    try {
      return sshService.read(user!.id, params.terminalId, query.lines ? Number(query.lines) : undefined);
    } catch (err) {
      set.status = 404; return { error: (err as Error).message };
    }
  }, { query: t.Object({ lines: t.Optional(t.String()) }) })
  .get('/sessions', ({ user }) => sshService.listActive(user!.id))
  .get('/terminals/:terminalId', async ({ user, params, set }) => {
    const terminal = await ownSshTerminal(user!.id, params.terminalId);
    if (!terminal) { set.status = 404; return { error: 'Not found' }; }
    const hostId = (JSON.parse(terminal.command) as string[])[1];
    const host = await db.query.sshHosts.findFirst({ where: eq(sshHosts.id, hostId) });
    if (!host) { set.status = 404; return { error: 'Host not found' }; }
    const live = sshService.getInstance(params.terminalId);
    return { sessionId: terminal.sessionId, terminalId: terminal.id, hostId: host.id, status: live?.status ?? 'exited', host };
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
  .post('/credentials', async ({ user, body, set }) => {
    try {
      if (body.type === 'key') {
        if (!body.privateKey) throw new Error('Paste the private key');
        return await storeKey(user!.id, body.name, body.privateKey, body.passphrase);
      }
      if (!body.password) throw new Error('Enter the password');
    } catch (err) {
      set.status = 400; return { error: (err as Error).message };
    }
    const id = nanoid();
    await db.insert(sshCredentials).values({ id, userId: user!.id, name: body.name, type: 'password', encPassword: enc(body.password) });
    return publicCred((await db.query.sshCredentials.findFirst({ where: eq(sshCredentials.id, id) }))!);
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      type: t.Union([t.Literal('password'), t.Literal('key')]),
      password: t.Optional(t.String()),
      privateKey: t.Optional(t.String()),
      passphrase: t.Optional(t.String()),
    }),
  })
  // A new ed25519 identity; the response carries the public key to install.
  .post('/credentials/generate', async ({ user, body }) => {
    const key = generateKey(body.comment || `remote-agent-${body.name}`);
    return storeKey(user!.id, body.name, key.privateKey);
  }, { body: t.Object({ name: t.String({ minLength: 1 }), comment: t.Optional(t.String()) }) })
  // The user's own keys in ~/.ssh — only where the server is the user's machine.
  .get('/credentials/local', ({ set }) => {
    if (!isLocalMode()) { set.status = 404; return { error: 'Only on a local install' }; }
    return listLocalIdentities();
  })
  .post('/credentials/import', async ({ user, body, set }) => {
    if (!isLocalMode()) { set.status = 404; return { error: 'Only on a local install' }; }
    try {
      return await storeKey(user!.id, body.name || body.file, readLocalIdentity(body.file), body.passphrase);
    } catch (err) {
      set.status = 400; return { error: (err as Error).message };
    }
  }, { body: t.Object({ file: t.String({ minLength: 1 }), name: t.Optional(t.String()), passphrase: t.Optional(t.String()) }) })
  .delete('/credentials/:id', async ({ user, params }) => {
    await db.delete(sshCredentials).where(and(eq(sshCredentials.id, params.id), eq(sshCredentials.userId, user!.id)));
    return { ok: true };
  });
