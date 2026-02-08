import { useState } from 'react';
import { X, Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { Project, KanbanStatus, KanbanPriority, AssigneeType, CreateTaskInput } from '@/lib/api';

interface CreateTaskModalProps {
  projects: Project[];
  defaultProjectId?: string;
  defaultStatus?: KanbanStatus;
  onClose: () => void;
  onCreate: (data: CreateTaskInput) => void;
}

export function CreateTaskModal({
  projects,
  defaultProjectId,
  defaultStatus,
  onClose,
  onCreate,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || '');
  const [status, setStatus] = useState<KanbanStatus>(defaultStatus || 'backlog');
  const [priority, setPriority] = useState<KanbanPriority>('medium');
  const [assigneeType, setAssigneeType] = useState<AssigneeType>('unassigned');
  const [autoFlow, setAutoFlow] = useState(false);
  const [branch, setBranch] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [githubIssueUrl, setGithubIssueUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;

    onCreate({
      projectId,
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      assigneeType,
      autoFlow,
      branch: branch.trim() || undefined,
      labels: labels.length > 0 ? labels : undefined,
      githubIssueUrl: githubIssueUrl.trim() || undefined,
    });
    onClose();
  };

  const handleAddLabel = () => {
    if (newLabel.trim() && !labels.includes(newLabel.trim())) {
      setLabels([...labels, newLabel.trim()]);
      setNewLabel('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background rounded-xl border shadow-xl p-6 mx-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Create Task</h2>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Project */}
          <div>
            <label className="text-sm font-medium block mb-1">Project *</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border bg-background"
              required
            >
              <option value="">Select project...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="text-sm font-medium block mb-1">Title *</label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title..."
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the task..."
              className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
            />
          </div>

          {/* Status & Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as KanbanStatus)}
                className="w-full h-9 px-3 text-sm rounded-md border bg-background"
              >
                <option value="backlog">Backlog</option>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="manual_testing">Manual Testing</option>
                <option value="review_needed">Review Needed</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as KanbanPriority)}
                className="w-full h-9 px-3 text-sm rounded-md border bg-background"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Assignee & Auto-Flow */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Assignee</label>
              <select
                value={assigneeType}
                onChange={(e) => setAssigneeType(e.target.value as AssigneeType)}
                className="w-full h-9 px-3 text-sm rounded-md border bg-background"
              >
                <option value="unassigned">Unassigned</option>
                <option value="user">User</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Auto-Flow</label>
              <button
                type="button"
                onClick={() => setAutoFlow(!autoFlow)}
                className={cn(
                  'w-full h-9 px-3 text-sm rounded-md border flex items-center justify-center gap-1.5 transition-colors',
                  autoFlow
                    ? 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-400'
                    : 'bg-background hover:bg-muted',
                )}
              >
                <Zap className="h-4 w-4" />
                {autoFlow ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          {/* Branch */}
          <div>
            <label className="text-sm font-medium block mb-1">Branch</label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feature/my-branch"
            />
          </div>

          {/* GitHub Issue */}
          <div>
            <label className="text-sm font-medium block mb-1">GitHub Issue URL</label>
            <Input
              value={githubIssueUrl}
              onChange={(e) => setGithubIssueUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/issues/123"
            />
          </div>

          {/* Labels */}
          <div>
            <label className="text-sm font-medium block mb-1">Labels</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {labels.map((label, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary">
                  {label}
                  <button type="button" onClick={() => setLabels(labels.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLabel(); } }}
                placeholder="Add label..."
                className="h-8 text-sm"
              />
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={handleAddLabel}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!title.trim() || !projectId}>
              <Plus className="h-4 w-4 mr-1" />
              Create Task
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
