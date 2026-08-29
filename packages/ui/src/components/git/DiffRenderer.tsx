import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { PatchDiff, FileDiff, WorkerPoolContextProvider } from '@pierre/diffs/react';
import { parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata } from '@pierre/diffs';
import { FileCode, Eye, ChevronDown } from 'lucide-react';
import { DIFF_THEME } from '@/lib/constants';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { cn } from '@/lib/utils';

/**
 * Collapse a file diff behind a "Load diff" button above this many lines. High
 * enough that an ordinary new file still renders — only lockfiles and other
 * generated blobs are worth hiding.
 */
const LARGE_DIFF_LINE_THRESHOLD = 2000;

const workerFactory = () =>
  new Worker(new URL('../../workers/diff-worker.js', import.meta.url), { type: 'module' });

/** Wraps children in the shiki worker pool that @pierre/diffs needs. */
export function DiffWorkerPool({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={{ workerFactory }} highlighterOptions={{}}>
      {children}
    </WorkerPoolContextProvider>
  );
}

/** User-facing render settings, persisted by the caller. */
export interface DiffViewSettings {
  diffStyle: 'split' | 'unified';
  overflow: 'scroll' | 'wrap';
  expandUnchanged: boolean;
}

export const DEFAULT_DIFF_SETTINGS: DiffViewSettings = {
  diffStyle: 'unified',
  overflow: 'scroll',
  expandUnchanged: false,
};

/** Hook that merges user settings with the active terminal theme. */
export function useDiffOptions(settings: DiffViewSettings) {
  const { activeTheme } = useTerminalTheme();
  return useMemo(
    () => ({
      theme: DIFF_THEME,
      themeType: activeTheme.type,
      diffStyle: settings.diffStyle,
      overflow: settings.overflow,
      expandUnchanged: settings.expandUnchanged,
      disableFileHeader: true,
      enableHoverUtility: true,
    }),
    [activeTheme.type, settings.diffStyle, settings.overflow, settings.expandUnchanged]
  );
}

