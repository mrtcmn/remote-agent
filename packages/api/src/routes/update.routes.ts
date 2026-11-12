import { Elysia } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { APP_VERSION } from '../config/version';
import { installKind, updater } from '../services/updater';
import { getLatestVersion, isNewerVersion } from './version.routes';

/** One-click update of THIS machine. Another machine's button reaches it through the machine proxy. */
export const updateRoutes = new Elysia({ prefix: '/update' })
  .use(requireAuth)

  .get('/', async () => {
    const latest = (await getLatestVersion())?.latest ?? null;
    return {
      kind: installKind(),
      current: APP_VERSION,
      latest,
      updateAvailable: latest ? isNewerVersion(APP_VERSION, latest) : false,
      ...(await updater.status()),
    };
  })

  .post('/', async ({ set }) => {
    const latest = (await getLatestVersion(true))?.latest;
    if (!latest || !isNewerVersion(APP_VERSION, latest)) {
      set.status = 409;
      return { error: 'No newer version is available' };
    }
    const started = await updater.start(latest);
    if (!started.ok) {
      set.status = 409;
      return { error: started.error };
    }
    return { ok: true, target: latest };
  });
