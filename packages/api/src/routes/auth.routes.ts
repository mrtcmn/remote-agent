import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { setPin, verifyPin, hasPin, removePin } from '../auth/pin';
import { requireAuth, authMiddleware } from '../auth/middleware';

export const authRoutes = new Elysia({ prefix: '/auth' })
  // PIN management - must be before catch-all
  .use(authMiddleware)

  .get('/me', async ({ user }) => {
    if (!user) {
      return { user: null };
    }

    const hasPinSet = await hasPin(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        hasPin: hasPinSet,
      },
    };
  })

  .post('/pin/set', async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    try {
      await setPin(user.id, body.pin);
      return { success: true };
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      pin: t.String({ minLength: 4, maxLength: 8 }),
    }),
  })

  .post('/pin/verify', async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    const valid = await verifyPin(user.id, body.pin);

    if (!valid) {
      set.status = 403;
      return { valid: false, error: 'Invalid PIN' };
    }

    return { valid: true };
  }, {
    body: t.Object({
      pin: t.String(),
    }),
  })

  .delete('/pin', async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    // Require current PIN to remove
    const valid = await verifyPin(user.id, body.currentPin);
    if (!valid) {
      set.status = 403;
      return { error: 'Invalid current PIN' };
    }

    await removePin(user.id);
    return { success: true };
  }, {
    body: t.Object({
      currentPin: t.String(),
    }),
  })

  // Better Auth handles all other auth routes (sign-in, sign-up, etc.)
  .all('/*', async ({ request, set }) => {
    const response = await auth.handler(request);

    // Debug: Log response details
    console.log('[Auth Routes] Path:', request.url);
    console.log('[Auth Routes] Status:', response.status);

    const setCookieHeaders: string[] = [];
    response.headers.forEach((value, key) => {
      console.log('[Auth Routes] Header:', key, '=', value);
      if (key.toLowerCase() === 'set-cookie') {
        setCookieHeaders.push(value);
      }
    });
    console.log('[Auth Routes] Set-Cookie headers:', setCookieHeaders);

    // Set status code
    set.status = response.status;

    // Forward all headers from Better Auth response
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') {
        set.headers[key] = value;
      }
    });

    // Handle Set-Cookie headers specially (can be multiple)
    if (setCookieHeaders.length > 0) {
      set.headers['set-cookie'] = setCookieHeaders;
    }

    // Return the body
    const body = await response.text();
    console.log('[Auth Routes] Body length:', body.length);

    // Try to parse as JSON, otherwise return as text
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  });
