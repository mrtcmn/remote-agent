import { eq } from 'drizzle-orm';
import { db, projects, projectLinks } from '../../db';

export async function resolveProjectEnv(projectId: string): Promise<Record<string, string>> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) return {};

  // Single project — just parse its env
  if (!project.isMultiProject) {
    return project.env ? JSON.parse(project.env) : {};
  }

  // Multi-project — merge child envs by position order
  const links = await db.query.projectLinks.findMany({
    where: eq(projectLinks.parentProjectId, projectId),
    with: { childProject: true },
    orderBy: (l, { asc }) => [asc(l.position)],
  });

  const merged: Record<string, string> = {};

  // Parent env first (base)
  if (project.env) {
    Object.assign(merged, JSON.parse(project.env));
  }

  // Then children by position (later overrides earlier on conflicts)
  for (const link of links) {
    const child = (link as any).childProject;
    if (child?.env) {
      Object.assign(merged, JSON.parse(child.env));
    }
  }

  return merged;
}
