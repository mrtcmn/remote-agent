import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { userInfo } from 'os';
import { getWorkspacesRoot, getAgentHome } from '../config/paths';
import { db, claudeSessions, terminals } from '../db';
import { terminalService } from '../services/terminal';
import { workspaceService } from '../services/workspace';
import { resolveProjectEnv } from '../services/workspace/env.service';
import { getProjectCredentials } from '../services/git';
import { requireAuth } from '../auth/middleware';

const CLAUDE_BIN = process.env.CLAUDE_BIN_PATH || 'claude';
const OPENCODE_BIN = process.env.OPENCODE_BIN_PATH || 'opencode';
const KIMI_BIN = process.env.KIMI_BIN_PATH || 'kimi';

function isValidShellPath(shell: string | null | undefined): shell is string {
  // Reject empty, non-absolute paths, and sentinel values like "unknown"
  // that libc returns when /etc/passwd has no shell entry (common in minimal
  // Docker images).
  return !!shell && shell.startsWith('/') && existsSync(shell);
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  if (isValidShellPath(process.env.SHELL)) return process.env.SHELL!;
  try {
    const info = userInfo();
    if (isValidShellPath(info.shell)) return info.shell;
  } catch {}
  for (const fallback of ['/bin/bash', '/bin/sh']) {
    if (existsSync(fallback)) return fallback;
  }
  return '/bin/sh';
}

const SHARED_DEFAULT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
};

