import { useEffect } from 'react';
import { useTerminal } from '@/hooks/useTerminal';
import { cn } from '@/lib/utils';

interface TerminalProps {
  terminalId: string;
  className?: string;
  onExit?: (exitCode: number) => void;
}

export function Terminal({ terminalId, className, onExit }: TerminalProps) {
  const { terminalRef, isConnected, status, fit } = useTerminal({
    terminalId,
    onExit,
  });

  // Fit terminal when container might have resized
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      fit();
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [fit, terminalRef]);

  return (
    <div className={cn('relative h-full w-full', className)}>
      {/* Status indicator */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 text-xs">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'connected' && 'bg-green-500',
            status === 'connecting' && 'bg-yellow-500 animate-pulse',
            status === 'disconnected' && 'bg-red-500',
            status === 'exited' && 'bg-gray-500'
          )}
        />
        <span className="text-muted-foreground capitalize">{status}</span>
      </div>

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="h-full w-full bg-[#1a1a1a] rounded-lg overflow-hidden"
      />
    </div>
  );
}
