import { eq, sql, inArray } from 'drizzle-orm';
import { db, claudeSessions, projects, projectLinks, reviewComments, worktrees } from '../../db';
import { terminalService } from '../terminal';
import { gitService } from '../git';
import { dockerService } from '../docker';
import { codeServerManager } from '../code-server/code-server.service';

/** Serialize a timestamp defensively — some rows carry null/invalid lastActiveAt. */
function toIsoString(value: unknown): string {
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/**
 * Build one machine's sidebar payload (projects with nested sessions + unassigned
 * sessions) for a user. Extracted from the GET /sessions/sidebar handler so it can
 * be called both directly (the local route) and as the "self" leg of the
 * cross-machine aggregate endpoint.
 */
export async function buildSidebarData(userId: string) {
  // Load all projects and sessions for the user
  const [userProjects, allSessions] = await Promise.all([
    db.query.projects.findMany({
      where: eq(projects.userId, userId),
      orderBy: (p, { asc }) => [asc(p.sidebarPosition), asc(p.createdAt)],
    }),
    db.query.claudeSessions.findMany({
      where: eq(claudeSessions.userId, userId),
      orderBy: (s, { desc }) => [desc(s.lastActiveAt)],
    }),
  ]);

  // SSH sessions live in the SSH section of the sidebar, not here. They own no
  // local PTYs, so the stale check below would wrongly terminate live ones.
  const workSessions = allSessions.filter(s => !s.sshHostId);

  // Load child links for multi-projects
  const multiProjectIds = userProjects.filter(p => p.isMultiProject).map(p => p.id);
  const allLinks = multiProjectIds.length > 0
    ? await db.query.projectLinks.findMany({
        with: { childProject: true },
      })
    : [];

  // Count review comments per session
  const commentCounts: Record<string, number> = {};
  const sessionIds = workSessions.map(s => s.id);
  if (sessionIds.length > 0) {
    const counts = await db
      .select({
        sessionId: reviewComments.sessionId,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(reviewComments)
      .where(inArray(reviewComments.sessionId, sessionIds))
      .groupBy(reviewComments.sessionId);

    for (const row of counts) {
      commentCounts[row.sessionId] = row.count;
    }
  }

  // Load worktrees
  const allWorktrees = await db.query.worktrees.findMany({
    where: eq(worktrees.userId, userId),
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
  for (const session of workSessions) {
    const terminals = terminalService.getSessionTerminals(session.id);
    const hasActiveTerminals = terminals.some(t => t.status === 'running');
    let liveStatus = hasActiveTerminals ? 'active' : session.status;

    // Auto-detect stale sessions: if status is active/waiting_input/paused but
    // no terminals are running and last activity was > 2 minutes ago, treat as terminated
    if (!hasActiveTerminals && (session.status === 'active' || session.status === 'waiting_input' || session.status === 'paused')) {
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
        // Use the terminal's name so the sidebar shows the actual title
        // (e.g. "Load Hetzner JSON") rather than a generic "Claude".
        services.push({ type: 'claude', id: term.id, label: term.name || 'Claude', status: 'running' });
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
      lastActiveAt: toIsoString(session.lastActiveAt),
    });
  }

  // Group sessions by project
  const projectSessionsMap = new Map<string, any[]>();
  const unassignedSessions: any[] = [];

  for (const session of workSessions) {
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
}
