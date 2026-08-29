import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, MessageSquare, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FileStatus = 'staged' | 'modified' | 'untracked';

export interface ChangeEntry {
  path: string;
  status: FileStatus;
}

export interface FileStat {
  added: number;
  deleted: number;
}

type TreeNode =
  | { kind: 'dir'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; entry: ChangeEntry };

/**
 * Groups flat git paths into a directory tree. Directory chains with a single
 * child collapse into one row ("packages/ui/src" instead of three), which is
 * what keeps a monorepo's deep paths readable.
 */
export function buildTree(entries: ChangeEntry[]): TreeNode[] {
  interface Raw {
    dirs: Map<string, Raw>;
    files: ChangeEntry[];
  }
  const root: Raw = { dirs: new Map(), files: [] };

  for (const entry of entries) {
    const parts = entry.path.split('/');
    parts.pop(); // the file name — only the directories build the tree
    let node = root;
    for (const part of parts) {
      let next = node.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push(entry);
  }

  const toNodes = (raw: Raw, prefix: string): TreeNode[] => {
    const dirs: TreeNode[] = [];
    for (const [name, child] of raw.dirs) {
      // Collapse a chain: one subdirectory and no files of its own.
      let label = name;
      let current = child;
      while (current.files.length === 0 && current.dirs.size === 1) {
        const [childName, grandChild] = [...current.dirs][0];
        label += `/${childName}`;
        current = grandChild;
      }
      const path = prefix ? `${prefix}/${label}` : label;
      dirs.push({ kind: 'dir', name: label, path, children: toNodes(current, path) });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    const files: TreeNode[] = raw.files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry) => ({ kind: 'file', name: entry.path.split('/').pop()!, entry }));
    return [...dirs, ...files];
  };

  return toNodes(root, '');
}

/** Every file path under a node, used for directory-level totals and actions. */
function filesUnder(node: TreeNode): ChangeEntry[] {
  if (node.kind === 'file') return [node.entry];
  return node.children.flatMap(filesUnder);
}

const statusConfig: Record<FileStatus, { color: string; label: string }> = {
  staged: { color: 'text-emerald-400', label: 'S' },
  modified: { color: 'text-amber-400', label: 'M' },
  untracked: { color: 'text-sky-400', label: 'U' },
};

interface ChangeTreeProps {
  entries: ChangeEntry[];
  stats?: Record<string, FileStat>;
  commentCounts: Map<string, number>;
  selectedFile: string | null;
  /** Paths force-expanded by the caller, e.g. while a filter is active. */
  expandAll?: boolean;
  onSelect: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  busy?: boolean;
}

export function ChangeTree({
  entries,
  stats,
  commentCounts,
  selectedFile,
  expandAll,
  onSelect,
  onStage,
  onUnstage,
  busy,
}: ChangeTreeProps) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  // Directories are open unless explicitly collapsed — a change list is short,
  // and hiding it behind clicks defeats the point.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'file') {
      return (
        <FileRow
          key={`f-${node.entry.path}`}
          entry={node.entry}
          name={node.name}
          depth={depth}
          stat={stats?.[node.entry.path]}
          commentCount={commentCounts.get(node.entry.path) ?? 0}
          isSelected={selectedFile === node.entry.path}
          onSelect={onSelect}
          onStage={onStage}
          onUnstage={onUnstage}
          busy={busy}
        />
      );
    }

    const isOpen = expandAll || !collapsed.has(node.path);
    const contained = filesUnder(node);
    const totals = contained.reduce(
      (acc, f) => {
        const s = stats?.[f.path];
        return { added: acc.added + (s?.added ?? 0), deleted: acc.deleted + (s?.deleted ?? 0) };
      },
      { added: 0, deleted: 0 }
    );
    const allStaged = contained.every((f) => f.status === 'staged');

    return (
      <div key={`d-${node.path}`}>
        <div
          className="group flex items-center gap-1 pr-1.5 py-[3px] text-[11px] text-muted-foreground hover:bg-accent/40 cursor-pointer"
          style={{ paddingLeft: 6 + depth * 10 }}
          onClick={() => toggle(node.path)}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <Folder className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate font-medium" title={node.path}>
            {node.name}
          </span>
          <span className="ml-auto shrink-0 tabular-nums opacity-60 group-hover:hidden">
            {contained.length}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const paths = contained.map((f) => f.path);
              allStaged ? onUnstage(paths) : onStage(paths);
            }}
            disabled={busy}
            className={cn(
              'ml-auto shrink-0 h-4 w-4 rounded items-center justify-center hidden group-hover:flex',
              allStaged
                ? 'text-rose-400 hover:bg-rose-500/20'
                : 'text-emerald-400 hover:bg-emerald-500/20'
            )}
            title={allStaged ? `Unstage ${contained.length} files` : `Stage ${contained.length} files`}
          >
            {allStaged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </button>
          {(totals.added > 0 || totals.deleted > 0) && (
            <span className="shrink-0 tabular-nums text-[9px]">
              <span className="text-emerald-400/70">+{totals.added}</span>{' '}
              <span className="text-rose-400/70">−{totals.deleted}</span>
            </span>
          )}
        </div>
        {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return <div>{tree.map((node) => renderNode(node, 0))}</div>;
}

function FileRow({
  entry,
  name,
  depth,
  stat,
  commentCount,
  isSelected,
  onSelect,
  onStage,
  onUnstage,
  busy,
}: {
  entry: ChangeEntry;
  name: string;
  depth: number;
  stat?: FileStat;
  commentCount: number;
  isSelected: boolean;
  onSelect: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  busy?: boolean;
}) {
  const config = statusConfig[entry.status];
  const isStaged = entry.status === 'staged';

  return (
    <div
      onClick={() => onSelect(entry.path)}
      className={cn(
        'group flex items-center gap-1.5 pr-1.5 py-[3px] font-mono text-xs cursor-pointer transition-colors',
        isSelected ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
      )}
      style={{ paddingLeft: 6 + depth * 10 }}
      title={entry.path}
    >
      <span className={cn('text-[10px] font-bold shrink-0 w-3 text-center', config.color)}>
        {config.label}
      </span>
      <span className="truncate flex-1">{name}</span>

      {commentCount > 0 && (
        <span className="flex items-center gap-0.5 text-[9px] text-sky-400 shrink-0">
          <MessageSquare className="h-2.5 w-2.5" />
          {commentCount}
        </span>
      )}

      {stat && (
        <span className="shrink-0 text-[9px] tabular-nums group-hover:hidden">
          <span className="text-emerald-400/80">+{stat.added}</span>{' '}
          <span className="text-rose-400/80">−{stat.deleted}</span>
        </span>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          isStaged ? onUnstage([entry.path]) : onStage([entry.path]);
        }}
        disabled={busy}
        className={cn(
          'shrink-0 h-5 w-5 rounded items-center justify-center hidden group-hover:flex',
          isStaged
            ? 'text-rose-400 hover:bg-rose-500/20'
            : 'text-emerald-400 hover:bg-emerald-500/20'
        )}
        title={isStaged ? 'Unstage file' : 'Stage file'}
      >
        {isStaged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
      </button>
    </div>
  );
}
