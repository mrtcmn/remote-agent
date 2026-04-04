import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, GitBranch, Layers, Loader2, X } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

type SessionMode = 'local' | 'worktree';

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  preselectedProjectId?: string | null;
}

export function NewSessionModal({ open, onClose, preselectedProjectId }: NewSessionModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>('local');
  const [branch, setBranch] = useState('');
  const [worktreeName, setWorktreeName] = useState('');
  const [createBranch, setCreateBranch] = useState(false);

  const { data: allProjects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    enabled: open,
  });

  // If we have a preselected project, skip project selection
  const hasPreselectedProject = !!preselectedProjectId;

  const createSessionMutation = useMutation({
    mutationFn: (projectId?: string) => api.createSession(projectId),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
      navigate(`/sessions/${session.id}`);
    },
  });

  const createWorktreeMutation = useMutation({
    mutationFn: (data: { projectId: string; branch: string; name: string; createBranch?: boolean }) =>
      api.createWorktree(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
      navigate(`/sessions/${result.session.id}`);
    },
  });

  const isPending = createSessionMutation.isPending || createWorktreeMutation.isPending;

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedProjectId(preselectedProjectId || null);
      setMode('local');
      setBranch('');
      setWorktreeName('');
      setCreateBranch(false);
      createSessionMutation.reset();
      createWorktreeMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedProjectId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    },
    [onClose, isPending]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open) return null;

  const effectiveProjectId = selectedProjectId || preselectedProjectId;

  const handleCreate = () => {
    if (mode === 'worktree' && effectiveProjectId) {
      createWorktreeMutation.mutate({
        projectId: effectiveProjectId,
        branch,
        name: worktreeName || branch,
        createBranch,
      });
    } else {
      createSessionMutation.mutate(effectiveProjectId ?? undefined);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isPending) onClose();
  };

  const canCreate = mode === 'local' || (mode === 'worktree' && branch.trim().length > 0);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg mx-4 bg-background border border-border rounded-lg shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Session</h2>
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Project selection (only if no preselected project) */}
          {!hasPreselectedProject && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Project</label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                <button
                  onClick={() => { setSelectedProjectId(null); setMode('local'); }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                    !selectedProjectId
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-accent border border-transparent'
                  )}
                >
                  <FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm">No Project</span>
                </button>

                {projectsLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {allProjects?.filter(p => !p.isMultiProject).map((project: Project) => (
                  <button
                    key={project.id}
                    onClick={() => setSelectedProjectId(project.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                      selectedProjectId === project.id
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-accent border border-transparent'
                    )}
                  >
                    <FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{project.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Session type toggle (only when a project is selected) */}
          {effectiveProjectId && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('local')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border',
                    mode === 'local'
                      ? 'bg-primary/10 border-primary/30 text-foreground'
                      : 'border-transparent hover:bg-accent text-muted-foreground'
                  )}
                >
                  <GitBranch className="size-3.5" />
                  Local
                </button>
                <button
                  onClick={() => setMode('worktree')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border',
                    mode === 'worktree'
                      ? 'bg-primary/10 border-primary/30 text-foreground'
                      : 'border-transparent hover:bg-accent text-muted-foreground'
                  )}
                >
                  <Layers className="size-3.5" />
                  Worktree
                </button>
              </div>
            </div>
          )}

          {/* Worktree config (only when worktree mode) */}
          {mode === 'worktree' && effectiveProjectId && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Branch</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="e.g. feature/auth or existing branch name"
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={createBranch}
                    onChange={(e) => setCreateBranch(e.target.checked)}
                    className="rounded border-border"
                  />
                  Create new branch (if it doesn't exist)
                </label>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Name</label>
                <input
                  type="text"
                  value={worktreeName}
                  onChange={(e) => setWorktreeName(e.target.value)}
                  placeholder={branch || 'worktree name'}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Optional — defaults to branch name
                </p>
              </div>
            </div>
          )}

          {/* Error display */}
          {(createSessionMutation.error || createWorktreeMutation.error) && (
            <p className="text-sm text-red-500">
              {(createSessionMutation.error || createWorktreeMutation.error)?.message}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending || !canCreate}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating...
              </>
            ) : mode === 'worktree' ? (
              'Create Worktree Session'
            ) : (
              'Create Session'
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
