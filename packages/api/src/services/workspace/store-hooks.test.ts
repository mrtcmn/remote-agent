import { test, expect } from 'bun:test';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceService } from './workspace.service';

// Regression: hooks must POST to the port the API actually listens on.
// Dev runs the API on 13590 (RA_PORT); a hardcoded 5100 dropped every hook.
async function bakedHooks(env: Record<string, string | undefined>): Promise<string> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const home = await mkdtemp(join(tmpdir(), 'ra-hooks-'));
  await mkdir(join(home, '.claude'), { recursive: true });
  await new WorkspaceService({ agentHome: home }).storeHooks('user1');
  return readFile(join(home, '.claude', 'settings.json'), 'utf-8');
}

test('local dev bakes RA_PORT into hook URLs, not 5100', async () => {
  const settings = await bakedHooks({ RA_MODE: 'local', RA_PORT: '13590', RA_API_URL: undefined, REMOTE_AGENT_API: undefined });
  expect(settings).toContain('http://localhost:13590/internal/hooks/attention');
  expect(settings).not.toContain('localhost:5100');
});

test('remote mode still defaults to 5100', async () => {
  const settings = await bakedHooks({ RA_MODE: 'remote', RA_PORT: undefined, RA_API_URL: undefined, REMOTE_AGENT_API: undefined });
  expect(settings).toContain('http://localhost:5100/internal/hooks/complete');
});
