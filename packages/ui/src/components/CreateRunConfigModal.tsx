import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { PackageJsonScript, RunConfigAdapterType } from '@/lib/api';
import { cn } from '@/lib/utils';

interface CreateRunConfigModalProps {
  scripts: PackageJsonScript[];
  onClose: () => void;
  onCreate: (data: {
    name: string;
    adapterType: RunConfigAdapterType;
    command: Record<string, unknown>;
    autoRestart: boolean;
  }) => void;
  isPending?: boolean;
}

export function CreateRunConfigModal({
  scripts,
  onClose,
  onCreate,
  isPending,
}: CreateRunConfigModalProps) {
  const [name, setName] = useState('');
  const [adapterType, setAdapterType] = useState<RunConfigAdapterType>('npm_script');
  const [selectedScript, setSelectedScript] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [autoRestart, setAutoRestart] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let command: Record<string, unknown>;
    let finalName = name;

    if (adapterType === 'npm_script') {
      if (!selectedScript) return;
      command = { script: selectedScript };
      if (!finalName) finalName = selectedScript;
    } else {
      if (!customCommand.trim()) return;
      command = { command: customCommand };
      if (!finalName) finalName = customCommand.split(' ')[0];
    }

    onCreate({
      name: finalName,
      adapterType,
      command,
      autoRestart,
    });
  };

  const isValid =
    adapterType === 'npm_script' ? !!selectedScript : !!customCommand.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background rounded-xl border shadow-xl p-6 mx-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New Run Config</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Adapter type */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={cn(
                  'flex-1 px-3 py-2 text-sm rounded-md border transition-colors',
                  adapterType === 'npm_script'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'hover:bg-accent'
                )}
                onClick={() => setAdapterType('npm_script')}
              >
                npm Script
              </button>
              <button
                type="button"
                className={cn(
                  'flex-1 px-3 py-2 text-sm rounded-md border transition-colors',
                  adapterType === 'custom_command'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'hover:bg-accent'
                )}
                onClick={() => setAdapterType('custom_command')}
              >
                Custom Command
              </button>
            </div>
          </div>

          {/* Script selector or command input */}
          {adapterType === 'npm_script' ? (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Script</label>
              {scripts.length > 0 ? (
                <select
                  value={selectedScript}
                  onChange={(e) => {
                    setSelectedScript(e.target.value);
                    if (!name) setName(e.target.value);
                  }}
                  className="w-full h-9 px-3 rounded-md border bg-background text-sm"
                >
                  <option value="">Select a script...</option>
                  {scripts.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} — {s.command}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No scripts found in package.json
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Command</label>
              <Input
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder="e.g. node server.js"
                className="font-mono text-sm"
              />
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated from command"
              className="text-sm"
            />
          </div>

          {/* Auto-restart toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRestart}
              onChange={(e) => setAutoRestart(e.target.checked)}
              className="rounded border"
            />
            <span className="text-sm">Auto-restart on exit</span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isPending}>
              {isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
