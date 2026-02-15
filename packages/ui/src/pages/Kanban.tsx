import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Loader2, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toaster';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel';
import { TaskFilters } from '@/components/kanban/TaskFilters';
import { CreateTaskModal } from '@/components/kanban/CreateTaskModal';
import { useKanbanBoard, useKanbanTask, useKanbanMutations } from '@/hooks/useKanban';
import { api, type KanbanTask, type KanbanStatus, type KanbanPriority, type AssigneeType } from '@/lib/api';

export function KanbanPage() {
  // Filter state
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<KanbanStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<KanbanPriority[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeType | undefined>();
  const [searchQuery, setSearchQuery] = useState('');

  // UI state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalDefaultStatus, setCreateModalDefaultStatus] = useState<KanbanStatus | undefined>();

  // Data
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });

  const { data: boardData, isLoading } = useKanbanBoard(selectedProjectId);
  const { data: selectedTask } = useKanbanTask(selectedTaskId);

  const mutations = useKanbanMutations();

  // Handlers
  const handleTaskClick = (task: KanbanTask) => {
    setSelectedTaskId(task.id);
  };

  const handleMoveTask = (taskId: string, status: KanbanStatus, position: number) => {
    mutations.moveTask.mutate(
      { id: taskId, status, position },
      {
        onError: (error) => {
          toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        },
      },
    );
  };

  const handleQuickAdd = (title: string, status: KanbanStatus) => {
    if (!selectedProjectId && projects.length === 0) {
      toast({ title: 'Error', description: 'No project available', variant: 'destructive' });
      return;
    }
    mutations.createTask.mutate(
      {
        projectId: selectedProjectId || projects[0].id,
        title,
        status,
      },
      {
        onError: (error) => {
          toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        },
      },
    );
  };

  const handleCreateTask = (data: Parameters<typeof api.createKanbanTask>[0]) => {
    mutations.createTask.mutate(data, {
      onSuccess: (task) => {
        toast({ title: 'Task created' });
        if (task) setSelectedTaskId(task.id);
      },
      onError: (error) => {
        toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
      },
    });
  };

  // Filter the board data client-side for status/priority/assignee/search
  const filteredBoardData = boardData ? {
    ...boardData,
    columns: boardData.columns
      .filter(col => statusFilter.length === 0 || statusFilter.includes(col.id))
      .map(col => ({
        ...col,
        tasks: col.tasks.filter(task => {
          if (priorityFilter.length > 0 && !priorityFilter.includes(task.priority)) return false;
          if (assigneeFilter && task.assigneeType !== assigneeFilter) return false;
          if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          return true;
        }),
      })),
  } : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Kanban Board</h1>
          <p className="text-muted-foreground text-sm">Manage tasks across your projects</p>
        </div>
        <Button className="gap-2" onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Task</span>
        </Button>
      </div>

      {/* Filters */}
      <TaskFilters
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Board */}
      <div className="flex-1 mt-4 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredBoardData ? (
          <KanbanBoard
            data={filteredBoardData}
            projectId={selectedProjectId}
            onTaskClick={handleTaskClick}
            onMoveTask={handleMoveTask}
            onQuickAdd={handleQuickAdd}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <LayoutGrid className="h-12 w-12 mb-4 opacity-50" />
            <p className="font-medium">No board data</p>
            <p className="text-sm">Select a project or create tasks to get started</p>
          </div>
        )}
      </div>

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={(data) => mutations.updateTask.mutate({ id: selectedTask.id, data })}
          onDelete={() => {
            mutations.deleteTask.mutate(selectedTask.id, {
              onSuccess: () => {
                setSelectedTaskId(null);
                toast({ title: 'Task deleted' });
              },
            });
          }}
          onAddComment={(content, parentCommentId) =>
            mutations.addComment.mutate({ taskId: selectedTask.id, content, parentCommentId })
          }
          onResolveComment={(commentId) => mutations.resolveComment.mutate(commentId)}
          onRejectComment={(commentId) => mutations.rejectComment.mutate(commentId)}
          onReopenComment={(commentId) => mutations.reopenComment.mutate(commentId)}
          onDeleteComment={(commentId) => mutations.deleteComment.mutate(commentId)}
          onUploadAttachment={(file, commentId) =>
            mutations.uploadAttachment.mutate({ taskId: selectedTask.id, file, commentId })
          }
          onDeleteAttachment={(id) => mutations.deleteAttachment.mutate(id)}
          onAddDependency={(dependsOnTaskId) =>
            mutations.addDependency.mutate({ taskId: selectedTask.id, dependsOnTaskId })
          }
          onRemoveDependency={(depId) => mutations.removeDependency.mutate(depId)}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          projects={projects}
          defaultProjectId={selectedProjectId}
          defaultStatus={createModalDefaultStatus}
          onClose={() => { setShowCreateModal(false); setCreateModalDefaultStatus(undefined); }}
          onCreate={handleCreateTask}
        />
      )}
    </div>
  );
}
