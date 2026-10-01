import { $ } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitService } from './git.service';

type Creds = { sshKeyPath?: string; token?: string };

export class HandoffConflictError extends Error {}

export const snapshotRef = (sessionId: string) => `ra-handoff/${sessionId}`;

/**
 * Push the current branch plus a snapshot commit of all uncommitted work
 * (staged, unstaged, untracked; not ignored) to origin. Uses a throwaway
 * index so the working tree, the real index and the stash stay untouched.
 */
export async function snapshotAndPush(cwd: string, sessionId: string, creds: Creds = {}) {
  const env = gitService.authEnv(creds);
  const branch = (await $`git symbolic-ref --short -q HEAD`.cwd(cwd).nothrow().quiet().text()).trim();
  if (!branch) throw new Error('Cannot hand off a detached HEAD — check out a branch first');
  if ((await $`git remote get-url origin`.cwd(cwd).nothrow().quiet()).exitCode !== 0) {
    throw new Error('Cannot hand off: the repository has no origin remote');
  }
  const headSha = (await $`git rev-parse HEAD`.cwd(cwd).quiet().text()).trim();

  const tmp = await mkdtemp(join(tmpdir(), 'ra-handoff-'));
  let snapshotSha: string;
  try {
    const idx = { ...env, GIT_INDEX_FILE: join(tmp, 'index') };
    await $`git read-tree HEAD`.cwd(cwd).env(idx).quiet();
    await $`git add -A`.cwd(cwd).env(idx).quiet();
    const tree = (await $`git write-tree`.cwd(cwd).env(idx).quiet().text()).trim();
    // ponytail: fixed identity — the snapshot commit is throwaway and must work on hosts without user.name.
    snapshotSha = (await $`git -c user.name=remote-agent -c user.email=handoff@remote-agent.local commit-tree ${tree} -p HEAD -m ${`handoff snapshot ${sessionId}`}`
      .cwd(cwd).env(env).quiet().text()).trim();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const push = await $`git push origin ${`HEAD:refs/heads/${branch}`} ${`${snapshotSha}:refs/heads/${snapshotRef(sessionId)}`}`
    .cwd(cwd).env(env).nothrow().quiet();
  if (push.exitCode !== 0) throw new Error(`git push failed: ${push.stderr.toString().trim()}`);
  return { branch, headSha, snapshotSha };
}

/**
 * Bring `cwd` (checked out on `branch`) to `expectedHead` and apply the
 * snapshot as unstaged changes. A stale local branch fast-forwards; a
 * diverged one throws HandoffConflictError and changes nothing.
 */
export async function fetchAndRestore(cwd: string, branch: string, sessionId: string, expectedHead: string, creds: Creds = {}) {
  const env = gitService.authEnv(creds);
  const local = `refs/${snapshotRef(sessionId)}`;
  const fetched = await $`git fetch origin ${`+refs/heads/${branch}:refs/remotes/origin/${branch}`} ${`+refs/heads/${snapshotRef(sessionId)}:${local}`}`
    .cwd(cwd).env(env).nothrow().quiet();
  if (fetched.exitCode !== 0) throw new Error(`git fetch failed: ${fetched.stderr.toString().trim()}`);

  const head = (await $`git rev-parse HEAD`.cwd(cwd).quiet().text()).trim();
  if (head !== expectedHead) {
    const ff = await $`git merge --ff-only ${expectedHead}`.cwd(cwd).nothrow().quiet();
    if (ff.exitCode !== 0) {
      throw new HandoffConflictError(`Local branch ${branch} has diverged from the handed-off HEAD ${expectedHead.slice(0, 8)}`);
    }
  }

  const diff = await $`git diff --binary HEAD ${local}`.cwd(cwd).quiet().arrayBuffer();
  if (diff.byteLength) await $`git apply --whitespace=nowarn < ${new Response(diff)}`.cwd(cwd).quiet();
  await $`git update-ref -d ${local}`.cwd(cwd).nothrow().quiet();
}

export async function deleteSnapshot(cwd: string, sessionId: string, creds: Creds = {}) {
  await $`git push origin --delete ${snapshotRef(sessionId)}`.cwd(cwd).env(gitService.authEnv(creds)).quiet();
}

/** One key for the same repo written as SSH, HTTPS, or with credentials: `host/owner/repo`. */
export function normalizeRepoUrl(url: string): string {
  return url.trim()
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(':', '/')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();
}
