import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getWorkspacesRoot } from '../../config/paths';

export interface CloneOptions {
  repoUrl: string;
  projectName: string;
  sshKeyPath?: string;
  token?: string;
  branch?: string;
}

export interface PROptions {
  title: string;
  body: string;
  base?: string;
  draft?: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export class GitService {
  private workspacesRoot: string;

  constructor(workspacesRoot?: string) {
    this.workspacesRoot = workspacesRoot || getWorkspacesRoot();
  }

  /**
   * Converts a GitHub repo URL to HTTPS with an embedded access token.
   * Handles: git@github.com:owner/repo.git, https://github.com/owner/repo.git, owner/repo
   */
  private toTokenUrl(repoUrl: string, token: string): string {
    // Handle git@github.com:owner/repo.git format
    const sshMatch = repoUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return `https://x-access-token:${token}@github.com/${sshMatch[1]}.git`;
    }

    // Handle https://github.com/owner/repo format
    const httpsMatch = repoUrl.match(/https?:\/\/(?:[^@]+@)?github\.com\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      return `https://x-access-token:${token}@github.com/${httpsMatch[1]}.git`;
    }

    // Handle owner/repo format
    if (repoUrl.match(/^[^/]+\/[^/]+$/)) {
      return `https://x-access-token:${token}@github.com/${repoUrl}.git`;
    }

    return repoUrl;
  }

  /**
   * Gets env vars for token-based HTTPS auth (disables SSH for git).
   */
  private getTokenEnv(token: string): Record<string, string> {
    return {
      ...process.env as Record<string, string>,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'url.https://x-access-token:' + token + '@github.com/.insteadOf',
      GIT_CONFIG_VALUE_0: 'https://github.com/',
    };
  }

