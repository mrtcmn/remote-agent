import { useState } from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { KanbanStatus, KanbanPriority, AssigneeType, Project } from '@/lib/api';

const statusFilters: { value: KanbanStatus; label: string; color: string }[] = [
  { value: 'backlog', label: 'Backlog', color: 'bg-gray-400' },
  { value: 'todo', label: 'To Do', color: 'bg-blue-400' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-400' },
  { value: 'manual_testing', label: 'Testing', color: 'bg-orange-400' },
  { value: 'review_needed', label: 'Review', color: 'bg-purple-400' },
  { value: 'completed', label: 'Done', color: 'bg-green-400' },
];

const priorityFilters: { value: KanbanPriority; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const assigneeFilters: { value: AssigneeType; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'agent', label: 'Agent' },
  { value: 'unassigned', label: 'Unassigned' },
];

interface TaskFiltersProps {
  projects: Project[];
  selectedProjectId: string | undefined;
  onProjectChange: (projectId: string | undefined) => void;
  statusFilter: KanbanStatus[];
  onStatusFilterChange: (statuses: KanbanStatus[]) => void;
  priorityFilter: KanbanPriority[];
  onPriorityFilterChange: (priorities: KanbanPriority[]) => void;
  assigneeFilter: AssigneeType | undefined;
  onAssigneeFilterChange: (assignee: AssigneeType | undefined) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function TaskFilters({
  projects,
  selectedProjectId,
  onProjectChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  searchQuery,
  onSearchChange,
}: TaskFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeFilterCount = statusFilter.length + priorityFilter.length + (assigneeFilter ? 1 : 0) + (searchQuery ? 1 : 0);

  const toggleStatus = (status: KanbanStatus) => {
    if (statusFilter.includes(status)) {
      onStatusFilterChange(statusFilter.filter(s => s !== status));
    } else {
      onStatusFilterChange([...statusFilter, status]);
    }
  };

  const togglePriority = (priority: KanbanPriority) => {
    if (priorityFilter.includes(priority)) {
      onPriorityFilterChange(priorityFilter.filter(p => p !== priority));
    } else {
      onPriorityFilterChange([...priorityFilter, priority]);
    }
  };

  const clearAll = () => {
    onStatusFilterChange([]);
    onPriorityFilterChange([]);
    onAssigneeFilterChange(undefined);
    onSearchChange('');
  };

  return (
    <div className="space-y-3">
      {/* Main filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Project selector */}
        <select
          value={selectedProjectId || ''}
          onChange={(e) => onProjectChange(e.target.value || undefined)}
          className="h-9 px-3 text-sm rounded-md border bg-background min-w-[160px]"
        >
          <option value="">All Projects</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="h-9 pl-9 pr-8"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {/* Advanced toggle */}
        <Button
          variant={showAdvanced ? 'secondary' : 'outline'}
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex items-center justify-center h-4 min-w-[16px] px-1 text-[10px] font-medium rounded-full bg-primary text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAll}>
            Clear all
          </Button>
        )}
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="flex flex-wrap gap-4 p-3 rounded-lg border bg-muted/30">
          {/* Status filter */}
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">Status</span>
            <div className="flex flex-wrap gap-1">
              {statusFilters.map(s => (
                <button
                  key={s.value}
                  onClick={() => toggleStatus(s.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border transition-colors',
                    statusFilter.includes(s.value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted',
                  )}
                >
                  <div className={cn('h-2 w-2 rounded-full', s.color)} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority filter */}
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">Priority</span>
            <div className="flex flex-wrap gap-1">
              {priorityFilters.map(p => (
                <button
                  key={p.value}
                  onClick={() => togglePriority(p.value)}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md border transition-colors',
                    priorityFilter.includes(p.value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Assignee filter */}
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">Assignee</span>
            <div className="flex flex-wrap gap-1">
              {assigneeFilters.map(a => (
                <button
                  key={a.value}
                  onClick={() => onAssigneeFilterChange(assigneeFilter === a.value ? undefined : a.value)}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md border transition-colors',
                    assigneeFilter === a.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted',
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
