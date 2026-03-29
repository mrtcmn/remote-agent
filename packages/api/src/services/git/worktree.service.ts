import { $ } from 'bun';
import { join, dirname, basename } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, worktrees, claudeSessions, projects } from '../../db';

export class WorktreeService {
  /**
   * Compute the filesystem path for a new worktree.
   * Layout: <project.localPath>/../.worktrees/<projectDirName>/<worktreeId>/
   */
  private worktreePath(projectLocalPath: string, worktreeId: string): string {
    const parentDir = dirname(projectLocalPath);
    const projectDirName = basename(projectLocalPath);
    return join(parentDir, '.worktrees', projectDirName, worktreeId);
  }

  async create(opts: {
    projectId: string;
    userId: string;
    branch: string;
    name: string;
    createBranch?: boolean;
  }): Promise<typeof worktrees.$inferSelect> {
    // Validate project
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, opts.projectId), eq(projects.userId, opts.userId)),
    });
    if (!project) throw new Error('Project not found');
    if (project.isMultiProject) throw new Error('Cannot create worktree on multi-project workspace');

    const id = nanoid();
    const wtPath = this.worktreePath(project.localPath, id);

    // Ensure parent directory exists
    await mkdir(dirname(wtPath), { recursive: true });

    // Create git worktree
    if (opts.createBranch) {
      const result = await $`git worktree add -b ${opts.branch} ${wtPath}`.cwd(project.localPath).nothrow().quiet();
      if (result.exitCode !== 0) {
        throw new Error(`Failed to create worktree: ${result.stderr.toString()}`);
      }
    } else {
      const result = await $`git worktree add ${wtPath} ${opts.branch}`.cwd(project.localPath).nothrow().quiet();
      if (result.exitCode !== 0) {
        throw new Error(`Failed to create worktree: ${result.stderr.toString()}`);
      }
    }

    // Insert DB record — clean up filesystem worktree if DB insert fails
    try {
      const [worktree] = await db.insert(worktrees).values({
        id,
        projectId: opts.projectId,
        userId: opts.userId,
        name: opts.name,
        branch: opts.branch,
        path: wtPath,
      }).returning();

      return worktree;
    } catch (err) {
      // Roll back the filesystem worktree since DB insert failed
      await $`git worktree remove ${wtPath} --force`.cwd(project.localPath).nothrow().quiet();
      throw err;
    }
  }

  async remove(worktreeId: string, userId: string): Promise<void> {
    const worktree = await db.query.worktrees.findFirst({
      where: and(eq(worktrees.id, worktreeId), eq(worktrees.userId, userId)),
      with: { project: true },
    });
    if (!worktree) throw new Error('Worktree not found');

    // Detach sessions from this worktree
    await db.update(claudeSessions)
      .set({ worktreeId: null })
      .where(eq(claudeSessions.worktreeId, worktreeId));

    // Remove git worktree from disk
    const project = worktree.project;
    if (project) {
      const result = await $`git worktree remove ${worktree.path} --force`
        .cwd(project.localPath).nothrow().quiet();
      if (result.exitCode !== 0) {
        // Try to force remove if normal remove fails
        await $`rm -rf ${worktree.path}`.nothrow().quiet();
        await $`git worktree prune`.cwd(project.localPath).nothrow().quiet();
      }
    }

    // Delete DB record
    await db.delete(worktrees).where(eq(worktrees.id, worktreeId));
  }

  async list(projectId: string): Promise<(typeof worktrees.$inferSelect)[]> {
    return db.query.worktrees.findMany({
      where: eq(worktrees.projectId, projectId),
      orderBy: (w, { desc }) => [desc(w.createdAt)],
    });
  }

  async getById(worktreeId: string): Promise<typeof worktrees.$inferSelect | undefined> {
    return db.query.worktrees.findFirst({
      where: eq(worktrees.id, worktreeId),
    });
  }
}

export const worktreeService = new WorktreeService();
