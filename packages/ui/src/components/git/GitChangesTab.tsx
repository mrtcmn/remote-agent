import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCode,
  Loader2,
  Plus,
  Minus,
  Circle,
  ChevronDown,
  ChevronRight,
  Send,
  History,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useReviewComments } from '@/hooks/useReviewComments';
import { ReviewCommentInput } from '../ReviewCommentInput';
import { ReviewBatchPanel } from '../ReviewBatchPanel';
import { toast } from '@/components/ui/Toaster';

/** Raw diff view */
function RawDiffView({ diff, fileName }: { diff: string; fileName?: string }) {
  const lines = diff.split('\n');
  return (
    <div className="font-mono text-xs leading-relaxed">
      {fileName && (
        <div className="flex items-center gap-2 px-3 py-2 bg-card/30 border-b border-border/30 text-muted-foreground sticky top-0">
          <FileCode className="h-3.5 w-3.5" />
          <span className="truncate">{fileName}</span>
        </div>
      )}
      <div>
        {lines.map((line, i) => {
          let bg = '';
          let color = 'text-muted-foreground';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            bg = 'bg-green-500/10';
            color = 'text-green-400';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            bg = 'bg-red-500/10';
            color = 'text-red-400';
          } else if (line.startsWith('@@')) {
            bg = 'bg-blue-500/10';
            color = 'text-blue-400';
          } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
            color = 'text-muted-foreground/70';
          }
          return (
            <div key={i} className={cn('px-3 py-0 whitespace-pre', bg, color)}>
              <span className="inline-block w-10 text-right mr-3 text-muted-foreground/50 select-none">{i + 1}</span>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}


interface GitChangesTabProps {
  sessionId: string;
  onProceed?: (message: string) => void;
}

export function GitChangesTab({ sessionId, onProceed }: GitChangesTabProps) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [showStaged, setShowStaged] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [showBatchPanel, setShowBatchPanel] = useState(false);

  const {
    comments,
    pendingComments,
    batches,
    createComment,
    proceed,
    rerunBatch,
    isProceedPending,
  } = useReviewComments(sessionId);

  const [commentPopover, setCommentPopover] = useState<{
    lineNumber: number;
    side: 'additions' | 'deletions';
    lineContent: string;
    filePath: string;
    position: { x: number; y: number };
  } | null>(null);

  const {
    data: gitStatus,
    isLoading: statusLoading,
  } = useQuery({
    queryKey: ['session-git-status', sessionId],
    queryFn: () => api.getSessionGitStatus(sessionId),
    refetchInterval: 3000,
  });

  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['session-file-diff', sessionId, selectedFile],
    queryFn: () => api.getSessionFileDiff(sessionId, selectedFile!),
    enabled: !!selectedFile,
  });

  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId] });
  };

  const stageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitStage(sessionId, files),
    onSuccess: invalidateGit,
    onError: (e) => toast({ title: 'Stage failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const unstageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitUnstage(sessionId, files),
    onSuccess: invalidateGit,
    onError: (e) => toast({ title: 'Unstage failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const commitMutation = useMutation({
    mutationFn: (message: string) => api.gitCommit(sessionId, message),
    onSuccess: () => {
      setCommitMessage('');
      invalidateGit();
      toast({ title: 'Committed successfully' });
    },
    onError: (e) => toast({ title: 'Commit failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const stagedFiles = gitStatus?.staged || [];
  const modifiedFiles = gitStatus?.modified || [];
  const untrackedFiles = gitStatus?.untracked || [];
  const changedFiles = [...modifiedFiles, ...untrackedFiles];
  const hasChanges = stagedFiles.length > 0 || changedFiles.length > 0;

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
    if (onProceed) onProceed(result.message);
  }, [proceed, onProceed]);

  return (
    <div className="flex flex-1 min-h-0">
        {/* Left Sidebar - Staging & Commit */}
        <div className="w-72 border-r bg-card/20 flex flex-col shrink-0">
          {/* Commit Section */}
          <div className="p-3 border-b space-y-2">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message..."
              className="w-full h-20 px-2.5 py-2 rounded-md border border-input bg-transparent text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commitMessage.trim() && stagedFiles.length > 0) {
                  commitMutation.mutate(commitMessage.trim());
                }
              }}
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="flex-1 h-7 text-xs"
                disabled={!commitMessage.trim() || stagedFiles.length === 0 || commitMutation.isPending}
                onClick={() => commitMutation.mutate(commitMessage.trim())}
              >
                {commitMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Commit ({stagedFiles.length})
              </Button>
            </div>
          </div>

          {/* Stage All / Unstage All */}
          {hasChanges && (
            <div className="flex gap-1 px-3 py-1.5 border-b">
              {changedFiles.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                  onClick={() => stageMutation.mutate(changedFiles)} disabled={stageMutation.isPending}>
                  <Plus className="h-3 w-3 mr-1" />Stage All
                </Button>
              )}
              {stagedFiles.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                  onClick={() => unstageMutation.mutate(stagedFiles)} disabled={unstageMutation.isPending}>
                  <Minus className="h-3 w-3 mr-1" />Unstage All
                </Button>
              )}
            </div>
          )}

          {/* File Lists */}
          <div className="flex-1 overflow-y-auto">
            {statusLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !hasChanges ? (
              <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                <Circle className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-xs font-mono">No changes</p>
              </div>
            ) : (
              <>
                {/* Staged Changes */}
                {stagedFiles.length > 0 && (
                  <div>
                    <button onClick={() => setShowStaged(!showStaged)}
                      className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent/30">
                      {showStaged ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Staged Changes
                      <span className="ml-auto text-[10px] bg-green-500/20 text-green-500 px-1.5 rounded-full">{stagedFiles.length}</span>
                    </button>
                    {showStaged && (
                      <div className="py-0.5">
                        {stagedFiles.map((file) => (
                          <StagingFileItem key={`staged-${file}`} file={file} status="staged"
                            isSelected={selectedFile === file}
                            onClick={() => setSelectedFile(selectedFile === file ? null : file)}
                            onAction={() => unstageMutation.mutate([file])} actionIcon="unstage"
                            disabled={unstageMutation.isPending} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Changes (modified + untracked) */}
                {changedFiles.length > 0 && (
                  <div>
                    <button onClick={() => setShowChanges(!showChanges)}
                      className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent/30">
                      {showChanges ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Changes
                      <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-500 px-1.5 rounded-full">{changedFiles.length}</span>
                    </button>
                    {showChanges && (
                      <div className="py-0.5">
                        {modifiedFiles.map((file) => (
                          <StagingFileItem key={`modified-${file}`} file={file} status="modified"
                            isSelected={selectedFile === file}
                            onClick={() => setSelectedFile(selectedFile === file ? null : file)}
                            onAction={() => stageMutation.mutate([file])} actionIcon="stage"
                            disabled={stageMutation.isPending} />
                        ))}
                        {untrackedFiles.map((file) => (
                          <StagingFileItem key={`untracked-${file}`} file={file} status="untracked"
                            isSelected={selectedFile === file}
                            onClick={() => setSelectedFile(selectedFile === file ? null : file)}
                            onAction={() => stageMutation.mutate([file])} actionIcon="stage"
                            disabled={stageMutation.isPending} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Review actions footer */}
          <div className="border-t px-3 py-2 flex items-center gap-1">
            {pendingComments.length > 0 && (
              <Button variant="default" size="sm" onClick={handleProceed} disabled={isProceedPending} className="h-7 text-xs">
                <Send className="h-3.5 w-3.5 mr-1" />Proceed ({pendingComments.length})
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setShowBatchPanel(true)} className="h-7 w-7 p-0" title="Review history">
              <History className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Right Diff Area - Full Width */}
        <div className="flex-1 min-w-0 overflow-auto bg-[#0d1117]">
          {diffLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedFile && diffData?.diff ? (
            <FileDiffRenderer
              diff={diffData.diff}
              fileName={selectedFile}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileCode className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs font-mono">{hasChanges ? 'Select a file to view changes' : 'Working tree clean'}</p>
            </div>
          )}
        </div>

        {commentPopover && (
          <div className="fixed z-50" style={{ left: commentPopover.position.x, top: commentPopover.position.y }}>
            <ReviewCommentInput
              onSubmit={handleAddComment}
              onCancel={() => setCommentPopover(null)}
              existingComments={comments
                .filter(c => c.filePath === commentPopover.filePath && c.lineNumber === commentPopover.lineNumber && c.status === 'pending')
                .map(c => ({ id: c.id, comment: c.comment }))}
            />
          </div>
        )}

        {showBatchPanel && (
          <ReviewBatchPanel batches={batches} comments={comments} onRerun={rerunBatch} onClose={() => setShowBatchPanel(false)} />
        )}
      </div>
  );
}

function FileDiffRenderer({ diff, fileName }: { diff: string; fileName: string }) {
  return <RawDiffView diff={diff} fileName={fileName} />;
}

function StagingFileItem({
  file, status, isSelected, onClick, onAction, actionIcon, disabled,
}: {
  file: string;
  status: 'staged' | 'modified' | 'untracked';
  isSelected: boolean;
  onClick: () => void;
  onAction: () => void;
  actionIcon: 'stage' | 'unstage';
  disabled: boolean;
}) {
  const statusConfig = {
    staged: { color: 'text-green-500', label: 'S' },
    modified: { color: 'text-yellow-500', label: 'M' },
    untracked: { color: 'text-blue-500', label: 'U' },
  };

  const config = statusConfig[status];
  const fileName = file.split('/').pop() || file;
  const dirPath = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '';

  return (
    <div className={cn(
      'flex items-center gap-1.5 w-full px-3 py-1 text-left group',
      'font-mono text-xs transition-colors',
      'hover:bg-accent',
      isSelected && 'bg-accent'
    )}>
      <span className={cn('text-[10px] font-bold shrink-0 w-3 text-center', config.color)}>{config.label}</span>
      <button onClick={onClick} className="flex-1 min-w-0 text-left">
        <span className="block truncate text-foreground">{fileName}</span>
        {dirPath && <span className="block truncate text-[10px] text-muted-foreground">{dirPath}</span>}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onAction(); }}
        disabled={disabled}
        className={cn(
          'shrink-0 h-5 w-5 rounded flex items-center justify-center transition-colors',
          'opacity-0 group-hover:opacity-100',
          actionIcon === 'stage' ? 'hover:bg-green-500/20 text-green-500' : 'hover:bg-red-500/20 text-red-500',
          isSelected && 'opacity-100'
        )}
        title={actionIcon === 'stage' ? 'Stage file' : 'Unstage file'}
      >
        {actionIcon === 'stage' ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      </button>
    </div>
  );
}
