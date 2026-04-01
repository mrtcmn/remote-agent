import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, user, account, session as sessionTable, githubApps } from '../db';
import { githubAppService } from '../services/github-app';
import { requireAuth, requirePin, authMiddleware } from '../auth/middleware';

const OAUTH_STATE_COOKIE = 'github_oauth_state';
const OAUTH_APP_COOKIE = 'github_oauth_app_id';
const SESSION_COOKIE = 'better-auth.session_token';
const SESSION_EXPIRY_DAYS = 7;

export const githubAppRoutes = new Elysia({ prefix: '/github-app' })

  // ─── Public OAuth routes (no auth required) ─────────────────────────────

  // Check if GitHub App OAuth is available
  .get('/oauth/status', async () => {
    const app = await githubAppService.getDefaultApp();
    const legacyOAuth = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    return {
      enabled: !!app,
      legacyOAuth,
    };
  })

  // Initiate GitHub OAuth login
  .get('/oauth/login', async ({ set, cookie }) => {
    const app = await githubAppService.getDefaultApp();
    if (!app) {
      set.status = 404;
      return { error: 'No GitHub App configured' };
    }

    const state = nanoid(32);
    const baseUrl = process.env.BETTER_AUTH_URL || process.env.APP_URL || 'http://localhost:5100';
    const redirectUri = `${baseUrl}/api/github-app/oauth/callback`;

    // Store state and app ID in cookies for verification
    cookie[OAUTH_STATE_COOKIE].set({
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });
    cookie[OAUTH_APP_COOKIE].set({
      value: app.id,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', app.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'user:email');

    set.redirect = authUrl.toString();
  })

  // GitHub OAuth callback
  .get('/oauth/callback', async ({ query, set, cookie }) => {
    const { code, state } = query;

    // Verify state
    const storedState = cookie[OAUTH_STATE_COOKIE]?.value as string | undefined;
    const appId = cookie[OAUTH_APP_COOKIE]?.value as string | undefined;

    // Clear OAuth cookies
    cookie[OAUTH_STATE_COOKIE].remove();
    cookie[OAUTH_APP_COOKIE].remove();

    if (!state || !storedState || state !== storedState) {
      set.status = 400;
      return { error: 'Invalid OAuth state' };
    }

    if (!code || !appId) {
      set.status = 400;
      return { error: 'Missing authorization code' };
    }

    try {
      // Exchange code for access token
      const { accessToken } = await githubAppService.exchangeOAuthCode(appId, code);

      // Get GitHub user profile
      const ghUser = await githubAppService.getGitHubUser(accessToken);

      if (!ghUser.email) {
        set.status = 400;
        return { error: 'GitHub account has no verified email' };
      }

      // Find or create user
      let existingAccount = await db.query.account.findFirst({
        where: and(
          eq(account.providerId, 'github'),
          eq(account.accountId, ghUser.id)
        ),
      });

      let userId: string;

      if (existingAccount) {
        // Existing GitHub-linked user
        userId = existingAccount.userId;

        // Update access token
        await db.update(account)
          .set({ accessToken, updatedAt: new Date() })
          .where(eq(account.id, existingAccount.id));
      } else {
        // Check if user exists by email
        let existingUser = await db.query.user.findFirst({
          where: eq(user.email, ghUser.email),
        });

        if (existingUser) {
          userId = existingUser.id;
        } else {
          // Create new user
          userId = nanoid();
          await db.insert(user).values({
            id: userId,
            name: ghUser.name,
            email: ghUser.email,
            emailVerified: true,
            image: ghUser.avatarUrl,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        // Link GitHub account
        await db.insert(account).values({
          id: nanoid(),
          userId,
          accountId: ghUser.id,
          providerId: 'github',
          accessToken,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Create session (matching Better Auth's format)
      const sessionId = nanoid();
      const sessionToken = nanoid(32);
      const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      await db.insert(sessionTable).values({
        id: sessionId,
        userId,
        token: sessionToken,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Set session cookie (same format as Better Auth)
      cookie[SESSION_COOKIE].set({
        value: sessionToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: expiresAt,
        path: '/',
      });

      set.redirect = '/';
    } catch (error) {
      console.error('GitHub OAuth error:', error);
      set.redirect = `/login?error=${encodeURIComponent((error as Error).message)}`;
    }
  }, {
    query: t.Object({
      code: t.Optional(t.String()),
      state: t.Optional(t.String()),
      error: t.Optional(t.String()),
    }),
  })

  // ─── Manifest callback (needs auth via session cookie) ────────────────

  .use(authMiddleware)

  .get('/manifest/callback', async ({ query, user: authUser, set }) => {
    if (!authUser) {
      set.redirect = '/login';
      return;
    }

    const { code } = query;
    if (!code) {
      set.redirect = '/settings?github-app=error&message=no-code';
      return;
    }

    try {
      await githubAppService.completeManifestFlow(code, authUser.id);
      set.redirect = '/settings?github-app=created';
    } catch (error) {
      console.error('Manifest flow error:', error);
      set.redirect = `/settings?github-app=error&message=${encodeURIComponent((error as Error).message)}`;
    }
  }, {
    query: t.Object({
      code: t.Optional(t.String()),
    }),
  })

  // Setup callback (GitHub redirects here after app installation)
  .get('/setup/callback', async ({ query, user: authUser, set }) => {
    const { installation_id } = query;

    if (!authUser || !installation_id) {
      set.redirect = '/settings?installation=error';
      return;
    }

    try {
      // Find the GitHub App this installation belongs to
      // We try all apps owned by this user
      const apps = await db.query.githubApps.findMany({
        where: eq(githubApps.userId, authUser.id),
      });

      let stored = false;
      for (const app of apps) {
        try {
          await githubAppService.addInstallation(app.id, parseInt(installation_id));
          stored = true;
          break;
        } catch {
          // Try next app
        }
      }

      if (!stored) {
        set.redirect = '/settings?installation=error&message=no-matching-app';
        return;
      }

      set.redirect = '/settings?installation=added';
    } catch (error) {
      console.error('Setup callback error:', error);
      set.redirect = '/settings?installation=error';
    }
  }, {
    query: t.Object({
      installation_id: t.Optional(t.String()),
      setup_action: t.Optional(t.String()),
    }),
  })

  // ─── Authenticated routes ─────────────────────────────────────────────

  .use(requireAuth)

  // Get manifest for form submission
  .get('/manifest', async ({ query }) => {
    const baseUrl = process.env.BETTER_AUTH_URL || process.env.APP_URL || 'http://localhost:5100';
    const manifest = githubAppService.generateManifest(baseUrl);

    let actionUrl = 'https://github.com/settings/apps/new';
    if (query.org) {
      actionUrl = `https://github.com/organizations/${query.org}/settings/apps/new`;
    }

    return { manifest, actionUrl };
  }, {
    query: t.Object({
      org: t.Optional(t.String()),
    }),
  })

  // List all GitHub Apps
  .get('/', async () => {
    return githubAppService.listApps();
  })

  // Get single GitHub App
  .get('/:id', async ({ params, set }) => {
    const app = await githubAppService.getApp(params.id);
    if (!app) {
      set.status = 404;
      return { error: 'GitHub App not found' };
    }
    return app;
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Set default GitHub App
  .put('/:id/default', async ({ params }) => {
    await githubAppService.setDefault(params.id);
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // List installations for a GitHub App
  .get('/:id/installations', async ({ params }) => {
    return githubAppService.listInstallations(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Sync installations from GitHub
  .post('/:id/installations/sync', async ({ params }) => {
    return githubAppService.syncInstallations(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // List repos for an installation
  .get('/installations/:installationId/repos', async ({ params, set }) => {
    const installation = await githubAppService.getAppForInstallation(params.installationId);
    if (!installation) {
      set.status = 404;
      return { error: 'Installation not found' };
    }

    return githubAppService.listInstallationRepos(
      installation.installationId,
      installation.githubAppId
    );
  }, {
    params: t.Object({ installationId: t.String() }),
  })

  // Delete GitHub App (requires PIN)
  .use(requirePin)
  .delete('/:id', async ({ params }) => {
    await githubAppService.deleteApp(params.id);
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
  });
