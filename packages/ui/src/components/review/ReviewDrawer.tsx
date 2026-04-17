import { useEffect, useCallback, useState, useRef } from 'react';
import { Drawer } from 'vaul';
import { useQuery } from '@tanstack/react-query';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import {
  X,
  Loader2,
  AlertCircle,
  Presentation,
  GitCommit,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import type { SlideAnnotation as SlideAnnotationType, GitLogEntry } from '@/lib/api';
import { usePresentationStream } from '@/hooks/usePresentationStream';
import { SlideCard } from '@/components/presentation/SlideCard';
import { SlideSkeleton } from '@/components/presentation/SlideSkeleton';
import { cn } from '@/lib/utils';

const workerFactory = () =>
  new Worker(new URL('../../workers/diff-worker.js', import.meta.url), { type: 'module' });

type SourceTab = 'changes' | 'commits';

interface ReviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  projectId?: string;
}

export function ReviewDrawer({ open, onOpenChange, sessionId, projectId }: ReviewDrawerProps) {
  const { plan, slides, status, error, start, cancel } = usePresentationStream();
  const [annotations, setAnnotations] = useState<SlideAnnotationType[]>([]);
  const [activeTab, setActiveTab] = useState<SourceTab>('changes');
  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
  const [reviewStarted, setReviewStarted] = useState(false);
  const hasAutoStarted = useRef(false);

  // Fetch recent commits when on commits tab
  const { data: commitData, isLoading: commitsLoading } = useQuery({
    queryKey: ['review-drawer-git-log', sessionId, projectId],
    queryFn: () => api.getSessionGitLog(sessionId, 20, projectId),
    enabled: open && activeTab === 'commits',
  });

  const commits = commitData?.commits || [];

  // Auto-start stream when drawer opens with "changes" tab
  useEffect(() => {
    if (open && activeTab === 'changes' && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      start(sessionId, { unstaged: true, staged: true, projectId });
    }
  }, [open, activeTab, sessionId, projectId, start]);

  // Reset all state when drawer closes
  useEffect(() => {
    if (!open) {
      cancel();
      setAnnotations([]);
      setActiveTab('changes');
      setSelectedCommits(new Set());
      setReviewStarted(false);
      hasAutoStarted.current = false;
    }
  }, [open, cancel]);

  // Handle tab switching
  const handleTabChange = useCallback((tab: SourceTab) => {
    if (tab === activeTab) return;
    cancel();
    setAnnotations([]);
    setReviewStarted(false);
    setActiveTab(tab);

    if (tab === 'changes') {
      hasAutoStarted.current = true;
      start(sessionId, { unstaged: true, staged: true, projectId });
    } else {
      hasAutoStarted.current = false;
    }
  }, [activeTab, cancel, start, sessionId, projectId]);

  // Toggle commit selection
  const toggleCommit = useCallback((hash: string) => {
    setSelectedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  // Start review for selected commits
  const handleReviewSelected = useCallback(() => {
    if (selectedCommits.size === 0) return;
    setReviewStarted(true);
    start(sessionId, { commitHashes: Array.from(selectedCommits), projectId });
  }, [selectedCommits, sessionId, projectId, start]);

  // Annotation handlers
  const handleAddAnnotation = useCallback(async (slideId: string, text: string) => {
    try {
      const annotation = await api.addPresentationAnnotation(sessionId, slideId, text);
      setAnnotations((prev) => [...prev, annotation]);
    } catch (err) {
      console.error('Failed to add annotation:', err);
    }
  }, [sessionId]);

  const handleDeleteAnnotation = useCallback(async (annotationId: string) => {
    try {
      await api.deletePresentationAnnotation(sessionId, annotationId);
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    } catch (err) {
      console.error('Failed to delete annotation:', err);
    }
  }, [sessionId]);

  const pendingSlideCount = plan ? plan.slides.length - slides.length : 0;
  const showSlides = activeTab === 'changes' || reviewStarted;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-xl bg-background border-t border-border"
          style={{ maxHeight: '95vh' }}
        >
          {/* Drag handle */}
          <div className="mx-auto mt-3 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30" />

          {/* Fixed header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-card">
            <div className="flex items-center gap-3">
              <Presentation className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">Review Changes</h2>
                {plan && showSlides && (
                  <p className="text-xs text-muted-foreground">{plan.summary}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Status indicators */}
              {showSlides && (status === 'connecting' || status === 'planning') && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing changes...
                </span>
              )}
              {showSlides && status === 'narrating' && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Writing narratives ({slides.length}/{plan?.slides.length || '?'})
                </span>
              )}
              {showSlides && status === 'done' && slides.length > 0 && (
                <span className="text-xs text-green-400">
                  {slides.length} slide{slides.length !== 1 ? 's' : ''} ready
                </span>
              )}

              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Source selector tabs */}
          <div className="flex border-b border-border bg-card px-6">
            <TabButton
              active={activeTab === 'changes'}
              onClick={() => handleTabChange('changes')}
            >
              Current Changes
            </TabButton>
            <TabButton
              active={activeTab === 'commits'}
              onClick={() => handleTabChange('commits')}
            >
              Commits
            </TabButton>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
              {/* Error state */}
              {showSlides && status === 'error' && (
                <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error || 'An error occurred'}
                </div>
              )}

              {/* Commits tab - commit list */}
              {activeTab === 'commits' && !reviewStarted && (
                <CommitSelector
                  commits={commits}
                  loading={commitsLoading}
                  selectedCommits={selectedCommits}
                  onToggleCommit={toggleCommit}
                  onReviewSelected={handleReviewSelected}
                />
              )}

              {/* Slides content (changes tab or after review started) */}
              {showSlides && (
                <>
                  {/* Connecting / planning skeleton */}
                  {(status === 'connecting' || status === 'planning') && !plan && (
                    <div className="space-y-6">
                      <SlideSkeleton />
                      <SlideSkeleton fileCount={3} />
                      <SlideSkeleton fileCount={1} />
                    </div>
                  )}

                  {/* Completed slides */}
                  {slides.length > 0 && (
                    <WorkerPoolContextProvider poolOptions={{ workerFactory }} highlighterOptions={{}}>
                      {slides.map((slide) => (
                        <SlideCard
                          key={slide.id}
                          slide={slide}
                          annotations={annotations}
                          onAddAnnotation={handleAddAnnotation}
                          onDeleteAnnotation={handleDeleteAnnotation}
                        />
                      ))}
                    </WorkerPoolContextProvider>
                  )}

                  {/* Pending slide skeletons from plan */}
                  {status === 'narrating' && plan && pendingSlideCount > 0 && (
                    <>
                      {plan.slides.slice(slides.length).map((entry, i) => (
                        <SlideSkeleton
                          key={`skeleton-${i}`}
                          title={entry.title}
                          fileCount={entry.files.length}
                        />
                      ))}
                    </>
                  )}

                  {/* Empty state */}
                  {status === 'done' && slides.length === 0 && !error && (
                    <div className="text-center py-12 text-muted-foreground">
                      <p className="text-sm">No changes to present.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Footer with slide count */}
          {showSlides && slides.length > 0 && (
            <div className="border-t border-border px-6 py-2 bg-card text-center">
              <span className="text-xs text-muted-foreground">
                {slides.length} slide{slides.length !== 1 ? 's' : ''}
                {annotations.length > 0 && ` · ${annotations.length} note${annotations.length !== 1 ? 's' : ''}`}
              </span>
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative px-4 py-2.5 text-xs font-medium transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
      )}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
      )}
    </button>
  );
}

