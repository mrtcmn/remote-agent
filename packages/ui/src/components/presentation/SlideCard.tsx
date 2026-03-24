import { useState, Component, type ReactNode, type ErrorInfo } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import { ChevronDown, ChevronRight, FileCode, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DIFF_THEME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { SlideAnnotation } from './SlideAnnotation';
import type { PresentationSlide, SlideAnnotation as SlideAnnotationType } from '@/lib/api';

class DiffErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SlideCard DiffErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function RawDiffFallback({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto rounded border border-border bg-muted/50 p-3 text-xs font-mono">
      {patch.split('\n').map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith('+') && !line.startsWith('+++') && 'text-green-400 bg-green-950/30',
            line.startsWith('-') && !line.startsWith('---') && 'text-red-400 bg-red-950/30',
            line.startsWith('@@') && 'text-blue-400',
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

const importanceBadge = {
  high: 'bg-red-500/15 text-red-400 border-red-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

interface SlideCardProps {
  slide: PresentationSlide;
  annotations: SlideAnnotationType[];
  onAddAnnotation: (slideId: string, text: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  className?: string;
}

export function SlideCard({
  slide,
  annotations,
  onAddAnnotation,
  onDeleteAnnotation,
  className,
}: SlideCardProps) {
  const [showFullDiff, setShowFullDiff] = useState(false);
  const [expandedExcerpts, setExpandedExcerpts] = useState<Set<number>>(new Set());

  const toggleExcerpt = (index: number) => {
    setExpandedExcerpts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const diffOptions = {
    diffStyle: 'unified' as const,
    themeType: 'dark' as const,
    themes: DIFF_THEME,
    overflow: 'scroll' as const,
    lineDiffType: 'word-alt' as const,
  };

  const slideAnnotations = annotations.filter(a => a.slideId === slide.id);

  return (
    <div className={cn('rounded-lg border border-border bg-card overflow-hidden', className)}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">
                {slide.index + 1}
              </span>
              <h3 className="text-lg font-semibold text-foreground">{slide.title}</h3>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                  importanceBadge[slide.importance],
                )}
              >
                {slide.importance}
              </span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {slide.files.map((file) => (
                <span
                  key={file}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  <FileCode className="h-3 w-3" />
                  {file.split('/').pop()}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Narrative */}
      <div className="px-6 py-4 text-sm text-foreground/90 leading-relaxed">
        {slide.narrative}
      </div>

      {/* Diff excerpts */}
      <div className="border-t border-border">
        {slide.excerpts.map((excerpt, i) => (
          <div key={i} className="border-b border-border last:border-b-0">
            <button
              onClick={() => toggleExcerpt(i)}
              className="flex items-center gap-2 w-full px-4 py-2 text-xs font-mono text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              {expandedExcerpts.has(i) ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{excerpt.filePath}</span>
            </button>
            {(expandedExcerpts.has(i) || slide.excerpts.length <= 3) && (
              <div className="px-2 pb-2">
                <DiffErrorBoundary fallback={<RawDiffFallback patch={excerpt.patch} />}>
                  <PatchDiff patch={excerpt.patch} options={diffOptions} />
                </DiffErrorBoundary>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Show full diff toggle */}
      {slide.fullDiff && (
        <div className="border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFullDiff(!showFullDiff)}
            className="w-full rounded-none text-xs text-muted-foreground"
          >
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
            {showFullDiff ? 'Hide full diff' : 'Show full diff'}
          </Button>
          {showFullDiff && (
            <div className="px-2 pb-2">
              <DiffErrorBoundary fallback={<RawDiffFallback patch={slide.fullDiff} />}>
                <PatchDiff patch={slide.fullDiff} options={diffOptions} />
              </DiffErrorBoundary>
            </div>
          )}
        </div>
      )}

      {/* Annotations */}
      <div className="border-t border-border px-6 py-3">
        <SlideAnnotation
          annotations={slideAnnotations}
          onAdd={(text) => onAddAnnotation(slide.id, text)}
          onDelete={onDeleteAnnotation}
        />
      </div>
    </div>
  );
}
