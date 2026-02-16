import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { originsService } from '../services/origins';

export const settingsRoutes = new Elysia({ prefix: '/settings' })
  .use(requireAuth)

  // GET /settings/origins - return current allowed origins
  .get('/origins', () => {
    return { origins: originsService.getOrigins() };
  })

  // PUT /settings/origins - update allowed origins
  .put('/origins', async ({ body, set }) => {
    const { origins } = body;

    // Validate each origin is a valid URL origin (protocol + host)
    for (const origin of origins) {
      try {
        const url = new URL(origin);
        // Origin should be protocol + host (no path beyond /)
        const reconstructed = url.origin;
        if (reconstructed !== origin) {
          set.status = 400;
          return { error: `Invalid origin format: "${origin}". Use format like "https://example.com"` };
        }
      } catch {
        set.status = 400;
        return { error: `Invalid URL: "${origin}"` };
      }
    }

    const updated = await originsService.setOrigins(origins);
    return { origins: updated };
  }, {
    body: t.Object({
      origins: t.Array(t.String()),
    }),
  });
