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

  test('stats is empty on a repo with no commits', async () => {
    expect(await git.status(dir).then((s) => s.stats)).toEqual({});
  });
});

describe('GitService.status stats', () => {
  let dir: string;
  const git = new GitService();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-stats-'));
    await $`git init -q`.cwd(dir);
    await $`git config user.email t@t.co`.cwd(dir);
    await $`git config user.name t`.cwd(dir);
    await writeFile(join(dir, 'kept.txt'), 'one\ntwo\nthree\n');
    await $`git add -A`.cwd(dir);
    await $`git commit -qm init`.cwd(dir);
    // Drop one line and add two: 2 added, 1 deleted.
    await writeFile(join(dir, 'kept.txt'), 'one\nthree\nfour\nfive\n');
    await writeFile(join(dir, 'brand-new.txt'), 'x\n');
  });

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  test('counts added and deleted lines per tracked file', async () => {
    const s = await git.status(dir);
    expect(s.stats?.['kept.txt']).toEqual({ added: 2, deleted: 1 });
  });

  test('leaves untracked files out of stats', async () => {
    const s = await git.status(dir);
    expect(s.untracked).toContain('brand-new.txt');
    expect(s.stats?.['brand-new.txt']).toBeUndefined();
  });
});
