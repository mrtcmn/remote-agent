import { useState, useRef } from 'react';
import {
  X, Edit3, Save, Trash2, GitBranch, Link2, Plus, Upload,
  Bot, User as UserIcon, ChevronRight, ArrowRight, AlertTriangle,
  Clock, Tag, Zap, ExternalLink, Image as ImageIcon,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { TaskComments } from './TaskComments';
import {
  api,
  type KanbanTask,
  type KanbanStatus,
  type KanbanPriority,
  type AssigneeType,
  type TaskAttachment,
} from '@/lib/api';

const statusOptions: { value: KanbanStatus; label: string; color: string }[] = [
  { value: 'backlog', label: 'Backlog', color: 'bg-gray-400' },
  { value: 'todo', label: 'To Do', color: 'bg-blue-400' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-400' },
  { value: 'manual_testing', label: 'Manual Testing', color: 'bg-orange-400' },
  { value: 'review_needed', label: 'Review Needed', color: 'bg-purple-400' },
  { value: 'completed', label: 'Completed', color: 'bg-green-400' },
];

const priorityOptions: { value: KanbanPriority; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: 'text-red-600' },
  { value: 'high', label: 'High', color: 'text-orange-600' },
  { value: 'medium', label: 'Medium', color: 'text-blue-600' },
  { value: 'low', label: 'Low', color: 'text-gray-500' },
];

interface TaskDetailPanelProps {
  task: KanbanTask;
  onClose: () => void;
  onUpdate: (data: Record<string, any>) => void;
  onDelete: () => void;
  onAddComment: (content: string, parentCommentId?: string) => void;
  onResolveComment: (commentId: string) => void;
  onRejectComment: (commentId: string) => void;
  onReopenComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onUploadAttachment: (file: File, commentId?: string) => void;
  onDeleteAttachment: (attachmentId: string) => void;
  onAddDependency: (dependsOnTaskId: string) => void;
  onRemoveDependency: (depId: string) => void;
}

export function TaskDetailPanel({
  task,
  onClose,
  onUpdate,
  onDelete,
  onAddComment,
  onResolveComment,
  onRejectComment,
  onReopenComment,
  onDeleteComment,
  onUploadAttachment,
  onDeleteAttachment,
  onAddDependency,
  onRemoveDependency,
}: TaskDetailPanelProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState(task.description || '');
  const [showDepInput, setShowDepInput] = useState(false);
  const [depTaskId, setDepTaskId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [showDetails, setShowDetails] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const labels: string[] = task.labels ? JSON.parse(task.labels) : [];
  const isBlocked = task.dependencies?.some(d => d.dependsOn && d.dependsOn.status !== 'completed');

  const handleSaveTitle = () => {
    if (editTitle.trim() && editTitle !== task.title) {
      onUpdate({ title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleSaveDesc = () => {
    if (editDesc !== (task.description || '')) {
      onUpdate({ description: editDesc });
    }
    setIsEditingDesc(false);
  };

  const handleAddLabel = () => {
    if (newLabel.trim() && !labels.includes(newLabel.trim())) {
      onUpdate({ labels: [...labels, newLabel.trim()] });
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (label: string) => {
    onUpdate({ labels: labels.filter(l => l !== label) });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadAttachment(file);
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-background border-l shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            {isBlocked && <AlertTriangle className="h-4 w-4 text-amber-500" />}
            <span className="text-xs text-muted-foreground font-mono">{task.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Title */}
          {isEditingTitle ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }}
                className="text-lg font-bold"
              />
              <Button size="icon" className="h-10 w-10" onClick={handleSaveTitle}>
                <Save className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <h2
              className="text-lg font-bold cursor-pointer hover:text-primary transition-colors"
              onClick={() => { setIsEditingTitle(true); setEditTitle(task.title); }}
            >
              {task.title}
              <Edit3 className="inline h-3.5 w-3.5 ml-2 opacity-0 group-hover:opacity-50" />
            </h2>
          )}

          {/* Status & Priority Row */}
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Status</label>
              <select
                value={task.status}
                onChange={(e) => onUpdate({ status: e.target.value })}
                className="h-8 px-2 text-sm rounded-md border bg-background cursor-pointer"
              >
                {statusOptions.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Priority</label>
              <select
                value={task.priority}
                onChange={(e) => onUpdate({ priority: e.target.value })}
                className="h-8 px-2 text-sm rounded-md border bg-background cursor-pointer"
              >
                {priorityOptions.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Assignee</label>
              <select
                value={task.assigneeType}
                onChange={(e) => onUpdate({ assigneeType: e.target.value })}
                className="h-8 px-2 text-sm rounded-md border bg-background cursor-pointer"
              >
                <option value="unassigned">Unassigned</option>
                <option value="user">User</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Auto-Flow</label>
              <button
                onClick={() => onUpdate({ autoFlow: !task.autoFlow })}
                className={cn(
                  'h-8 px-3 text-sm rounded-md border flex items-center gap-1.5 transition-colors',
                  task.autoFlow ? 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-700' : 'bg-background',
                )}
              >
                <Zap className="h-3.5 w-3.5" />
                {task.autoFlow ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Description</label>
            {isEditingDesc ? (
              <div>
                <textarea
                  autoFocus
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full min-h-[100px] px-3 py-2 text-sm rounded-md border bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={4}
                />
                <div className="flex gap-1 mt-1">
                  <Button size="sm" onClick={handleSaveDesc}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditingDesc(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'text-sm p-2 rounded-md border border-dashed cursor-pointer hover:bg-muted/50 transition-colors min-h-[60px]',
                  !task.description && 'text-muted-foreground italic',
                )}
                onClick={() => { setIsEditingDesc(true); setEditDesc(task.description || ''); }}
              >
                {task.description || 'Click to add description...'}
              </div>
            )}
          </div>

          {/* Collapsible Details */}
          <div>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
            >
              {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Details
            </button>

            {showDetails && (
              <div className="space-y-3 pl-1">
                {/* Branch */}
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={task.branch || ''}
                    onChange={(e) => onUpdate({ branch: e.target.value })}
                    placeholder="Branch name..."
                    className="h-7 text-xs flex-1"
                  />
                </div>

                {/* GitHub Issue */}
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={task.githubIssueUrl || ''}
                    onChange={(e) => onUpdate({ githubIssueUrl: e.target.value })}
                    placeholder="GitHub issue URL..."
                    className="h-7 text-xs flex-1"
                  />
                  {task.githubIssueUrl && (
                    <a href={task.githubIssueUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </a>
                  )}
                </div>

                {/* Estimated Effort */}
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={task.estimatedEffort || ''}
                    onChange={(e) => onUpdate({ estimatedEffort: e.target.value })}
                    placeholder="Estimated effort (e.g., 2h, 1d)..."
                    className="h-7 text-xs flex-1"
                  />
                </div>

                {/* Labels */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Labels</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {labels.map((label, i) => (
                      <span
                        key={i}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary"
                      >
                        {label}
                        <button onClick={() => handleRemoveLabel(label)} className="hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <div className="flex gap-1">
                      <Input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddLabel(); }}
                        placeholder="Add label..."
                        className="h-6 w-24 text-xs"
                      />
                      {newLabel && (
                        <Button size="sm" className="h-6 w-6 p-0" onClick={handleAddLabel}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dependencies */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-2">
              Dependencies ({task.dependencies?.length || 0})
            </label>
            <div className="space-y-1">
              {task.dependencies?.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 text-sm p-1.5 rounded-md bg-muted/50">
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={cn(
                    'flex-1 truncate',
                    dep.dependsOn?.status === 'completed' && 'line-through text-muted-foreground',
                  )}>
                    {dep.dependsOn?.title || dep.dependsOnTaskId}
                  </span>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded',
                    dep.dependsOn?.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                  )}>
                    {dep.dependsOn?.status || 'unknown'}
                  </span>
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => onRemoveDependency(dep.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {showDepInput ? (
                <div className="flex gap-1">
                  <Input
                    autoFocus
                    value={depTaskId}
                    onChange={(e) => setDepTaskId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && depTaskId.trim()) {
                        onAddDependency(depTaskId.trim());
                        setDepTaskId('');
                        setShowDepInput(false);
                      }
                      if (e.key === 'Escape') setShowDepInput(false);
                    }}
                    placeholder="Task ID to depend on..."
                    className="h-7 text-xs"
                  />
                  <Button size="sm" className="h-7" onClick={() => {
                    if (depTaskId.trim()) {
                      onAddDependency(depTaskId.trim());
                      setDepTaskId('');
                      setShowDepInput(false);
                    }
                  }}>Add</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowDepInput(true)}>
                  <Plus className="h-3 w-3" /> Add Dependency
                </Button>
              )}
            </div>
          </div>

          {/* Subtasks */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div>
              <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider block mb-2">
                Subtasks ({task.subtasks.length})
              </label>
              <div className="space-y-1">
                {task.subtasks.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2 text-sm p-1.5 rounded-md bg-muted/50">
                    <div className={cn(
                      'h-2 w-2 rounded-full',
                      sub.status === 'completed' ? 'bg-green-500' :
                      sub.status === 'in_progress' ? 'bg-yellow-500' : 'bg-gray-400',
                    )} />
                    <span className={cn('flex-1', sub.status === 'completed' && 'line-through text-muted-foreground')}>
                      {sub.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{sub.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                Attachments ({task.attachments?.length || 0})
              </label>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3 w-3" /> Upload
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.txt,.md,.zip"
                onChange={handleFileSelect}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {task.attachments?.map((att) => (
                <div key={att.id} className="relative group">
                  {att.mimetype.startsWith('image/') ? (
                    <a href={api.getAttachmentUrl(att.id)} target="_blank" rel="noopener noreferrer">
                      <img
                        src={api.getAttachmentUrl(att.id)}
                        alt={att.filename}
                        className="w-full h-24 object-cover rounded-md border"
                      />
                    </a>
                  ) : (
                    <a
                      href={api.getAttachmentUrl(att.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 text-xs rounded-md border bg-muted/50 h-24"
                    >
                      <span className="truncate">{att.filename}</span>
                    </a>
                  )}
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onDeleteAttachment(att.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Comments Section */}
          <TaskComments
            taskId={task.id}
            comments={task.comments || []}
            onAddComment={onAddComment}
            onResolveComment={onResolveComment}
            onRejectComment={onRejectComment}
            onReopenComment={onReopenComment}
            onDeleteComment={onDeleteComment}
            onUploadAttachment={onUploadAttachment}
          />
        </div>

        {/* Footer */}
        <div className="border-t p-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
          <span>Updated {new Date(task.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
