import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';

interface EnvEntry {
  key: string;
  value: string;
}

export function EnvEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['project-env', projectId],
    queryFn: () => api.getProjectEnv(projectId),
  });

  useEffect(() => {
    if (data?.env) {
      const parsed = Object.entries(data.env).map(([key, value]) => ({ key, value: String(value) }));
      setEntries(parsed.length > 0 ? parsed : [{ key: '', value: '' }]);
      setIsDirty(false);
    } else {
      setEntries([{ key: '', value: '' }]);
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
    const env: Record<string, string> = {};
    for (const entry of entries) {
      const key = entry.key.trim();
      if (key) {
        env[key] = entry.value;
      }
    }
    saveMutation.mutate(env);
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
        <h3 className="text-sm font-medium text-muted-foreground">Environment Variables</h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={addEntry} className="h-7 px-2 text-xs">
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
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
    </div>
  );
}
