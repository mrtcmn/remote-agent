import { useQuery } from '@tanstack/react-query';
import { File } from '@pierre/diffs/react';
import { Loader2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { DIFF_THEME } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface FileViewerProps {
  sessionId: string;
  filePath: string | null;
  className?: string;
}

export function FileViewer({ sessionId, filePath, className }: FileViewerProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['session-file-content', sessionId, filePath],
    queryFn: () => api.getSessionFileContent(sessionId, filePath!),
    enabled: !!filePath,
    staleTime: 30000,
  });

  if (!filePath) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <FileText className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm font-mono">Select a file to view</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <p className="text-sm font-mono">Failed to load file</p>
        {error && <p className="text-xs mt-1 opacity-60">{(error as Error).message}</p>}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* File path header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card/30 shrink-0">
        <span className="text-xs font-mono text-muted-foreground truncate">{filePath}</span>
        <span className="text-xs font-mono text-muted-foreground/50 ml-auto shrink-0">
          {data.size < 1024 ? `${data.size} B` : `${(data.size / 1024).toFixed(1)} KB`}
        </span>
      </div>

      {/* File content */}
      <div className="flex-1 overflow-auto min-h-0">
        <File
          file={{
            name: data.name,
            contents: data.content,
          }}
          options={{
            theme: DIFF_THEME,
          }}
        />
      </div>
    </div>
  );
}
