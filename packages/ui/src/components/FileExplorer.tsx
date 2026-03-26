import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileTree } from '@/components/FileTree';
import { FileViewer } from '@/components/FileViewer';
import { ProjectSelector } from '@/components/ProjectSelector';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { Project } from '@/lib/api';

interface FileExplorerProps {
  sessionId: string;
  project?: Project;
  selectedProjectId?: string | null;
  className?: string;
}

export function FileExplorer({ sessionId, project, selectedProjectId: externalSelectedProjectId, className }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(externalSelectedProjectId ?? null);

  // Sync with external selection (from toolbar project selector)
  useEffect(() => {
    if (externalSelectedProjectId !== undefined) {
      setSelectedProjectId(externalSelectedProjectId);
      setSelectedFile(null);
    }
  }, [externalSelectedProjectId]);

  // Load child links when multi-project
  const { data: links } = useQuery({
    queryKey: ['project-links', project?.id],
    queryFn: () => api.getProjectLinks(project!.id),
    enabled: !!project?.isMultiProject,
  });

  // Determine the base path for file browsing
  const basePath = (() => {
    if (!project?.isMultiProject || !selectedProjectId || !links) return '.';
    const link = links.find(l => l.childProjectId === selectedProjectId);
    return link ? link.alias : '.';
  })();

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* Project selector for multi-project — hidden when toolbar already controls selection */}
      {project?.isMultiProject && links && links.length > 0 && externalSelectedProjectId === undefined && (
        <div className="px-2 py-1.5 border-b bg-card/20 shrink-0">
          <ProjectSelector
            links={links}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
          />
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* File Tree - Left Panel */}
        <div className="w-60 border-r bg-card/30 shrink-0 overflow-hidden">
          <FileTree
            sessionId={sessionId}
            selectedFile={selectedFile}
            onFileSelect={setSelectedFile}
            basePath={basePath}
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
    </div>
  );
}