// ─── Commit Selector ──────────────────────────────────────────────────────────

function CommitSelector({
  commits,
  loading,
  selectedCommits,
  onToggleCommit,
  onReviewSelected,
}: {
  commits: GitLogEntry[];
  loading: boolean;
  selectedCommits: Set<string>;
  onToggleCommit: (hash: string) => void;
  onReviewSelected: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <GitCommit className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-xs font-mono">No commits found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card divide-y divide-border/30">
        {commits.map((commit) => {
          const selected = selectedCommits.has(commit.hash);
          return (
            <button
              key={commit.hash}
              onClick={() => onToggleCommit(commit.hash)}
              className={cn(
                'flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors',
                selected ? 'bg-primary/5' : 'hover:bg-accent/30',
              )}
            >
              {/* Checkbox */}
              <div
                className={cn(
                  'flex items-center justify-center h-4 w-4 rounded border shrink-0 transition-colors',
                  selected
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-muted-foreground/40',
                )}
              >
                {selected && <Check className="h-3 w-3" />}
              </div>

              {/* Commit info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-primary/70 shrink-0">
                    {commit.shortHash}
                  </span>
                  <p className="text-xs text-foreground truncate">{commit.message}</p>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                  <span>{commit.author}</span>
                  <span>&middot;</span>
                  <span>{getRelativeDate(commit.date)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Review button */}
      {selectedCommits.size > 0 && (
        <div className="flex justify-center">
          <Button onClick={onReviewSelected} size="sm">
            Review {selectedCommits.size} commit{selectedCommits.size !== 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}
