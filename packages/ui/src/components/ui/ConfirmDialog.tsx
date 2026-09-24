import { useEffect } from 'react';
import { Button } from './Button';

/**
 * One question, two answers. Used where an action cannot be undone — deleting a
 * task takes its comments, plan and checklist with it.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    // Enter needs no handler: the confirm button takes focus and answers it.
    // A second one here would confirm twice.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-xl border bg-background p-4 shadow-xl animate-in zoom-in-95">
        <h3 className="text-sm font-semibold">{title}</h3>
        {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="destructive" autoFocus onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
