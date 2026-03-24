import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and, sql } from 'drizzle-orm';
import { db, claudeSessions, projects, projectLinks, reviewComments } from '../db';
import { terminalService } from '../services/terminal';
import { gitService } from '../services/git';
import { notificationService } from '../services/notification';
import { requireAuth } from '../auth/middleware';

export const sessionRoutes = new Elysia({ prefix: '/sessions' })
  .use(requireAuth)

  // List user sessions
  .get('/', async ({ user }) => {
    const sessions = await db.query.claudeSessions.findMany({
      where: eq(claudeSessions.userId, user!.id),
      orderBy: (s, { desc }) => [desc(s.lastActiveAt)],
      with: {
        project: true,
      },
    });

    // Check if sessions have running terminals
    return sessions.map(session => {
      const terminals = terminalService.getSessionTerminals(session.id);
      const hasActiveTerminals = terminals.some(t => t.status === 'running');
      return {
        ...session,
        liveStatus: hasActiveTerminals ? 'active' : session.status,
      };
    });
  })

  // Get single session
  .get('/:id', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: {
        project: {
          with: {
            childLinks: {
              with: { childProject: true },
            },
          },
        },
      },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const terminals = terminalService.getSessionTerminals(session.id);
    const hasActiveTerminals = terminals.some(t => t.status === 'running');

    return {
      ...session,
      liveStatus: hasActiveTerminals ? 'active' : session.status,
    };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Create new session (container for terminals)
  .post('/', async ({ user, body, set }) => {
    const sessionId = nanoid();

    // Verify project if provided
    if (body.projectId) {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.id, body.projectId),
          eq(projects.userId, user!.id)
        ),
      });

      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }
    }

    // Create session record
    await db.insert(claudeSessions).values({
      id: sessionId,
      userId: user!.id,
      projectId: body.projectId || null,
      status: 'active',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });

    const session = await db.query.claudeSessions.findFirst({
      where: eq(claudeSessions.id, sessionId),
      with: { project: true },
    });

    return session;
  }, {
    body: t.Object({
      projectId: t.Optional(t.String()),
    }),
  })

  // Get git status for session's project
  .get('/:id/git/status', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    if (!session.project) {
      return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
    }

    // If projectId query param provided, resolve linked project path
    let targetPath = session.project.localPath;
    if (query.projectId && session.project.isMultiProject) {
      const link = await db.query.projectLinks.findFirst({
        where: and(
          eq(projectLinks.parentProjectId, session.project.id),
          eq(projectLinks.childProjectId, query.projectId)
        ),
        with: { childProject: true },
      });
      if (link && (link as any).childProject) {
        targetPath = (link as any).childProject.localPath;
      } else {
        return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
      }
    } else if (!query.projectId && session.project.isMultiProject) {
      // Multi-project root is not a git repo
      return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
    }

    try {
      const status = await gitService.status(targetPath);
      return status;
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      projectId: t.Optional(t.String()),
    }),
  })

  // Get git diff for session's project
  .get('/:id/git/diff', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    if (!session.project) {
      return { diff: '' };
    }

    // If projectId query param provided, resolve linked project path
    let targetPath = session.project.localPath;
    if (query.projectId && session.project.isMultiProject) {
      const link = await db.query.projectLinks.findFirst({
        where: and(
          eq(projectLinks.parentProjectId, session.project.id),
          eq(projectLinks.childProjectId, query.projectId)
        ),
        with: { childProject: true },
      });
      if (link && (link as any).childProject) {
        targetPath = (link as any).childProject.localPath;
      } else {
        return { diff: '' };
      }
    } else if (!query.projectId && session.project.isMultiProject) {
      return { diff: '' };
    }

    try {
      const diff = await gitService.diff(targetPath, query.cached === 'true');
      return { diff };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      cached: t.Optional(t.String()),
      projectId: t.Optional(t.String()),
    }),
  })

  // Get diff for a specific file
  .get('/:id/git/file-diff', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    if (!session.project) {
      return { diff: '' };
    }

    // Resolve target path for multi-project support
    let targetPath = session.project.localPath;
    if (query.projectId && session.project.isMultiProject) {
      const link = await db.query.projectLinks.findFirst({
        where: and(
          eq(projectLinks.parentProjectId, session.project.id),
          eq(projectLinks.childProjectId, query.projectId)
        ),
        with: { childProject: true },
      });
      if (link && (link as any).childProject) {
        targetPath = (link as any).childProject.localPath;
      } else {
        return { diff: '', file: query.file };
      }
    } else if (!query.projectId && session.project.isMultiProject) {
      return { diff: '', file: query.file };
    }

    try {
      const { $ } = await import('bun');
      const filePath = query.file;

      // Check git status to determine the right diff command
      const statusResult = await $`git status --porcelain -- ${filePath}`.cwd(targetPath).nothrow().quiet();
      const statusLine = statusResult.stdout.toString().trimEnd();

      let diff = '';

      if (statusLine) {
        const indexStatus = statusLine[0];
        const workingStatus = statusLine[1];

        if (indexStatus === '?' && workingStatus === '?') {
          // Untracked file: show full content as addition
          const result = await $`git diff --no-index /dev/null ${filePath}`.cwd(targetPath).nothrow().quiet();
          diff = result.stdout.toString();
        } else {
          // 1. Working tree vs HEAD (covers staged + unstaged combined)
          const headResult = await $`git diff HEAD -- ${filePath}`.cwd(targetPath).nothrow().quiet();
          diff = headResult.stdout.toString();

          // 2. Staged diff (index vs HEAD) — covers staged-only or when HEAD fails
          if (!diff) {
            const cachedResult = await $`git diff --cached -- ${filePath}`.cwd(targetPath).nothrow().quiet();
            diff = cachedResult.stdout.toString();
          }

          // 3. Unstaged diff (working tree vs index) — last resort
          if (!diff) {
            const unstagedResult = await $`git diff -- ${filePath}`.cwd(targetPath).nothrow().quiet();
            diff = unstagedResult.stdout.toString();
          }
        }
      }

      return { diff, file: filePath };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      file: t.String(),
      projectId: t.Optional(t.String()),
    }),
  })

  // Stage files
  .post('/:id/git/stage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.stage(session.project.localPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()) }),
  })

  // Unstage files
  .post('/:id/git/unstage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.unstage(session.project.localPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()) }),
  })

  // Commit staged files
  .post('/:id/git/commit', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      const hash = await gitService.commit(session.project.localPath, body.message);
      return { success: true, hash };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ message: t.String() }),
  })

  // Checkout branch
  .post('/:id/git/checkout', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.checkout(session.project.localPath, body.branch, body.create || false);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ branch: t.String(), create: t.Optional(t.Boolean()) }),
  })

  // Pull
  .post('/:id/git/pull', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.pull(session.project.localPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })

  // Push
  .post('/:id/git/push', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.push(session.project.localPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })

  // Fetch
  .post('/:id/git/fetch', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.fetch(session.project.localPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })

  // Get git log
  .get('/:id/git/log', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      const limit = query.limit ? parseInt(query.limit) : 50;
      const commits = await gitService.log(session.project.localPath, limit);
      return { commits };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ limit: t.Optional(t.String()) }),
  })

  // List branches
  .get('/:id/git/branches', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      const branches = await gitService.listBranches(session.project.localPath);
      const status = await gitService.status(session.project.localPath);
      return { ...branches, current: status.branch };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })
  // Get sidebar tree data (projects with nested sessions)
  .get('/sidebar', async ({ user }) => {
    // Load all projects and sessions for the user
    const [userProjects, allSessions] = await Promise.all([
      db.query.projects.findMany({
        where: eq(projects.userId, user!.id),
        orderBy: (p, { asc }) => [asc(p.name)],
      }),
      db.query.claudeSessions.findMany({
        where: eq(claudeSessions.userId, user!.id),
        orderBy: (s, { desc }) => [desc(s.lastActiveAt)],
      }),
    ]);

    // Load child links for multi-projects
    const multiProjectIds = userProjects.filter(p => p.isMultiProject).map(p => p.id);
    const allLinks = multiProjectIds.length > 0
      ? await db.query.projectLinks.findMany({
          with: { childProject: true },
        })
      : [];

    // Count review comments per session
    const commentCounts: Record<string, number> = {};
    const sessionIds = allSessions.map(s => s.id);
    if (sessionIds.length > 0) {
      const counts = await db
        .select({
          sessionId: reviewComments.sessionId,
          count: sql<number>`count(*)::int`,
        })
        .from(reviewComments)
        .where(sql`${reviewComments.sessionId} IN ${sessionIds}`)
        .groupBy(reviewComments.sessionId);

      for (const row of counts) {
        commentCounts[row.sessionId] = row.count;
      }
    }

    // Build session data with live status and git stats
    const sessionDataMap = new Map<string, any>();
    for (const session of allSessions) {
      const terminals = terminalService.getSessionTerminals(session.id);
      const hasActiveTerminals = terminals.some(t => t.status === 'running');
      let liveStatus = hasActiveTerminals ? 'active' : session.status;

      // Auto-detect stale sessions: if status is 'active' or 'waiting_input' but
      // no terminals are running and last activity was > 2 minutes ago, treat as terminated
      if (!hasActiveTerminals && (session.status === 'active' || session.status === 'waiting_input')) {
        const staleThreshold = 2 * 60 * 1000; // 2 minutes
        const lastActive = new Date(session.lastActiveAt).getTime();
        if (Date.now() - lastActive > staleThreshold) {
          liveStatus = 'terminated';
          // Also update the DB so this doesn't keep showing up
          db.update(claudeSessions)
            .set({ status: 'terminated' })
            .where(eq(claudeSessions.id, session.id))
            .then(() => {})
            .catch(() => {});
        }
      }

      let diffStats = null;
      let branchName = '';

      // Only compute git stats for active sessions with a non-multi project
      if (liveStatus === 'active' && session.projectId) {
        const project = userProjects.find(p => p.id === session.projectId);
        if (project && !project.isMultiProject) {
          try {
            const [status, stats] = await Promise.all([
              gitService.status(project.localPath),
              gitService.diffStats(project.localPath),
            ]);
            branchName = status.branch;
            if (stats.additions > 0 || stats.deletions > 0) {
              diffStats = stats;
            }
          } catch {
            // Git operations may fail
          }
        }
      }

      sessionDataMap.set(session.id, {
        id: session.id,
        status: session.status,
        liveStatus,
        branchName,
        diffStats,
        commentCount: commentCounts[session.id] || 0,
      });
    }

    // Group sessions by project
    const projectSessionsMap = new Map<string, any[]>();
    const unassignedSessions: any[] = [];

    for (const session of allSessions) {
      const data = sessionDataMap.get(session.id);
      if (session.projectId) {
        const list = projectSessionsMap.get(session.projectId) || [];
        list.push(data);
        projectSessionsMap.set(session.projectId, list);
      } else {
        unassignedSessions.push(data);
      }
    }

    // Build sidebar projects
    const sidebarProjects = userProjects.map(p => {
      const linkedProjects = p.isMultiProject
        ? allLinks
            .filter(l => l.parentProjectId === p.id)
            .map(l => ({
              id: (l as any).childProject?.id,
              alias: l.alias,
              name: (l as any).childProject?.name || l.alias,
            }))
        : undefined;

      return {
        id: p.id,
        name: p.name,
        isMultiProject: p.isMultiProject,
        linkedProjects,
        sessions: projectSessionsMap.get(p.id) || [],
      };
    });

    return {
      projects: sidebarProjects,
      unassignedSessions,
    };
  })

  // Terminate session (close all terminals)
  .delete('/:id', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Close all terminals for this session
    await terminalService.closeSessionTerminals(params.id);

    // Dismiss pending notifications for this session
    await notificationService.dismissBySession(params.id);

    // Delete session (cascades to messages, terminals, review comments)
    await db.delete(claudeSessions)
      .where(eq(claudeSessions.id, params.id));

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
