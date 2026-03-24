import { useEffect, useCallback, useState } from 'react';
import { X, Loader2, AlertCircle, Presentation } from 'lucide-react';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import type { PresentationRequest, SlideAnnotation as SlideAnnotationType } from '@/lib/api';
import { usePresentationStream } from '@/hooks/usePresentationStream';
import { SlideCard } from './SlideCard';
import { SlideSkeleton } from './SlideSkeleton';

const workerFactory = () =>
  new Worker(new URL('../../workers/diff-worker.js', import.meta.url), { type: 'module' });

interface PresentationModalProps {
  sessionId: string;
  request: PresentationRequest;
  onClose: () => void;
}

export function PresentationModal({ sessionId, request, onClose }: PresentationModalProps) {
  const { plan, slides, status, error, start, cancel } = usePresentationStream();
  const [annotations, setAnnotations] = useState<SlideAnnotationType[]>([]);

  // Start streaming on mount
  useEffect(() => {
    start(sessionId, request);
    return () => cancel();
  }, [sessionId, request, start, cancel]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-card">
        <div className="flex items-center gap-3">
          <Presentation className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Change Review</h2>
            {plan && (
              <p className="text-xs text-muted-foreground">{plan.summary}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          {(status === 'connecting' || status === 'planning') && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyzing changes...
            </span>
          )}
          {status === 'narrating' && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Writing narratives ({slides.length}/{plan?.slides.length || '?'})
            </span>
          )}
          {status === 'done' && (
            <span className="text-xs text-green-400">
              {slides.length} slide{slides.length !== 1 ? 's' : ''} ready
            </span>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
          {/* Error state */}
          {status === 'error' && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error || 'An error occurred'}
            </div>
          )}

          {/* Connecting / planning skeleton */}
          {(status === 'connecting' || status === 'planning') && !plan && (
            <div className="space-y-6">
              <SlideSkeleton />
              <SlideSkeleton fileCount={3} />
              <SlideSkeleton fileCount={1} />
            </div>
          )}

          {/* Completed slides */}
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
        </div>
      </div>

      {/* Footer with slide count */}
      {slides.length > 0 && (
        <div className="border-t border-border px-6 py-2 bg-card text-center">
          <span className="text-xs text-muted-foreground">
            {slides.length} slide{slides.length !== 1 ? 's' : ''}
            {annotations.length > 0 && ` \u00B7 ${annotations.length} note${annotations.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      )}
    </div>
  );
}
