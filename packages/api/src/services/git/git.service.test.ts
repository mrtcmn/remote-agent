import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService } from './git.service';

describe('GitService.status recent', () => {
  let dir: string;
  const git = new GitService();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-recent-'));
    await $`git init -q`.cwd(dir);
    await $`git config user.email t@t.co`.cwd(dir);
    await $`git config user.name t`.cwd(dir);
    // Three changed (untracked) files with explicitly ordered mtimes: b newest, then a, then c.
    for (const name of ['a', 'b', 'c']) await writeFile(join(dir, name), name);
    await utimes(join(dir, 'a'), new Date(2000), new Date(2000));
    await utimes(join(dir, 'b'), new Date(3000), new Date(3000));
    await utimes(join(dir, 'c'), new Date(1000), new Date(1000));
  });

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  test('omits recent without the flag', async () => {
    const s = await git.status(dir);
    expect(s.recent).toBeUndefined();
    expect(s.untracked.sort()).toEqual(['a', 'b', 'c']);
  });

  test('recent: true sorts changed files newest-first by mtime', async () => {
    const s = await git.status(dir, { recent: true });
    expect(s.recent?.map((r) => r.path)).toEqual(['b', 'a', 'c']);
    expect(s.recent?.every((r) => r.status === 'untracked')).toBe(true);
  });
});
