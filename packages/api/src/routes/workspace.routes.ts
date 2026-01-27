import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, sshKeys } from '../db';
import { workspaceService } from '../services/workspace';
import { requireAuth, requirePin } from '../auth/middleware';

export const workspaceRoutes = new Elysia({ prefix: '/workspace' })
  .use(requireAuth)

  // Pair workspace (upload SSH keys, skills, hooks, settings)
  .post('/pair', async ({ user, body, set }) => {
    try {
      await workspaceService.pairWorkspace(user!.id, {
        sshPrivateKey: body.sshPrivateKey,
        sshPublicKey: body.sshPublicKey,
        skills: body.skills,
        hooks: body.hooks,
        claudeSettings: body.claudeSettings,
      });

      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      sshPrivateKey: t.Optional(t.String()),
      sshPublicKey: t.Optional(t.String()),
      skills: t.Optional(t.Array(t.Object({
        name: t.String(),
        content: t.String(),
      }))),
      hooks: t.Optional(t.Object({
        hooks: t.Record(t.String(), t.Array(t.Object({
          type: t.String(),
          command: t.String(),
        }))),
      })),
      claudeSettings: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  })

  // List SSH keys
  .get('/ssh-keys', async ({ user }) => {
    const keys = await db.query.sshKeys.findMany({
      where: eq(sshKeys.userId, user!.id),
      columns: {
        id: true,
        name: true,
        publicKey: true,
        createdAt: true,
      },
    });

    return keys;
  })

  // Add SSH key
  .post('/ssh-keys', async ({ user, body, set }) => {
    try {
      const keyId = await workspaceService.storeSSHKey(
        user!.id,
        body.privateKey,
        body.publicKey
      );

      // Update name if provided
      if (body.name) {
        await db.update(sshKeys)
          .set({ name: body.name })
          .where(eq(sshKeys.id, keyId));
      }

      return { id: keyId };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      privateKey: t.String(),
      publicKey: t.Optional(t.String()),
    }),
  })

  // Delete SSH key (requires PIN)
  .use(requirePin)
  .delete('/ssh-keys/:id', async ({ user, params, set }) => {
    const key = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, params.id),
    });

    if (!key || key.userId !== user!.id) {
      set.status = 404;
      return { error: 'SSH key not found' };
    }

    // Delete key file
    try {
      await Bun.file(key.privateKeyPath).delete();
    } catch {
      // File might not exist
    }

    await db.delete(sshKeys).where(eq(sshKeys.id, params.id));

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
