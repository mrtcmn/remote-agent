import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Unplug } from 'lucide-react';
import { useSshTerminal, type SshStatus } from '@/hooks/useSshTerminal';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

/** An SSH tab: same look as a local terminal, plus reconnect when it ends. */
export function SshTerminal({ terminalId, className, onStatusChange }: {
  terminalId: string;
  className?: string;
  onStatusChange?: (status: SshStatus) => void;
}) {
  const { activeTheme, activeFont, activeWeight, activeFontSize } = useTerminalTheme();
  const [resuming, setResuming] = useState(false);
  const { containerRef, status, attempt, fit } = useSshTerminal(terminalId, {
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

      {status === 'closed' && (
        <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Unplug className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">SSH connection ended</p>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={resuming}
              onClick={async () => {
                setResuming(true);
                try {
                  // Same terminal, same scrollback; the socket picks it up.
                  await api.reconnectSshTerminal(terminalId);
                } catch (err) {
                  toast({ title: 'Reconnect failed', description: (err as Error).message, variant: 'destructive' });
                } finally {
                  setResuming(false);
                }
              }}
            >
              <RefreshCw className={cn('size-3.5', resuming && 'animate-spin')} />
              Reconnect
            </Button>
          </div>
        </div>
      )}

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
