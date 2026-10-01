import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotAndPush, fetchAndRestore, deleteSnapshot, normalizeRepoUrl } from './handoff';

const git = (cwd: string) => (s: TemplateStringsArray, ...v: unknown[]) =>
  $(s, ...(v as never[])).cwd(cwd).quiet().text().then((t) => t.trimEnd());
const porcelainPaths = (out: string) => out.split('\n').filter(Boolean).map((l) => l.slice(3)).sort();
const PATHS = ['modified.txt', 'staged.txt', 'untracked.txt', 'deleted.txt'];

async function initRepo(dir: string) {
  await $`git init -q -b main`.cwd(dir);
  await $`git config user.email t@t.co`.cwd(dir);
  await $`git config user.name t`.cwd(dir);
}

describe('handoff', () => {
  let root: string, A: string, bare: string, B: string;
  let statusBefore: string;
  let pushed: Awaited<ReturnType<typeof snapshotAndPush>>;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'handoff-'));
    A = join(root, 'A'); bare = join(root, 'bare.git'); B = join(root, 'B');
    await $`mkdir -p ${A}`;
    await $`git init -q --bare ${bare}`;
    await initRepo(A);
    await writeFile(join(A, 'modified.txt'), 'v1\n');
    await writeFile(join(A, 'deleted.txt'), 'bye\n');
    await $`git add -A && git commit -qm init`.cwd(A);
    await $`git remote add origin ${bare}`.cwd(A);
    await $`git push -q origin main`.cwd(A);
    // B is cloned before the feature branch exists, like the target machine's checkout.
    await $`git clone -q ${bare} ${B}`;
    await $`git checkout -q -b feat`.cwd(A);
    await writeFile(join(A, 'modified.txt'), 'v2\n');
    await $`git commit -qam feat`.cwd(A);
    // The four kinds of uncommitted work.
    await writeFile(join(A, 'modified.txt'), 'v3 uncommitted\n');
    await writeFile(join(A, 'staged.txt'), 'staged\n');
    await $`git add staged.txt`.cwd(A);
    await writeFile(join(A, 'untracked.txt'), Buffer.from([0, 1, 2, 255]));
    await rm(join(A, 'deleted.txt'));
    statusBefore = await git(A)`git status --porcelain`;
  });

  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  test('snapshotAndPush throws on a detached HEAD and pushes nothing', async () => {
    const D = join(root, 'detached');
    await $`git clone -q ${bare} ${D}`;
    await $`git checkout -q --detach`.cwd(D);
    await writeFile(join(D, 'x.txt'), 'x');
    const refsBefore = await git(root)`git ls-remote ${bare}`;
    await expect(snapshotAndPush(D, 's-detached')).rejects.toThrow(/detached/i);
    expect(await git(root)`git ls-remote ${bare}`).toBe(refsBefore);
  });

  test('snapshotAndPush throws without origin and pushes nothing', async () => {
    const N = join(root, 'no-origin');
    await $`mkdir -p ${N}`;
    await initRepo(N);
    await writeFile(join(N, 'x.txt'), 'x');
    await $`git add -A && git commit -qm x`.cwd(N);
    const refsBefore = await git(root)`git ls-remote ${bare}`;
    await expect(snapshotAndPush(N, 's-none')).rejects.toThrow(/origin/i);
    expect(await git(root)`git ls-remote ${bare}`).toBe(refsBefore);
  });

  test('snapshotAndPush leaves A untouched', async () => {
    pushed = await snapshotAndPush(A, 'sess1');
    expect(pushed.branch).toBe('feat');
    expect(pushed.headSha).toBe(await git(A)`git rev-parse HEAD`);
    expect(await git(A)`git status --porcelain`).toBe(statusBefore);
    expect(await git(A)`git stash list`).toBe('');
    expect(await git(root)`git ls-remote ${bare} refs/heads/ra-handoff/sess1`).toContain(pushed.snapshotSha);
  });

  test('fetchAndRestore reproduces the branch and uncommitted work in B', async () => {
    await $`git fetch -q origin && git checkout -q feat`.cwd(B);
    await fetchAndRestore(B, pushed.branch, 'sess1', pushed.headSha);
    expect(await git(B)`git rev-parse HEAD`).toBe(await git(A)`git rev-parse HEAD`);
    const bStatus = await git(B)`git status --porcelain`;
    expect(porcelainPaths(bStatus)).toEqual([...PATHS].sort());
    for (const p of PATHS) {
      expect(existsSync(join(B, p))).toBe(existsSync(join(A, p)));
      if (existsSync(join(A, p))) expect(await readFile(join(B, p))).toEqual(await readFile(join(A, p)));
    }
  });

  test('fetchAndRestore fast-forwards a stale local branch', async () => {
    const S = join(root, 'stale');
    await $`git clone -q ${bare} ${S}`;
    await $`git checkout -q -b feat origin/main`.cwd(S);
    await fetchAndRestore(S, pushed.branch, 'sess1', pushed.headSha);
    expect(await git(S)`git rev-parse HEAD`).toBe(pushed.headSha);
    expect(await readFile(join(S, 'modified.txt'), 'utf8')).toBe('v3 uncommitted\n');
  });

  test('fetchAndRestore refuses a diverged local branch', async () => {
    const C = join(root, 'diverged');
    await $`git clone -q ${bare} ${C}`;
    await $`git config user.email t@t.co && git config user.name t`.cwd(C);
    await $`git checkout -q -b feat origin/main`.cwd(C);
    await writeFile(join(C, 'other.txt'), 'other');
    await $`git add -A && git commit -qm other`.cwd(C);
    await expect(fetchAndRestore(C, pushed.branch, 'sess1', pushed.headSha)).rejects.toThrow(/diverged/i);
  });

  test('deleteSnapshot removes the ra-handoff ref', async () => {
    await deleteSnapshot(A, 'sess1');
    expect(await git(root)`git ls-remote ${bare} ${'refs/heads/ra-handoff/*'}`).toBe('');
  });
});

test('normalizeRepoUrl maps SSH and HTTPS forms to one key', () => {
  const key = 'github.com/a/b';
  for (const u of ['git@github.com:a/b.git', 'https://github.com/a/b', 'https://x-access-token:tok@github.com/A/b.git', 'ssh://git@github.com/a/b.git/']) {
    expect(normalizeRepoUrl(u)).toBe(key);
  }
});
