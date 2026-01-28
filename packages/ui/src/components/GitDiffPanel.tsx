import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PatchDiff } from '@pierre/diffs/react';
import { GitBranch, ChevronRight, FileCode, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface GitDiffPanelProps {
  sessionId: string;
  className?: string;
}

export function GitDiffPanel({ sessionId, className }: GitDiffPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Fetch git status with debounced polling (every 3 seconds)
  const { data: gitStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
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

  const hasChanges = gitStatus && (
    gitStatus.modified.length > 0 ||
    gitStatus.staged.length > 0 ||
    gitStatus.untracked.length > 0
  );

  if (isCollapsed) {
    return (
      <div className={cn('flex flex-col border-l bg-background w-10', className)}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(false)}
          className="m-1"
          title="Expand Git Panel"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </Button>
        {hasChanges && (
          <div className="flex flex-col items-center gap-1 p-2">
            {gitStatus?.modified.length > 0 && (
              <span className="text-xs text-yellow-500">{gitStatus.modified.length}</span>
            )}
            {gitStatus?.staged.length > 0 && (
              <span className="text-xs text-green-500">{gitStatus.staged.length}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col border-l bg-background w-80', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Changes</span>
          {gitStatus?.branch && (
            <span className="text-xs text-muted-foreground">({gitStatus.branch})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetchStatus()}
            className="h-6 w-6"
            title="Refresh"
          >
            <RefreshCw className={cn('h-3 w-3', statusLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(true)}
            className="h-6 w-6"
            title="Collapse"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* File List */}
      <div className="flex-none overflow-y-auto max-h-40 border-b">
        {statusLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !hasChanges ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No changes detected
          </div>
        ) : (
          <div className="p-1">
            {/* Staged files */}
            {gitStatus?.staged.map((file) => (
              <FileItem
                key={`staged-${file}`}
                file={file}
                status="staged"
                isSelected={selectedFile === file}
                onClick={() => setSelectedFile(selectedFile === file ? null : file)}
              />
            ))}
            {/* Modified files */}
            {gitStatus?.modified.map((file) => (
              <FileItem
                key={`modified-${file}`}
                file={file}
                status="modified"
                isSelected={selectedFile === file}
                onClick={() => setSelectedFile(selectedFile === file ? null : file)}
              />
            ))}
            {/* Untracked files */}
            {gitStatus?.untracked.map((file) => (
              <FileItem
                key={`untracked-${file}`}
                file={file}
                status="untracked"
                isSelected={selectedFile === file}
                onClick={() => setSelectedFile(selectedFile === file ? null : file)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Diff View */}
      <div className="flex-1 overflow-auto bg-[#1e1e1e]">
        {diffLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedFile && diffData?.diff ? (
          <PatchDiff
            patch={diffData.diff}
            options={{
              theme: { dark: 'github-dark', light: 'github-light' },
              diffStyle: 'unified',
            }}
          />
        ) : fullDiff?.diff ? (
          <PatchDiff
            patch={fullDiff.diff}
            options={{
              theme: { dark: 'github-dark', light: 'github-light' },
              diffStyle: 'unified',
            }}
          />
        ) : hasChanges ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Click a file to view diff
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No changes to display
          </div>
        )}
      </div>
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
  const statusColors = {
    staged: 'text-green-500',
    modified: 'text-yellow-500',
    untracked: 'text-blue-500',
  };

  const statusLabels = {
    staged: 'S',
    modified: 'M',
    untracked: 'U',
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full p-1.5 rounded text-left text-sm hover:bg-accent',
        isSelected && 'bg-accent'
      )}
    >
      <FileCode className={cn('h-3.5 w-3.5 flex-shrink-0', statusColors[status])} />
      <span className="truncate flex-1">{file}</span>
      <span className={cn('text-xs font-mono', statusColors[status])}>
        {statusLabels[status]}
      </span>
    </button>
  );
}
