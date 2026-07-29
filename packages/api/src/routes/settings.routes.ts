import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { llmSettings } from '../services/llm-engine';
import { sonioxSettings } from '../services/soniox';
import { originsService } from '../services/origins';

/** Config without the secret — the API key is write-only. */
const publicLLM = () => {
  const c = llmSettings.get();
  return { provider: c.provider, baseUrl: c.baseUrl, model: c.model, hasApiKey: Boolean(c.apiKey) };
};

export const settingsRoutes = new Elysia({ prefix: '/settings' })
  .use(requireAuth)

  // GET /settings/llm - engine config used for notification summaries + slides
  .get('/llm', () => publicLLM())

  // PUT /settings/llm - update engine config. Blank apiKey keeps the stored one.
  .put('/llm', async ({ body }) => {
    await llmSettings.set({
      provider: body.provider,
      baseUrl: body.baseUrl ?? '',
      model: body.model ?? '',
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
    });
    return publicLLM();
  }, {
    body: t.Object({
      provider: t.Union([t.Literal('claude-code'), t.Literal('openai')]),
      baseUrl: t.Optional(t.String()),
      model: t.Optional(t.String()),
      apiKey: t.Optional(t.String()),
    }),
  })

  // GET /settings/soniox - dictation key state (write-only, never returned)
  .get('/soniox', () => ({ hasApiKey: sonioxSettings.hasKey() }))

  // PUT /settings/soniox - update the Soniox key. Blank keeps the stored one.
  .put('/soniox', async ({ body }) => {
    if (body.apiKey?.trim()) await sonioxSettings.set(body.apiKey.trim());
    return { hasApiKey: sonioxSettings.hasKey() };
  }, {
    body: t.Object({ apiKey: t.Optional(t.String()) }),
  })

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
