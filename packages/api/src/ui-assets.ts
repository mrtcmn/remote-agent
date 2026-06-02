/**
 * UI asset loader.
 *
 * Two modes:
 * - **Dev / Electron-packaged source**: scan `../../ui/dist` on the filesystem.
 *   Re-scanned per request so new Vite builds (with new hashed filenames) are
 *   picked up without restarting the API and without regenerating any manifest.
 * - **Compiled binary** (`bun build --compile`): the dist directory is not
 *   present on the host filesystem; fall back to the auto-generated
 *   `embedded-ui.ts` whose static imports embed the assets into the binary.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const DIST_DIR = resolve(import.meta.dir, '..', '..', 'ui', 'dist');
const IS_DEV = existsSync(DIST_DIR);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function scanDist(): Record<string, string> {
  if (!existsSync(DIST_DIR)) return {};
  const assets: Record<string, string> = {};
  for (const full of walk(DIST_DIR)) {
    const rel = relative(DIST_DIR, full).split('\\').join('/');
    assets[`/${rel}`] = full;
  }
  return assets;
}

let staticCache: Record<string, string> | null = null;

async function loadStaticAssets(): Promise<Record<string, string>> {
  if (staticCache) return staticCache;
  const mod = await import('./embedded-ui');
  staticCache = mod.uiAssets;
  return staticCache;
}

export async function getUiAssets(): Promise<Record<string, string>> {
  return IS_DEV ? scanDist() : loadStaticAssets();
}

export async function getAssetPath(urlPath: string): Promise<string | undefined> {
  const assets = await getUiAssets();
  return assets[urlPath];
}

export const uiServingMode = IS_DEV ? 'runtime' : 'embedded';
