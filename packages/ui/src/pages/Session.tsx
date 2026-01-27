import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Send, Loader2, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface OutputMessage {
  type: string;
  data: {
    type?: string;
    content?: string;
    status?: string;
    prompt?: string;
    permission?: string;
    message?: string;
  };
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);

  const { data: session } = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.getSession(id!),
    enabled: !!id,
  });

  const {
    isConnected,
    messages,
    sendInput,
    respondPermission,
  } = useWebSocket(id || null, {
    onMessage: () => {
      // Auto-scroll on new message
      setTimeout(() => {
        outputRef.current?.scrollTo({
          top: outputRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }, 100);
    },
  });

  const handleSend = () => {
    if (!input.trim()) return;
    sendInput(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Check if waiting for input
  const lastMessage = messages[messages.length - 1] as OutputMessage | undefined;
  const isWaitingInput = lastMessage?.type === 'input_required';
  const isWaitingPermission = lastMessage?.type === 'permission_required';

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="font-semibold">{session?.project?.name || 'Session'}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div
              className={cn(
                'h-2 w-2 rounded-full',
                isConnected ? 'bg-green-500' : 'bg-red-500'
              )}
            />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto rounded-lg border bg-black/50 p-4 terminal-output"
      >
        {messages.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">
            Waiting for output...
          </div>
        ) : (
          messages.map((msg, i) => <OutputLine key={i} message={msg as OutputMessage} />)
        )}
      </div>

      {/* Permission Request */}
      {isWaitingPermission && (
        <Card className="mt-4 border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-yellow-500">Permission Required</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {lastMessage?.data?.permission || lastMessage?.data?.prompt}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={() => respondPermission(true)}
                    className="gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Allow
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => respondPermission(false)}
                    className="gap-2"
                  >
                    <XCircle className="h-4 w-4" />
                    Deny
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isWaitingInput ? 'Enter your response...' : 'Send a message...'}
          className="flex-1"
          disabled={!isConnected}
        />
        <Button onClick={handleSend} disabled={!isConnected || !input.trim()}>
          {isConnected ? <Send className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        </Button>
      </div>
    </div>
  );
}

function OutputLine({ message }: { message: OutputMessage }) {
  const { type, data } = message;

  if (type === 'connected') {
    return (
      <div className="text-green-500 mb-2">
        Connected to session
      </div>
    );
  }

  if (type === 'status') {
    return (
      <div className="text-blue-400 mb-2 text-sm">
        Status: {data.status}
      </div>
    );
  }

  if (type === 'output') {
    const outputType = data.type;

    if (outputType === 'text') {
      return <div className="text-gray-100 mb-1 whitespace-pre-wrap">{data.content}</div>;
    }

    if (outputType === 'tool_call') {
      return (
        <div className="text-purple-400 mb-1 text-sm">
          <span className="opacity-50">[Tool]</span> {data.content}
        </div>
      );
    }

    if (outputType === 'tool_result') {
      return (
        <div className="text-cyan-400 mb-1 text-sm opacity-75">
          {data.content}
        </div>
      );
    }

    if (outputType === 'error') {
      return (
        <div className="text-red-400 mb-1">
          <span className="opacity-50">[Error]</span> {data.content}
        </div>
      );
    }

    if (outputType === 'system') {
      return (
        <div className="text-gray-500 mb-1 text-sm">
          {data.content}
        </div>
      );
    }
  }

  if (type === 'input_required') {
    return (
      <div className="text-yellow-400 mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        {data.prompt}
      </div>
    );
  }

  if (type === 'terminated') {
    return (
      <div className="text-red-500 mb-2">
        Session terminated
      </div>
    );
  }

  if (type === 'error') {
    return (
      <div className="text-red-400 mb-1">
        {data.message}
      </div>
    );
  }

  return null;
}
