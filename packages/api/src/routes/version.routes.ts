import { Elysia, t } from 'elysia';

// Configuration
const GITHUB_REPO = process.env.GITHUB_REPO || 'yourorg/remote-agent';
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

// Cache for GitHub API response
interface VersionCache {
  latest: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  fetchedAt: number;
}

let versionCache: VersionCache | null = null;

// Get current version from environment
function getCurrentVersion(): string {
  return process.env.APP_VERSION || 'dev';
}

// Fetch latest version from GitHub Releases API
async function fetchLatestVersion(): Promise<VersionCache | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Remote-Agent-Update-Checker',
        },
      }
    );

    if (!response.ok) {
      console.error(`GitHub API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    return {
      latest: data.tag_name || 'unknown',
      releaseUrl: data.html_url || '',
      releaseNotes: data.body || '',
      publishedAt: data.published_at || '',
      fetchedAt: Date.now(),
    };
  } catch (error) {
    console.error('Failed to fetch latest version:', error);
    return null;
  }
}

// Get cached or fresh version info
async function getLatestVersion(force: boolean = false): Promise<VersionCache | null> {
  const now = Date.now();

  // Return cached version if still valid and not forced
  if (!force && versionCache && now - versionCache.fetchedAt < CACHE_DURATION_MS) {
    return versionCache;
  }

  // Fetch fresh data
  const freshData = await fetchLatestVersion();

  if (freshData) {
    versionCache = freshData;
  }

  return versionCache;
}

// Compare semantic versions (returns true if v1 < v2)
function isNewerVersion(current: string, latest: string): boolean {
  // Remove 'v' prefix if present
  const cleanCurrent = current.replace(/^v/, '');
  const cleanLatest = latest.replace(/^v/, '');

  // Handle non-semver versions
  if (cleanCurrent === 'dev' || cleanCurrent === 'unknown') {
    return false; // Dev versions don't need updates
  }

  const currentParts = cleanCurrent.split('.').map((n) => parseInt(n, 10) || 0);
  const latestParts = cleanLatest.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;

    if (l > c) return true;
    if (c > l) return false;
  }

  return false;
}

export const versionRoutes = new Elysia({ prefix: '/version' })
  // Get version info - public endpoint (no auth required)
  .get('/', async ({ query }) => {
    const force = query.force === 'true';
    const current = getCurrentVersion();
    const latestInfo = await getLatestVersion(force);

    if (!latestInfo) {
      return {
        current,
        latest: null,
        updateAvailable: false,
        error: 'Could not fetch latest version',
        lastChecked: null,
      };
    }

    const updateAvailable = isNewerVersion(current, latestInfo.latest);

    return {
      current,
      latest: latestInfo.latest,
      updateAvailable,
      releaseUrl: latestInfo.releaseUrl,
      releaseNotes: latestInfo.releaseNotes,
      publishedAt: latestInfo.publishedAt,
      lastChecked: new Date(latestInfo.fetchedAt).toISOString(),
    };
  }, {
    query: t.Object({
      force: t.Optional(t.String()),
    }),
  });
