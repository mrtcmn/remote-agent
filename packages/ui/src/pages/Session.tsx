import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { TerminalTabs } from '@/components/TerminalTabs';

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: session } = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.getSession(id!),
    enabled: !!id,
  });

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="font-semibold">{session?.project?.name || 'Session'}</h1>
        </div>
      </div>

      {/* Terminal tabs with Claude and Shell support */}
      <TerminalTabs sessionId={id!} className="flex-1" />
    </div>
  );
}
