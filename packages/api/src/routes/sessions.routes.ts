import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { db, claudeSessions, projects, projectLinks, reviewComments, worktrees } from '../db';
import { terminalService } from '../services/terminal';
import { gitService, getProjectCredentials } from '../services/git';
import { notificationService } from '../services/notification';
import { requireAuth } from '../auth/middleware';
import { dockerService } from '../services/docker';
import { codeServerManager } from '../services/code-server/code-server.service';
import { buildSidebarData } from '../services/sidebar/build-sidebar';
import { fanOutToMachines } from '../services/aggregation/fan-out';
import { assembleSidebar } from '../services/aggregation/merge';
import { worktreeService } from '../services/git/worktree.service';
import { snapshotAndPush, fetchAndRestore, deleteSnapshot, normalizeRepoUrl, snapshotRef, HandoffConflictError } from '../services/git/handoff';
import { resolveMachine, machineFetch } from '../services/machines/resolve';
import { startTerminal } from './terminals.routes';
import { hostname } from 'node:os';

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


type HandoffPayload = {
  repoUrl: string;
  branch: string;
  headSha: string;
  fromSessionId: string;
  fromMachineName: string;
  note?: string;
  lastMessage?: string | null;
};

class HandoffError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Target side of a handoff: land the branch + snapshot in a new worktree and start an agent on it. */
async function receiveHandoff(userId: string, p: HandoffPayload) {
  const key = normalizeRepoUrl(p.repoUrl);
  const candidates = await db.query.projects.findMany({ where: eq(projects.userId, userId) });
  const project = candidates.find((c: typeof projects.$inferSelect) => c.repoUrl && !c.isMultiProject && normalizeRepoUrl(c.repoUrl) === key);
  if (!project) throw new HandoffError(404, `No project on this machine has origin ${p.repoUrl}. Clone it here first.`);

  const creds = await getProjectCredentials(project, userId);
  await gitService.fetch(project.localPath, creds.sshKeyPath, creds.token);
  let worktree;
  try {
    worktree = await worktreeService.create({ projectId: project.id, userId, branch: p.branch, name: p.branch });
  } catch (err) {
    throw new HandoffError(409, (err as Error).message);
  }
  try {
    await fetchAndRestore(worktree.path, p.branch, p.fromSessionId, p.headSha, creds);
  } catch (err) {
    await worktreeService.remove(worktree.id, userId).catch(() => {});
    throw new HandoffError(err instanceof HandoffConflictError ? 409 : 500, (err as Error).message);
  }

  const sessionId = nanoid();
  await db.insert(claudeSessions).values({
    id: sessionId, userId, projectId: project.id, worktreeId: worktree.id,
    status: 'active', createdAt: new Date(), lastActiveAt: new Date(),
  });
  const session = await db.query.claudeSessions.findFirst({
    where: eq(claudeSessions.id, sessionId),
    with: { project: true, worktree: true },
  });
  const prompt = [
    `This work was handed off from machine "${p.fromMachineName}" on branch ${p.branch}.`,
    'The uncommitted changes from that machine are restored as unstaged changes. Run `git status` and `git diff` to see them.',
    p.lastMessage ? `The last agent message there was:\n${p.lastMessage}` : '',
    p.note ? `Note from the user: ${p.note}` : 'Continue the work.',
  ].filter(Boolean).join('\n\n');
  await startTerminal(userId, session!, { sessionId, type: 'claude', initialPrompt: prompt, persist: true });
  return { sessionId };
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
      const status = await gitService.status(targetPath, { recent: query.recent === '1' });
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
      recent: t.Optional(t.String()),
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
      const creds = await getProjectCredentials(session.project, user!.id);
      await gitService.pull(targetPath, undefined, creds.sshKeyPath, creds.token);
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
      const creds = await getProjectCredentials(session.project, user!.id);
      await gitService.push(targetPath, undefined, creds.sshKeyPath, creds.token);
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
      const creds = await getProjectCredentials(session.project, user!.id);
      await gitService.fetch(targetPath, creds.sshKeyPath, creds.token);
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
  // Get sidebar tree data (projects with nested sessions) for THIS machine
  .get('/sidebar', ({ user, query }) =>
    buildSidebarData(user!.id, { activeOnly: query.activeOnly === '1' }), {
    query: t.Object({ activeOnly: t.Optional(t.String()) }),
  })

  // Aggregate sidebar across self + all paired machines. Local-only: it runs on
  // this machine and fans out to paired masters, so it is never itself proxied.
  .get('/sidebar/aggregate', async ({ user }) => {
    const self = {
      machineId: 'self',
      machineName: 'This machine',
      online: true,
      data: await buildSidebarData(user!.id, { activeOnly: true }),
    };
    const remotes = await fanOutToMachines<Awaited<ReturnType<typeof buildSidebarData>>>(
      user!.id,
      '/sessions/sidebar?activeOnly=1',
    );
    return assembleSidebar([self, ...remotes]);
  })

  // Hand a session off to another machine: push branch + snapshot, have the target restore it.
  // `to` is a machine id, 'self', or 'caller' (the machine that relayed this request — "Continue here").
  .post('/:id/handoff', async ({ user, params, body, set, session: authSession }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session) { set.status = 404; return { error: 'Session not found' }; }
    if (!session.project?.repoUrl) { set.status = 400; return { error: 'Session has no project with an origin' }; }
    const cwd = await resolveTargetPath(session, undefined);
    if (!cwd) { set.status = 400; return { error: 'Session has no working directory' }; }

    const toId = body.to === 'caller' ? authSession?.machineId : body.to;
    const target = toId && toId !== 'self' ? await resolveMachine(toId, user!.id) : null;
    if (toId !== 'self' && !target) { set.status = 404; return { error: `Machine ${body.to} is not reachable` }; }

    const creds = await getProjectCredentials(session.project, user!.id);
    let pushed;
    try {
      pushed = await snapshotAndPush(cwd, session.id, creds);
    } catch (err) {
      set.status = 400;
      return { error: (err as Error).message };
    }

    const payload: HandoffPayload = {
      repoUrl: session.project.repoUrl, branch: pushed.branch, headSha: pushed.headSha,
      fromSessionId: session.id, fromMachineName: hostname(), note: body.note, lastMessage: session.lastMessage,
    };
    let result: { sessionId: string };
    try {
      if (!target) {
        result = await receiveHandoff(user!.id, payload);
      } else {
        const res = await machineFetch(target, '/api/sessions/handoff/receive', {
          method: 'POST',
          headers: new Headers({ 'content-type': 'application/json' }),
          body: new TextEncoder().encode(JSON.stringify(payload)),
        });
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (!res.ok) throw new HandoffError(res.status, data.error ?? `HTTP ${res.status}`);
        result = data;
      }
    } catch (err) {
      set.status = err instanceof HandoffError ? err.status : 502;
      return { error: `${(err as Error).message} (snapshot kept on origin as ${snapshotRef(session.id)})` };
    }

    await deleteSnapshot(cwd, session.id, creds).catch(() => {});
    if (body.closeSource) await terminalService.closeSessionTerminals(session.id);
    return { sessionId: result.sessionId, machineId: toId === 'self' ? 'self' : target!.machineId, branch: pushed.branch };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      to: t.String(),
      note: t.Optional(t.String()),
      closeSource: t.Optional(t.Boolean()),
    }),
  })

  // Target side of a handoff, called machine-to-machine.
  .post('/handoff/receive', async ({ user, body, set }) => {
    try {
      return await receiveHandoff(user!.id, body);
    } catch (err) {
      set.status = err instanceof HandoffError ? err.status : 500;
      return { error: (err as Error).message };
    }
  }, {
    body: t.Object({
      repoUrl: t.String(),
      branch: t.String(),
      headSha: t.String(),
      fromSessionId: t.String(),
      fromMachineName: t.String(),
      note: t.Optional(t.String()),
      lastMessage: t.Optional(t.Nullable(t.String())),
    }),
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
