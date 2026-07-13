import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSshTerminal, type SshStatus } from '@/hooks/useSshTerminal';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { cn } from '@/lib/utils';

export function SshTerminal({ sessionId, className, onStatusChange }: {
  sessionId: string;
  className?: string;
  onStatusChange?: (status: SshStatus) => void;
}) {
  const { activeTheme, activeFont, activeWeight, activeFontSize } = useTerminalTheme();
  const { containerRef, status, attempt, fit } = useSshTerminal(sessionId, {
    theme: activeTheme.theme,
    fontFamily: activeFont.family,
    fontWeight: activeWeight,
    fontSize: activeFontSize,
  });

  useEffect(() => { onStatusChange?.(status); }, [status, onStatusChange]);

  useEffect(() => {
    const ro = new ResizeObserver(() => fit());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fit, containerRef]);

  const bgColor = (activeTheme.theme.background as string) || '#0a0a0a';

  return (
    <div className={cn('relative h-full w-full', className)} style={{ backgroundColor: bgColor }}>
      {/* Status indicator — mirrors the local Terminal component */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 text-xs bg-background/80 px-2 py-1 rounded">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'connected' && 'bg-green-500',
            status === 'connecting' && 'bg-yellow-500 animate-pulse',
            status === 'reconnecting' && 'bg-orange-500 animate-pulse',
            status === 'closed' && 'bg-gray-500'
          )}
        />
        <span className="text-foreground/70 capitalize text-[10px]">{status}</span>
      </div>

      <div
        ref={containerRef}
        className={cn('h-full w-full pl-3', activeTheme.type === 'light' && 'xterm-light-theme')}
        style={{ backgroundColor: bgColor }}
      />

      <AnimatePresence>
        {status === 'reconnecting' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3">
              <motion.div
                className="size-3 rounded-full bg-primary"
                animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.1, repeat: Infinity }}
              />
              <div className="text-sm text-foreground">Reconnecting… attempt {attempt}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