/** Catches @pierre/diffs rendering failures so a broken patch never blanks the panel. */
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
    console.error('Diff rendering error:', error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/** Unstyled fallback used when the highlighter cannot render a patch. */
export function RawDiffView({ diff, fileName }: { diff: string; fileName?: string }) {
  const lines = diff.split('\n');
  return (
    <div className="font-mono text-xs leading-relaxed" style={{ fontFamily: 'var(--code-font)' }}>
      {fileName && (
        <div className="flex items-center gap-2 px-3 py-2 bg-card/30 border-b border-border/30 text-muted-foreground sticky top-0">
          <FileCode className="h-3.5 w-3.5" />
          <span className="truncate">{fileName}</span>
        </div>
      )}
      <div className="overflow-auto">
        {lines.map((line, i) => {
          let bg = '';
          let color = 'text-muted-foreground';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            bg = 'bg-emerald-500/10';
            color = 'text-emerald-400';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            bg = 'bg-rose-500/10';
            color = 'text-rose-400';
          } else if (line.startsWith('@@')) {
            bg = 'bg-sky-500/10';
            color = 'text-sky-400';
          } else if (
            line.startsWith('diff ') ||
            line.startsWith('index ') ||
            line.startsWith('---') ||
            line.startsWith('+++')
          ) {
            color = 'text-muted-foreground/70';
          }
          return (
            <div key={i} className={cn('px-3 whitespace-pre', bg, color)}>
              <span className="inline-block w-10 text-right mr-3 text-muted-foreground/50 select-none">
                {i + 1}
              </span>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The highlighter paints into a custom element, so a broken worker shows a
 * blank pane instead of throwing. Watch the host: if it is still empty a moment
 * after mount, swap in the plain fallback so the diff is always readable.
 */
function DiffRenderGuard({
  watchKey,
  fallback,
  children,
}: {
  watchKey: string;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [blank, setBlank] = useState(false);

  useEffect(() => {
    setBlank(false);
    const timer = setTimeout(() => {
      const host = ref.current?.firstElementChild;
      const painted =
        (host?.shadowRoot?.textContent ?? '').trim() || (host?.textContent ?? '').trim();
      if (!painted) {
        console.warn('Diff highlighter produced no output; falling back to the plain view.');
        setBlank(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [watchKey]);

  if (blank) return <>{fallback}</>;
  return <div ref={ref}>{children}</div>;
}

/** Renderer callbacks that turn a hovered line into a comment thread. */
export interface DiffAnnotationProps {
  lineAnnotations?: DiffLineAnnotation<string>[];
  renderAnnotation?: (annotation: DiffLineAnnotation<string>) => ReactNode;
  renderHoverUtility?: (
    getHoveredLine: () => { lineNumber: number; side: 'additions' | 'deletions' } | undefined
  ) => ReactNode;
}

/** Renders one file's patch with syntax highlighting and inline annotations. */
export function SinglePatchDiff({
  patch,
  fileName,
  options,
  ...annotations
}: { patch: string; fileName?: string; options: unknown } & DiffAnnotationProps) {
  const fallback = <RawDiffView diff={patch} fileName={fileName} />;
  return (
    <DiffErrorBoundary fallback={fallback}>
      <DiffRenderGuard watchKey={patch} fallback={fallback}>
        <PatchDiff patch={patch} options={options as never} {...annotations} />
      </DiffRenderGuard>
    </DiffErrorBoundary>
  );
}

function countDiffLines(fileDiff: FileDiffMetadata): number {
  let count = 0;
  for (const hunk of fileDiff.hunks) count += hunk.hunkContent.length;
  return count;
}

interface MultiFileDiffProps {
  diff: string;
  options: unknown;
  getLineAnnotationsForFile: (filePath: string) => DiffLineAnnotation<string>[];
  renderAnnotation: (annotation: DiffLineAnnotation<string>) => ReactNode;
  createRenderHoverUtility: (
    filePath: string
  ) => (
    getHoveredLine: () => { lineNumber: number; side: 'additions' | 'deletions' } | undefined
  ) => ReactNode;
  onSelectFile?: (filePath: string) => void;
}

/** Renders a whole multi-file patch as one scroll of per-file cards. */
export function MultiFileDiff({
  diff,
  options,
  getLineAnnotationsForFile,
  renderAnnotation,
  createRenderHoverUtility,
  onSelectFile,
}: MultiFileDiffProps) {
  const { parsedFiles, parseError } = useMemo(() => {
    try {
      const files: FileDiffMetadata[] = [];
      for (const patch of parsePatchFiles(diff)) files.push(...patch.files);
      return { parsedFiles: files, parseError: false };
    } catch (error) {
      console.error('Failed to parse diff:', error);
      return { parsedFiles: [] as FileDiffMetadata[], parseError: true };
    }
  }, [diff]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((fileName: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }, []);

  if (parseError || parsedFiles.length === 0) {
    if (diff.trim()) return <RawDiffView diff={diff} />;
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No diff to display
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {parsedFiles.map((fileDiff, index) => {
        const fileKey = fileDiff.name || String(index);
        const lineCount = countDiffLines(fileDiff);
        const isLarge = lineCount > LARGE_DIFF_LINE_THRESHOLD;
        const isExpanded = expandedFiles.has(fileKey);

        return (
          <div
            key={fileKey}
            className="rounded-lg overflow-hidden border border-border/60 bg-card/10 shadow-sm"
          >
            <div className="bg-card/40 px-3 py-2 border-b border-border/50 font-mono text-xs flex items-center gap-2 backdrop-blur-sm">
              <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <button
                onClick={() => onSelectFile?.(fileDiff.name)}
                className="truncate flex-1 text-left text-foreground/90 hover:text-foreground hover:underline"
                title={fileDiff.name}
              >
                {fileDiff.name}
              </button>
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                {lineCount} lines
              </span>
            </div>
            {isLarge && !isExpanded ? (
              <CollapsedDiffPlaceholder
                lineCount={lineCount}
                fileName={fileDiff.name}
                onExpand={() => toggleExpand(fileKey)}
              />
            ) : (
              <DiffErrorBoundary fallback={<RawDiffView diff={diff} fileName={fileDiff.name} />}>
                {isLarge && (
                  <button
                    onClick={() => toggleExpand(fileKey)}
                    className="w-full px-3 py-1 bg-card/20 border-b border-border/30 text-xs text-muted-foreground hover:text-foreground hover:bg-card/40 transition-colors flex items-center justify-center gap-1"
                  >
                    <ChevronDown className="h-3 w-3 rotate-180" />
                    Collapse diff
                  </button>
                )}
                <DiffRenderGuard
                  watchKey={`${fileKey}:${lineCount}`}
                  fallback={<RawDiffView diff={diff} fileName={fileDiff.name} />}
                >
                  <FileDiff
                    fileDiff={fileDiff}
                    options={options as never}
                    lineAnnotations={getLineAnnotationsForFile(fileDiff.name)}
                    renderAnnotation={renderAnnotation}
                    renderHoverUtility={createRenderHoverUtility(fileDiff.name)}
                  />
                </DiffRenderGuard>
              </DiffErrorBoundary>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CollapsedDiffPlaceholder({
  lineCount,
  fileName,
  onExpand,
}: {
  lineCount: number;
  fileName: string;
  onExpand: () => void;
}) {
  const isGenerated =
    /\.(lock|min\.\w+|map|snap)$/.test(fileName) ||
    fileName.includes('package-lock') ||
    fileName.includes('yarn.lock');

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 bg-card/10">
      <p className="text-xs text-muted-foreground mb-1">
        Large diff not shown — <span className="text-foreground/70 font-medium">{lineCount} lines</span> changed
        {isGenerated && <span className="text-amber-500/70 ml-1">(generated file)</span>}
      </p>
      <button
        onClick={onExpand}
        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent/50 hover:bg-accent text-foreground/80 hover:text-foreground transition-colors"
      >
        <Eye className="h-3.5 w-3.5" />
        Load diff
      </button>
    </div>
  );
}
