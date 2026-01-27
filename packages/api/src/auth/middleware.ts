import { Elysia } from 'elysia';
import { auth } from './index';
import { verifyPin, hasPin } from './pin';

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
  } | null;
}

// Authentication middleware
export const authMiddleware = new Elysia({ name: 'auth' })
  .derive({ as: 'global' }, async ({ request }) => {
    // Debug: Log cookies
    const cookies = request.headers.get('cookie');
    // console.log('[Auth Middleware] Cookies:', cookies);

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return { user: null, session: null };
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image ?? undefined,
      },
      session: session.session,
    };
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
