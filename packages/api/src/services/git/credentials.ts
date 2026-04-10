import { eq } from 'drizzle-orm';
import { db, projects } from '../../db';
import type { Project } from '../../db/schema';
import { githubAppService } from '../github-app';
import { workspaceService } from '../workspace';

/**
 * Gets git credentials for a project. Returns either an SSH key path
 * or an installation token, depending on how the project was created.
 */
export async function getProjectCredentials(project: Project, userId: string): Promise<{ sshKeyPath?: string; token?: string }> {
  if (project.githubAppInstallationId) {
    const installation = await githubAppService.getAppForInstallation(project.githubAppInstallationId);
    if (installation) {
      const token = await githubAppService.getInstallationToken(
        installation.installationId,
        installation.githubAppId
      );
      return { token };
    }
  }

  const sshKeyPath = project.sshKeyId
    ? await workspaceService.getSSHKeyPath(userId, project.sshKeyId)
    : null;

  return { sshKeyPath: sshKeyPath || undefined };
}

/**
 * Gets git credentials for a project by its ID.
 * Used by the internal credential helper endpoint.
 */
export async function getProjectCredentialsById(projectId: string): Promise<{ username: string; password: string } | null> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) return null;

  const creds = await getProjectCredentials(project, project.userId);

  if (creds.token) {
    return { username: 'x-access-token', password: creds.token };
  }

  return null;
}
