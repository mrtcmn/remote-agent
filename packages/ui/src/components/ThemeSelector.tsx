import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Sun, Moon, Type, Monitor, Palette } from 'lucide-react';
import { useTerminalTheme, type TerminalThemeEntry } from '@/hooks/useTerminalTheme';
import { cn } from '@/lib/utils';
import { useAppTheme, type AppThemeMode } from '@/hooks/useAppTheme';

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
        className="shrink-0 w-[42px] h-[22px] rounded border border-foreground/10 overflow-hidden flex"
        style={{ backgroundColor: t.background as string }}
      >
        <div className="flex-1 flex flex-col justify-center items-start pl-1 gap-px">
          <span className="block h-[2px] w-3 rounded-full" style={{ backgroundColor: t.green as string }} />
          <span className="block h-[2px] w-4 rounded-full" style={{ backgroundColor: t.blue as string }} />
          <span className="block h-[2px] w-2.5 rounded-full" style={{ backgroundColor: t.red as string }} />
        </div>
        <div className="w-[2px] h-2 self-center rounded-full mr-1" style={{ backgroundColor: t.cursor as string, opacity: 0.7 }} />
      </div>

      <span className="text-[11px] font-medium text-foreground/90 truncate flex-1 min-w-0">{entry.name}</span>

      {isActive && <Check className="size-3 text-emerald-400 shrink-0" />}
    </button>
  );
}

export function ThemeSelector({ open, onClose, anchorRef }: { open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement> }) {
  const { darkThemes, lightThemes, activeTheme, setTheme, fonts, activeFont, activeWeight, setFont, setWeight } = useTerminalTheme();
  const { mode: appMode, setMode: setAppMode } = useAppTheme();
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
          className="absolute bottom-[32px] right-1 z-50 w-[260px] max-h-[420px] rounded-lg border border-border bg-card shadow-xl flex flex-col"
        >
          {/* Fixed header */}
          <div className="shrink-0 bg-card border-b border-border px-3 py-2 rounded-t-lg">
            <p className="text-[11px] font-semibold text-foreground/80 tracking-wide uppercase">Appearance</p>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            <div className="p-1.5">
              {/* Font section */}
              <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
                <Type className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Font</span>
              </div>

              {/* Font family */}
              <div className="flex gap-1 px-2 pb-1">
                {fonts.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFont(f.id)}
                    className={cn(
                      'flex-1 px-2 py-1.5 rounded-md text-[10px] font-medium transition-colors',
                      activeFont.id === f.id
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                    )}
                    style={{ fontFamily: f.family }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>

              {/* Font weight */}
              <div className="flex gap-1 px-2 pb-2">
                {activeFont.weights.map((w) => (
                  <button
                    key={w}
                    onClick={() => setWeight(w)}
                    className={cn(
                      'flex-1 px-1.5 py-1 rounded text-[10px] tabular-nums transition-colors',
                      activeWeight === w
                        ? 'bg-secondary text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                    )}
                  >
                    {w}
                  </button>
                ))}
              </div>

              <div className="h-px bg-border mx-1 mb-1" />

              {/* UI Theme section */}
              <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
                <Palette className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">UI Theme</span>
              </div>

              <div className="grid grid-cols-2 gap-1 px-2 pb-2">
                {([
                  { id: 'dark' as AppThemeMode, label: 'Dark', icon: Moon },
                  { id: 'light' as AppThemeMode, label: 'Light', icon: Sun },
                  { id: 'system' as AppThemeMode, label: 'System', icon: Monitor },
                  { id: 'terminal' as AppThemeMode, label: 'Terminal', icon: Palette },
                ]).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setAppMode(opt.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] font-medium transition-colors',
                      appMode === opt.id
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                    )}
                  >
                    <opt.icon className="size-3" />
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="h-px bg-border mx-1 mb-1" />

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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
