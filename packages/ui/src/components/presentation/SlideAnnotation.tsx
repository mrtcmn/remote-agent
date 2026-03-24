import { useState } from 'react';
import { MessageSquarePlus, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { SlideAnnotation as SlideAnnotationType } from '@/lib/api';

interface SlideAnnotationProps {
  annotations: SlideAnnotationType[];
  onAdd: (text: string) => void;
  onDelete: (annotationId: string) => void;
  className?: string;
}

export function SlideAnnotation({ annotations, onAdd, onDelete, className }: SlideAnnotationProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setText('');
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsAdding(false);
      setText('');
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Existing annotations */}
      {annotations.map((annotation) => (
        <div
          key={annotation.id}
          className="flex items-start gap-2 rounded border border-border bg-muted/30 px-3 py-2 text-sm"
        >
          <span className="flex-1 text-muted-foreground">{annotation.text}</span>
          <button
            onClick={() => onDelete(annotation.id)}
            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {/* Add annotation */}
      {isAdding ? (
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a note..."
            className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="ghost" onClick={handleSubmit} disabled={!text.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setIsAdding(false); setText(''); }}>
              <span className="text-xs">Esc</span>
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Add note
        </button>
      )}
    </div>
  );
}
