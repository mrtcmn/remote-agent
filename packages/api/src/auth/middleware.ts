import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { auth } from './index';
import { verifyPin, hasPin } from './pin';
import { db } from '../db';
import { user as userTable, pairedMasters } from '../db/schema';
import { machineRegistry } from '../services/machine-registry';
import {
  TUNNEL_INTERNAL_SECRET,
  TUNNEL_AUTH_HEADER,
  TUNNEL_MACHINE_HEADER,
} from '../services/machine-tunnel/internal';

// Auth context type
export interface AuthContext {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
  } | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    machineId?: string;
  } | null;
}

// Authentication middleware
export const authMiddleware = new Elysia({ name: 'auth' })
  .derive({ as: 'global' }, async ({ request }) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (session) {
      return {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image: session.user.image ?? undefined,
        },
        session: {
          id: session.session.id,
          userId: session.session.userId,
          expiresAt: session.session.expiresAt,
          machineId: undefined as string | undefined,
        },
      };
    }

    // A request our own tunnel client dispatched in-process on behalf of a
    // master we paired with. The secret proves local origin (see internal.ts);
    // the originating master id tells us whose machines these are.
    if (request.headers.get(TUNNEL_AUTH_HEADER) === TUNNEL_INTERNAL_SECRET) {
      const originMasterId = request.headers.get(TUNNEL_MACHINE_HEADER);
      if (originMasterId) {
        const master = await db.query.pairedMasters.findFirst({
          where: eq(pairedMasters.id, originMasterId),
        });
        if (master) {
          const owner = await db.query.user.findFirst({
            where: eq(userTable.id, master.ownerUserId),
          });
          if (owner) {
            return {
              user: {
                id: owner.id,
                email: owner.email,
                name: owner.name,
                image: owner.image ?? undefined,
              },
              session: {
                id: `tunnel:${master.id}`,
                userId: owner.id,
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                machineId: master.id as string | undefined,
              },
            };
          }
        }
      }
    }

    // Fall back to machineToken bearer auth — a paired secondary
    // acting on behalf of the owner user.
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const machine = await machineRegistry.findByToken(token);
        if (machine) {
          const owner = await db.query.user.findFirst({
            where: eq(userTable.id, machine.ownerUserId),
          });
          if (owner) {
            return {
              user: {
                id: owner.id,
                email: owner.email,
                name: owner.name,
                image: owner.image ?? undefined,
              },
              session: {
                id: `machine:${machine.id}`,
                userId: owner.id,
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                machineId: machine.id as string | undefined,
              },
            };
          }
        }
      }
    }

    return { user: null, session: null };
  });

// Require authentication
export const requireAuth = new Elysia({ name: 'requireAuth' })
  .use(authMiddleware)
  .onBeforeHandle(({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  });

// Require PIN for sensitive operations
export const requirePin = new Elysia({ name: 'requirePin' })
  .use(requireAuth)
  .onBeforeHandle(async ({ user, headers, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    const pinRequired = await hasPin(user.id);
    if (!pinRequired) {
      // PIN not set, allow through
      return;
    }

    const pin = headers['x-pin'] as string | undefined;
    if (!pin) {
      set.status = 403;
      return { error: 'PIN required', code: 'PIN_REQUIRED' };
    }

    const valid = await verifyPin(user.id, pin);
    if (!valid) {
      set.status = 403;
      return { error: 'Invalid PIN', code: 'INVALID_PIN' };
    }
  });
