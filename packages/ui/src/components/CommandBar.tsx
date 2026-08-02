import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  TerminalSquare,
  GitBranch,
  Layers,
  Home,
  LayoutGrid,
  FolderGit2,
  Sparkles,
  Plug,
  Settings,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useActiveMachine } from '@/lib/active-machine';
import { flattenSidebarSessions } from '@/lib/sidebar-sessions';
import { sessionPath } from '@/lib/session-route';
import { FEATURE_SECTION_TASKS } from '@/lib/flags';
import { Kbd } from '@/components/ui/kbd';

/** Fire this window event to open the palette from a click (sidebar search, new-session buttons, etc.). */
export const OPEN_COMMAND_BAR = 'ra:open-command-bar';
export const openCommandBar = (initialQuery?: string) =>
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_BAR, { detail: initialQuery }));

// Machine-scoped session path is /sessions/<machineId>/<sessionId>[/...].
function currentSession(pathname: string): { machineId: string; sessionId: string } | null {
  const m = pathname.match(/^\/sessions\/([^/]+)\/([^/]+)/);
  return m ? { machineId: m[1], sessionId: m[2] } : null;
}

/** Global ⌘K / Ctrl+K command palette. Mounted once in Layout. */
export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  // Branch mode: input repurposed to collect a branch name for a chosen "New Worktree" target.
  const [branchTarget, setBranchTarget] = useState<{ machineId: string; machineName: string; projectId: string; projectName: string } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const setActiveMachine = useActiveMachine((s) => s.setActive);

  const closeAndReset = () => {
    setOpen(false);
    setInputValue('');
    setBranchTarget(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // Clickable entry points (sidebar search, "New Session" buttons, ...), optionally pre-filled.
    const onOpen = (e: Event) => {
      setOpen(true);
      const query = (e as CustomEvent<string | undefined>).detail;
      if (query) setInputValue(query);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_BAR, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_COMMAND_BAR, onOpen);
    };
  }, []);

  // Shares the sidebar's query cache — no extra request. Only fetch while open.
  const { data } = useQuery({
    queryKey: ['sidebar-aggregate'],
    queryFn: api.getAggregatedSidebar,
    enabled: open,
  });

  const multipleMachines = (data?.machines?.length ?? 0) > 1;

  // Only active sessions — old/terminated sessions clutter the palette and belong in the sidebar's history.
  const sessions = useMemo(() => {
    const rows: { machineId: string; machineName: string; id: string; label: string; branch: string }[] = [];
    for (const machine of data?.machines ?? []) {
      const { active } = flattenSidebarSessions(machine.data);
      for (const s of active) {
        rows.push({
          machineId: machine.machineId,
          machineName: machine.machineName,
          id: s.id,
          label: s.projectName || s.worktreeName || 'session',
          branch: s.branchName,
        });
      }
    }
    return rows;
  }, [data]);

  // One row per (project, machine) so typing a project name surfaces every machine that has it.
  const projectTargets = useMemo(() => {
    const rows: { machineId: string; machineName: string; projectId: string; projectName: string }[] = [];
    for (const machine of data?.machines ?? []) {
      for (const project of machine.data.projects) {
        if (project.isMultiProject) continue;
        rows.push({ machineId: machine.machineId, machineName: machine.machineName, projectId: project.id, projectName: project.name });
      }
    }
    return rows;
  }, [data]);

  // One row per machine for a project-less session — the only way to reach a machine with no projects registered.
  const machineTargets = useMemo(
    () => (data?.machines ?? []).map((m) => ({ machineId: m.machineId, machineName: m.machineName })),
    [data]
  );

  const here = currentSession(location.pathname);

  const shellMutation = useMutation({
    mutationFn: () => api.createTerminal({ sessionId: here!.sessionId, type: 'shell', name: 'Shell' }),
    onSuccess: (terminal) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', here!.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
      closeAndReset();
      navigate(sessionPath(here!.machineId, here!.sessionId, terminal.id));
    },
  });

  const onSessionCreated = (machineId: string, machineName: string, sessionId: string) => {
    setActiveMachine({ machineId, name: machineName });
    queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    closeAndReset();
    navigate(sessionPath(machineId, sessionId));
  };

  const createSessionMutation = useMutation({
    mutationFn: (t: { machineId: string; projectId?: string }) => api.createSession(t.projectId, undefined, t.machineId),
    onSuccess: (session, t) => {
      const machineName = data?.machines.find((m) => m.machineId === t.machineId)?.machineName ?? 'this machine';
      onSessionCreated(t.machineId, machineName, session.id);
    },
  });

  const createWorktreeMutation = useMutation({
    mutationFn: (t: { machineId: string; projectId: string; branch: string }) =>
      api.createWorktree({ projectId: t.projectId, branch: t.branch, name: t.branch, createBranch: true }, t.machineId),
    onSuccess: (result, t) => {
      const machineName = data?.machines.find((m) => m.machineId === t.machineId)?.machineName ?? 'this machine';
      onSessionCreated(t.machineId, machineName, result.session.id);
    },
  });

  const go = (path: string) => { closeAndReset(); navigate(path); };
  const openSession = (r: (typeof sessions)[number]) => {
    setActiveMachine({ machineId: r.machineId, name: r.machineName });
    go(sessionPath(r.machineId, r.id));
  };

  const confirmWorktree = () => {
    if (!branchTarget || !inputValue.trim()) return;
    createWorktreeMutation.mutate({ machineId: branchTarget.machineId, projectId: branchTarget.projectId, branch: inputValue.trim() });
  };

  const pages = [
    { label: 'Dashboard', icon: Home, to: '/' },
    ...(FEATURE_SECTION_TASKS ? [{ label: 'Kanban', icon: LayoutGrid, to: '/kanban' }] : []),
    { label: 'Projects', icon: FolderGit2, to: '/projects' },
    { label: 'Skills', icon: Sparkles, to: '/skills' },
    { label: 'MCP Servers', icon: Plug, to: '/mcp-servers' },
    { label: 'Settings', icon: Settings, to: '/settings' },
  ];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : closeAndReset())}
      label="Command Menu"
      className="ra-cmdk"
      overlayClassName="ra-cmdk-overlay"
      contentClassName="ra-cmdk-content"
      loop
    >
      <Command.Input
        value={inputValue}
        onValueChange={setInputValue}
        placeholder={branchTarget ? `Branch name for ${branchTarget.projectName}… (Enter to create)` : 'Search sessions or run a command…'}
        onKeyDown={(e) => {
          if (branchTarget && e.key === 'Enter') {
            e.preventDefault();
            confirmWorktree();
          }
        }}
      />
      <Command.List>
        {branchTarget ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            Press <Kbd>Enter</Kbd> to create a worktree session for <strong className="text-foreground">{branchTarget.projectName}</strong>
            {multipleMachines && <> on <strong className="text-foreground">{branchTarget.machineName}</strong></>}, or <Kbd>Esc</Kbd> to cancel.
          </div>
        ) : (
          <>
            <Command.Empty>No results found.</Command.Empty>

            <Command.Group heading="Actions">
              <Command.Item value="new session create" onSelect={() => createSessionMutation.mutate({ machineId: 'self' })}>
                <Plus className="size-4 shrink-0" />
                <span>New Session</span>
              </Command.Item>
              {here && (
                <Command.Item value="new shell terminal current session" onSelect={() => shellMutation.mutate()}>
                  <TerminalSquare className="size-4 shrink-0" />
                  <span>New Shell in current session</span>
                </Command.Item>
              )}
            </Command.Group>

            {(machineTargets.length > 0 || projectTargets.length > 0) && (
              <Command.Group heading="Create">
                {machineTargets.map((m) => (
                  <Command.Item
                    key={`session:${m.machineId}:blank`}
                    value={`create new session ${m.machineName}`}
                    onSelect={() => createSessionMutation.mutate({ machineId: m.machineId })}
                  >
                    <Plus className="size-4 shrink-0 text-muted-foreground" />
                    <span>Create session{multipleMachines && ` [${m.machineName}]`}</span>
                  </Command.Item>
                ))}
                {projectTargets.map((t) => (
                  <Command.Item
                    key={`session:${t.machineId}:${t.projectId}`}
                    value={`create new session ${t.projectName} ${t.machineName}`}
                    onSelect={() => createSessionMutation.mutate({ machineId: t.machineId, projectId: t.projectId })}
                  >
                    <Plus className="size-4 shrink-0 text-muted-foreground" />
                    <span>
                      Create session{multipleMachines && ` [${t.machineName}]`}: {t.projectName}
                    </span>
                  </Command.Item>
                ))}
                {projectTargets.map((t) => (
                  <Command.Item
                    key={`worktree:${t.machineId}:${t.projectId}`}
                    value={`create new worktree ${t.projectName} ${t.machineName}`}
                    onSelect={() => { setBranchTarget(t); setInputValue(''); }}
                  >
                    <Layers className="size-4 shrink-0 text-muted-foreground" />
                    <span>
                      Create worktree{multipleMachines && ` [${t.machineName}]`}: {t.projectName}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {sessions.length > 0 && (
              <Command.Group heading="Sessions">
                {sessions.map((r) => (
                  <Command.Item
                    key={`${r.machineId}:${r.id}`}
                    value={`${r.label} ${r.branch} ${r.machineName} ${r.id}`}
                    onSelect={() => openSession(r)}
                  >
                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{r.label}</span>
                    <span className="truncate text-muted-foreground">· {r.branch}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Go to">
              {pages.map((p) => (
                <Command.Item key={p.to} value={`go ${p.label}`} onSelect={() => go(p.to)}>
                  <p.icon className="size-4 shrink-0" />
                  <span>{p.label}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

/** Small hint badge for the sidebar / toolbar: ⌘K. */
export function CommandBarHint() {
  return <Kbd>⌘K</Kbd>;
}
