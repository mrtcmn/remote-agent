# Git Review Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Review Changes" button to the bottom status bar that opens a Vaul drawer (from bottom, 95vh max) with commit selection and inline AI review content — replacing the full-screen PresentationModal.

**Architecture:** Install `vaul` package. Create a `ReviewDrawer` component that wraps Vaul's `Drawer` with a fixed header containing source selection (current changes / commit picker), and a scrollable body rendering the existing presentation stream content. Wire a new toolbar button in `Session.tsx` to open it.

**Tech Stack:** vaul, React, TanStack Query, existing `usePresentationStream` hook, existing `SlideCard`/`SlideSkeleton` components.

---

### Task 1: Install vaul dependency

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Install vaul**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && bun add vaul --cwd packages/ui
```

- [ ] **Step 2: Verify installation**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && cat packages/ui/package.json | grep vaul
```

Expected: `"vaul": "^x.x.x"` in dependencies.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/package.json bun.lock*
git commit -m "feat: add vaul drawer dependency"
```

---

### Task 2: Create ReviewDrawer component

**Files:**
- Create: `packages/ui/src/components/review/ReviewDrawer.tsx`

This is the main new component. It contains:
- Vaul `Drawer.Root` + `Drawer.Portal` + `Drawer.Overlay` + `Drawer.Content` at 95vh
- A fixed header with: title, source selector (tabs: "Current Changes" / "Commits"), close button
- When "Current Changes" is selected: auto-starts the presentation stream with `{ unstaged: true, staged: true }`
- When "Commits" is selected: shows a list of recent commits with checkboxes, and a "Review Selected" button
- Scrollable body rendering `SlideCard` / `SlideSkeleton` (reused from existing presentation code)
- Status indicators (same as PresentationModal: connecting, planning, narrating, done, error)

- [ ] **Step 1: Create the ReviewDrawer component**

Create `packages/ui/src/components/review/ReviewDrawer.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react';
import { Drawer } from 'vaul';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  Loader2,
  AlertCircle,
  Presentation,
  GitCommit,
  Check,
  Play,
} from 'lucide-react';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import { Button } from '@/components/ui/Button';
import { api, type PresentationRequest, type SlideAnnotation as SlideAnnotationType, type GitLogEntry } from '@/lib/api';
import { usePresentationStream } from '@/hooks/usePresentationStream';
import { SlideCard } from '@/components/presentation/SlideCard';
import { SlideSkeleton } from '@/components/presentation/SlideSkeleton';
import { cn } from '@/lib/utils';

const workerFactory = () =>
  new Worker(new URL('../../workers/diff-worker.js', import.meta.url), { type: 'module' });

type ReviewSource = 'current' | 'commits';

interface ReviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  projectId?: string;
}

