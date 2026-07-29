import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  TerminalSquare,
  GitBranch,
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
import { NewSessionModal } from '@/components/NewSessionModal';
import { FEATURE_SECTION_TASKS } from '@/lib/flags';
import { Kbd } from '@/components/ui/kbd';

/** Fire this window event to open the palette from a click (sidebar search, etc.). */
export const OPEN_COMMAND_BAR = 'ra:open-command-bar';
export const openCommandBar = () => window.dispatchEvent(new Event(OPEN_COMMAND_BAR));

// Machine-scoped session path is /sessions/<machineId>/<sessionId>[/...].
function currentSession(pathname: string): { machineId: string; sessionId: string } | null {
  const m = pathname.match(/^\/sessions\/([^/]+)\/([^/]+)/);
  return m ? { machineId: m[1], sessionId: m[2] } : null;
}

/** Global ⌘K / Ctrl+K command palette. Mounted once in Layout. */
export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const setActiveMachine = useActiveMachine((s) => s.setActive);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true); // clickable entry points (e.g. sidebar search)
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

  const sessions = useMemo(() => {
    const rows: { machineId: string; machineName: string; id: string; label: string; branch: string }[] = [];
    for (const machine of data?.machines ?? []) {
      const { active, inactive } = flattenSidebarSessions(machine.data);
      for (const s of [...active, ...inactive]) {
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

  const here = currentSession(location.pathname);

  const shellMutation = useMutation({
    mutationFn: () => api.createTerminal({ sessionId: here!.sessionId, type: 'shell', name: 'Shell' }),
    onSuccess: (terminal) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', here!.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
      setOpen(false);
      navigate(sessionPath(here!.machineId, here!.sessionId, terminal.id));
    },
  });

  const go = (path: string) => { setOpen(false); navigate(path); };
  const openSession = (r: (typeof sessions)[number]) => {
    setActiveMachine({ machineId: r.machineId, name: r.machineName });
    go(sessionPath(r.machineId, r.id));
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
    <>
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command Menu"
        className="ra-cmdk"
        overlayClassName="ra-cmdk-overlay"
        contentClassName="ra-cmdk-content"
        loop
      >
        <Command.Input placeholder="Search sessions or run a command…" />
        <Command.List>
          <Command.Empty>No results found.</Command.Empty>

          <Command.Group heading="Actions">
            <Command.Item value="new session create" onSelect={() => { setOpen(false); setNewSessionOpen(true); }}>
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
        </Command.List>
      </Command.Dialog>

      <NewSessionModal open={newSessionOpen} onClose={() => setNewSessionOpen(false)} />
    </>
  );
}

/** Small hint badge for the sidebar / toolbar: ⌘K. */
export function CommandBarHint() {
  return <Kbd>⌘K</Kbd>;
}
