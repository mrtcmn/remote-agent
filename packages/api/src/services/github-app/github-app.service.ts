import { createSign } from 'crypto';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, githubApps, githubAppInstallations } from '../../db';
import { encrypt, decrypt, getEncryptionKey } from './crypto';

interface TokenCache {
  token: string;
  expiresAt: Date;
}

class GitHubAppService {
  private tokenCache = new Map<number, TokenCache>();

  /**
   * Generates the manifest JSON for GitHub App creation.
   */
  generateManifest(baseUrl: string, appName?: string): object {
    const url = baseUrl.replace(/\/$/, '');
    const hostname = new URL(url).hostname.replace(/\./g, '-');
    const name = appName || `remote-agent-${hostname}`.slice(0, 34);

    return {
      name,
      url,
      hook_attributes: {
        url: `${url}/api/github-app/webhook`,
        active: false,
      },
      redirect_url: `${url}/api/github-app/manifest/callback`,
      callback_urls: [`${url}/api/github-app/oauth/callback`],
      setup_url: `${url}/api/github-app/setup/callback`,
      setup_on_update: true,
      public: false,
      default_permissions: {
        contents: 'write',
        pull_requests: 'write',
        metadata: 'read',
      },
      default_events: ['push', 'pull_request'],
    };
  }

  /**
   * Exchanges the temporary code from GitHub for app credentials.
   * This is step 3 of the manifest flow.
   */
  async completeManifestFlow(code: string, userId: string) {
    const response = await fetch(
      `https://api.github.com/app-manifests/${code}/conversions`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub manifest exchange failed: ${error}`);
    }

    const data = await response.json();
    const key = getEncryptionKey();
    const id = nanoid();

    // Check if this is the first app — make it default
    const existingApps = await db.select({ id: githubApps.id }).from(githubApps).limit(1);
    const isDefault = existingApps.length === 0;

    await db.insert(githubApps).values({
      id,
      userId,
      appId: data.id,
      appSlug: data.slug,
      name: data.name,
      clientId: data.client_id,
      clientSecret: encrypt(data.client_secret, key),
      privateKey: encrypt(data.pem, key),
      webhookSecret: data.webhook_secret ? encrypt(data.webhook_secret, key) : null,
      htmlUrl: data.html_url,
      permissions: JSON.stringify(data.permissions || {}),
      events: JSON.stringify(data.events || []),
      isDefault,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return db.query.githubApps.findFirst({
      where: eq(githubApps.id, id),
    });
  }

  /**
   * Signs a JWT for authenticating as the GitHub App (RS256).
   */
  generateAppJWT(appId: number, pemKey: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iat: now - 60, // issued 60s ago to allow clock drift
      exp: now + 600, // 10 minutes
      iss: appId,
    };

    const encode = (obj: object) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');

    const headerB64 = encode(header);
    const payloadB64 = encode(payload);
    const unsigned = `${headerB64}.${payloadB64}`;

    const sign = createSign('RSA-SHA256');
    sign.update(unsigned);
    const signature = sign.sign(pemKey, 'base64url');

    return `${unsigned}.${signature}`;
  }

  /**
   * Gets an installation access token (cached until near-expiry).
   */
  async getInstallationToken(installationId: number, githubAppId: string): Promise<string> {
    // Check cache
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return cached.token;
    }

    const app = await db.query.githubApps.findFirst({
      where: eq(githubApps.id, githubAppId),
    });
    if (!app) throw new Error('GitHub App not found');

    const key = getEncryptionKey();
    const pem = decrypt(app.privateKey, key);
    const jwt = this.generateAppJWT(app.appId, pem);

    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${jwt}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get installation token: ${error}`);
    }

