import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and, sql } from 'drizzle-orm';
import { db, claudeSessions, projects, projectLinks, reviewComments, worktrees } from '../db';
import { terminalService } from '../services/terminal';
import { gitService } from '../services/git';
import { notificationService } from '../services/notification';
import { requireAuth } from '../auth/middleware';
import { dockerService } from '../services/docker';
import { codeServerManager } from '../services/code-server/code-server.service';

/** Resolve target path for git operations, supporting worktrees and multi-project. */
async function resolveTargetPath(
  session: {
    project?: { id: string; localPath: string; isMultiProject: boolean } | null;
    worktree?: { path: string } | null;
    worktreeId?: string | null;
  },
  projectId: string | undefined
): Promise<string | null> {
  // Worktree takes priority
  if (session.worktreeId && session.worktree) {
    return session.worktree.path;
  }

  const project = session.project;
  if (!project) return null;
  if (!projectId || !project.isMultiProject) return project.localPath;

  const link = await db.query.projectLinks.findFirst({
    where: and(
      eq(projectLinks.parentProjectId, project.id),
      eq(projectLinks.childProjectId, projectId)
    ),
    with: { childProject: true },
  });

  return link && (link as any).childProject
    ? (link as any).childProject.localPath
    : null;
}

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
        worktree: true,
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
      worktreeId: body.worktreeId || null,
      status: 'active',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });

    const session = await db.query.claudeSessions.findFirst({
      where: eq(claudeSessions.id, sessionId),
      with: { project: true, worktree: true },
    });

    return session;
  }, {
    body: t.Object({
      projectId: t.Optional(t.String()),
      worktreeId: t.Optional(t.String()),
    }),
  })

  // Get git status for session's project
  .get('/:id/git/status', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true, worktree: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Resolve working path (worktree > multi-project child > project)
    let targetPath: string;
    if (session.worktreeId && session.worktree) {
      targetPath = session.worktree.path;
    } else if (!session.project) {
      return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
    } else if (query.projectId && session.project.isMultiProject) {
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
      return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
    } else {
      targetPath = session.project.localPath;
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
      with: { project: true, worktree: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Resolve working path (worktree > multi-project child > project)
    let targetPath: string;
    if (session.worktreeId && session.worktree) {
      targetPath = session.worktree.path;
    } else if (!session.project) {
      return { diff: '' };
    } else if (query.projectId && session.project.isMultiProject) {
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
    } else {
      targetPath = session.project.localPath;
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
      with: { project: true, worktree: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Resolve working path (worktree > multi-project child > project)
    let targetPath: string;
    if (session.worktreeId && session.worktree) {
      targetPath = session.worktree.path;
    } else if (!session.project) {
      return { diff: '' };
    } else if (query.projectId && session.project.isMultiProject) {
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
    } else {
      targetPath = session.project.localPath;
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
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.stage(targetPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()), projectId: t.Optional(t.String()) }),
  })

  // Unstage files
  .post('/:id/git/unstage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.unstage(targetPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()), projectId: t.Optional(t.String()) }),
  })

  // Commit staged files
  .post('/:id/git/commit', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      const hash = await gitService.commit(targetPath, body.message);
      return { success: true, hash };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ message: t.String(), projectId: t.Optional(t.String()) }),
  })

  // Checkout branch
  .post('/:id/git/checkout', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.checkout(targetPath, body.branch, body.create || false);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ branch: t.String(), create: t.Optional(t.Boolean()), projectId: t.Optional(t.String()) }),
  })

  // Pull
  .post('/:id/git/pull', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body?.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.pull(targetPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ projectId: t.Optional(t.String()) })),
  })

  // Push
  .post('/:id/git/push', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body?.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.push(targetPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ projectId: t.Optional(t.String()) })),
  })

  // Fetch
  .post('/:id/git/fetch', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body?.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.fetch(targetPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ projectId: t.Optional(t.String()) })),
  })

  // Get git log
  .get('/:id/git/log', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, query.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      const limit = query.limit ? parseInt(query.limit) : 50;
      const commits = await gitService.log(targetPath, limit);
      return { commits };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ limit: t.Optional(t.String()), projectId: t.Optional(t.String()) }),
  })

  // List branches
  .get('/:id/git/branches', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, query.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      const branches = await gitService.listBranches(targetPath);
      const status = await gitService.status(targetPath);
      return { ...branches, current: status.branch };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ projectId: t.Optional(t.String()) }),
  })
  // Get sidebar tree data (projects with nested sessions)
  .get('/sidebar', async ({ user }) => {
    // Load all projects and sessions for the user
    const [userProjects, allSessions] = await Promise.all([
      db.query.projects.findMany({
        where: eq(projects.userId, user!.id),
        orderBy: (p, { asc }) => [asc(p.sidebarPosition), asc(p.createdAt)],
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

    // Load worktrees
    const allWorktrees = await db.query.worktrees.findMany({
      where: eq(worktrees.userId, user!.id),
    });
    const worktreeMap = new Map(allWorktrees.map(w => [w.id, w]));

    // Fetch docker and code-server status once (used for all sessions)
    const CODE_SERVER_URL = process.env.VITE_CODE_SERVER_URL || '';
    const [dockerContainers, codeServerStatus] = await Promise.all([
      dockerService.listContainers().catch(() => [] as any[]),
      Promise.resolve(codeServerManager.getStatus()),
    ]);
    const runningContainerCount = dockerContainers.filter((c: any) => c.state === 'running').length;

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
      const worktree = session.worktreeId ? worktreeMap.get(session.worktreeId) : null;

      // Only compute git stats for active sessions with a non-multi project
      if (liveStatus === 'active' && session.projectId) {
        const project = userProjects.find(p => p.id === session.projectId);
        if (project && !project.isMultiProject) {
          // Determine the path for git ops
          const gitPath = worktree ? worktree.path : project.localPath;
          try {
            const [status, stats] = await Promise.all([
              gitService.status(gitPath),
              gitService.diffStats(gitPath),
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

      // Build services array from running terminals
      const services: Array<{
        type: string;
        id: string;
        label: string;
        status: string;
        count?: number;
        url?: string;
      }> = [];

      const runningTerminals = terminals.filter(t => t.status === 'running');

      for (const term of runningTerminals) {
        if (term.type === 'claude') {
          services.push({ type: 'claude', id: term.id, label: 'Claude', status: 'running' });
        } else if (term.type === 'shell') {
          services.push({ type: 'shell', id: term.id, label: term.name || 'Shell', status: 'running' });
        } else if (term.type === 'process') {
          services.push({ type: 'process', id: term.id, label: term.name || 'Process', status: 'running' });
        }
      }

      // Docker: attach to active sessions only
      if (runningContainerCount > 0 && liveStatus === 'active') {
        services.push({
          type: 'docker',
          id: 'docker',
          label: `Docker (${runningContainerCount})`,
          status: 'running',
          count: runningContainerCount,
        });
      }

      // Code Server: attach to active sessions only
      if (codeServerStatus === 'running' && liveStatus === 'active' && CODE_SERVER_URL) {
        services.push({
          type: 'codeServer',
          id: 'codeServer',
          label: 'Code Server',
          status: 'running',
          url: CODE_SERVER_URL,
        });
      }

      sessionDataMap.set(session.id, {
        id: session.id,
        status: session.status,
        liveStatus,
        branchName,
        diffStats,
        commentCount: commentCounts[session.id] || 0,
        worktreeId: session.worktreeId || null,
        worktreeName: worktree?.name || null,
        sessionType: session.worktreeId ? 'worktree' : 'git',
        services,
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
