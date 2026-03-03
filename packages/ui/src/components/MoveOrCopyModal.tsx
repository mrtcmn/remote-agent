import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface MoveOrCopyModalProps {
  mode: 'copy' | 'move';
  sourcePath: string;
  onConfirm: (destination: string) => void;
  onClose: () => void;
  isPending?: boolean;
}

export function MoveOrCopyModal({ mode, sourcePath, onConfirm, onClose, isPending }: MoveOrCopyModalProps) {
  const parentDir = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '.';
  const [destination, setDestination] = useState(parentDir);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (destination.trim()) {
      onConfirm(destination.trim());
    }
  };

  const label = mode === 'copy' ? 'Copy' : 'Move';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background rounded-xl border shadow-xl p-6 mx-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{label} {sourcePath.includes('/') ? sourcePath.split('/').pop() : sourcePath}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Source</label>
            <p className="text-sm font-mono text-muted-foreground bg-muted px-3 py-2 rounded-md truncate">
              {sourcePath}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Destination</label>
            <Input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="path/to/destination"
              className="font-mono text-sm"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              Relative to project root
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!destination.trim() || isPending}>
              {isPending ? `${label}ing...` : label}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
