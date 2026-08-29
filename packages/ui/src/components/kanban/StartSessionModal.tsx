import { useState } from 'react';
import { Loader2, TerminalSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { buildSessionPrompt } from '@/lib/task-prompt';
import type { KanbanTask, TerminalType } from '@/lib/api';

interface StartSessionModalProps {
  task: KanbanTask;
  busy: boolean;
  onClose: () => void;
  onStart: (prompt: string, agent: TerminalType) => void;
}

const AGENTS: { value: TerminalType; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'opencode', label: 'opencode' },
  { value: 'kimi', label: 'Kimi' },
];

/**
 * Opens an interactive session on this task. The prompt is prefilled from the
 * task — title, details, plan, checklist — and stays editable, because the
 * person usually knows one thing the board does not.
 */
export function StartSessionModal({ task, busy, onClose, onStart }: StartSessionModalProps) {
  const [prompt, setPrompt] = useState(() => buildSessionPrompt(task));
  const [agent, setAgent] = useState<TerminalType>(task.adapterType === 'gemini_cli' ? 'claude' : 'claude');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-background rounded-xl border shadow-xl mx-4 max-h-[85vh] flex flex-col">
        <header className="flex items-center gap-2 p-4 border-b">
          <TerminalSquare className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Start a session on this task</h2>
          <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Project</span>
            <span className="font-medium text-foreground">{task.project?.name ?? 'unknown'}</span>
            <span className="ml-auto">Agent</span>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value as TerminalType)}
              className="h-7 px-1.5 text-xs rounded border bg-background cursor-pointer"
            >
              {AGENTS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>

          <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block">
            Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            spellCheck={false}
            className="w-full h-[320px] px-3 py-2 text-xs font-mono rounded-md border bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !prompt.trim() || !task.project} onClick={() => onStart(prompt, agent)}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TerminalSquare className="h-4 w-4 mr-1" />}
            Start session
          </Button>
        </footer>
      </div>
    </div>
  );
}