export const terminalRoutes = new Elysia({ prefix: '/terminals' })
  .use(requireAuth)

  // List terminals for a session
  .get('/session/:sessionId', async ({ user, params, set }) => {
    // Verify session ownership
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Get terminals from database
    const dbTerminals = await db.query.terminals.findMany({
      where: eq(terminals.sessionId, params.sessionId),
    });

    // Enrich with live status
    return dbTerminals.map(t => {
      const live = terminalService.getTerminal(t.id);
      return {
        ...t,
        command: JSON.parse(t.command),
        cols: parseInt(t.cols, 10),
        rows: parseInt(t.rows, 10),
        liveStatus: live?.status || t.status,
      };
    });
  }, {
    params: t.Object({
      sessionId: t.String(),
    }),
  })

  // Create terminal
  .post('/', async ({ user, body, set }) => {
    // Verify session ownership
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, body.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true, worktree: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const terminalId = nanoid();
    const userWorkspace = join(getWorkspacesRoot(), user!.id);
    // Resolve CWD: explicit > worktree > project > workspace
    let cwd = body.cwd;
    if (!cwd && session.worktreeId && session.worktree) {
      cwd = session.worktree.path;
    } else if (!cwd && session.project) {
      cwd = session.project.localPath;
    }
    if (!cwd) cwd = userWorkspace;
    const type = body.type || 'shell';

    // Resolve project-level env vars
    const projectEnv = session.project
      ? await resolveProjectEnv(session.project.id)
      : {};

    // Build command based on type
    let command: string[];
    let name: string;
    let env: Record<string, string> = {
      ...SHARED_DEFAULT_ENV,
      HOME: getAgentHome(),
      ...projectEnv,
    };

    // Set GH_TOKEN for GitHub App projects so `gh` CLI and shell git commands work
    if (session.project?.githubAppInstallationId) {
      try {
        const creds = await getProjectCredentials(session.project, user!.id);
        if (creds.token) {
          env.GH_TOKEN = creds.token;
          env.GITHUB_TOKEN = creds.token;
        }
      } catch {
        // Non-fatal: credential helper will handle git auth as fallback
      }
    }

    if (type === 'claude') {
      // cwd is inherited from the outer scope (body.cwd || project.localPath || userWorkspace)
      command = [CLAUDE_BIN, '--dangerously-skip-permissions'];
      // Append initial prompt if provided (starts REPL with query)
      if (body.initialPrompt) {
        command.push(body.initialPrompt);
      }
      name = body.name || 'Claude';

      // Ensure user workspace, .claude directory, templates, and hooks exist
      await workspaceService.createUserWorkspace(user!.id);
      await workspaceService.deployGlobalTemplates(user!.id);
      await workspaceService.storeHooks(user!.id, body.sessionId, terminalId);

      // Set session and terminal IDs for hook callbacks
      env.REMOTE_AGENT_SESSION_ID = body.sessionId;
      env.REMOTE_AGENT_TERMINAL_ID = terminalId;
    } else if (type === 'opencode') {
      command = [OPENCODE_BIN];
      name = body.name || 'Opencode';
      await workspaceService.createUserWorkspace(user!.id);
    } else if (type === 'kimi') {
      command = [KIMI_BIN];
      name = body.name || 'Kimi';
      await workspaceService.createUserWorkspace(user!.id);
    } else {
      command = body.command || [getDefaultShell(), '-l'];
      name = body.name || 'Terminal';
      await workspaceService.createUserWorkspace(user!.id);
    }

    try {
      const terminal = await terminalService.createTerminal({
        terminalId,
        sessionId: body.sessionId,
        name,
        type,
        command,
        cols: body.cols,
        rows: body.rows,
        persist: body.persist,
        cwd,
        env,
      });

      return {
        id: terminal.id,
        sessionId: terminal.sessionId,
        name: terminal.name,
        type: terminal.type,
        command: terminal.command,
        cols: terminal.cols,
        rows: terminal.rows,
        persist: terminal.persist,
        status: terminal.status,
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      sessionId: t.String(),
      name: t.Optional(t.String()),
      type: t.Optional(t.Union([t.Literal('shell'), t.Literal('claude'), t.Literal('opencode'), t.Literal('kimi'), t.Literal('process')])),
      command: t.Optional(t.Array(t.String())),
      cols: t.Optional(t.Number()),
      rows: t.Optional(t.Number()),
      persist: t.Optional(t.Boolean()),
      initialPrompt: t.Optional(t.String()),
      cwd: t.Optional(t.String()),
    }),
  })

  // Get terminal
  .get('/:id', async ({ user, params, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    // Verify ownership via session
    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    const live = terminalService.getTerminal(params.id);

    return {
      ...terminal,
      command: JSON.parse(terminal.command),
      cols: parseInt(terminal.cols, 10),
      rows: parseInt(terminal.rows, 10),
      liveStatus: live?.status || terminal.status,
    };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Resize terminal
  .post('/:id/resize', async ({ user, params, body, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    try {
      await terminalService.resize(params.id, body.cols, body.rows);
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
      cols: t.Number(),
      rows: t.Number(),
    }),
  })

  // Remove all exited terminals for a session
  .delete('/session/:sessionId/exited', async ({ user, params, set }) => {
    // Verify session ownership
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const removed = await terminalService.removeExitedTerminals(params.sessionId);
    return { success: true, removed };
  }, {
    params: t.Object({
      sessionId: t.String(),
    }),
  })

  // Paste image - save to temp file and return path
  .post('/:id/paste-image', async ({ user, params, body, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    const file = body.image;
    if (!(file instanceof File)) {
      set.status = 400;
      return { error: 'No image provided' };
    }

    // Cap at 10MB
    if (file.size > 10 * 1024 * 1024) {
      set.status = 400;
      return { error: 'Image too large (max 10MB)' };
    }

    // Determine extension from MIME type
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
    };
    const ext = extMap[file.type] || 'png';

    const pasteDir = '/tmp/terminal-pastes';
    await mkdir(pasteDir, { recursive: true });

    const filename = `${nanoid()}.${ext}`;
    const filePath = join(pasteDir, filename);
    await Bun.write(filePath, file);

    return { filePath };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      image: t.File(),
    }),
    type: 'multipart/form-data',
  })

  // Drag-and-drop upload — save any file to a temp dir and return its absolute
  // path so the UI can insert it into the terminal input. A unique subdir per
  // upload keeps the original filename intact and collision-free.
  .post('/:id/upload-file', async ({ user, params, body, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    const file = body.file;
    if (!(file instanceof File)) {
      set.status = 400;
      return { error: 'No file provided' };
    }

    if (file.size > 100 * 1024 * 1024) {
      set.status = 400;
      return { error: 'File too large (max 100MB)' };
    }

    const safeName = (file.name || 'file').replace(/[^\w.-]+/g, '_');
    const dir = join('/tmp/terminal-drops', nanoid(8));
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, safeName);
    await Bun.write(filePath, file);

    return { filePath };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      file: t.File(),
    }),
    type: 'multipart/form-data',
  })

  // Local-mode drag-and-drop assist: the browser never reveals a dropped
  // file's absolute path, but on the machine that received the drop the macOS
  // drag pasteboard still holds the file:// URLs. Read them natively and only
  // trust the result if it matches exactly the filenames the UI dropped.
  // ponytail: no isLocalMode() gate — the filename match IS the same-machine
  // check. A cloud server's pasteboard can't contain the dropped names, so it
  // returns [] and the caller falls back to uploading.
  .post('/local-drop-paths', async ({ body, set }) => {
    if (process.platform !== 'darwin') {
      set.status = 404;
      return { error: 'Not available' };
    }
    const script =
      'ObjC.import("AppKit");' +
      'const pb=$.NSPasteboard.pasteboardWithName($.NSPasteboardNameDrag);' +
      'const items=pb.pasteboardItems;const urls=[];' +
      'for(let i=0;i<items.count;i++){' +
      'const s=items.objectAtIndex(i).stringForType("public.file-url");' +
      'if(s&&!s.isNil()){const u=$.NSURL.URLWithString(s);if(!u.isNil())urls.push(u.path.js)}}' +
      'JSON.stringify(urls)';
    try {
      const proc = Bun.spawn(['osascript', '-l', 'JavaScript', '-e', script], {
        stdout: 'pipe',
        stderr: 'ignore',
      });
      const out = (await new Response(proc.stdout).text()).trim();
      const paths: string[] = JSON.parse(out || '[]');
      const wanted = [...body.names].sort();
      const got = paths.map((p) => basename(p)).sort();
      const matches = wanted.length === got.length && wanted.every((n, i) => n === got[i]);
      return { paths: matches ? paths : [] };
    } catch {
      return { paths: [] };
    }
  }, {
    body: t.Object({ names: t.Array(t.String()) }),
  })

  // Close terminal
  .delete('/:id', async ({ user, params, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    await terminalService.closeTerminal(params.id);

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
