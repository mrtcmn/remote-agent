import { useState } from 'react';
import { CheckSquare, Plus, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { parseChecklist } from '@/lib/task-prompt';
import type { ChecklistItem, KanbanTask } from '@/lib/api';

interface TaskChecklistProps {
  task: KanbanTask;
  onToggle: (index: number, done: boolean) => void;
  onReplace: (items: ChecklistItem[]) => void;
}

/** Optional per task. The agent writes to the same list over MCP. */
export function TaskChecklist({ task, onToggle, onReplace }: TaskChecklistProps) {
  const items = parseChecklist(task.checklist);
  const [newItem, setNewItem] = useState('');
  const done = items.filter((i) => i.done).length;

  const add = () => {
    const text = newItem.trim();
    if (!text) return;
    onReplace([...items, { text, done: false }]);
    setNewItem('');
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
          Checklist
        </label>
        {items.length > 0 && (
          <>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {done}/{items.length}
            </span>
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-[120px]">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
              />
            </div>
          </>
        )}
      </div>

      <div className="space-y-0.5">
        {items.map((item, i) => (
          <div key={i} className="group flex items-start gap-2 py-0.5">
            <button
              onClick={() => onToggle(i, !item.done)}
              className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={item.done ? `Untick ${item.text}` : `Tick ${item.text}`}
            >
              {item.done
                ? <CheckSquare className="h-4 w-4 text-green-500" />
                : <Square className="h-4 w-4" />}
            </button>
            <span className={cn('flex-1 text-sm', item.done && 'line-through text-muted-foreground')}>
              {item.text}
            </span>
            <button
              onClick={() => onReplace(items.filter((_, j) => j !== i))}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
              aria-label={`Remove ${item.text}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-1 mt-1.5">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={items.length ? 'Add an item...' : 'Add a checklist item — the agent ticks these off'}
          className="h-7 text-xs"
        />
        {newItem.trim() && (
          <Button size="sm" className="h-7 w-7 p-0" onClick={add}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </section>
  );
}
