import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Folder, FileText, Loader2 } from 'lucide-react';
import { api, type FileEntry } from '@/lib/api';
import { cn } from '@/lib/utils';

interface FileTreeProps {
  sessionId: string;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
}

export function FileTree({ sessionId, selectedFile, onFileSelect }: FileTreeProps) {
  return (
    <div className="h-full overflow-y-auto py-2 text-sm font-mono">
      <TreeDirectory
        sessionId={sessionId}
        path="."
        depth={0}
        selectedFile={selectedFile}
        onFileSelect={onFileSelect}
        defaultExpanded
      />
    </div>
  );
}

interface TreeDirectoryProps {
  sessionId: string;
  path: string;
  depth: number;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
  defaultExpanded?: boolean;
}

function TreeDirectory({ sessionId, path, depth, selectedFile, onFileSelect, defaultExpanded = false }: TreeDirectoryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { data, isLoading } = useQuery({
    queryKey: ['session-files', sessionId, path],
    queryFn: () => api.getSessionFiles(sessionId, path),
    enabled: expanded,
    staleTime: 30000,
  });

  const toggle = useCallback(() => setExpanded(prev => !prev), []);

  return (
    <>
      {/* Don't render a row for the root directory */}
      {path !== '.' && (
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
              />
            ) : (
              <TreeFile
                key={entry.path}
                entry={entry}
                depth={path === '.' ? depth : depth + 1}
                isSelected={selectedFile === entry.path}
                onSelect={onFileSelect}
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
}

function TreeFile({ entry, depth, isSelected, onSelect }: TreeFileProps) {
  return (
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
  );
}
