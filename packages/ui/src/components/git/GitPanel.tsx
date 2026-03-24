import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { Project, PresentationRequest } from '@/lib/api';
import { GitToolbar } from './GitToolbar';
import { GitChangesTab } from './GitChangesTab';
import { GitLogTab } from './GitLogTab';
import { GitBranchesTab } from './GitBranchesTab';
import { PresentationModal } from '@/components/presentation/PresentationModal';

type GitTab = 'changes' | 'log' | 'branches';

interface GitPanelProps {
  sessionId: string;
  project?: Project;
  className?: string;
  onProceed?: (message: string) => void;
}

export function GitPanel({ sessionId, project: _project, className, onProceed }: GitPanelProps) {
  const [activeTab, setActiveTab] = useState<GitTab>('changes');
  const [presentationRequest, setPresentationRequest] = useState<PresentationRequest | null>(null);

  const tabs: { id: GitTab; label: string }[] = [
    { id: 'changes', label: 'Changes' },
    { id: 'log', label: 'Log' },
    { id: 'branches', label: 'Branches' },
  ];

  const handleReview = useCallback(() => {
    setPresentationRequest({ unstaged: true, staged: true });
  }, []);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      <GitToolbar sessionId={sessionId} onReview={handleReview} />

      <div className="flex items-center border-b bg-card/20 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-xs font-medium transition-colors relative',
              activeTab === tab.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === 'changes' && <GitChangesTab sessionId={sessionId} onProceed={onProceed} />}
        {activeTab === 'log' && <GitLogTab sessionId={sessionId} />}
        {activeTab === 'branches' && <GitBranchesTab sessionId={sessionId} />}
      </div>

      {presentationRequest && (
        <PresentationModal
          sessionId={sessionId}
          request={presentationRequest}
          onClose={() => setPresentationRequest(null)}
        />
      )}
    </div>
  );
}
