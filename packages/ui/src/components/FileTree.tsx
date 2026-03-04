import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Folder, FileText, Loader2 } from 'lucide-react';
import { api, type FileEntry } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';
import { FileContextMenu, type ContextAction } from '@/components/FileContextMenu';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { UploadModal } from '@/components/UploadModal';
import { MoveOrCopyModal } from '@/components/MoveOrCopyModal';

interface FileTreeProps {
  sessionId: string;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
  basePath?: string;
}

interface ContextActionState {
  type: ContextAction;
  path: string;
  entryType: 'file' | 'directory';
}

export function FileTree({ sessionId, selectedFile, onFileSelect, basePath = '.' }: FileTreeProps) {
  const [contextAction, setContextAction] = useState<ContextActionState | null>(null);
  const queryClient = useQueryClient();

  const invalidateFiles = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['session-files', sessionId] });
  }, [queryClient, sessionId]);

  const deleteMutation = useMutation({
    mutationFn: (path: string) => api.deleteFile(sessionId, path),
    onSuccess: () => {
      toast({ title: 'Deleted successfully' });
      invalidateFiles();
      // Clear selected file if it was the deleted one
      if (contextAction && selectedFile?.startsWith(contextAction.path)) {
        onFileSelect('');
      }
      setContextAction(null);
    },
    onError: (err: Error) => toast({ title: 'Delete failed', description: err.message, variant: 'destructive' }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ files, directory }: { files: File[]; directory: string }) =>
      api.uploadFiles(sessionId, files, directory),
    onSuccess: () => {
      toast({ title: 'Files uploaded' });
      invalidateFiles();
      setContextAction(null);
    },
    onError: (err: Error) => toast({ title: 'Upload failed', description: err.message, variant: 'destructive' }),
  });

  const copyMutation = useMutation({
    mutationFn: ({ source, destination }: { source: string; destination: string }) =>
      api.copyFile(sessionId, source, destination),
    onSuccess: () => {
      toast({ title: 'Copied successfully' });
      invalidateFiles();
      setContextAction(null);
    },
    onError: (err: Error) => toast({ title: 'Copy failed', description: err.message, variant: 'destructive' }),
  });

  const moveMutation = useMutation({
    mutationFn: ({ source, destination }: { source: string; destination: string }) =>
      api.moveFile(sessionId, source, destination),
    onSuccess: () => {
      toast({ title: 'Moved successfully' });
      invalidateFiles();
      if (contextAction && selectedFile?.startsWith(contextAction.path)) {
        onFileSelect('');
      }
      setContextAction(null);
    },
    onError: (err: Error) => toast({ title: 'Move failed', description: err.message, variant: 'destructive' }),
  });

  const handleContextAction = useCallback((type: ContextAction, path: string, entryType: 'file' | 'directory') => {
    setContextAction({ type, path, entryType });
  }, []);

  return (
    <div className="h-full overflow-y-auto py-2 text-sm font-mono">
      <TreeDirectory
        sessionId={sessionId}
        path={basePath}
        depth={0}
        selectedFile={selectedFile}
        onFileSelect={onFileSelect}
        onContextAction={handleContextAction}
        defaultExpanded
      />

      {/* Modals */}
      {contextAction?.type === 'delete' && (
        <ConfirmDeleteDialog
          path={contextAction.path}
          entryType={contextAction.entryType}
          onConfirm={() => deleteMutation.mutate(contextAction.path)}
          onClose={() => setContextAction(null)}
          isPending={deleteMutation.isPending}
        />
      )}

      {contextAction?.type === 'upload' && (
        <UploadModal
          directory={contextAction.path}
          onUpload={(files) => uploadMutation.mutate({ files, directory: contextAction.path })}
          onClose={() => setContextAction(null)}
          isPending={uploadMutation.isPending}
        />
      )}

      {contextAction?.type === 'copy' && (
        <MoveOrCopyModal
          mode="copy"
          sourcePath={contextAction.path}
          onConfirm={(dest) => copyMutation.mutate({ source: contextAction.path, destination: dest })}
          onClose={() => setContextAction(null)}
          isPending={copyMutation.isPending}
        />
      )}

      {contextAction?.type === 'move' && (
        <MoveOrCopyModal
          mode="move"
          sourcePath={contextAction.path}
          onConfirm={(dest) => moveMutation.mutate({ source: contextAction.path, destination: dest })}
          onClose={() => setContextAction(null)}
          isPending={moveMutation.isPending}
        />
      )}
    </div>
  );
}

interface TreeDirectoryProps {
  sessionId: string;
  path: string;
  depth: number;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
  onContextAction: (type: ContextAction, path: string, entryType: 'file' | 'directory') => void;
  defaultExpanded?: boolean;
}

function TreeDirectory({ sessionId, path, depth, selectedFile, onFileSelect, onContextAction, defaultExpanded = false }: TreeDirectoryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { data, isLoading } = useQuery({
    queryKey: ['session-files', sessionId, path],
    queryFn: () => api.getSessionFiles(sessionId, path),
    enabled: expanded,
    staleTime: 30000,
  });

  const toggle = useCallback(() => setExpanded(prev => !prev), []);

  const directoryButton = path !== '.' ? (
    <button
      onClick={toggle}
      className={cn(
        'flex items-center gap-1 w-full px-2 py-1 hover:bg-accent/50 text-left',
        'text-muted-foreground hover:text-foreground transition-colors'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      )}
      <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
      <span className="truncate text-xs">{path.split('/').pop()}</span>
    </button>
  ) : null;

  return (
    <>
      {directoryButton && (
        <FileContextMenu
          entryType="directory"
          onAction={(action) => onContextAction(action, path, 'directory')}
        >
          {directoryButton}
        </FileContextMenu>
      )}

      {expanded && (
        <>
          {isLoading && (
            <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }} className="py-1">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </div>
          )}
          {data?.entries.map((entry) => (
            entry.type === 'directory' ? (
              <TreeDirectory
                key={entry.path}
                sessionId={sessionId}
                path={entry.path}
                depth={path === '.' ? depth : depth + 1}
                selectedFile={selectedFile}
                onFileSelect={onFileSelect}
                onContextAction={onContextAction}
              />
            ) : (
              <TreeFile
                key={entry.path}
                entry={entry}
                depth={path === '.' ? depth : depth + 1}
                isSelected={selectedFile === entry.path}
                onSelect={onFileSelect}
                onContextAction={onContextAction}
              />
            )
          ))}
        </>
      )}
    </>
  );
}

interface TreeFileProps {
  entry: FileEntry;
  depth: number;
  isSelected: boolean;
  onSelect: (path: string) => void;
  onContextAction: (type: ContextAction, path: string, entryType: 'file' | 'directory') => void;
}

function TreeFile({ entry, depth, isSelected, onSelect, onContextAction }: TreeFileProps) {
  return (
    <FileContextMenu
      entryType="file"
      onAction={(action) => onContextAction(action, entry.path, 'file')}
    >
      <button
        onClick={() => onSelect(entry.path)}
        className={cn(
          'flex items-center gap-1 w-full px-2 py-1 text-left transition-colors',
          'text-muted-foreground hover:text-foreground',
          isSelected
            ? 'bg-primary/15 text-foreground'
            : 'hover:bg-accent/50'
        )}
        style={{ paddingLeft: `${depth * 12 + 8 + 18}px` }}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs">{entry.name}</span>
      </button>
    </FileContextMenu>
  );
}
