import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSshTerminal } from '@/hooks/useSshTerminal';
import { cn } from '@/lib/utils';

export function SshTerminal({ sessionId, className }: { sessionId: string; className?: string }) {
  const { containerRef, status, attempt, fit } = useSshTerminal(sessionId);

  useEffect(() => {
    const ro = new ResizeObserver(() => fit());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fit, containerRef]);

  return (
    <div className={cn('relative h-full w-full bg-[#0a0a0a]', className)}>
      <div ref={containerRef} className="h-full w-full p-2" />

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
