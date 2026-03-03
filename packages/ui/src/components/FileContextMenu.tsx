import * as ContextMenu from '@radix-ui/react-context-menu';
import { Upload, Copy, Move, Trash2 } from 'lucide-react';

export type ContextAction = 'upload' | 'copy' | 'move' | 'delete';

interface FileContextMenuProps {
  entryType: 'file' | 'directory';
  children: React.ReactNode;
  onAction: (action: ContextAction) => void;
}

export function FileContextMenu({ entryType, children, onAction }: FileContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="min-w-[160px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 z-50"
        >
          {entryType === 'directory' && (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent"
              onSelect={() => onAction('upload')}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Files
            </ContextMenu.Item>
          )}

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent"
            onSelect={() => onAction('copy')}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy to...
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent"
            onSelect={() => onAction('move')}
          >
            <Move className="h-3.5 w-3.5" />
            Move to...
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-border my-1" />

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent text-destructive"
            onSelect={() => onAction('delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