  private getEnv(sshKeyPath?: string): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
    };

    if (sshKeyPath) {
      env.GIT_SSH_COMMAND = `ssh -i "${sshKeyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
    } else if (process.env.SSH_AUTH_SOCK) {
      // Use ssh-agent when no explicit key is provided
      env.GIT_SSH_COMMAND = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
    }

    return env;
  }

  async cloneProject(opts: CloneOptions): Promise<string> {
    const projectPath = join(this.workspacesRoot, opts.projectName);

    // Ensure workspaces directory exists
    await mkdir(this.workspacesRoot, { recursive: true });

    let env: Record<string, string>;
    let repoUrl = opts.repoUrl;

    if (opts.token) {
      env = this.getTokenEnv(opts.token);
      repoUrl = this.toTokenUrl(opts.repoUrl, opts.token);
    } else {
      env = this.getEnv(opts.sshKeyPath);
    }

    const args = ['git', 'clone'];

    if (opts.branch) {
      args.push('--branch', opts.branch);
    }

    args.push(repoUrl, projectPath);

    const result = await $`${args}`.env(env).quiet();

    if (result.exitCode !== 0) {
      throw new Error(`Failed to clone: ${result.stderr.toString()}`);
    }

    // For token-based clones, set the remote URL without the token
    // so it doesn't get stored in .git/config
    if (opts.token) {
      const cleanUrl = this.toTokenUrl(opts.repoUrl, '').replace('x-access-token:@', '');
      await $`git remote set-url origin ${cleanUrl}`.cwd(projectPath).quiet().nothrow();
    }

    return projectPath;
  }

  /**
   * Configures the git credential helper for GitHub App authentication.
   * Sets up the repo to use the credential helper script with the project ID,
   * and ensures the remote URL uses HTTPS so the credential helper is invoked.
   */
  async configureCredentialHelper(projectPath: string, projectId: string, repoUrl: string): Promise<void> {
    // Store project ID in git config for the credential helper to read
    await $`git config credential.projectId ${projectId}`.cwd(projectPath).quiet().nothrow();

    // Set credential helper to our script
    await $`git config credential.helper /usr/local/bin/git-credential-helper`.cwd(projectPath).quiet().nothrow();

    // Ensure remote URL is HTTPS (not SSH) so git invokes the credential helper
    const httpsUrl = this.toHttpsUrl(repoUrl);
    if (httpsUrl) {
      await $`git remote set-url origin ${httpsUrl}`.cwd(projectPath).quiet().nothrow();
    }
  }

  /**
   * Converts any GitHub repo URL to plain HTTPS format (no credentials embedded).
   */
  private toHttpsUrl(repoUrl: string): string | null {
    // Handle git@github.com:owner/repo.git format
    const sshMatch = repoUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}.git`;
    }

    // Handle https://github.com/owner/repo format (strip any embedded credentials)
    const httpsMatch = repoUrl.match(/https?:\/\/(?:[^@]+@)?github\.com\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      return `https://github.com/${httpsMatch[1]}.git`;
    }

    // Handle owner/repo format
    if (repoUrl.match(/^[^/]+\/[^/]+$/)) {
      return `https://github.com/${repoUrl}.git`;
    }

    return null;
  }

  async initProject(projectName: string): Promise<string> {
    const projectPath = join(this.workspacesRoot, projectName);

    await mkdir(projectPath, { recursive: true });
    await $`git init`.cwd(projectPath).quiet();

    return projectPath;
  }

  async fetch(projectPath: string, sshKeyPath?: string, token?: string): Promise<void> {
    const env = token ? this.getTokenEnv(token) : this.getEnv(sshKeyPath);
    await $`git fetch --all`.cwd(projectPath).env(env).quiet();
  }

  async pull(projectPath: string, branch?: string, sshKeyPath?: string, token?: string): Promise<void> {
    const env = token ? this.getTokenEnv(token) : this.getEnv(sshKeyPath);
    const targetBranch = branch || 'origin/HEAD';
    await $`git pull origin ${targetBranch}`.cwd(projectPath).env(env).quiet();
  }

  async push(projectPath: string, branch?: string, sshKeyPath?: string, token?: string): Promise<void> {
    const env = token ? this.getTokenEnv(token) : this.getEnv(sshKeyPath);
    if (branch) {
      await $`git push -u origin ${branch}`.cwd(projectPath).env(env).quiet();
    } else {
      await $`git push`.cwd(projectPath).env(env).quiet();
    }
  }

  async checkout(projectPath: string, branch: string, create = false): Promise<void> {
    if (create) {
      await $`git checkout -b ${branch}`.cwd(projectPath).quiet();
    } else {
      await $`git checkout ${branch}`.cwd(projectPath).quiet();
    }
  }

  async stage(projectPath: string, files: string[]): Promise<void> {
    await $`git add ${files}`.cwd(projectPath).quiet();
  }

  async unstage(projectPath: string, files: string[]): Promise<void> {
    await $`git reset HEAD -- ${files}`.cwd(projectPath).quiet();
  }

  async commit(projectPath: string, message: string, files?: string[]): Promise<string> {
    if (files && files.length > 0) {
      await $`git add ${files}`.cwd(projectPath).quiet();
    } else {
      await $`git add -A`.cwd(projectPath).quiet();
    }

    const result = await $`git commit -m ${message}`.cwd(projectPath).quiet();

    // Get commit hash
    const hash = await $`git rev-parse HEAD`.cwd(projectPath).quiet();
    return hash.stdout.toString().trim();
  }

  async status(projectPath: string): Promise<GitStatus> {
    const branchResult = await $`git branch --show-current`.cwd(projectPath).quiet();
    const branch = branchResult.stdout.toString().trim();

    // Get ahead/behind
    let ahead = 0;
    let behind = 0;
    try {
      const aheadResult = await $`git rev-list --count HEAD...@{upstream}`.cwd(projectPath).quiet();
      const counts = aheadResult.stdout.toString().trim().split('\n');
      if (counts.length >= 2) {
        ahead = parseInt(counts[0]) || 0;
        behind = parseInt(counts[1]) || 0;
      }
    } catch {
      // No upstream configured
    }

    // Get status
    const statusResult = await $`git status --porcelain`.cwd(projectPath).quiet();
    const lines = statusResult.stdout.toString().trim().split('\n').filter(Boolean);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const index = line[0];
      const working = line[1];
      // --porcelain format is "XY PATH" (XY = 2 status chars, space, then path)
      // but handle edge cases where the separator might be off
      const file = line.charAt(2) === ' ' ? line.slice(3) : line.slice(2).trimStart();

      if (index === '?' && working === '?') {
        untracked.push(file);
      } else {
        if (index !== ' ' && index !== '?') {
          staged.push(file);
        }
        if (working !== ' ' && working !== '?') {
          modified.push(file);
        }
      }
    }

    return { branch, ahead, behind, staged, modified, untracked };
  }

  async log(projectPath: string, limit = 50): Promise<Array<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    refs: string[];
    parents: string[];
  }>> {
    const result = await $`git log --format=%H%n%h%n%s%n%an%n%ai%n%D%n%P%n--END-- -n ${limit}`.cwd(projectPath).quiet();
    const output = result.stdout.toString().trim();
    if (!output) return [];

    const commits: Array<{
      hash: string;
      shortHash: string;
      message: string;
      author: string;
      date: string;
      refs: string[];
      parents: string[];
    }> = [];

    const entries = output.split('--END--').filter(e => e.trim());
    for (const entry of entries) {
      const lines = entry.trim().split('\n');
      if (lines.length < 7) continue;
      commits.push({
        hash: lines[0],
        shortHash: lines[1],
        message: lines[2],
        author: lines[3],
        date: lines[4],
        refs: lines[5] ? lines[5].split(', ').map(r => r.trim()).filter(Boolean) : [],
        parents: lines[6] ? lines[6].split(' ').filter(Boolean) : [],
      });
    }
    return commits;
  }

  async diff(projectPath: string, cached = false): Promise<string> {
    if (cached) {
      const result = await $`git diff --cached`.cwd(projectPath).nothrow().quiet();
      return result.stdout.toString();
    }

    // Show all changes (staged + unstaged) relative to HEAD
    const headResult = await $`git diff HEAD`.cwd(projectPath).nothrow().quiet();
    if (headResult.exitCode === 0) {
      return headResult.stdout.toString();
    }

    // Fallback for repos with no commits: combine cached + unstaged
    const [cachedResult, unstagedResult] = await Promise.all([
      $`git diff --cached`.cwd(projectPath).nothrow().quiet(),
      $`git diff`.cwd(projectPath).nothrow().quiet(),
    ]);
    return cachedResult.stdout.toString() + unstagedResult.stdout.toString();
  }

  async getFileSha(projectPath: string, filePath: string): Promise<string | null> {
    try {
      const result = await $`git hash-object ${filePath}`.cwd(projectPath).quiet();
      if (result.exitCode !== 0) return null;
      return result.stdout.toString().trim();
    } catch {
      return null;
    }
  }

  // GitHub CLI operations
  async createPR(projectPath: string, opts: PROptions): Promise<string> {
    const args = [
      'gh', 'pr', 'create',
      '--title', opts.title,
      '--body', opts.body,
    ];

    if (opts.base) {
      args.push('--base', opts.base);
    }

    if (opts.draft) {
      args.push('--draft');
    }

    const result = await $`${args}`.cwd(projectPath).quiet();
    return result.stdout.toString().trim();
  }

  async mergePR(projectPath: string, prNumber: number, method: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<void> {
    await $`gh pr merge ${prNumber} --${method}`.cwd(projectPath).quiet();
  }

  async listPRs(projectPath: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<Array<{ number: number; title: string; author: string; state: string }>> {
    const result = await $`gh pr list --state ${state} --json number,title,author,state`.cwd(projectPath).quiet();
    return JSON.parse(result.stdout.toString());
  }

  async getPR(projectPath: string, prNumber: number): Promise<Record<string, unknown>> {
    const result = await $`gh pr view ${prNumber} --json number,title,body,author,state,additions,deletions,files`.cwd(projectPath).quiet();
    return JSON.parse(result.stdout.toString());
  }

  async listBranches(projectPath: string): Promise<{ local: string[]; remote: string[] }> {
    const localResult = await $`git branch --format="%(refname:short)"`.cwd(projectPath).quiet();
    const remoteResult = await $`git branch -r --format="%(refname:short)"`.cwd(projectPath).quiet();

    return {
      local: localResult.stdout.toString().trim().split('\n').filter(Boolean),
      remote: remoteResult.stdout.toString().trim().split('\n').filter(Boolean),
    };
  }

  async stash(projectPath: string, message?: string): Promise<void> {
    if (message) {
      await $`git stash push -m ${message}`.cwd(projectPath).quiet();
    } else {
      await $`git stash`.cwd(projectPath).quiet();
    }
  }

  async stashPop(projectPath: string): Promise<void> {
    await $`git stash pop`.cwd(projectPath).quiet();
  }

  async reset(projectPath: string, mode: 'soft' | 'mixed' | 'hard' = 'mixed', ref = 'HEAD~1'): Promise<void> {
    await $`git reset --${mode} ${ref}`.cwd(projectPath).quiet();
  }

  async commitDiff(projectPath: string, hash: string): Promise<string> {
    const result = await $`git show ${hash} --format= --patch`.cwd(projectPath).nothrow().quiet();
    return result.stdout.toString();
  }

  async unstagedDiff(projectPath: string): Promise<string> {
    const result = await $`git diff`.cwd(projectPath).nothrow().quiet();
    return result.stdout.toString();
  }

  async diffStats(projectPath: string): Promise<{ additions: number; deletions: number }> {
    try {
      // Use HEAD to include both staged + unstaged changes
      const result = await $`git diff HEAD --shortstat`.cwd(projectPath).nothrow().quiet();
      let output = result.stdout.toString().trim();

      // Fallback for repos with no commits
      if (!output && result.exitCode !== 0) {
        const cachedResult = await $`git diff --cached --shortstat`.cwd(projectPath).nothrow().quiet();
        output = cachedResult.stdout.toString().trim();
      }

      if (!output) return { additions: 0, deletions: 0 };

      const addMatch = output.match(/(\d+) insertion/);
      const delMatch = output.match(/(\d+) deletion/);
      return {
        additions: addMatch ? parseInt(addMatch[1]) : 0,
        deletions: delMatch ? parseInt(delMatch[1]) : 0,
      };
    } catch {
      return { additions: 0, deletions: 0 };
    }
  }
}

// Singleton instance
export const gitService = new GitService();
