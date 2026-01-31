import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface CloneOptions {
  repoUrl: string;
  projectName: string;
  sshKeyPath?: string;
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

  constructor(workspacesRoot = '/app/workspaces') {
    this.workspacesRoot = workspacesRoot;
  }

  private getEnv(sshKeyPath?: string): Record<string, string> {
    if (!sshKeyPath) return {};
    return {
      GIT_SSH_COMMAND: `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
    };
  }

  async cloneProject(opts: CloneOptions): Promise<string> {
    const projectPath = join(this.workspacesRoot, opts.projectName);

    // Ensure workspaces directory exists
    await mkdir(this.workspacesRoot, { recursive: true });

    const env = this.getEnv(opts.sshKeyPath);
    const args = ['git', 'clone'];

    if (opts.branch) {
      args.push('--branch', opts.branch);
    }

    args.push(opts.repoUrl, projectPath);

    const result = await $`${args}`.env(env).quiet();

    if (result.exitCode !== 0) {
      throw new Error(`Failed to clone: ${result.stderr.toString()}`);
    }

    return projectPath;
  }

  async initProject(projectName: string): Promise<string> {
    const projectPath = join(this.workspacesRoot, projectName);

    await mkdir(projectPath, { recursive: true });
    await $`git init`.cwd(projectPath).quiet();

    return projectPath;
  }

  async fetch(projectPath: string, sshKeyPath?: string): Promise<void> {
    const env = this.getEnv(sshKeyPath);
    await $`git fetch --all`.cwd(projectPath).env(env).quiet();
  }

  async pull(projectPath: string, branch?: string, sshKeyPath?: string): Promise<void> {
    const env = this.getEnv(sshKeyPath);
    const targetBranch = branch || 'origin/HEAD';
    await $`git pull origin ${targetBranch}`.cwd(projectPath).env(env).quiet();
  }

  async push(projectPath: string, branch?: string, sshKeyPath?: string): Promise<void> {
    const env = this.getEnv(sshKeyPath);
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
      const file = line.slice(3);

      if (index === '?' && working === '?') {
        untracked.push(file);
      } else if (index !== ' ' && index !== '?') {
        staged.push(file);
      } else if (working !== ' ') {
        modified.push(file);
      }
    }

    return { branch, ahead, behind, staged, modified, untracked };
  }

  async log(projectPath: string, limit = 10): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
    const result = await $`git log --oneline --format="%H|%s|%an|%ai" -n ${limit}`.cwd(projectPath).quiet();
    const lines = result.stdout.toString().trim().split('\n').filter(Boolean);

    return lines.map(line => {
      const [hash, message, author, date] = line.split('|');
      return { hash, message, author, date };
    });
  }

  async diff(projectPath: string, cached = false): Promise<string> {
    const args = cached ? ['git', 'diff', '--cached'] : ['git', 'diff'];
    const result = await $`${args}`.cwd(projectPath).quiet();
    return result.stdout.toString();
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
}

// Singleton instance
export const gitService = new GitService(process.env.WORKSPACES_ROOT || '/app/workspaces');
