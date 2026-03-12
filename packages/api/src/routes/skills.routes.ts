import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { skillsService } from '../services/skills/skills.service';

export const skillsRoutes = new Elysia({ prefix: '/skills' })
  .use(requireAuth)

  // GET /skills - list installed skills
  .get('/', async () => {
    const skills = await skillsService.listInstalled();
    return { skills };
  })

  // GET /skills/search?q=query - search skills registry
  .get('/search', async ({ query }) => {
    const q = query.q || '';
    if (!q) {
      const trending = await skillsService.getTrending();
      return { skills: trending, source: 'trending' };
    }
    const results = await skillsService.search(q);
    return { skills: results, source: 'search' };
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
    }),
  })

  // GET /skills/trending - get popular skills
  .get('/trending', async () => {
    const skills = await skillsService.getTrending();
    return { skills };
  })

  // POST /skills/install - install a skill
  .post('/install', async ({ body, set }) => {
    const { repo, skillName, useCLI } = body;

    if (!repo) {
      set.status = 400;
      return { error: 'repo is required (e.g., "vercel-labs/agent-skills")' };
    }

    if (useCLI) {
      const result = await skillsService.installViaCLI(repo, skillName);
      if (!result.success) {
        set.status = 500;
        return { error: result.error || 'Installation failed', output: result.output };
      }
      return { success: true, output: result.output };
    }

    const result = await skillsService.install(repo, skillName);
    if (!result.success) {
      set.status = 500;
      return { error: result.error || 'Installation failed' };
    }

    return { success: true, installed: result.installed };
  }, {
    body: t.Object({
      repo: t.String(),
      skillName: t.Optional(t.String()),
      useCLI: t.Optional(t.Boolean()),
    }),
  })

  // DELETE /skills/:name - uninstall a skill
  .delete('/:name', async ({ params, set }) => {
    const result = await skillsService.uninstall(params.name);
    if (!result.success) {
      set.status = 404;
      return { error: result.error };
    }
    return { success: true };
  }, {
    params: t.Object({
      name: t.String(),
    }),
  });
