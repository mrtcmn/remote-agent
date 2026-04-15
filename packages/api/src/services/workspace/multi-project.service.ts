import { mkdir, symlink, unlink, readlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, projectLinks } from '../../db';
import { getWorkspacesRoot } from '../../config/paths';

export class MultiProjectService {
  private workspacesRoot: string;

  constructor(workspacesRoot?: string) {
    this.workspacesRoot = workspacesRoot || getWorkspacesRoot();
  }

  /**
   * Create a multi-project workspace directory with symlinks to child projects.
   */
  async createMultiProjectWorkspace(
    userId: string,
    name: string,
    links: Array<{ alias: string; targetPath: string }>
  ): Promise<string> {
    const workspacePath = join(this.workspacesRoot, userId, name);
    await mkdir(workspacePath, { recursive: true });

    for (const link of links) {
      await this.addLink(workspacePath, link.alias, link.targetPath);
    }

    return workspacePath;
  }

  /**
   * Add a symlink in a multi-project workspace.
   */
  async addLink(workspacePath: string, alias: string, targetPath: string): Promise<void> {
    const symlinkPath = join(workspacePath, alias);

    // Remove existing symlink if present
    try {
      const stats = await lstat(symlinkPath);
      if (stats.isSymbolicLink()) {
        await unlink(symlinkPath);
      }
    } catch {
      // Path doesn't exist, which is fine
    }

    await symlink(targetPath, symlinkPath, 'dir');
  }

  /**
   * Remove a symlink from a multi-project workspace.
   */
  async removeLink(workspacePath: string, alias: string): Promise<void> {
    const symlinkPath = join(workspacePath, alias);

    try {
      const stats = await lstat(symlinkPath);
      if (stats.isSymbolicLink()) {
        await unlink(symlinkPath);
      }
    } catch {
      // Already gone
    }
  }

  /**
   * Get local paths for all child projects of a multi-project.
   */
  async getLinkedProjectPaths(projectId: string): Promise<string[]> {
    const links = await db.query.projectLinks.findMany({
      where: eq(projectLinks.parentProjectId, projectId),
      with: { childProject: true },
    });

    return links
      .map(l => (l as any).childProject?.localPath)
      .filter(Boolean) as string[];
  }
}

export const multiProjectService = new MultiProjectService();
