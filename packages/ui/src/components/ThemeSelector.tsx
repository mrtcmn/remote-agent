import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Sun, Moon } from 'lucide-react';
import { useTerminalTheme, type TerminalThemeEntry } from '@/hooks/useTerminalTheme';
import { cn } from '@/lib/utils';

function ThemeSwatch({ entry, isActive, onClick }: { entry: TerminalThemeEntry; isActive: boolean; onClick: () => void }) {
  const t = entry.theme;
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors',
        isActive ? 'bg-secondary' : 'hover:bg-secondary/50'
      )}
    >
      {/* Color preview */}
      <div
        className="shrink-0 w-[42px] h-[22px] rounded border border-white/10 overflow-hidden flex"
        style={{ backgroundColor: t.background as string }}
      >
        <div className="flex-1 flex flex-col justify-center items-start pl-1 gap-px">
          <span className="block h-[2px] w-3 rounded-full" style={{ backgroundColor: t.green as string }} />
          <span className="block h-[2px] w-4 rounded-full" style={{ backgroundColor: t.blue as string }} />
          <span className="block h-[2px] w-2.5 rounded-full" style={{ backgroundColor: t.red as string }} />
        </div>
        <div className="w-[2px] h-2 self-center rounded-full mr-1" style={{ backgroundColor: t.cursor as string, opacity: 0.7 }} />
      </div>

      <span className="text-[11px] font-medium text-foreground/90 truncate flex-1">{entry.name}</span>

      {isActive && <Check className="size-3 text-emerald-400 shrink-0" />}
    </button>
  );
}

export function ThemeSelector({ open, onClose, anchorRef }: { open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement> }) {
  const { darkThemes, lightThemes, activeTheme, setTheme } = useTerminalTheme();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          className="absolute bottom-[32px] right-1 z-50 w-[260px] max-h-[420px] overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border px-3 py-2">
            <p className="text-[11px] font-semibold text-foreground/80 tracking-wide uppercase">Terminal Theme</p>
          </div>

          <div className="p-1.5">
            {/* Dark themes */}
            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
              <Moon className="size-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Dark</span>
            </div>
            {darkThemes.map((t) => (
              <ThemeSwatch
                key={t.id}
                entry={t}
                isActive={activeTheme.id === t.id}
                onClick={() => setTheme(t.id)}
              />
            ))}

            {/* Light themes */}
            <div className="flex items-center gap-1.5 px-2 pt-3 pb-1">
              <Sun className="size-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Light</span>
            </div>
            {lightThemes.map((t) => (
              <ThemeSwatch
                key={t.id}
                entry={t}
                isActive={activeTheme.id === t.id}
                onClick={() => setTheme(t.id)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