    const data = await response.json();
    this.tokenCache.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at),
    });

    return data.token;
  }

  /**
   * Lists repositories accessible to an installation.
   */
  async listInstallationRepos(installationId: number, githubAppId: string) {
    const token = await this.getInstallationToken(installationId, githubAppId);

    const repos: Array<{
      id: number;
      name: string;
      full_name: string;
      private: boolean;
      default_branch: string;
      html_url: string;
    }> = [];

    let page = 1;
    while (true) {
      const response = await fetch(
        `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) break;

      const data = await response.json();
      repos.push(
        ...data.repositories.map((r: any) => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          default_branch: r.default_branch,
          html_url: r.html_url,
        }))
      );

      if (repos.length >= data.total_count) break;
      page++;
    }

    return repos;
  }

  /**
   * Exchanges an OAuth authorization code for a user access token.
   */
  async exchangeOAuthCode(githubAppId: string, code: string) {
    const app = await db.query.githubApps.findFirst({
      where: eq(githubApps.id, githubAppId),
    });
    if (!app) throw new Error('GitHub App not found');

    const key = getEncryptionKey();
    const clientSecret = decrypt(app.clientSecret, key);

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: app.clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      throw new Error('OAuth code exchange failed');
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`OAuth error: ${data.error_description || data.error}`);
    }

    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      scope: data.scope as string,
    };
  }

  /**
   * Fetches the authenticated GitHub user's profile.
   */
  async getGitHubUser(accessToken: string) {
    const [userResponse, emailsResponse] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
        },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    ]);

    if (!userResponse.ok) {
      throw new Error('Failed to fetch GitHub user profile');
    }

    const userData = await userResponse.json();

    // Get primary email from emails endpoint (more reliable than user.email)
    let email = userData.email;
    if (emailsResponse.ok) {
      const emails = await emailsResponse.json();
      const primary = emails.find((e: any) => e.primary && e.verified);
      if (primary) email = primary.email;
    }

    return {
      id: String(userData.id),
      login: userData.login as string,
      email: email as string,
      name: (userData.name || userData.login) as string,
      avatarUrl: userData.avatar_url as string,
    };
  }

  /**
   * Gets the default GitHub App for OAuth login.
   */
  async getDefaultApp() {
    // Try the one marked as default first
    let app = await db.query.githubApps.findFirst({
      where: eq(githubApps.isDefault, true),
    });

    // Fall back to the first app
    if (!app) {
      app = await db.query.githubApps.findFirst({
        orderBy: (g, { asc }) => [asc(g.createdAt)],
      });
    }

    return app || null;
  }

  /**
   * Lists all GitHub Apps.
   */
  async listApps() {
    return db.query.githubApps.findMany({
      orderBy: (g, { desc }) => [desc(g.createdAt)],
      columns: {
        id: true,
        userId: true,
        appId: true,
        appSlug: true,
        name: true,
        clientId: true,
        htmlUrl: true,
        permissions: true,
        events: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Gets a single GitHub App by ID (without secrets).
   */
  async getApp(id: string) {
    return db.query.githubApps.findFirst({
      where: eq(githubApps.id, id),
      columns: {
        id: true,
        userId: true,
        appId: true,
        appSlug: true,
        name: true,
        clientId: true,
        htmlUrl: true,
        permissions: true,
        events: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Deletes a GitHub App.
   */
  async deleteApp(id: string) {
    await db.delete(githubApps).where(eq(githubApps.id, id));
  }

  /**
   * Sets a GitHub App as the default for OAuth login.
   */
  async setDefault(id: string) {
    // Unset all defaults
    await db.update(githubApps).set({ isDefault: false });
    // Set the new default
    await db.update(githubApps).set({ isDefault: true, updatedAt: new Date() }).where(eq(githubApps.id, id));
  }

  /**
   * Lists installations for a GitHub App from the database.
   */
  async listInstallations(githubAppId: string) {
    return db.query.githubAppInstallations.findMany({
      where: eq(githubAppInstallations.githubAppId, githubAppId),
      orderBy: (i, { asc }) => [asc(i.accountLogin)],
    });
  }

  /**
   * Stores a new installation (from the setup callback).
   */
  async addInstallation(githubAppId: string, installationId: number) {
    // Fetch installation details from GitHub
    const app = await db.query.githubApps.findFirst({
      where: eq(githubApps.id, githubAppId),
    });
    if (!app) throw new Error('GitHub App not found');

    const key = getEncryptionKey();
    const pem = decrypt(app.privateKey, key);
    const jwt = this.generateAppJWT(app.appId, pem);

    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${jwt}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch installation details from GitHub');
    }

    const data = await response.json();
    const id = nanoid();

    await db.insert(githubAppInstallations).values({
      id,
      githubAppId,
      installationId,
      accountLogin: data.account.login,
      accountType: data.account.type,
      repositorySelection: data.repository_selection || null,
      createdAt: new Date(),
    });

    return db.query.githubAppInstallations.findFirst({
      where: eq(githubAppInstallations.id, id),
    });
  }

  /**
   * Syncs installations from GitHub API to the database.
   */
  async syncInstallations(githubAppId: string) {
    const app = await db.query.githubApps.findFirst({
      where: eq(githubApps.id, githubAppId),
    });
    if (!app) throw new Error('GitHub App not found');

    const key = getEncryptionKey();
    const pem = decrypt(app.privateKey, key);
    const jwt = this.generateAppJWT(app.appId, pem);

    const response = await fetch('https://api.github.com/app/installations', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch installations from GitHub');
    }

    const installations = await response.json();

    // Get existing installations
    const existing = await db.query.githubAppInstallations.findMany({
      where: eq(githubAppInstallations.githubAppId, githubAppId),
    });
    const existingMap = new Map(existing.map(i => [i.installationId, i]));

    // Add new installations
    for (const inst of installations) {
      if (!existingMap.has(inst.id)) {
        await db.insert(githubAppInstallations).values({
          id: nanoid(),
          githubAppId,
          installationId: inst.id,
          accountLogin: inst.account.login,
          accountType: inst.account.type,
          repositorySelection: inst.repository_selection || null,
          createdAt: new Date(),
        });
      }
    }

    // Remove installations that no longer exist on GitHub
    const remoteIds = new Set(installations.map((i: any) => i.id));
    for (const existing of existingMap.values()) {
      if (!remoteIds.has(existing.installationId)) {
        await db.delete(githubAppInstallations).where(
          eq(githubAppInstallations.id, existing.id)
        );
      }
    }

    return this.listInstallations(githubAppId);
  }

  /**
   * Finds the GitHub App that owns a given installation.
   */
  async getAppForInstallation(installationId: string) {
    const installation = await db.query.githubAppInstallations.findFirst({
      where: eq(githubAppInstallations.id, installationId),
      with: { githubApp: true },
    });
    return installation;
  }
}

export const githubAppService = new GitHubAppService();
