import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, projects, projectLinks } from '../../db';

async function readDotEnv(dirPath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(join(dirPath, '.env'), 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key) continue;
      let val = trimmed.slice(eqIdx + 1);
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

export async function resolveProjectEnv(projectId: string): Promise<Record<string, string>> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) return {};

  // Single project — also inherit parent multi-project env if this is a child
  if (!project.isMultiProject) {
    // Look up parent multi-project (if any)
    const parentLink = await db.query.projectLinks.findFirst({
      where: eq(projectLinks.childProjectId, projectId),
      with: { parentProject: true },
    });
    const parent = (parentLink as any)?.parentProject;
    const parentEnv = parent
      ? {
          ...(await readDotEnv(parent.localPath)),
          ...(parent.env ? JSON.parse(parent.env) : {}),
        }
      : {};

    const diskEnv = await readDotEnv(project.localPath);
    return {
      ...parentEnv,   // parent env is base
      ...diskEnv,     // child disk .env overrides parent
      ...(project.env ? JSON.parse(project.env) : {}),  // child DB env overrides disk
    };
  }

  // Multi-project — merge child envs by position order
  const links = await db.query.projectLinks.findMany({
    where: eq(projectLinks.parentProjectId, projectId),
    with: { childProject: true },
    orderBy: (l, { asc }) => [asc(l.position)],
  });

  const merged: Record<string, string> = {};

  // Parent disk .env + DB env (base)
  const parentDiskEnv = await readDotEnv(project.localPath);
  Object.assign(merged, parentDiskEnv);
  if (project.env) {
    Object.assign(merged, JSON.parse(project.env));
  }

  // Then children by position (later overrides earlier on conflicts)
  for (const link of links) {
    const child = (link as any).childProject;
    if (child?.localPath) {
      const childDiskEnv = await readDotEnv(child.localPath);
      Object.assign(merged, childDiskEnv);
    }
    if (child?.env) {
      Object.assign(merged, JSON.parse(child.env));
    }
  }

  return merged;
}
