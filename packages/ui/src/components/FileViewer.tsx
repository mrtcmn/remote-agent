import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File } from '@pierre/diffs/react';
import { Loader2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { DIFF_THEME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { toast } from '@/components/ui/Toaster';
import { EditControls } from '@/components/git/GitChangesTab';
import { useLineComments } from '@/components/review/useLineComments';
import type { ReviewTarget } from '@/components/review/ReviewComposer';

interface FileViewerProps {
  sessionId: string;
  filePath: string | null;
  className?: string;
  /** Name of the live agent terminal, used to label the "open session" target. */
  currentTargetLabel?: string;
  onProceed?: (message: string, target: ReviewTarget) => void;
  /** Reports unsaved edits, so the explorer can ask before it switches file. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function FileViewer({
  sessionId,
  filePath,
  className,
  currentTargetLabel,
  onProceed,
  onDirtyChange,
}: FileViewerProps) {
  const queryClient = useQueryClient();
  const { activeTheme } = useTerminalTheme();
  const queryKey = ['session-file-content', sessionId, filePath];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.getSessionFileContent(sessionId, filePath!),
    enabled: !!filePath,
    staleTime: 30000,
  });

  const { annotationsFor, renderAnnotation, gutterFor, popoverElement, composer } = useLineComments(
    sessionId,
    { currentTargetLabel, onProceed }
  );

  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<{ getText(): string } | null>(null);
  useEffect(() => {
    setEditing(false);
  }, [filePath]);
  useEffect(() => {
    editorRef.current = null;
    setDirty(false);
  }, [editing]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const saveMutation = useMutation({
    mutationFn: (content: string) => api.saveSessionFileContent(sessionId, filePath!, content),
    onSuccess: (res, content) => {
      queryClient.setQueryData(queryKey, { ...data!, content, size: res.size });
      queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId] });
      setEditing(false);
      toast({ title: 'Saved', description: filePath! });
    },
    onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
  });
  const save = () => {
    if (editorRef.current && !saveMutation.isPending) saveMutation.mutate(editorRef.current.getText());
  };

  // A file line is the diff's additions side, so diff comments on new lines show here too.
  const lineAnnotations = useMemo(
    () => (filePath ? annotationsFor(filePath).filter((a) => a.side === 'additions') : []),
    [filePath, annotationsFor]
  );
  const lines = useMemo(() => data?.content.split('\n') ?? [], [data?.content]);

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
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-card/30 shrink-0">
        <span className="text-xs font-mono text-muted-foreground truncate">{filePath}</span>
        {dirty && <span className="text-[10px] text-amber-400 shrink-0">unsaved</span>}
        <span className="text-xs font-mono text-muted-foreground/50 ml-auto shrink-0">
          {data.size < 1024 ? `${data.size} B` : `${(data.size / 1024).toFixed(1)} KB`}
        </span>
        <EditControls
          editing={editing}
          dirty={dirty}
          saving={saveMutation.isPending}
          onEdit={() => setEditing(true)}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      </div>

      {/* File content */}
      <div
        className="flex-1 overflow-auto min-h-0"
        onKeyDown={(e) => {
          if (editing && e.key === 's' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <File
          file={{ name: data.name, contents: data.content }}
          options={{
            theme: DIFF_THEME,
            themeType: activeTheme.type,
            disableFileHeader: true,
            enableGutterUtility: true,
          }}
          edit={editing}
          onEditChange={(event) => {
            editorRef.current = event.editor;
            setDirty(true);
          }}
          lineAnnotations={lineAnnotations}
          renderAnnotation={renderAnnotation}
          renderGutterUtility={gutterFor(filePath, (n) => lines[n - 1] ?? '')}
        />
      </div>

      {composer}
      {popoverElement}
    </div>
  );
}
