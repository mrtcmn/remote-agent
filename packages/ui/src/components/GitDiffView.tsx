import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PatchDiff, FileDiff } from '@pierre/diffs/react';
import type { DiffLineAnnotation } from '@pierre/diffs';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import {
  GitBranch,
  FileCode,
  Loader2,
  RefreshCw,
  ChevronRight,
  Circle,
  Plus,
  Pencil,
  MessageSquarePlus,
  History,
  Send,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useReviewComments } from '@/hooks/useReviewComments';
import { ReviewCommentInput } from './ReviewCommentInput';
import { ReviewCommentAnnotation } from './ReviewCommentAnnotation';
import { ReviewBatchPanel } from './ReviewBatchPanel';

interface GitDiffViewProps {
  sessionId: string;
  className?: string;
  onProceed?: (message: string) => void;
}

export function GitDiffView({ sessionId, className, onProceed }: GitDiffViewProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Show file list by default on desktop, hide on mobile
  const [showFileList, setShowFileList] = useState(window.innerWidth >= 768);

  const {
    comments,
    pendingComments,
    batches,
    createComment,
    deleteComment,
    proceed,
    rerunBatch,
    isProceedPending,
  } = useReviewComments(sessionId);

  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [commentPopover, setCommentPopover] = useState<{
    lineNumber: number;
    side: 'additions' | 'deletions';
    lineContent: string;
    filePath: string;
    position: { x: number; y: number };
  } | null>(null);

  // Fetch git status
  const {
    data: gitStatus,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['session-git-status', sessionId],
    queryFn: () => api.getSessionGitStatus(sessionId),
    refetchInterval: 3000,
  });

  // Fetch diff for selected file
  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['session-file-diff', sessionId, selectedFile],
    queryFn: () => api.getSessionFileDiff(sessionId, selectedFile!),
    enabled: !!selectedFile,
  });

  // Fetch full diff when no file selected
  const { data: fullDiff } = useQuery({
    queryKey: ['session-git-diff', sessionId],
    queryFn: () => api.getSessionGitDiff(sessionId),
    enabled: !selectedFile && !!(gitStatus?.modified?.length || gitStatus?.staged?.length),
  });

  const hasChanges =
    gitStatus &&
    (gitStatus.modified.length > 0 || gitStatus.staged.length > 0 || gitStatus.untracked.length > 0);

  const allFiles = useMemo(() => {
    if (!gitStatus) return [];
    return [
      ...gitStatus.staged.map((f) => ({ file: f, status: 'staged' as const })),
      ...gitStatus.modified.map((f) => ({ file: f, status: 'modified' as const })),
      ...gitStatus.untracked.map((f) => ({ file: f, status: 'untracked' as const })),
    ];
  }, [gitStatus]);

  const getLineAnnotationsForFile = useCallback((filePath: string): DiffLineAnnotation<string>[] => {
    return comments
      .filter(c => c.filePath === filePath)
      .map(c => ({
        lineNumber: c.lineNumber,
        side: c.lineSide,
        metadata: c.id,
      }));
  }, [comments]);

  const lineAnnotations: DiffLineAnnotation<string>[] = useMemo(() => {
    if (!selectedFile) return [];
    return getLineAnnotationsForFile(selectedFile);
  }, [selectedFile, getLineAnnotationsForFile]);

  const renderAnnotation = useCallback((annotation: DiffLineAnnotation<string>) => {
    const comment = comments.find(c => c.id === annotation.metadata);
    if (!comment) return null;
    return (
      <ReviewCommentAnnotation
        comment={comment}
        onDelete={deleteComment}
      />
    );
  }, [comments, deleteComment]);

  const createRenderHoverUtility = useCallback((filePath: string) => {
    return (getHoveredLine: () => { lineNumber: number; side: 'additions' | 'deletions' } | undefined) => {
      const hovered = getHoveredLine();
      if (!hovered) return null;

      return (
        <button
          type="button"
          onClick={(e) => {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            setCommentPopover({
              lineNumber: hovered.lineNumber,
              side: hovered.side,
              lineContent: '',
              filePath: filePath,
              position: { x: rect.right + 10, y: rect.top },
            });
          }}
          className="p-1 rounded hover:bg-accent"
          title="Add comment"
        >
          <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
        </button>
      );
    };
  }, []);

  const renderHoverUtility = useMemo(() => {
    return createRenderHoverUtility(selectedFile || '');
  }, [selectedFile, createRenderHoverUtility]);

  const handleAddComment = useCallback((comment: string) => {
    if (!commentPopover) return;
    createComment({
      filePath: commentPopover.filePath,
      lineNumber: commentPopover.lineNumber,
      lineSide: commentPopover.side,
      lineContent: commentPopover.lineContent,
      comment,
    });
    setCommentPopover(null);
  }, [commentPopover, createComment]);

  const handleProceed = useCallback(async () => {
    const result = await proceed();
    if (onProceed) {
      onProceed(result.message);
    }
  }, [proceed, onProceed]);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Compact Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-card/30 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          {gitStatus?.branch && (
            <span className="font-mono text-xs text-muted-foreground">
              {gitStatus.branch}
            </span>
          )}
          {hasChanges && (
            <span className="font-mono text-xs text-muted-foreground">
              · {allFiles.length} file{allFiles.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetchStatus()}
            className="h-7 w-7 p-0"
            title="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', statusLoading && 'animate-spin')} />
          </Button>
          {pendingComments.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={handleProceed}
              disabled={isProceedPending}
              className="h-7 text-xs"
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              Proceed ({pendingComments.length})
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowBatchPanel(true)}
            className="h-7 w-7 p-0"
            title="Review history"
          >
            <History className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFileList(!showFileList)}
            className="h-7 w-7 p-0"
            title={showFileList ? 'Hide files' : 'Show files'}
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform', showFileList && 'rotate-90')}
            />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* File List - Collapsible */}
        {showFileList && (
          <div className="w-64 border-r bg-card/20 flex flex-col shrink-0">
            <div className="flex-1 overflow-y-auto">
              {statusLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !hasChanges ? (
                <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                  <Circle className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm font-mono">No changes</p>
                </div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {/* View all button */}
                  <button
                    onClick={() => setSelectedFile(null)}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-2 rounded text-left',
                      'font-mono text-xs transition-colors',
                      'hover:bg-accent',
                      selectedFile === null && 'bg-accent'
                    )}
                  >
                    <FileCode className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium">All changes</span>
                    <span className="ml-auto text-muted-foreground">{allFiles.length}</span>
                  </button>

                  <div className="h-px bg-border my-2" />

                  {/* File list */}
                  {allFiles.map(({ file, status }) => (
                    <FileItem
                      key={`${status}-${file}`}
                      file={file}
                      status={status}
                      isSelected={selectedFile === file}
                      onClick={() => setSelectedFile(selectedFile === file ? null : file)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Summary */}
            {hasChanges && (
              <div className="border-t px-3 py-2 flex items-center gap-3 text-xs font-mono">
                {gitStatus?.staged.length > 0 && (
                  <span className="flex items-center gap-1 text-green-500">
                    <Plus className="h-3 w-3" />
                    {gitStatus.staged.length}
                  </span>
                )}
                {gitStatus?.modified.length > 0 && (
                  <span className="flex items-center gap-1 text-yellow-500">
                    <Pencil className="h-3 w-3" />
                    {gitStatus.modified.length}
                  </span>
                )}
                {gitStatus?.untracked.length > 0 && (
                  <span className="flex items-center gap-1 text-blue-500">
                    <Circle className="h-3 w-3" />
                    {gitStatus.untracked.length}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Diff View */}
        <div className="flex-1 overflow-auto bg-[#0d1117]">
          {diffLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedFile && diffData?.diff ? (
            <div className="p-2">
              <div className="mb-2 px-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <FileCode className="h-3.5 w-3.5" />
                <span className="truncate">{selectedFile}</span>
              </div>
              <PatchDiff
                patch={diffData.diff}
                options={{
                  theme: { dark: 'github-dark', light: 'github-light' },
                  diffStyle: 'unified',
                  enableLineSelection: true,
                  enableHoverUtility: true,
                }}
                lineAnnotations={lineAnnotations}
                renderAnnotation={renderAnnotation}
                renderHoverUtility={renderHoverUtility}
              />
            </div>
          ) : fullDiff?.diff ? (
            <div className="p-2">
              <MultiFileDiffView
                diff={fullDiff.diff}
                getLineAnnotationsForFile={getLineAnnotationsForFile}
                renderAnnotation={renderAnnotation}
                createRenderHoverUtility={createRenderHoverUtility}
              />
            </div>
          ) : hasChanges ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileCode className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs font-mono">Select a file to view changes</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <GitBranch className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs font-mono">Working tree clean</p>
            </div>
          )}
        </div>
      </div>

      {commentPopover && (
        <div
          className="fixed z-50"
          style={{ left: commentPopover.position.x, top: commentPopover.position.y }}
        >
          <ReviewCommentInput
            onSubmit={handleAddComment}
            onCancel={() => setCommentPopover(null)}
            existingComments={comments
              .filter(c =>
                c.filePath === commentPopover.filePath &&
                c.lineNumber === commentPopover.lineNumber &&
                c.status === 'pending'
              )
              .map(c => ({ id: c.id, comment: c.comment }))}
          />
        </div>
      )}

      {showBatchPanel && (
        <ReviewBatchPanel
          batches={batches}
          comments={comments}
          onRerun={rerunBatch}
          onClose={() => setShowBatchPanel(false)}
        />
      )}
    </div>
  );
}

function FileItem({
  file,
  status,
  isSelected,
  onClick,
}: {
  file: string;
  status: 'staged' | 'modified' | 'untracked';
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusConfig = {
    staged: {
      color: 'text-green-500',
      bg: 'bg-green-500/10',
      icon: Plus,
      label: 'S',
    },
    modified: {
      color: 'text-yellow-500',
      bg: 'bg-yellow-500/10',
      icon: Pencil,
      label: 'M',
    },
    untracked: {
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
      icon: Circle,
      label: 'U',
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  // Get just the filename for display
  const fileName = file.split('/').pop() || file;
  const dirPath = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '';

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1.5 rounded text-left',
        'font-mono text-xs transition-colors',
        'hover:bg-accent group',
        isSelected && 'bg-accent'
      )}
    >
      <Icon className={cn('h-3 w-3 shrink-0', config.color)} />
      <div className="flex-1 min-w-0">
        <span className="block truncate">{fileName}</span>
        {dirPath && (
          <span className="block truncate text-[10px] text-muted-foreground">{dirPath}</span>
        )}
      </div>
      <span
        className={cn(
          'text-[10px] font-bold px-1.5 py-0.5 rounded',
          config.color,
          config.bg,
          'opacity-0 group-hover:opacity-100 transition-opacity',
          isSelected && 'opacity-100'
        )}
      >
        {config.label}
      </span>
    </button>
  );
}

interface MultiFileDiffViewProps {
  diff: string;
  getLineAnnotationsForFile: (filePath: string) => DiffLineAnnotation<string>[];
  renderAnnotation: (annotation: DiffLineAnnotation<string>) => React.ReactNode;
  createRenderHoverUtility: (filePath: string) => (getHoveredLine: () => { lineNumber: number; side: 'additions' | 'deletions' } | undefined) => React.ReactNode;
}

function MultiFileDiffView({ diff, getLineAnnotationsForFile, renderAnnotation, createRenderHoverUtility }: MultiFileDiffViewProps) {
  const parsedFiles = useMemo(() => {
    try {
      const patches = parsePatchFiles(diff);
      const files: FileDiffMetadata[] = [];
      for (const patch of patches) {
        files.push(...patch.files);
      }
      return files;
    } catch (error) {
      console.error('Failed to parse diff:', error);
      return [];
    }
  }, [diff]);

  if (parsedFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No diff to display
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {parsedFiles.map((fileDiff, index) => (
        <div key={fileDiff.name || index} className="rounded overflow-hidden border border-border/30">
          <div className="bg-card/30 px-3 py-1.5 border-b border-border/30 font-mono text-xs text-muted-foreground flex items-center gap-2">
            <FileCode className="h-3 w-3" />
            <span className="truncate">{fileDiff.name}</span>
          </div>
          <FileDiff
            fileDiff={fileDiff}
            options={{
              theme: { dark: 'github-dark', light: 'github-light' },
              diffStyle: 'unified',
              enableLineSelection: true,
              enableHoverUtility: true,
            }}
            lineAnnotations={getLineAnnotationsForFile(fileDiff.name)}
            renderAnnotation={renderAnnotation}
            renderHoverUtility={createRenderHoverUtility(fileDiff.name)}
          />
        </div>
      ))}
    </div>
  );
}
