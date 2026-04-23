import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, projects, projectLinks } from '../db';
import type { Project } from '../db/schema';
import { gitService, getProjectCredentials } from '../services/git';
import { DirtySourceError } from '../services/git/git.service';
import { isLocalMode } from '../config/mode';
import { workspaceService, multiProjectService } from '../services/workspace';
import { githubAppService } from '../services/github-app';
import { requireAuth, requirePin } from '../auth/middleware';

export const projectRoutes = new Elysia({ prefix: '/projects' })
  .use(requireAuth)

  // List projects
  .get('/', async ({ user }) => {
    return db.query.projects.findMany({
      where: eq(projects.userId, user!.id),
      orderBy: (p, { desc }) => [desc(p.updatedAt)],
    });
  })

  // Get single project
  .get('/:id', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    // For multi-project, load child links instead of git status
    if (project.isMultiProject) {
      const childLinks = await db.query.projectLinks.findMany({
        where: eq(projectLinks.parentProjectId, project.id),
        with: { childProject: true },
      });
      return { ...project, git: null, childLinks };
    }

    // Get git status for regular projects
    try {
      const status = await gitService.status(project.localPath);
      return { ...project, git: status };
    } catch {
      return { ...project, git: null };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Get project environment variables
  .get('/:id/env', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
      columns: { env: true },
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    return { env: project.env ? JSON.parse(project.env) : {} };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Update project environment variables
  .put('/:id/env', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    await db.update(projects)
      .set({ env: JSON.stringify(body.env), updatedAt: new Date() })
      .where(eq(projects.id, params.id));

    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      env: t.Record(t.String(), t.String()),
    }),
  })

  // Create/Clone project
  .post('/', async ({ user, body, set }) => {
    const projectId = nanoid();

    try {
      let localPath: string;
      let adoptedRepoUrl: string | null = null;
      let adoptedDefaultBranch: string | null = null;

      if (body.sourcePath) {
        if (!isLocalMode()) {
          set.status = 400;
          return { error: 'Adopting a local folder is only available in local mode' };
        }

        try {
          const result = await gitService.adoptLocalRepo({
            sourcePath: body.sourcePath,
            projectName: `${user!.id}/${body.name}`,
            allowDirty: body.allowDirty,
          });
          localPath = result.localPath;
          adoptedRepoUrl = result.repoUrl;
          adoptedDefaultBranch = result.defaultBranch;
        } catch (err) {
          if (err instanceof DirtySourceError) {
            set.status = 409;
            return { error: 'dirty', changedFiles: err.changedFiles };
          }
          throw err;
        }
      } else if (body.repoUrl || body.githubRepoFullName) {
        const repoUrl = body.repoUrl || `https://github.com/${body.githubRepoFullName}.git`;

        if (body.githubAppInstallationId) {
          // Clone via GitHub App installation token
          const installation = await githubAppService.getAppForInstallation(body.githubAppInstallationId);
          if (!installation) {
            set.status = 400;
            return { error: 'GitHub App installation not found' };
          }

          const token = await githubAppService.getInstallationToken(
            installation.installationId,
            installation.githubAppId
          );

          localPath = await gitService.cloneProject({
            repoUrl,
            projectName: `${user!.id}/${body.name}`,
            token,
            branch: body.branch,
          });

          // Configure credential helper so shell git commands work with GitHub App tokens
          await gitService.configureCredentialHelper(localPath, projectId, repoUrl);
        } else {
          // Clone via SSH key
          const sshKey = body.sshKeyId
            ? await workspaceService.getSSHKeyPath(user!.id, body.sshKeyId)
            : await workspaceService.getSSHKeyPath(user!.id);

          localPath = await gitService.cloneProject({
            repoUrl,
            projectName: `${user!.id}/${body.name}`,
            sshKeyPath: sshKey || undefined,
            branch: body.branch,
          });
        }
      } else {
        // Initialize empty project
        localPath = await gitService.initProject(`${user!.id}/${body.name}`);
      }

      // Store in database
      await db.insert(projects).values({
        id: projectId,
        userId: user!.id,
        name: body.name,
        description: body.description,
        repoUrl: adoptedRepoUrl
          || body.repoUrl
          || (body.githubRepoFullName ? `https://github.com/${body.githubRepoFullName}` : undefined),
        localPath,
        defaultBranch: adoptedDefaultBranch || body.branch || 'main',
        sshKeyId: body.sshKeyId,
        githubAppInstallationId: body.githubAppInstallationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      return project;
    } catch (error) {
      console.error('Error creating project:', error);
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      repoUrl: t.Optional(t.String()),
      branch: t.Optional(t.String()),
      sshKeyId: t.Optional(t.String()),
      githubAppInstallationId: t.Optional(t.String()),
      githubRepoFullName: t.Optional(t.String()),
      sourcePath: t.Optional(t.String()),
      allowDirty: t.Optional(t.Boolean()),
    }),
  })

  // Git operations
  .post('/:id/fetch', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      const creds = await getProjectCredentials(project, user!.id);
      await gitService.fetch(project.localPath, creds.sshKeyPath, creds.token);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  .post('/:id/pull', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      const creds = await getProjectCredentials(project, user!.id);
      await gitService.pull(project.localPath, body?.branch, creds.sshKeyPath, creds.token);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Optional(t.Object({
      branch: t.Optional(t.String()),
    })),
  })

  .post('/:id/push', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      const creds = await getProjectCredentials(project, user!.id);
      await gitService.push(project.localPath, body?.branch, creds.sshKeyPath, creds.token);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Optional(t.Object({
      branch: t.Optional(t.String()),
    })),
  })

  .post('/:id/checkout', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      await gitService.checkout(project.localPath, body.branch, body.create);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      branch: t.String(),
      create: t.Optional(t.Boolean()),
    }),
  })

  // PR operations
  .post('/:id/pr', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      const url = await gitService.createPR(project.localPath, {
        title: body.title,
        body: body.body,
        base: body.base,
        draft: body.draft,
      });

      return { url };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      title: t.String(),
      body: t.String(),
      base: t.Optional(t.String()),
      draft: t.Optional(t.Boolean()),
    }),
  })

  .post('/:id/pr/:prNumber/merge', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      await gitService.mergePR(
        project.localPath,
        parseInt(params.prNumber),
        body?.method || 'merge'
      );

      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
      prNumber: t.String(),
    }),
    body: t.Optional(t.Object({
      method: t.Optional(t.Union([
        t.Literal('merge'),
        t.Literal('squash'),
        t.Literal('rebase'),
      ])),
    })),
  })

  // ─── Multi-project endpoints ──────────────────────────────────────────────

  // Create multi-project workspace
  .post('/multi', async ({ user, body, set }) => {
    const projectId = nanoid();

    try {
      // Validate all linked projects belong to user
      const childProjects = await Promise.all(
        body.links.map(async (link) => {
          const p = await db.query.projects.findFirst({
            where: and(eq(projects.id, link.projectId), eq(projects.userId, user!.id)),
          });
          if (!p) throw new Error(`Project ${link.projectId} not found`);
          return { ...link, project: p };
        })
      );

      // Create workspace directory with symlinks
      const localPath = await multiProjectService.createMultiProjectWorkspace(
        user!.id,
        body.name,
        childProjects.map(l => ({ alias: l.alias, targetPath: l.project.localPath }))
      );

      // Insert multi-project record
      await db.insert(projects).values({
        id: projectId,
        userId: user!.id,
        name: body.name,
        localPath,
        isMultiProject: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Insert project link records
      for (let i = 0; i < childProjects.length; i++) {
        await db.insert(projectLinks).values({
          id: nanoid(),
          parentProjectId: projectId,
          childProjectId: childProjects[i].projectId,
          alias: childProjects[i].alias,
          position: i,
          createdAt: new Date(),
        });
      }

      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });
      const links = await db.query.projectLinks.findMany({
        where: eq(projectLinks.parentProjectId, projectId),
        with: { childProject: true },
      });

      return { ...project, childLinks: links };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      name: t.String(),
      links: t.Array(t.Object({
        projectId: t.String(),
        alias: t.String(),
      })),
    }),
  })

  // Get linked projects for a multi-project
  .get('/:id/links', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, params.id), eq(projects.userId, user!.id)),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    const links = await db.query.projectLinks.findMany({
      where: eq(projectLinks.parentProjectId, params.id),
      with: { childProject: true },
    });

    return links;
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Add a link to a multi-project
  .post('/:id/links', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, params.id), eq(projects.userId, user!.id)),
    });

    if (!project || !project.isMultiProject) {
      set.status = 404;
      return { error: 'Multi-project not found' };
    }

    const childProject = await db.query.projects.findFirst({
      where: and(eq(projects.id, body.projectId), eq(projects.userId, user!.id)),
    });

    if (!childProject) {
      set.status = 404;
      return { error: 'Child project not found' };
    }

    try {
      await multiProjectService.addLink(project.localPath, body.alias, childProject.localPath);

      const linkId = nanoid();
      await db.insert(projectLinks).values({
        id: linkId,
        parentProjectId: params.id,
        childProjectId: body.projectId,
        alias: body.alias,
        position: 0,
        createdAt: new Date(),
      });

      return db.query.projectLinks.findFirst({
        where: eq(projectLinks.id, linkId),
        with: { childProject: true },
      });
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      projectId: t.String(),
      alias: t.String(),
    }),
  })

  // Remove a link from a multi-project
  .delete('/:id/links/:linkId', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, params.id), eq(projects.userId, user!.id)),
    });

    if (!project || !project.isMultiProject) {
      set.status = 404;
      return { error: 'Multi-project not found' };
    }

    const link = await db.query.projectLinks.findFirst({
      where: and(
        eq(projectLinks.id, params.linkId),
        eq(projectLinks.parentProjectId, params.id)
      ),
    });

    if (!link) {
      set.status = 404;
      return { error: 'Link not found' };
    }

    try {
      await multiProjectService.removeLink(project.localPath, link.alias);
      await db.delete(projectLinks).where(eq(projectLinks.id, params.linkId));
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String(), linkId: t.String() }),
  })

  .get('/:id/pr', async ({ user, params, query, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      const prs = await gitService.listPRs(
        project.localPath,
        (query.state as 'open' | 'closed' | 'all') || 'open'
      );

      return prs;
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      state: t.Optional(t.String()),
    }),
  })

  // Reorder projects in sidebar (DnD)
  .put('/reorder', async ({ user, body, set }) => {
    try {
      const { projectIds } = body;
      await Promise.all(
        projectIds.map((id: string, index: number) =>
          db.update(projects)
            .set({ sidebarPosition: index })
            .where(and(eq(projects.id, id), eq(projects.userId, user!.id)))
        )
      );
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      projectIds: t.Array(t.String()),
    }),
  })

  // Delete project (requires PIN)
  .use(requirePin)
  .delete('/:id', async ({ user, params, set }) => {
    try {
      await workspaceService.deleteProject(user!.id, params.id);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
