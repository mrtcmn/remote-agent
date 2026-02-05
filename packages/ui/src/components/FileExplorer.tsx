import { useState } from 'react';
import { FileTree } from '@/components/FileTree';
import { FileViewer } from '@/components/FileViewer';
import { cn } from '@/lib/utils';

interface FileExplorerProps {
  sessionId: string;
  className?: string;
}

export function FileExplorer({ sessionId, className }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <div className={cn('flex h-full min-h-0', className)}>
      {/* File Tree - Left Panel */}
      <div className="w-60 border-r bg-card/30 shrink-0 overflow-hidden">
        <FileTree
          sessionId={sessionId}
          selectedFile={selectedFile}
          onFileSelect={setSelectedFile}
        />
      </div>

      {/* File Viewer - Right Panel */}
      <div className="flex-1 min-w-0">
        <FileViewer
          sessionId={sessionId}
          filePath={selectedFile}
        />
      </div>
    </div>
  );
}
