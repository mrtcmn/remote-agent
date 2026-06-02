import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EDITORS, getEditorById, type EditorId } from './EditorIcons';

const STORAGE_KEY = 'localMode.openInEditor.default';

function readDefault(): EditorId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && EDITORS.some((e) => e.id === v)) return v as EditorId;
  } catch {
    /* localStorage may throw in private mode */
  }
  // First-time fallback: first editor in the catalog (VS Code).
  return EDITORS[0].id;
}

function writeDefault(id: EditorId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

function launch(url: string) {
  // Same pattern as the existing code-server flow — Electron intercepts
  // window.open and routes non-app origins through shell.openExternal,
  // which handles vscode://, cursor://, jetbrains://, zed://, antigravity://.
  // In a browser, the OS protocol handler picks it up.
  window.open(url, '_blank');
}

interface OpenInEditorButtonProps {
  folder: string;
  disabled?: boolean;
  className?: string;
}

export function OpenInEditorButton({ folder, disabled, className }: OpenInEditorButtonProps) {
  const [defaultId, setDefaultId] = useState<EditorId | null>(() => readDefault());
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoveredHalf, setHoveredHalf] = useState<'main' | 'caret' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  // Position the portaled menu under the trigger; reposition on scroll/resize.
  useLayoutEffect(() => {
    if (!menuOpen || !rootRef.current) return;
    const update = () => {
      const r = rootRef.current!.getBoundingClientRect();
      setMenuPos({
        top: r.bottom + 4,
        right: window.innerWidth - r.right,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [menuOpen]);

  // Close on outside click / Escape — check both the trigger and the portaled menu.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = rootRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const current = getEditorById(defaultId);

  function pick(id: EditorId, opts: { open: boolean }) {
    if (defaultId !== id) {
      setDefaultId(id);
      writeDefault(id);
    }
    setMenuOpen(false);
    if (opts.open) {
      const editor = getEditorById(id);
      if (editor) launch(editor.deepLink(folder));
    }
  }

  function onMainClick() {
    if (disabled) return;
    // No default yet → both halves open the menu (first pick becomes default).
    if (!current) {
      setMenuOpen((v) => !v);
      return;
    }
    launch(current.deepLink(folder));
  }

  function onCaretClick() {
    if (disabled) return;
    setMenuOpen((v) => !v);
  }

  const MainIcon = current?.Icon;
  const mainLabel = current ? `Open in ${current.label}` : 'Open in editor';

  return (
    <div ref={rootRef} className={cn('relative flex items-stretch', className)}>
      {/* ── Left face: launches default editor ── */}
      <motion.button
        type="button"
        whileTap={disabled ? undefined : { scale: 0.97 }}
        onHoverStart={() => setHoveredHalf('main')}
        onHoverEnd={() => setHoveredHalf((h) => (h === 'main' ? null : h))}
        onClick={onMainClick}
        disabled={disabled}
        title={mainLabel}
        className={cn(
          'flex items-center gap-1.5 pl-2 pr-1.5 my-[2px] text-xs font-medium select-none cursor-pointer',
          'rounded-l-md transition-colors duration-100 shrink-0',
          'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        {MainIcon ? (
          <MainIcon size={14} className="shrink-0" />
        ) : (
          <span className="inline-flex size-3.5 items-center justify-center rounded-[3px] border border-dashed border-muted-foreground/50" />
        )}
        <span className="leading-none tracking-tight hidden sm:inline">
          {mainLabel}
        </span>
        <motion.span
          animate={{ opacity: hoveredHalf === 'main' ? 0.5 : 0.2 }}
          transition={{ duration: 0.12 }}
        >
          <ExternalLink className="size-2.5" />
        </motion.span>
      </motion.button>

      {/* hairline divider between halves */}
      <div className="w-px self-stretch my-[6px] bg-border/70 shrink-0" />

      {/* ── Right face: opens dropdown ── */}
      <motion.button
        type="button"
        whileTap={disabled ? undefined : { scale: 0.97 }}
        onHoverStart={() => setHoveredHalf('caret')}
        onHoverEnd={() => setHoveredHalf((h) => (h === 'caret' ? null : h))}
        onClick={onCaretClick}
        disabled={disabled}
        title="Choose editor"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={cn(
          'flex items-center justify-center px-1.5 my-[2px] cursor-pointer select-none shrink-0',
          'rounded-r-md transition-colors duration-100',
          'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
          menuOpen && 'bg-secondary/60 text-foreground',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <motion.span animate={{ rotate: menuOpen ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="size-3" />
        </motion.span>
      </motion.button>

      {/* ── Dropdown — portaled to escape toolbar overflow-hidden ── */}
      {createPortal(
        <AnimatePresence>
          {menuOpen && menuPos && (
            <motion.div
              ref={menuRef}
              key="editor-menu"
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
              role="menu"
              style={{
                position: 'fixed',
                top: menuPos.top,
                right: menuPos.right,
                transformOrigin: 'top right',
              }}
              className={cn(
                'z-[100] min-w-[220px]',
                'rounded-md border border-border bg-card shadow-xl overflow-hidden',
              )}
            >
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border/60">
                Open folder in…
              </div>
              <ul className="py-1">
                {EDITORS.map((ed) => {
                  const isDefault = ed.id === defaultId;
                  return (
                    <li key={ed.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => pick(ed.id, { open: true })}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs',
                          'text-foreground/90 hover:bg-secondary/60 transition-colors duration-75',
                          'cursor-pointer',
                        )}
                      >
                        <ed.Icon size={14} className="shrink-0" />
                        <span className="flex-1 truncate font-medium">{ed.label}</span>
                        {isDefault ? (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Check className="size-3 text-emerald-400" />
                            default
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/40">
                            set default
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
