import { ChevronDown, FolderGit2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { ProjectLink } from '@/lib/api';

interface ProjectSelectorProps {
  links: ProjectLink[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
}

export function ProjectSelector({ links, selectedProjectId, onSelect }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLink = links.find(l => l.childProjectId === selectedProjectId);
  const label = selectedLink
    ? selectedLink.alias
    : 'All projects';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono bg-card/50 hover:bg-card border border-border/50 transition-colors"
      >
        <FolderGit2 className="h-3 w-3 text-primary" />
        <span className="truncate max-w-[120px]">{label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[160px]">
          {links.map((link) => (
            <button
              key={link.id}
              onClick={() => {
                onSelect(link.childProjectId);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors',
                selectedProjectId === link.childProjectId && 'bg-accent text-accent-foreground'
              )}
            >
              <span className="font-medium">{link.alias}</span>
              {link.childProject && (
                <span className="text-muted-foreground ml-1">({link.childProject.name})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