export function ReviewDrawer({ open, onOpenChange, sessionId, projectId }: ReviewDrawerProps) {
  const [source, setSource] = useState<ReviewSource>('current');
  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
  const [reviewStarted, setReviewStarted] = useState(false);
  const [annotations, setAnnotations] = useState<SlideAnnotationType[]>([]);

  const { plan, slides, status, error, start, cancel } = usePresentationStream();

  // Fetch recent commits when on commits tab
  const { data: logData } = useQuery({
    queryKey: ['session-git-log', sessionId, projectId],
    queryFn: () => api.getSessionGitLog(sessionId, 20, projectId),
    enabled: open && source === 'commits',
  });
  const commits = logData?.commits || [];

  // Auto-start review for "current changes" when drawer opens
  useEffect(() => {
    if (open && source === 'current') {
      const request: PresentationRequest = { unstaged: true, staged: true, projectId };
      start(sessionId, request);
      setReviewStarted(true);
    }
    return () => {
      if (!open) {
        cancel();
        setReviewStarted(false);
        setSelectedCommits(new Set());
        setAnnotations([]);
      }
    };
  }, [open, source, sessionId, projectId]);

  const handleReviewCommits = useCallback(() => {
    if (selectedCommits.size === 0) return;
    const request: PresentationRequest = {
      commitHashes: Array.from(selectedCommits),
      projectId,
    };
    start(sessionId, request);
    setReviewStarted(true);
  }, [selectedCommits, sessionId, projectId, start]);

  const toggleCommit = (hash: string) => {
    setSelectedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const handleSourceChange = (newSource: ReviewSource) => {
    if (newSource === source) return;
    cancel();
    setReviewStarted(false);
    setSelectedCommits(new Set());
    setAnnotations([]);
    setSource(newSource);
  };

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
  const isStreaming = status === 'connecting' || status === 'planning' || status === 'narrating';

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-xl bg-background border-t border-border outline-none"
          style={{ maxHeight: '95vh' }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
          </div>

          {/* Fixed header */}
          <div className="flex items-center justify-between px-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <Presentation className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Review Changes</h2>
            </div>

            <div className="flex items-center gap-2">
              {/* Status */}
              {isStreaming && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {status === 'connecting' || status === 'planning'
                    ? 'Analyzing...'
                    : `Writing (${slides.length}/${plan?.slides.length || '?'})`}
                </span>
              )}
              {status === 'done' && slides.length > 0 && (
                <span className="text-xs text-green-400">
                  {slides.length} slide{slides.length !== 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={() => onOpenChange(false)}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Source tabs */}
          <div className="flex items-center border-b border-border shrink-0">
            <button
              onClick={() => handleSourceChange('current')}
              className={cn(
                'px-4 py-2 text-xs font-medium transition-colors relative',
                source === 'current' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Current Changes
              {source === 'current' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
            <button
              onClick={() => handleSourceChange('commits')}
              className={cn(
                'px-4 py-2 text-xs font-medium transition-colors relative',
                source === 'commits' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Commits
              {source === 'commits' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* Commit selection list (only when source === 'commits' and not yet reviewing) */}
            {source === 'commits' && !reviewStarted && (
              <div className="flex flex-col h-full">
                <div className="flex-1 overflow-y-auto divide-y divide-border/30">
                  {commits.map((commit) => (
                    <CommitSelectRow
                      key={commit.hash}
                      commit={commit}
                      selected={selectedCommits.has(commit.hash)}
                      onToggle={() => toggleCommit(commit.hash)}
                    />
                  ))}
                  {commits.length === 0 && (
                    <div className="flex items-center justify-center py-12 text-muted-foreground text-xs">
                      No commits found
                    </div>
                  )}
                </div>
                {selectedCommits.size > 0 && (
                  <div className="border-t border-border px-5 py-3 shrink-0">
                    <Button size="sm" className="w-full gap-2" onClick={handleReviewCommits}>
                      <Play className="h-3.5 w-3.5" />
                      Review {selectedCommits.size} commit{selectedCommits.size !== 1 ? 's' : ''}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Review content (slides) */}
            {(source === 'current' || reviewStarted) && (
              <div className="px-5 py-6 space-y-6 max-w-4xl mx-auto">
                {/* Error */}
                {status === 'error' && (
                  <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error || 'An error occurred'}
                  </div>
                )}

                {/* Loading skeleton */}
                {(status === 'connecting' || status === 'planning') && !plan && (
                  <div className="space-y-6">
                    <SlideSkeleton />
                    <SlideSkeleton fileCount={3} />
                  </div>
                )}

                {/* Slides */}
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

                {/* Pending skeletons */}
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

                {/* Empty */}
                {status === 'done' && slides.length === 0 && !error && (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No changes to review.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function CommitSelectRow({
  commit,
  selected,
  onToggle,
}: {
  commit: GitLogEntry;
  selected: boolean;
  onToggle: () => void;
}) {
  const relativeDate = getRelativeDate(commit.date);

  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center gap-3 w-full px-5 py-3 text-left hover:bg-accent/30 transition-colors',
        selected && 'bg-accent/20'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center size-5 rounded border shrink-0 transition-colors',
          selected
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-border'
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </div>
      <GitCommit className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-primary/70">{commit.shortHash}</span>
          <span className="text-xs text-foreground truncate">{commit.message}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{commit.author}</span>
          <span>·</span>
          <span>{relativeDate}</span>
        </div>
      </div>
    </button>
  );
}

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
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/review/ReviewDrawer.tsx
git commit -m "feat: create ReviewDrawer component with vaul"
```

---

### Task 3: Add "Review Changes" button to bottom toolbar and wire drawer

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

Add state for the drawer, a `ToolbarItem` with `Presentation` icon in the bottom `ToolbarRoot`, and render the `ReviewDrawer` component.

- [ ] **Step 1: Add imports and state to Session.tsx**

Add to the imports at top of `Session.tsx`:

```tsx
import { Presentation } from 'lucide-react';
import { ReviewDrawer } from '@/components/review/ReviewDrawer';
```

Add state inside `SessionPage()`:

```tsx
const [showReviewDrawer, setShowReviewDrawer] = useState(false);
```

- [ ] **Step 2: Add "Review" button to the bottom ToolbarRoot**

In the `<ToolbarRoot>` section (around line 847), after the `changeCount` block and its `<ToolbarDivider />`, add:

```tsx
<ToolbarItem
  icon={Presentation}
  label="REVIEW"
  onClick={() => setShowReviewDrawer(true)}
/>
<ToolbarDivider />
```

- [ ] **Step 3: Render ReviewDrawer at end of component**

Just before the closing `</div>` of the return (before the Preview URL Dialog), add:

```tsx
<ReviewDrawer
  open={showReviewDrawer}
  onOpenChange={setShowReviewDrawer}
  sessionId={id!}
  projectId={gitProjectId}
/>
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat: add Review Changes button to status bar with drawer"
```

---

### Task 4: Build verification and cleanup

**Files:**
- No new files

- [ ] **Step 1: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run build**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && bun run build
```

Expected: Build succeeds.

- [ ] **Step 3: Run lint (if available)**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && bun run lint 2>/dev/null || echo "No lint script"
```
