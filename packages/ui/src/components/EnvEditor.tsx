import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Trash2, Save, Loader2, List, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EnvEntry {
  key: string;
  value: string;
}

function entriesToText(entries: EnvEntry[]): string {
  return entries
    .filter(e => e.key.trim())
    .map(e => `${e.key}=${e.value}`)
    .join('\n');
}

function textToEntries(text: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) entries.push({ key, value });
  }
  return entries.length > 0 ? entries : [{ key: '', value: '' }];
}

export function EnvEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [mode, setMode] = useState<'table' | 'text'>('table');
  const [rawText, setRawText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['project-env', projectId],
    queryFn: () => api.getProjectEnv(projectId),
  });

  useEffect(() => {
    if (data?.env) {
      const parsed = Object.entries(data.env).map(([key, value]) => ({ key, value: String(value) }));
      const result = parsed.length > 0 ? parsed : [{ key: '', value: '' }];
      setEntries(result);
      setRawText(entriesToText(result));
      setIsDirty(false);
    } else {
      setEntries([{ key: '', value: '' }]);
      setRawText('');
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (env: Record<string, string>) => api.updateProjectEnv(projectId, env),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-env', projectId] });
      setIsDirty(false);
    },
  });

  const handleSave = () => {
    const source = mode === 'text' ? textToEntries(rawText) : entries;
    const env: Record<string, string> = {};
    for (const entry of source) {
      const key = entry.key.trim();
      if (key) {
        env[key] = entry.value;
      }
    }
    saveMutation.mutate(env);
  };

  const switchMode = (newMode: 'table' | 'text') => {
    if (newMode === mode) return;
    if (newMode === 'text') {
      setRawText(entriesToText(entries));
    } else {
      setEntries(textToEntries(rawText));
    }
    setMode(newMode);
  };

  const updateEntry = (index: number, field: 'key' | 'value', val: string) => {
    const next = [...entries];
    next[index] = { ...next[index], [field]: val };
    setEntries(next);
    setIsDirty(true);
  };

  const addEntry = () => {
    setEntries([...entries, { key: '', value: '' }]);
  };

  const removeEntry = (index: number) => {
    const next = entries.filter((_, i) => i !== index);
    setEntries(next.length > 0 ? next : [{ key: '', value: '' }]);
    setIsDirty(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Environment Variables</h3>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => switchMode('table')}
              className={cn(
                'h-6 w-7 flex items-center justify-center transition-colors',
                mode === 'table' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
              title="Table view"
            >
              <List className="h-3 w-3" />
            </button>
            <button
              onClick={() => switchMode('text')}
              className={cn(
                'h-6 w-7 flex items-center justify-center transition-colors border-l border-border',
                mode === 'text' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
              title="Text view (KEY=VALUE)"
            >
              <FileText className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          {mode === 'table' && (
            <Button variant="ghost" size="sm" onClick={addEntry} className="h-7 px-2 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          )}
          <Button
            variant={isDirty ? 'default' : 'ghost'}
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending || !isDirty}
            className="h-7 px-2 text-xs"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      {mode === 'table' ? (
        <div className="space-y-1.5">
          {entries.map((entry, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <Input
                value={entry.key}
                onChange={(e) => updateEntry(i, 'key', e.target.value)}
                placeholder="KEY"
                className="h-8 text-xs font-mono flex-1"
              />
              <span className="text-muted-foreground text-xs">=</span>
              <Input
                value={entry.value}
                onChange={(e) => updateEntry(i, 'value', e.target.value)}
                placeholder="value"
                className="h-8 text-xs font-mono flex-[2]"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeEntry(i)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <textarea
            value={rawText}
            onChange={(e) => { setRawText(e.target.value); setIsDirty(true); }}
            placeholder={"# Paste env vars, one per line\nAPI_KEY=your-key\nDATABASE_URL=postgres://..."}
            className="w-full min-h-[160px] px-3 py-2 rounded-md border border-input bg-transparent text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            spellCheck={false}
          />
          <p className="text-[10px] text-muted-foreground">
            Format: KEY=VALUE (one per line, # comments ignored)
          </p>
        </div>
      )}
    </div>
  );
}
