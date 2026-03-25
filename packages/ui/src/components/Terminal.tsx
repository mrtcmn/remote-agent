import { useEffect, useRef } from 'react';
import { useTerminal } from '@/hooks/useTerminal';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { cn } from '@/lib/utils';

interface TerminalProps {
  terminalId: string;
  className?: string;
  onExit?: (exitCode: number) => void;
  onTitleChanged?: (name: string) => void;
}

export function Terminal({ terminalId, className, onExit, onTitleChanged }: TerminalProps) {
  const { activeTheme, activeFont, activeWeight } = useTerminalTheme();
  const { terminalRef, status, fit, refresh } = useTerminal({
    terminalId,
    theme: activeTheme.theme,
    fontFamily: activeFont.family,
    fontWeight: activeWeight,
    onExit,
    onTitleChanged,
  });
  const hasRefreshedRef = useRef(false);

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

  // Refresh terminal when it becomes visible or when status changes to connected
  useEffect(() => {
    if (status === 'connected' && !hasRefreshedRef.current) {
      // Small delay to ensure terminal has received data
      const timer = setTimeout(() => {
        fit();
        refresh();
        hasRefreshedRef.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [status, fit, refresh]);

  // Refresh when component becomes visible (tab switch)
  useEffect(() => {
    if (!terminalRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          // Terminal became visible, refresh it
          requestAnimationFrame(() => {
            fit();
            refresh();
          });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(terminalRef.current);
    return () => observer.disconnect();
  }, [terminalRef, fit, refresh]);

  return (
    <div
      className={cn('relative h-full w-full', className)}
      style={{ backgroundColor: (activeTheme.theme.background as string) || '#1e1e1e' }}
    >
      {/* Status indicator */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 text-xs bg-black/50 px-2 py-1 rounded">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'connected' && 'bg-green-500',
            status === 'connecting' && 'bg-yellow-500 animate-pulse',
            status === 'disconnected' && 'bg-red-500',
            status === 'exited' && 'bg-gray-500'
          )}
        />
        <span className="text-white/70 capitalize text-[10px]">{status}</span>
      </div>

      {/* Terminal container with horizontal padding */}
      <div
        ref={terminalRef}
        className="h-full w-full rounded-lg overflow-hidden px-3"
        style={{ backgroundColor: (activeTheme.theme.background as string) || '#1e1e1e' }}
      />
    </div>
  );
}
